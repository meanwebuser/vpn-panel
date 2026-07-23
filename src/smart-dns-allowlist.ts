// smart-dns-allowlist.ts — manage the SmartDNS edge-allow-list (the in-memory
// store consulted by smartedge-go via /edge-auth). Used for plain DNS-over-UDP
// clients (routers that can't speak DoH/DoT) — those authenticate by source
// IP only, so the IP must be on the allow-list before DPI starts trusting it.
//
// Wired by /admin/smart-dns/allowlist (page) and /api/admin/smart-dns/allowlist
// (form handlers) on the VPN panel (worker-main).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { page as renderPage } from "./html.js";
import { escapeHtml } from "./html.js";

export type AllowedEntry = {
  ip: string;
  until: number;
  source: string;
  // New fields (smartdns-go ≥ post-permanent patch). Older builds returned
  // only ip/until/source — render defensively.
  permanent?: boolean;
  lastSeen?: number; // unix ms of last successful /edge-auth hit
  idleMs?: number; // ms since lastSeen (only present for permanent)
  expiresAt?: number; // lastSeen + inactivityMs (only present for permanent)
  inactivityMs?: number; // configured inactivity window for this entry
};

export type AllowlistResponse = {
  ok: boolean;
  now: number;
  ttlMs: number;
  allowed: AllowedEntry[];
};

// -----------------------------------------------------------------------
// SmartDNS HTTP client
// -----------------------------------------------------------------------

export function smartDnsBaseUrl(): string {
  return (process.env.SMART_DNS_URL || "http://worker-lan:8053").replace(/\/$/, "");
}

export function smartDnsToken(): string {
  return process.env.SMART_DNS_TOKEN || "";
}

export class SmartDnsClient {
  constructor(private readonly baseUrl: string = smartDnsBaseUrl(), private readonly token: string = smartDnsToken()) {}

  get isConfigured(): boolean {
    return this.token.length > 0;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.token) {
      throw new SmartDnsError(0, "SMART_DNS_TOKEN env var is empty on the panel");
    }
    const headers = new Headers(init.headers);
    headers.set("X-Edge-Auth-Token", this.token);
    const r = await fetch(`${this.baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new SmartDnsError(r.status, `smartdns ${path} ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json() as Promise<T>;
  }

  async listAllow(): Promise<AllowlistResponse> {
    const out = await this.req<AllowlistResponse>("/edge-allowlist", { method: "GET" });
    return { ...out, allowed: (out.allowed ?? []) };
  }

  async addAllow(input: {
    ip: string;
    clientId?: string;
    ttlMs?: number;
    domain?: string;
    port?: number;
    source?: string;
    permanent?: boolean;
  }): Promise<{ ok: boolean; ip: string; until: number }> {
    return this.req("/edge-allowlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ip: input.ip,
        clientId: input.clientId,
        ttlMs: input.ttlMs,
        domain: input.domain,
        port: input.port,
        source: input.source,
        permanent: input.permanent,
      }),
    });
  }

  async removeAllow(ip: string): Promise<{ ok: boolean; ip: string }> {
    return this.req(`/edge-allowlist?ip=${encodeURIComponent(ip)}`, { method: "DELETE" });
  }
}

export class SmartDnsError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "SmartDnsError";
  }
}

// -----------------------------------------------------------------------
// Source IP detection (Mac's public IP behind nginx proxy → request.ip)
// -----------------------------------------------------------------------

/**
 * Best-effort source IP for the user, walking X-Forwarded-For first.
 * Used to seed the allow-list with the user's *public* IP automatically,
 * not the LAN/RFC1918 address the request came from.
 */
export function publicIpFromRequest(request: { ip: string; headers: Record<string, unknown> }): string {
  const xff = request.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return normalizeIp(xff.split(",")[0].trim());
  }
  const xri = request.headers["x-real-ip"];
  if (typeof xri === "string" && xri.trim()) {
    return normalizeIp(xri.trim());
  }
  return normalizeIp(request.ip);
}

function normalizeIp(s: string): string {
  let v = (s || "").trim();
  if (v.startsWith("::ffff:")) v = v.slice(7);
  if (v.includes(",")) v = v.split(",")[0].trim();
  return v;
}

