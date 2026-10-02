const { logBotError } = require("./errorLogger");
const { getGrizzlyServiceCode, getGrizzlyCountryMeta, grizzlyServices } = require("../constants/grizzly");
const { getSmsProvider } = require("../constants/smsProviders");
const { VIRTUAL_CACHE_PATH } = require("../config");
const { saveData } = require("./jsonStorage");
const { getAxiosNetworkOptions } = require("../utils/network");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_STALE_PRICE_MS = 24 * 60 * 60 * 1000;
const REFRESH_RETRY_MS = 60 * 1000;
const GRIZZLY_PRICES_PAGE_SIZE = 36;
const priceCache = new Map();
const priceRequests = new Map();
const refreshAttempts = new Map();
let fileCacheMemory = null;
let cacheFlushTimer = null;
let cacheVersion = 0;
let fullRefreshRequest = null;
let publicCatalogRequest = null;
const REQUEST_TIMEOUT_MS = 10000;
const DEBUG_HERO = String(process.env.DEBUG_HERO || "1") !== "0";
const USD_TO_RUB = 30;

function getCacheKey(providerKey, serviceCode) {
  return `prices:${providerKey}:${serviceCode}`;
}

function parseProviderBaseUrls(providerKey) {
  const provider = getSmsProvider(providerKey);
  const envValue = providerKey === "server1" ? process.env.HERO_BASE_URLS : process.env.GRIZZLY_BASE_URLS;
  const urls = String(envValue || provider.baseUrl || "").split(",").map((value) => value.trim()).filter(Boolean);
  return urls.length ? urls : [provider.baseUrl];
}

function buildProviderUrl(baseUrl, providerKey, params) {
  const provider = getSmsProvider(providerKey);
  if (!provider.apiKey) throw new Error(`Missing API key for provider ${provider.key}`);
  const query = new URLSearchParams({ api_key: provider.apiKey, ...params });
  return `${baseUrl}?${query.toString()}`;
}

function parseProviderResponse(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) throw new Error("Empty response from SMS provider API");
  if (/^(BAD_|ERROR|NO_)/i.test(trimmed)) throw new Error(`SMS provider API error: ${trimmed}`);
  return JSON.parse(trimmed);
}

function readFileCache() {
  if (fileCacheMemory) return fileCacheMemory;
  try {
    const source = fs.existsSync(VIRTUAL_CACHE_PATH) ? VIRTUAL_CACHE_PATH : path.resolve(__dirname, "../../data/virtual-number-cache.json");
    if (!fs.existsSync(source)) return (fileCacheMemory = {});
    fileCacheMemory = JSON.parse(fs.readFileSync(source, "utf8") || "{}") || {};
    return fileCacheMemory;
  } catch (error) {
    logBotError("grizzlyService.readFileCache", error);
    return (fileCacheMemory = {});
  }
}

function writeFileCache(next) {
  fileCacheMemory = next;
  cacheVersion += 1;
  if (cacheFlushTimer) return;
  cacheFlushTimer = setTimeout(() => {
    cacheFlushTimer = null;
    try { saveData(VIRTUAL_CACHE_PATH, fileCacheMemory); }
    catch (error) { logBotError("grizzlyService.writeFileCache", error); }
  }, 1500);
  cacheFlushTimer.unref?.();
}

function readCachedPriceEntry(providerKey, serviceCode) {
  const entry = readFileCache()[getCacheKey(providerKey, serviceCode)];
  if (!entry || !Number.isFinite(Number(entry.at)) || Number(entry.at) <= 0 || !entry.data || typeof entry.data !== "object" || Array.isArray(entry.data)) return null;
  return entry;
}

function getCachedPriceInfo(serviceCode, providerKey = "server2") {
  const key = getCacheKey(providerKey, serviceCode);
  const memory = priceCache.get(key);
  const file = readCachedPriceEntry(providerKey, serviceCode);
  const entry = memory && (!file || Number(memory.at) >= Number(file.at)) ? memory : file;
  if (!entry) return null;
  const ageMs = Math.max(0, Date.now() - Number(entry.at));
  if (ageMs > MAX_STALE_PRICE_MS || Number(entry.at) > Date.now() + 5 * 60 * 1000) return null;
  return { data: entry.data, at: Number(entry.at), ageMs, stale: ageMs >= CACHE_TTL_MS };
}

function getVirtualCacheSnapshot() {
  return readFileCache();
}

function getVirtualCacheVersion() {
  return cacheVersion;
}

function writeCachedPrices(providerKey, serviceCode, data) {
  const cache = readFileCache();
  cache[getCacheKey(providerKey, serviceCode)] = { at: Date.now(), data };
  writeFileCache(cache);
}

