import test from "node:test";
import assert from "node:assert/strict";
import { serviceCatalogEditor } from "../src/service-catalog-ui.js";
import type { ServiceCatalog, ServiceTargetCapability } from "../src/service-catalog.js";

const targets: ServiceTargetCapability[] = [
  { id: "vps-\"lan", publicDnsEdge: false, lanEgress: true, lanBalancerTag: "lan" },
  { id: "vps-external", publicDnsEdge: true, lanEgress: false },
];

function catalog(...services: ServiceCatalog["services"]): ServiceCatalog {
  return { schemaVersion: 2, updatedAt: "2026-07-19T00:00:00.000Z", description: "test", services };
}

test("renders both scopes and dynamically named checked pool target", () => {
  const html = serviceCatalogEditor({
    catalog: catalog({
      id: "chat-service",
      label: "Chat",
      domains: [{ match: "suffix", value: "chat.example" }],
      workIn: "both",
      routeTo: { kind: "vps-pool", allowedVpsIds: ['vps-"lan'], onNoHealthyTarget: "servfail" },
    }),
    targets,
    saveAction: "/save",
  });
  assert.match(html, /name="workInLan"[^>]*checked/);
  assert.match(html, /name="workInExternal"[^>]*checked/);
  assert.match(html, /name="allowedVpsIds"[^>]*value="vps-&quot;lan"[^>]*checked/);
});

test("disables incompatible LAN targets with a reason", () => {
  const html = serviceCatalogEditor({
    catalog: catalog({ id: "lan-service", label: "LAN", domains: [{ match: "exact", value: "lan.example" }], workIn: "lan-only", routeTo: { kind: "vps-pool", allowedVpsIds: ["vps-\"lan"], onNoHealthyTarget: "direct" } }),
    targets,
    saveAction: "/save",
  });
  assert.match(html, /value="vps-external"[^>]*disabled/);
  assert.match(html, /requires LAN egress/i);
});

test("direct route checks Direct and disables every VPS checkbox", () => {
  const html = serviceCatalogEditor({
    catalog: catalog({ id: "direct-service", label: "Direct", domains: [{ match: "exact", value: "direct.example" }], workIn: "external", routeTo: { kind: "direct" } }),
    targets,
    saveAction: "/save",
  });
  assert.match(html, /name="routeKind" value="direct"[^>]*checked/);
  assert.doesNotMatch(html, /name="routeKind" value="vps-pool"[^>]*checked/);
  assert.equal((html.match(/name="allowedVpsIds"[^>]*disabled/g) ?? []).length, targets.length);
});

test("escapes text and attributes and renders empty state", () => {
  const html = serviceCatalogEditor({
    catalog: catalog({ id: "unsafe", label: '<b>"unsafe"</b>', domains: [{ match: "exact", value: "safe.example" }], workIn: "external", routeTo: { kind: "direct" } }),
    targets: [{ id: 'x" onfocus="alert(1)', publicDnsEdge: true, lanEgress: false }],
    saveAction: '/save?next="bad"',
  });
  assert.match(html, /&lt;b&gt;&quot;unsafe&quot;&lt;\/b&gt;/);
  assert.match(html, /action="\/save\?next=&quot;bad&quot;"/);
  assert.match(html, /value="x&quot; onfocus=&quot;alert\(1\)"/);

  const empty = serviceCatalogEditor({ catalog: catalog(), targets, saveAction: "/save" });
  assert.match(empty, /No services configured/i);
});
