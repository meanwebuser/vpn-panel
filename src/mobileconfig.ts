import crypto from "node:crypto";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function uuidFromSeed(seed: string): string {
  const hex = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`.toUpperCase();
}

function identifierSuffix(clientId: string): string {
  return clientId.toLowerCase().replace(/[^a-z0-9.-]/g, "-").slice(0, 80);
}

export function smartDnsMobileconfig(input: {
  clientId: string;
  displayName?: string;
  dohUrl?: string;
  serverAddresses?: string[];
}): string {
  const clientId = input.clientId.trim();
  const dohUrl = input.dohUrl || `https://dns.example.com/dns-query/${encodeURIComponent(clientId)}`;
  const displayName = input.displayName?.trim() || "BezVPN Smart DNS";
  const serverAddresses = input.serverAddresses?.length ? input.serverAddresses : ["198.51.100.10"];
  const suffix = identifierSuffix(clientId);
  const profileIdentifier = `com.example.vpn.smartdns.${suffix}`;
  const dnsPayloadIdentifier = `${profileIdentifier}.dns`;
  const profileUuid = uuidFromSeed(`profile:${clientId}`);
  const dnsUuid = uuidFromSeed(`dns:${clientId}`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>DNSSettings</key>
      <dict>
        <key>DNSProtocol</key>
        <string>HTTPS</string>
        <key>ServerURL</key>
        <string>${escapeXml(dohUrl)}</string>
        <key>ServerAddresses</key>
        <array>
${serverAddresses.map((address) => `          <string>${escapeXml(address)}</string>`).join("\n")}
        </array>
      </dict>
      <key>PayloadDescription</key>
      <string>Use BezVPN Smart DNS over HTTPS.</string>
      <key>PayloadDisplayName</key>
      <string>${escapeXml(displayName)}</string>
      <key>PayloadIdentifier</key>
      <string>${escapeXml(dnsPayloadIdentifier)}</string>
      <key>PayloadScope</key>
      <string>System</string>
      <key>PayloadType</key>
      <string>com.apple.dnsSettings.managed</string>
      <key>PayloadUUID</key>
      <string>${dnsUuid}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>BezVPN Smart DNS profile for iOS, iPadOS and macOS.</string>
  <key>PayloadDisplayName</key>
  <string>${escapeXml(displayName)}</string>
  <key>PayloadIdentifier</key>
  <string>${escapeXml(profileIdentifier)}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadScope</key>
  <string>System</string>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${profileUuid}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
}