function getProviderProxy(providerKey = "server2") {
  if (providerKey === "server1") {
    return String(process.env.HERO_PROXY_URL || process.env.SMS_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim();
  }
  return String(process.env.GRIZZLY_PROXY_URL || process.env.SMS_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim();
}

async function fetchRaw(url, providerKey = "server2", accept = "application/json,text/plain;q=0.9,*/*;q=0.8") {
  const response = await axios.get(url, {
    headers: { Accept: accept },
    timeout: REQUEST_TIMEOUT_MS,
    ...getAxiosNetworkOptions(getProviderProxy(providerKey)),
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`SMS provider API HTTP ${response.status}`);
  return typeof response.data === "string" ? response.data.trim() : JSON.stringify(response.data || {}).trim();
}

async function fetchJson(url, providerKey = "server2") {
  return parseProviderResponse(await fetchRaw(url, providerKey));
}

async function fetchText(url, providerKey = "server2") {
  return fetchRaw(url, providerKey, "text/plain,*/*;q=0.8");
}

async function requestProviderWithFailover(providerKey, params, mode = "json") {
  const baseUrls = parseProviderBaseUrls(providerKey);
  let lastError = null;
  for (const baseUrl of baseUrls) {
    try {
      const url = buildProviderUrl(baseUrl, providerKey, params);
      return mode === "text" ? await fetchText(url, providerKey) : await fetchJson(url, providerKey);
    } catch (error) {
      lastError = error;
      logBotError("provider.request.failover", error, { providerKey, baseUrl, action: params.action });
      // A timed-out purchase may have succeeded at the provider. Blindly
      // submitting it again to a mirror can create a second activation.
      if (params.action === "getNumber") break;
    }
  }
  throw lastError || new Error("Provider request failed");
}

function parseCountriesPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  const out = {};
  const consumeEntry = (idLike, item) => {
    const id = String(item?.id ?? item?.country_id ?? item?.countryId ?? item?.value ?? idLike ?? "").trim();
    if (!id) return;
    const label = String(item?.name_en || item?.name || item?.country || item?.title || item?.text || "").trim();
    if (label) out[id] = label;
  };
  const array = Array.isArray(payload) ? payload : Array.isArray(payload.countries) ? payload.countries : Array.isArray(payload.data) ? payload.data : null;
  if (array) {
    array.forEach((item, idx) => { if (item && typeof item === "object") consumeEntry(idx, item); });
    return out;
  }
  Object.entries(payload).forEach(([id, item]) => {
    if (item && typeof item === "object") consumeEntry(id, item);
    else if (typeof item === "string" && item.trim()) out[String(id)] = item.trim();
  });
  return out;
}

async function getProviderCountries(providerKey = "server2") {
  try {
    return parseCountriesPayload(await requestProviderWithFailover(providerKey, { action: "getCountries" }, "json"));
  } catch (error) {
    logBotError("getProviderCountries", error, { providerKey });
    return {};
  }
}

async function getServicePrices(serviceCode, providerKey = "server2", options = {}) {
  const cacheKey = getCacheKey(providerKey, serviceCode);
  if (!serviceCode || !/^[a-z0-9]{1,12}$/i.test(String(serviceCode))) return null;
  // Navigation never waits for a provider timeout. Background jobs refresh
  // these USD prices every 30 minutes; checkout still calls getNumber live.
  if (options.cachedOnly) {
    const cached = getCachedPriceInfo(serviceCode, providerKey);
    if (options.refreshInBackground && (!cached || cached.stale)) schedulePriceRefresh(serviceCode, providerKey);
    return cached && (options.allowStale !== false || !cached.stale) ? cached.data : null;
  }
  if (priceRequests.has(cacheKey)) return priceRequests.get(cacheKey);
  const request = (async () => {
  try {
    const cached = getCachedPriceInfo(serviceCode, providerKey);
    if (!options.forceRefresh && cached && !cached.stale) return cached.data;
    if (providerKey === "server1" && DEBUG_HERO) console.log(`[HeroSMS] Fetching USD prices for ${serviceCode}`);
    const data = await requestProviderWithFailover(providerKey, { action: "getPrices", service: serviceCode }, "json");
    const validPrices = data && typeof data === "object" && !Array.isArray(data) && Object.entries(data).some(([countryId, country]) => {
      const entry = country?.[serviceCode] || country;
      const cost = Number(entry?.cost ?? entry?.price);
      const count = Number(entry?.count ?? entry?.qty ?? entry?.stock ?? entry?.physicalCount);
      return /^\d{1,6}$/.test(countryId) && Number.isFinite(cost) && cost > 0 && Number.isFinite(count) && count >= 0;
    });
    if (!validPrices) throw new Error("Provider returned no valid price records");
    priceCache.set(cacheKey, { at: Date.now(), data });
    writeCachedPrices(providerKey, serviceCode, data);
    return data;
  } catch (error) {
    if (providerKey === "server1" && DEBUG_HERO) console.error("[HeroSMS] getServicePrices failed:", error.message);
    logBotError("getServicePrices", error, { serviceCode, providerKey });
    const cached = getCachedPriceInfo(serviceCode, providerKey);
    return options.allowStale !== false && cached ? cached.data : null;
  }
  })();
  priceRequests.set(cacheKey, request);
  try { return await request; } finally { priceRequests.delete(cacheKey); }
}

function schedulePriceRefresh(serviceCode, providerKey = "server2") {
  const key = getCacheKey(providerKey, serviceCode);
  if (!getSmsProvider(providerKey).apiKey || priceRequests.has(key)) return false;
  const attemptedAt = refreshAttempts.get(key) || 0;
  if (Date.now() - attemptedAt < REFRESH_RETRY_MS) return false;
  refreshAttempts.set(key, Date.now());
  void getServicePrices(serviceCode, providerKey, { forceRefresh: true }).catch((error) => logBotError("schedulePriceRefresh", error, { serviceCode, providerKey }));
  return true;
}

async function refreshSelectedSmsPrices() {
  if (fullRefreshRequest) return fullRefreshRequest;
  const cachedCodes = Object.keys(readFileCache()).map((key) => key.match(/^prices:(?:server1|server2):([a-z0-9]{1,12})$/i)?.[1]).filter(Boolean);
  const codes = [...new Set(["wa", "tg", "ig", "fb", "tw", "tt", "go", "sn", "im", "pp", "hj", ...Object.values(grizzlyServices), ...cachedCodes])];
  const jobs = codes.flatMap((code) => ["server1", "server2"].map((provider) => [code, provider]));
  // Bound concurrency so navigation calls aren't blocked behind a burst of API calls.
  const run = async () => Promise.all(Array.from({ length: 4 }, async () => {
    while (jobs.length) {
      const [code, provider] = jobs.shift();
      if (getSmsProvider(provider).apiKey) await getServicePrices(code, provider, { forceRefresh: true });
    }
  }));
  fullRefreshRequest = run();
  try { return await fullRefreshRequest; } finally { fullRefreshRequest = null; }
}

async function refreshPublicSmsCatalog() {
  if (publicCatalogRequest) return publicCatalogRequest;
  const url = String(process.env.VAULTX_PUBLIC_CATALOG_URL || "https://raw.githubusercontent.com/engabdulrhman5/VAULTX/provider-catalog/catalog/virtual-number-cache.json");
  publicCatalogRequest = (async () => {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) throw new Error("Public catalog must use an HTTPS URL without credentials");
      const response = await axios.get(url, { timeout: 5000, maxContentLength: 8 * 1024 * 1024, maxBodyLength: 8 * 1024 * 1024 });
      const { sanitizeVirtualCache } = require("./publicCatalog");
      const incoming = sanitizeVirtualCache(response.data);
      const cache = readFileCache();
      let merged = 0;
      for (const [key, entry] of Object.entries(incoming)) {
        if (Number(entry.at) <= Number(cache[key]?.at || 0)) continue;
        if (Number(entry.at) > Date.now() + 5 * 60 * 1000) continue;
        cache[key] = entry;
        priceCache.delete(key);
        merged += 1;
      }
      if (merged) writeFileCache(cache);
      return merged;
    } catch (error) {
      logBotError("refreshPublicSmsCatalog", error);
      return 0;
    }
  })();
  try { return await publicCatalogRequest; } finally { publicCatalogRequest = null; }
}

