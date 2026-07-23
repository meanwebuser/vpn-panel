import { randomBytes } from "node:crypto";

export type AppConfig = {
  databaseUrl: string;
  host: string;
  port: number;
  sessionSecret: string;
  adminLogin: string;
  adminPassword?: string;
  secureConfigPath: string;
  publicBaseUrl: string;
  healthApiKey: string;
};

export function loadAppConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return {
    databaseUrl,
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || "3129"),
    sessionSecret:
      process.env.VPN_PANEL_SESSION_SECRET ||
      process.env.VPN_PANEL_SECRET ||
      randomBytes(32).toString("hex"),
    adminLogin: process.env.VPN_PANEL_ADMIN_LOGIN || "admin",
    adminPassword: process.env.VPN_PANEL_ADMIN_PASSWORD || process.env.VPN_PANEL_PASSWORD,
    secureConfigPath:
      process.env.VPN_PANEL_SECURE_CONFIG ||
      process.env.VPN_PANEL_CONFIG ||
      "/etc/vpn-panel/secure.json",
    publicBaseUrl: (process.env.VPN_PANEL_PUBLIC_BASE_URL || "https://panel.example.com").replace(/\/$/, ""),
    healthApiKey: process.env.VPN_PANEL_HEALTH_API_KEY || "",
  };
}
