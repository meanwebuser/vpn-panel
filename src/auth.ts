import { Buffer } from "node:buffer";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DbPool } from "./db.js";
import type { Account, AccountRole } from "./types.js";
import { verifyPassword } from "./passwords.js";
import { randomToken } from "./tokens.js";

const COOKIE_NAME = "vpn_panel_sid";
const SESSION_DAYS = 30;

/** Parse HTTP Basic credentials, preserving colons inside the password. */
export function basicCredentials(request: Pick<FastifyRequest, "headers">): { login: string; password: string } | null {
  const raw = request.headers.authorization;
  const authorization = Array.isArray(raw) ? raw[0] : raw;
  const match = typeof authorization === "string" ? /^Basic\s+(.+)$/i.exec(authorization) : null;
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator <= 0) return null;
  return { login: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

export async function accountForCredentials(
  pool: DbPool,
  login: string,
  password: string,
  role: AccountRole,
): Promise<Account | null> {
  const result = await pool.query<Account>(
    `select id::text, login, display_name, password_hash, role, enabled
     from accounts where login = $1 and role = $2`,
    [login, role],
  );
  const account = result.rows[0];
  if (!account || !account.enabled || !(await verifyPassword(password, account.password_hash))) {
    return null;
  }
  return account;
}

export async function accountForLogin(pool: DbPool, login: string, role: AccountRole): Promise<Account | null> {
  const result = await pool.query<Account>(
    `select id::text, login, display_name, password_hash, role, enabled
     from accounts where login = $1 and role = $2`,
    [login, role],
  );
  const account = result.rows[0];
  return account && account.enabled ? account : null;
}

export async function loginAccount(
  pool: DbPool,
  login: string,
  password: string,
  role: AccountRole,
): Promise<{ account: Account; sessionId: string } | null> {
  const account = await accountForCredentials(pool, login, password, role);
  if (!account) return null;

  const sessionId = randomToken(36);
  await pool.query(
    `insert into sessions (id, account_id, expires_at)
     values ($1, $2, now() + interval '${SESSION_DAYS} days')`,
    [sessionId, account.id],
  );
  return { account, sessionId };
}

export async function accountFromRequest(pool: DbPool, request: FastifyRequest): Promise<Account | null> {
  const sessionId = request.cookies[COOKIE_NAME];
  if (!sessionId) {
    return null;
  }
  const result = await pool.query<Account>(
    `select a.id::text, a.login, a.display_name, a.password_hash, a.role, a.enabled
     from sessions s
     join accounts a on a.id = s.account_id
     where s.id = $1 and s.expires_at > now() and a.enabled = true`,
    [sessionId],
  );
  return result.rows[0] || null;
}

export async function requireRole(
  pool: DbPool,
  request: FastifyRequest,
  reply: FastifyReply,
  role: AccountRole,
): Promise<Account | null> {
  const account = await accountFromRequest(pool, request);
  if (!account || account.role !== role) {
    if (request.headers.accept?.includes("text/html")) {
      reply.redirect(role === "admin" ? "/admin" : "/login");
      return null;
    }
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  return account;
}

export async function logout(pool: DbPool, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sessionId = request.cookies[COOKIE_NAME];
  if (sessionId) {
    await pool.query("delete from sessions where id = $1", [sessionId]);
  }
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(COOKIE_NAME, sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: true,
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}