async function requestNumber(serviceCode, countryId, providerKey = "server2", options = {}) {
  if (!getSmsProvider(providerKey).apiKey) return "BAD_KEY";
  if (!/^[a-z0-9]{1,12}$/i.test(String(serviceCode)) || !/^\d{1,6}$/.test(String(countryId))) return "BAD_REQUEST";
  if (options.maxPriceUsd != null && (!Number.isFinite(Number(options.maxPriceUsd)) || Number(options.maxPriceUsd) <= 0)) return "BAD_PRICE";
  try {
    const params = { action: "getNumber", service: serviceCode, country: countryId };
    if (options.maxPriceUsd !== undefined && options.maxPriceUsd !== null) params.maxPrice = Number(options.maxPriceUsd);
    const response = String(await requestProviderWithFailover(providerKey, params, "text") || "").trim();
    if (/^ACCESS_NUMBER:[^:]+:\+?\d+$/.test(response) || /^(BAD_|ERROR|NO_)/i.test(response)) return response;
    return "PROVIDER_UNCONFIRMED";
  } catch (error) {
    if (providerKey === "server1" && DEBUG_HERO) console.error("[HeroSMS] requestNumber failed:", error.message);
    logBotError("requestNumber", error, { serviceCode, countryId, providerKey });
    if (!error.response || Number(error.response.status) >= 500) return "PROVIDER_UNCONFIRMED";
    return null;
  }
}