// -----------------------------------------------------------------------
// Formatting helpers
// -----------------------------------------------------------------------

/** Render a millisecond duration as a short human string. */
export function formatDuration(ms: number): string {
  const abs = Math.max(0, Math.round(ms));
  const sec = Math.floor(abs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 48) {
    const remMin = min - hr * 60;
    return remMin ? `${hr}h ${remMin}m` : `${hr}h`;
  }
  const days = Math.floor(hr / 24);
  const remHr = hr - days * 24;
  return remHr ? `${days}d ${remHr}h` : `${days}d`;
}

/** Render an absolute unix-ms timestamp as "YYYY-MM-DD HH:MM" in local TZ. */
export function formatLocalTime(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// -----------------------------------------------------------------------
// Page renderer
// -----------------------------------------------------------------------

export type AllowlistPageInput = {
  status: "ok" | "error" | null;
  message: string | null;
  detectedIp: string;
  entries: AllowedEntry[];
  ttlMs: number;
  serverNow: number;
  panelBaseUrl: string;
};

export function allowlistPage(input: AllowlistPageInput): string {
  const statusTag = input.status === "ok"
    ? `<p class="tag good">OK — ${escapeHtml(input.message || "saved")}</p>`
    : input.status === "error"
      ? `<p class="tag bad">ERROR — ${escapeHtml(input.message || "unknown")}</p>`
      : "";

  const detectedBlock = input.detectedIp
    ? `<p>Detected public IP: <code>${escapeHtml(input.detectedIp)}</code></p>
       <form method="post" action="/api/admin/smart-dns/allowlist/add" class="row">
         <input type="hidden" name="ip" value="${escapeHtml(input.detectedIp)}">
         <input type="hidden" name="ttlMs" value="86400000">
         <button class="btn" type="submit">Add my current IP (24h TTL)</button>
       </form>
       <form method="post" action="/api/admin/smart-dns/allowlist/add" class="row" style="margin-top:6px">
         <input type="hidden" name="ip" value="${escapeHtml(input.detectedIp)}">
         <input type="hidden" name="permanent" value="1">
         <button class="btn" type="submit">Pin my current IP as permanent</button>
         <span class="muted">Kept until ${escapeHtml(formatDuration(30 * 24 * 3600 * 1000))} of inactivity, then auto-removed</span>
       </form>`
    : `<p class="tag bad">Could not detect a public IP from the request — check X-Forwarded-For in nginx.</p>`;

  const rows = input.entries.length === 0
    ? `<tr><td colspan="6" class="muted">No entries yet. SmartDNS will auto-seed the IP once you enable it on a user and that user opens chatgpt.com (or any proxy-routed domain).</td></tr>`
    : input.entries
        .map((entry) => {
          const isPermanent = entry.permanent === true;
          // Non-permanent: classic "expires in" countdown against until.
          // Permanent: idle for X, expires at lastSeen + inactivityMs.
          let statusCell: string;
          let dueCell: string;
          let rowClass = "";
          if (isPermanent) {
            const idle = entry.idleMs ?? 0;
            const win = entry.inactivityMs ?? 0;
            const left = win > 0 ? Math.max(0, (entry.expiresAt ?? 0) - input.serverNow) : Number.POSITIVE_INFINITY;
            statusCell = `<span class="tag good">permanent</span>`;
            if (win <= 0) {
              dueCell = `<span class="muted">idle ${escapeHtml(formatDuration(idle))} · no expiry</span>`;
            } else if (left <= 0) {
              dueCell = `<span class="tag bad">idle ${escapeHtml(formatDuration(idle))} · past ${escapeHtml(formatDuration(win))} window</span>`;
              rowClass = ' class="warn"';
            } else if (left < win / 4) {
              dueCell = `<span class="tag bad">idle ${escapeHtml(formatDuration(idle))} · ${escapeHtml(formatDuration(left))} left → auto-remove</span>`;
              rowClass = ' class="warn"';
            } else {
              dueCell = `<span class="muted">idle ${escapeHtml(formatDuration(idle))} · ${escapeHtml(formatDuration(left))} left of ${escapeHtml(formatDuration(win))} window</span>`;
            }
          } else {
            const remainingMin = Math.max(0, Math.round((entry.until - input.serverNow) / 60000));
            statusCell = `<span class="tag">auto</span>`;
            if (entry.until > 0 && remainingMin <= 0) {
              dueCell = `<span class="tag bad">expired — pending GC</span>`;
              rowClass = ' class="warn"';
            } else {
              dueCell = `${escapeHtml(formatDuration(entry.until - input.serverNow))}`;
            }
          }
          const seenCell = entry.lastSeen && entry.lastSeen > 0
            ? `${escapeHtml(formatLocalTime(entry.lastSeen))} <span class="muted">(${escapeHtml(formatDuration(input.serverNow - entry.lastSeen))} ago)</span>`
            : `<span class="muted">never</span>`;
          return `<tr${rowClass}>
            <td><code>${escapeHtml(entry.ip)}</code></td>
            <td>${statusCell}</td>
            <td>${dueCell}</td>
            <td>${seenCell}</td>
            <td><code>${escapeHtml(entry.source)}</code></td>
            <td>
              <form method="post" action="/api/admin/smart-dns/allowlist/remove" style="display:inline">
                <input type="hidden" name="ip" value="${escapeHtml(entry.ip)}">
                <button class="btn warn" type="submit">Remove</button>
              </form>
            </td>
          </tr>`;
        })
        .join("\n");

  const allowSet = new Set(input.entries.map((e) => e.ip));
  const detectedExists = input.detectedIp && allowSet.has(input.detectedIp);
  const detectedPermanent = !!input.detectedIp && input.entries.find((e) => e.ip === input.detectedIp)?.permanent === true;

  return renderPage(
    "SmartDNS — IP allow-list (UDP)",
    `<section class="hero">
       <div><a href="/admin/smart-dns">← SmartDNS</a><h1>DNS-over-UDP allow-list</h1>
       <p class="muted">Plain DNS (UDP/5353) clients authenticate by source IP. Add the public IP of the
       router (or any DoT/DoH-less device) here so DPI trusts its tagged SNI traffic.
       <br>Auto-entries (smart-edge auto-insert) TTL: ${Math.round(input.ttlMs / 3600000)}h, refreshes on every successful /edge-auth hit.
       Manual entries tagged <code>panel:*</code> are <b>permanent</b> and auto-removed after 30d of inactivity.</p></div>
     </section>
     <section class="grid">
       <article class="card">
         <h2>Quick add</h2>
         ${statusTag}
         ${detectedBlock}
         ${detectedExists ? `<p class="tag good">Your IP is already on the allow-list${detectedPermanent ? " (permanent)" : ""}.</p>` : ""}
         <h3 style="margin-top:18px">Add any IP manually</h3>
         <form method="post" action="/api/admin/smart-dns/allowlist/add" class="grid">
           <label class="third">IP address<input class="input" name="ip" placeholder="203.0.113.42" required pattern="^[0-9.]+$"></label>
           <label class="third">TTL (hours)<input class="input" name="ttlHours" value="24" pattern="^[0-9]+$"></label>
           <label class="third">Source tag<input class="input" name="source" value="manual" placeholder="manual"></label>
           <div class="wide"><button class="btn" type="submit">Add as auto (TTL)</button>
             <button class="btn" type="submit" formaction="/api/admin/smart-dns/allowlist/add" name="permanent" value="1" style="margin-left:6px">Add as permanent</button>
           </div>
         </form>
       </article>
       <article class="card">
         <h2>Live entries <span class="tag">${input.entries.length}</span></h2>
         <table style="width:100%; border-collapse:collapse">
           <thead>
             <tr><th align="left">IP</th><th align="left">type</th><th align="left">expiry</th><th align="left">last seen</th><th align="left">source</th><th></th></tr>
           </thead>
           <tbody>${rows}</tbody>
         </table>
         <p class="muted" style="margin-top:10px">Panel API base: <code>${escapeHtml(input.panelBaseUrl)}</code></p>
       </article>
     </section>`,
  );
}