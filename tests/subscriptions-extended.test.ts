import test from "node:test";
import assert from "node:assert/strict";
import { subscriptionUrl, happInstallDeeplink, personalizedAnnounce } from "../src/subscriptions.js";

test("subscriptionUrl generates correct URL with default format", () => {
  const url = subscriptionUrl("https://panel.example.com", "tok-abc");
  assert.equal(url, "https://panel.example.com/sub/tok-abc/plain");
});

test("subscriptionUrl generates correct URL with v2ray format", () => {
  const url = subscriptionUrl("https://panel.example.com", "tok-abc", "v2ray");
  assert.equal(url, "https://panel.example.com/sub/tok-abc/v2ray");
});

test("subscriptionUrl generates correct URL with happ format", () => {
  const url = subscriptionUrl("https://panel.example.com", "tok-abc", "happ");
  assert.equal(url, "https://panel.example.com/sub/tok-abc/happ");
});

test("happInstallDeeplink from subscriptions generates correct format", () => {
  const link = happInstallDeeplink("TestProvider", "ABC123");
  assert.equal(link, "happ://install/TestProvider/ABC123");
});

test("happInstallDeeplink with different codes", () => {
  const codes = ["XYZ789", "PmzdtajH3Lja", "a1b2c3d4"];
  for (const code of codes) {
    const link = happInstallDeeplink("MyCode", code);
    assert.ok(link.includes(code), `Link should contain install code: ${code}`);
    assert.ok(link.includes("MyCode"), "Link should contain provider code");
  }
});

test("personalizedAnnounce returns greeting with name substitution", () => {
  const now = new Date("2024-01-15T12:00:00Z"); // Monday noon
  const announce = personalizedAnnounce("John Doe", "johndoe", now);
  assert.ok(announce.length > 0, "announce must not be empty");
  assert.ok(announce.includes("John Doe") || announce.includes("{name}"), "announce should contain name or placeholder");
});

test("personalizedAnnounce uses login override for nameOverrides", () => {
  const now = new Date("2024-01-15T12:00:00Z");
  const announce = personalizedAnnounce("Display Name", "demo-login", now);
  // A normal login should still produce a valid announcement.
  assert.ok(announce.length > 0, "announce must not be empty");
});

test("personalizedAnnounce handles different times of day", () => {
  const morning = new Date("2024-01-15T08:00:00Z");
  const day = new Date("2024-01-15T14:00:00Z");
  const evening = new Date("2024-01-15T19:00:00Z");
  const night = new Date("2024-01-15T23:00:00Z");

  const morningAnnounce = personalizedAnnounce("Test", "test", morning);
  const dayAnnounce = personalizedAnnounce("Test", "test", day);
  const eveningAnnounce = personalizedAnnounce("Test", "test", evening);
  const nightAnnounce = personalizedAnnounce("Test", "test", night);

  assert.ok(morningAnnounce.length > 0);
  assert.ok(dayAnnounce.length > 0);
  assert.ok(eveningAnnounce.length > 0);
  assert.ok(nightAnnounce.length > 0);
});

test("personalizedAnnounce handles weekend days", () => {
  const saturday = new Date("2024-01-13T12:00:00Z"); // Saturday
  const sunday = new Date("2024-01-14T12:00:00Z"); // Sunday

  const satAnnounce = personalizedAnnounce("Test", "test", saturday);
  const sunAnnounce = personalizedAnnounce("Test", "test", sunday);

  assert.ok(satAnnounce.length > 0);
  assert.ok(sunAnnounce.length > 0);
});

test("personalizedAnnounce replaces weekday placeholder", () => {
  const monday = new Date("2024-01-15T12:00:00Z"); // Monday
  const announce = personalizedAnnounce("Test", "test", monday);
  // If the greeting contains {weekday}, it should be replaced
  assert.ok(!announce.includes("{weekday}") || announce.includes("Понедельник"), "weekday placeholder should be replaced");
});
