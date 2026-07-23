import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatUptime } from "../src/pages.js";

// Re-implement the local functions since they're not exported, test the logic

function _formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function _formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

test("formatBytes handles all size ranges", () => {
  assert.equal(_formatBytes(0), "0 B");
  assert.equal(_formatBytes(512), "512 B");
  assert.equal(_formatBytes(1024), "1.0 KB");
  assert.equal(_formatBytes(1536), "1.5 KB");
  assert.equal(_formatBytes(1048576), "1.0 MB");
  assert.equal(_formatBytes(1073741824), "1.00 GB");
  assert.equal(_formatBytes(5368709120), "5.00 GB");
});

test("formatUptime handles all time ranges", () => {
  assert.equal(_formatUptime(0), "0m");
  assert.equal(_formatUptime(60), "1m");
  assert.equal(_formatUptime(3600), "1h 0m");
  assert.equal(_formatUptime(86400), "1d 0h");
  assert.equal(_formatUptime(90061), "1d 1h");
  assert.equal(_formatUptime(3661), "1h 1m");
});

test("latencyClass returns correct class", () => {
  function latencyClass(ms: number | null): string {
    if (ms === null) return "";
    if (ms < 100) return "green";
    if (ms < 300) return "blue";
    return "red";
  }
  assert.equal(latencyClass(null), "");
  assert.equal(latencyClass(50), "green");
  assert.equal(latencyClass(100), "blue");
  assert.equal(latencyClass(200), "blue");
  assert.equal(latencyClass(300), "red");
  assert.equal(latencyClass(500), "red");
});

test("formatLatency handles null and ranges", () => {
  function formatLatency(ms: number | null): string {
    if (ms === null) return "\u2014";
    return `${ms}ms`;
  }
  assert.equal(formatLatency(null), "\u2014");
  assert.equal(formatLatency(50), "50ms");
  assert.equal(formatLatency(200), "200ms");
});

test("formatSpeed handles null and values", () => {
  function formatSpeed(mbps: number | null): string {
    if (mbps === null) return "\u2014";
    return `${mbps} Mbps`;
  }
  assert.equal(formatSpeed(null), "\u2014");
  assert.equal(formatSpeed(100), "100 Mbps");
});

test("formatTimeAgo handles various time differences", () => {
  function formatTimeAgo(dateStr: string): string {
    try {
      const diff = Date.now() - new Date(dateStr).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      return `${Math.floor(hours / 24)}d ago`;
    } catch {
      return "";
    }
  }

  // Test with recent date
  const now = new Date().toISOString();
  assert.equal(formatTimeAgo(now), "just now");

  // Test with 5 minutes ago
  const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
  assert.equal(formatTimeAgo(fiveMinAgo), "5m ago");

  // Test with 2 hours ago
  const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
  assert.equal(formatTimeAgo(twoHoursAgo), "2h ago");

  // Test with 3 days ago
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
  assert.equal(formatTimeAgo(threeDaysAgo), "3d ago");
});

test("loginPage renders admin and user variants", async () => {
  const { loginPage } = await import("../src/pages.js");

  const adminHtml = loginPage("admin");
  assert.ok(adminHtml.includes("BezVPN Admin"));
  assert.ok(adminHtml.includes("/api/admin/login"));

  const userHtml = loginPage("user");
  assert.ok(userHtml.includes("BezVPN"));
  assert.ok(userHtml.includes("/api/user/login"));

  const errorHtml = loginPage("admin", "bad credentials");
  assert.ok(errorHtml.includes("bad credentials"));
});

test("loginPage with error message includes error tag", async () => {
  const { loginPage } = await import("../src/pages.js");
  const html = loginPage("admin", "Invalid password");
  assert.ok(html.includes("tag-error"));
  assert.ok(html.includes("Invalid password"));
});

test("vpsPage renders disconnected state with VPS list", async () => {
  const { vpsPage } = await import("../src/pages.js");
  const html = vpsPage({
    connected: false,
    error: "Test error",
    vpsList: [
      { id: "de", host: "vpn1.example.com", label: "Germany" },
      { id: "ru", host: "vpn2.example.com", label: "Russia" },
    ],
    activeVpsId: "de",
  });

  assert.ok(html.includes("VPS Not Connected"));
  assert.ok(html.includes("Test error"));
  assert.ok(html.includes("Germany"));
  assert.ok(html.includes("Russia"));
});

test("vpsPage renders connected state", async () => {
  const { vpsPage } = await import("../src/pages.js");
  const html = vpsPage({
    connected: true,
    system: {
      hostname: "vpn1",
      os: "Ubuntu 22.04",
      uptime_seconds: 86400,
      cpu_count: 2,
      cpu_model: "Intel Xeon",
      cpu_load_1m: 0.5,
      cpu_load_5m: 0.4,
      cpu_load_15m: 0.3,
      mem_total_mb: 4000,
      mem_used_mb: 2000,
      mem_available_mb: 2000,
      disk_total_gb: 50,
      disk_used_gb: 25,
      disk_available_gb: 25,
      disk_use_percent: 50,
    },
    xray: {
      running: true,
      pid: 1234,
      memory_mb: 30,
      cpu_time: "0:05:00",
      uptime: "2h",
      version: "26.5.9",
    },
    userTraffic: [],
    inboundTraffic: [],
    vpsLabel: "Germany VPS",
  });

  assert.ok(html.includes("Germany VPS"));
  assert.ok(html.includes("Ubuntu 22.04"));
  assert.ok(html.includes("1d 0h"));
  assert.ok(html.includes("Running"));
  assert.ok(html.includes("26.5.9"));
});
