import test from "node:test";
import assert from "node:assert/strict";
import { personalizedAnnounce } from "../src/subscriptions.js";

test("personalizedAnnounce returns a non-empty string", () => {
  const result = personalizedAnnounce("Иван", "ivan", new Date(2024, 5, 10, 14, 0)); // Monday 14:00
  assert.ok(result.length > 0);
  assert.ok(result.includes("Иван"), `Should include the name, got: ${result}`);
});

test("personalizedAnnounce uses nameOverrides when login matches", () => {
  // "ovign" has an override: "мама Ольга"
  const result = personalizedAnnounce("Ольга", "ovign", new Date(2024, 5, 10, 10, 0));
  assert.ok(result.includes("мама Ольга"), `Should use override, got: ${result}`);
});

test("personalizedAnnounce morning greeting at 8am", () => {
  const morning = new Date(2024, 5, 10, 8, 0); // 8am
  const result = personalizedAnnounce("Test", "test", morning);
  assert.ok(result.includes("Test"), `Should include name, got: ${result}`);
});

test("personalizedAnnounce evening greeting at 20pm", () => {
  const evening = new Date(2024, 5, 10, 20, 0); // 8pm
  const result = personalizedAnnounce("Test", "test", evening);
  assert.ok(result.includes("Test"), `Should include name, got: ${result}`);
});

test("happDeeplink produces valid URL with base64url encoding", async () => {
  const { happDeeplink } = await import("../src/subscriptions.js");
  const subUrl = "https://vpn.example.com/sub/abc123/plain";
  const link = happDeeplink(subUrl);
  assert.ok(link.startsWith("happ://subscription-url/add/"), `Link should start with happ://subscription-url/add/, got: ${link}`);
  // The encoded part should be base64url of the URL
  const encoded = link.replace("happ://subscription-url/add/", "");
  const decoded = Buffer.from(encoded, "base64url").toString("utf8");
  assert.equal(decoded, subUrl);
});

test("subscriptionUrl generates correct paths", async () => {
  const { subscriptionUrl } = await import("../src/subscriptions.js");
  assert.equal(subscriptionUrl("https://vpn.example.com", "abc123"), "https://vpn.example.com/sub/abc123/plain");
  assert.equal(subscriptionUrl("https://vpn.example.com", "abc123", "v2ray"), "https://vpn.example.com/sub/abc123/v2ray");
  assert.equal(subscriptionUrl("https://vpn.example.com", "abc123", "happ"), "https://vpn.example.com/sub/abc123/happ");
  assert.equal(subscriptionUrl("https://vpn.example.com", "abc123", "sing-box"), "https://vpn.example.com/sub/abc123/sing-box");
});

test("announceHeader produces base64: prefixed string", async () => {
  const { announceHeader } = await import("../src/subscriptions.js");
  const msg = "Test message with UTF-8: Привет";
  const header = announceHeader(msg);
  assert.ok(header.startsWith("base64:"), "Should start with base64:");
  const decoded = Buffer.from(header.replace("base64:", ""), "base64").toString("utf8");
  assert.equal(decoded, msg);
});
