const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sanitizeVirtualCache, sanitizeSmmServices } = require("../src/services/publicCatalog");
const { selectedServiceIds } = require("../src/constants/smmServices");
const { refreshPublicCatalog } = require("../scripts/refresh-public-catalog");
const { publishCatalog } = require("../scripts/publish-public-catalog");

test("public virtual catalog drops credentials, orders, unknown keys and private snapshot fields", () => {
  const at = Date.now() - 1000;
  const catalog = sanitizeVirtualCache({
    api_key: "SECRET", balance: 123, orders: [{ phone: "+15555555" }],
    "prices:server1:wa": { at, data: {
      "187": { wa: { cost: "0.35", count: "4", api_key: "SECRET", activationId: 123, sms: "5555" } },
      bad: { wa: { cost: 0.3, count: 3 } },
      "1": { wa: { cost: -1, count: 3 } },
    } },
    "virtual-number-snapshot:v4:server1:wa": { at, data: { countries: [{
      id: "US", code: "US", providerCountryId: "187", name_en: "United States SECRET", name_ar: "أمريكا", dialCode: "+1", flag: "🇺🇸", phone: "+15555555", apiKey: "SECRET", userId: 1,
    }] } },
  }, { secrets: ["SECRET"] });
  assert.deepEqual(catalog["prices:server1:wa"], { at, data: { "187": { wa: { cost: 0.35, count: 4 } } } });
  assert.equal(catalog["virtual-number-snapshot:v4:server1:wa"].data.countries[0].name_en, "US");
  const text = JSON.stringify(catalog);
  for (const privateText of ["SECRET", "api_key", "apiKey", "userId", "phone", "activationId", "sms", "orders", "balance"]) assert.ok(!text.includes(privateText));
});

test("SMM catalog selects supported services and strips private and URL-bearing fields", () => {
  const service = Number(selectedServiceIds[0]);
  const result = sanitizeSmmServices([
    { service, name: "Followers", type: "Default", rate: "0.05", min: 10, max: 1000, refill: true, api_key: "SECRET", description: "API key SECRET", link: "https://example.com/private" },
    { service: 999999999, rate: 1, min: 1, max: 1000 },
  ], { secrets: ["SECRET"] });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { service, name: "Followers", type: "Default", rate: "0.05", min: 10, max: 1000, category: "", refill: true });
});

test("missing configuration does not fetch or make old prices current", async () => {
  const at = Date.now() - 100000;
  const previous = { "prices:server1:wa": { at, data: { "187": { wa: { cost: 0.5, count: 2 } } } } };
  const result = await refreshPublicCatalog({ env: {}, previousVirtual: previous, fetchImpl: async () => { assert.fail("No credentials should mean no provider request"); } });
  assert.equal(result.updates, 0);
  assert.deepEqual(result.virtual, previous);
  assert.equal(result.status.providers.HeroSMS.status, "missing_configuration");
});

test("failed providers preserve last good catalog and timestamp", async () => {
  const at = Date.now() - 100000;
  const previous = { "prices:server2:wa": { at, data: { "1": { wa: { cost: 0.2, count: 10 } } } } };
  const result = await refreshPublicCatalog({ env: { GRIZZLY_API_KEY: "SECRET" }, previousVirtual: previous, fetchImpl: async () => { throw new Error("private SECRET error"); } });
  assert.equal(result.updates, 0);
  assert.deepEqual(result.virtual, previous);
  assert.equal(result.status.providers.Grizzly.status, "unavailable");
  assert.ok(!JSON.stringify(result).includes("SECRET"));
});

test("partial refresh updates successful service only while retaining failed service", async () => {
  const at = Date.now() - 100000;
  const now = Date.now();
  const oldTg = { at, data: { "1": { tg: { cost: 0.4, count: 6 } } } };
  const result = await refreshPublicCatalog({
    env: { GRIZZLY_API_KEY: "SECRET" }, previousVirtual: { "prices:server2:tg": oldTg }, now,
    fetchImpl: async (url) => ({ ok: true, text: async () => new URL(url).searchParams.get("service") === "wa" ? JSON.stringify({ "1": { wa: { cost: 0.2, count: 10, api_key: "SECRET", phone: "+12345" } } }) : "BAD_KEY" }),
  });
  assert.equal(result.updates, 1);
  assert.deepEqual(result.virtual["prices:server2:tg"], oldTg);
  assert.deepEqual(result.virtual["prices:server2:wa"], { at: now, data: { "1": { wa: { cost: 0.2, count: 10 } } } });
  assert.ok(!JSON.stringify(result).includes("SECRET"));
});

test("publisher creates an orphan catalog branch containing only public files", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultx-catalog-"));
  const at = Date.now();
  try {
    fs.writeFileSync(path.join(outputDir, "virtual-number-cache.json"), JSON.stringify({ "prices:server2:wa": { at, data: { "1": { wa: { cost: 0.5, count: 2, key: "SECRET" } } } }, users: [{ balance: 200 }] }));
    fs.writeFileSync(path.join(outputDir, "smm-services.json"), JSON.stringify({ at: 0, services: [] }));
    fs.writeFileSync(path.join(outputDir, "status.json"), JSON.stringify({ checkedAt: at, providers: { Grizzly: { status: "updated", refreshedServices: 1 } }, key: "SECRET" }));
    const calls = [];
    const result = await publishCatalog({ repository: "owner/repo", token: "SECRET", outputDir, fetchImpl: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url, body });
      return { ok: options.method !== "GET", status: options.method === "GET" ? 404 : 201, json: async () => ({ sha: "1234567890" }) };
    } });
    assert.equal(result.published, true);
    const tree = calls.find((call) => call.url.endsWith("/git/trees")).body;
    assert.equal(tree.base_tree, undefined);
    assert.deepEqual(tree.tree.map((item) => item.path), ["catalog/virtual-number-cache.json", "catalog/smm-services.json", "catalog/status.json"]);
    assert.ok(!JSON.stringify(tree).includes("SECRET"));
    assert.ok(!JSON.stringify(tree).includes("balance"));
    const commit = calls.find((call) => call.url.endsWith("/git/commits")).body;
    assert.equal(commit.parents, undefined);
    assert.equal(calls.at(-1).body.ref, "refs/heads/provider-catalog");
  } finally { fs.rmSync(outputDir, { recursive: true, force: true }); }
});
