const fs = require("node:fs");
const path = require("node:path");
const { SERVICE_CODES, sanitizeSmsPrices, sanitizeVirtualCache, sanitizeSmmServices } = require("../src/services/publicCatalog");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

function safeUrls(value, fallback = "") {
  return String(value || fallback).split(",").map((entry) => entry.trim()).filter((entry) => {
    try { const u = new URL(entry); return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash; } catch { return false; }
  });
}

async function fetchProviderJson(urls, params, fetchImpl) {
  for (const base of urls) {
    try {
      const url = new URL(base);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" }, redirect: "error" });
      if (!response.ok) continue;
      const content = await response.text();
      if (content.length > 10 * 1024 * 1024) continue;
      const data = JSON.parse(content);
      if (data && typeof data === "object" && !data.error) return data;
    } catch { /* URLs and provider errors may contain API keys; do not log them. */ }
  }
  return null;
}

async function refreshPublicCatalog({ env = process.env, previousVirtual = {}, previousSmm = {}, seedVirtual = {}, fetchImpl = fetch, now = Date.now() } = {}) {
  const secrets = [env.HERO_SMS_API_KEY, env.HERO_API_KEY, env.GRIZZLY_API_KEY, env.SMM_API_KEY].filter(Boolean);
  const options = { secrets };
  const virtual = { ...sanitizeVirtualCache(seedVirtual, options), ...sanitizeVirtualCache(previousVirtual, options) };
  const smm = { at: Number(previousSmm.at) || 0, services: sanitizeSmmServices(previousSmm, options) };
  const status = {};
  let updates = 0;
  const providers = [
    { key: "server1", name: "HeroSMS", apiKey: env.HERO_SMS_API_KEY || env.HERO_API_KEY, urls: safeUrls(env.HERO_BASE_URLS || env.HERO_BASE_URL, "https://hero-sms.com/stubs/handler_api.php") },
    { key: "server2", name: "Grizzly", apiKey: env.GRIZZLY_API_KEY, urls: safeUrls(env.GRIZZLY_BASE_URLS || env.GRIZZLY_BASE_URL, "https://api.grizzlysms.com/stubs/handler_api.php") },
  ];
  const jobs = [];
  for (const provider of providers) {
    status[provider.name] = { status: provider.apiKey && provider.urls.length ? "unavailable" : "missing_configuration", refreshedServices: 0 };
    if (provider.apiKey && provider.urls.length) for (const service of SERVICE_CODES) jobs.push({ provider, service });
  }
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
    while (index < jobs.length) {
      const { provider, service } = jobs[index++];
      const raw = await fetchProviderJson(provider.urls, { api_key: provider.apiKey, action: "getPrices", service }, fetchImpl);
      const data = sanitizeSmsPrices(raw, service);
      if (!Object.keys(data).length) continue; // Keep the last good prices and original timestamp.
      virtual[`prices:${provider.key}:${service}`] = { at: now, data };
      status[provider.name].status = "updated";
      status[provider.name].refreshedServices += 1;
      updates += 1;
    }
  }));
  const smmUrls = safeUrls(env.SMM_API_URL);
  status.SMM = { status: env.SMM_API_KEY && smmUrls.length ? "unavailable" : "missing_configuration", refreshedServices: 0 };
  if (env.SMM_API_KEY && smmUrls.length) {
    const raw = await fetchProviderJson(smmUrls, { key: env.SMM_API_KEY, action: "services" }, fetchImpl);
    const services = sanitizeSmmServices(raw, options);
    if (services.length) {
      smm.at = now;
      smm.services = services;
      status.SMM = { status: "updated", refreshedServices: services.length };
      updates += 1;
    }
  }
  return { virtual, smm, status: { checkedAt: now, providers: status }, updates };
}

async function main() {
  const input = path.resolve(process.env.CATALOG_INPUT_DIR || "catalog");
  const output = path.resolve(process.env.CATALOG_OUTPUT_DIR || "catalog-output");
  const result = await refreshPublicCatalog({
    previousVirtual: readJson(path.join(input, "virtual-number-cache.json")),
    previousSmm: readJson(path.join(input, "smm-services.json")),
    seedVirtual: readJson(path.resolve(__dirname, "../data/virtual-number-cache.json")),
  });
  console.log(JSON.stringify({ updates: result.updates, providers: result.status.providers }));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ["## Public catalog refresh", "", "| Provider | Status | Refreshed services |", "| --- | --- | --- |"];
    for (const [name, entry] of Object.entries(result.status.providers)) lines.push(`| ${name} | ${entry.status} | ${entry.refreshedServices} |`);
    lines.push("", "Missing configuration requires repository Actions secrets. Provider failures keep the last successful catalog and do not publish empty prices.");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
  if (!result.updates) return;
  fs.mkdirSync(output, { recursive: true });
  for (const [name, value] of [["virtual-number-cache.json", result.virtual], ["smm-services.json", result.smm], ["status.json", result.status]]) {
    fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
  }
}

if (require.main === module) main().catch(() => { console.error("Public catalog refresh failed; previous catalog retained."); process.exitCode = 1; });
module.exports = { refreshPublicCatalog, safeUrls };