async function getSmsStatus(activationId, providerKey = "server2") {
  try {
    return await requestProviderWithFailover(providerKey, { action: "getStatus", id: activationId }, "text");
  } catch (error) {
    logBotError("getSmsStatus", error, { activationId, providerKey });
    return null;
  }
}

async function cancelNumber(activationId, providerKey = "server2") {
  try {
    return await requestProviderWithFailover(providerKey, { action: "setStatus", status: "8", id: activationId }, "text");
  } catch (error) {
    logBotError("cancelNumber", error, { activationId, providerKey });
    return null;
  }
}

function extractPriceEntry(countryEntry, serviceCode) {
  if (!countryEntry || typeof countryEntry !== "object") return null;
  if (countryEntry[serviceCode] && typeof countryEntry[serviceCode] === "object") return countryEntry[serviceCode];
  return countryEntry;
}

function toNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function extractPrice(prices, countryId, serviceCode) {
  return toNumber(extractPriceEntry(prices?.[String(countryId)], serviceCode)?.cost ?? extractPriceEntry(prices?.[String(countryId)], serviceCode)?.price);
}

function calculateVirtualNumberPrice(apiPriceUsd) {
  const usd = Number(apiPriceUsd);
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  // Preserve the legacy whole-ruble sale price; the source cost is USD.
  return Math.ceil(usd * USD_TO_RUB - 1e-9);
}

async function getGrizzlyVirtualNumberCatalog(appName, options = {}) {
  const serviceCode = getGrizzlyServiceCode(appName);
  if (!serviceCode) return { appName, serviceCode: null, countries: [] };
  const providerKey = options.providerKey || "server2";
  const prices = await getServicePrices(serviceCode, providerKey, options);
  if (!prices || typeof prices !== "object") return { appName, serviceCode, countries: [] };

  const countries = Object.entries(prices).map(([countryId, countryEntry]) => {
    const priceEntry = extractPriceEntry(countryEntry, serviceCode);
    const supplierPriceUsd = toNumber(priceEntry?.cost ?? priceEntry?.price);
    const availableCount = toNumber(priceEntry?.count ?? priceEntry?.qty ?? priceEntry?.stock);
    if (supplierPriceUsd === null || availableCount === null || availableCount <= 0) return null;
    return {
      id: String(countryId),
      serviceCode,
      providerKey,
      supplierPriceUsd: Number(supplierPriceUsd.toFixed(6)),
      supplierPrice: Number(supplierPriceUsd.toFixed(6)),
      sellPriceUsd: calculateVirtualNumberPrice(supplierPriceUsd) / USD_TO_RUB,
      sellPrice: calculateVirtualNumberPrice(supplierPriceUsd),
      availableCount: Math.floor(availableCount),
      ...getGrizzlyCountryMeta(countryId),
    };
  }).filter(Boolean).sort((a, b) => a.sellPrice - b.sellPrice || b.availableCount - a.availableCount);

  return { appName, serviceCode, countries };
}

function paginateVirtualNumberCountries(countries, pageIndex, pageSize = GRIZZLY_PRICES_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(countries.length / pageSize));
  const safePageIndex = Math.max(0, Math.min(Number(pageIndex) || 0, totalPages - 1));
  const start = safePageIndex * pageSize;
  return { items: countries.slice(start, start + pageSize), totalPages, pageIndex: safePageIndex, totalItems: countries.length };
}

module.exports = {
  GRIZZLY_PRICES_PAGE_SIZE,
  getServicePrices,
  requestNumber,
  getSmsStatus,
  cancelNumber,
  extractPrice,
  calculateVirtualNumberPrice,
  getGrizzlyVirtualNumberCatalog,
  paginateVirtualNumberCountries,
  getProviderCountries,
  refreshSelectedSmsPrices,
  refreshPublicSmsCatalog,
  getCachedPriceInfo,
  getVirtualCacheSnapshot,
  getVirtualCacheVersion,
  schedulePriceRefresh,
};
