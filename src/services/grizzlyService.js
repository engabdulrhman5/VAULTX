const { logBotError } = require("./errorLogger");
const { getGrizzlyServiceCode, getGrizzlyCountryMeta } = require("../constants/grizzly");
const { getSmsProvider } = require("../constants/smsProviders");
const { getAxiosNetworkOptions } = require("../utils/network");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const CACHE_TTL_MS = 30 * 60 * 1000;
const GRIZZLY_PRICES_PAGE_SIZE = 36;
const priceCache = new Map();
const VIRTUAL_CACHE_PATH = path.resolve(__dirname, "..", "..", "data", "virtual-number-cache.json");
const REQUEST_TIMEOUT_MS = 15000;
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
  try {
    if (!fs.existsSync(VIRTUAL_CACHE_PATH)) return {};
    return JSON.parse(fs.readFileSync(VIRTUAL_CACHE_PATH, "utf8") || "{}") || {};
  } catch (error) {
    logBotError("grizzlyService.readFileCache", error);
    return {};
  }
}

function writeFileCache(next) {
  try {
    fs.mkdirSync(path.dirname(VIRTUAL_CACHE_PATH), { recursive: true });
    fs.writeFileSync(VIRTUAL_CACHE_PATH, JSON.stringify(next, null, 2), "utf8");
  } catch (error) {
    logBotError("grizzlyService.writeFileCache", error);
  }
}

function readCachedPrices(providerKey, serviceCode) {
  const entry = readFileCache()[getCacheKey(providerKey, serviceCode)];
  if (!entry || !entry.at || !entry.data) return null;
  if (Date.now() - Number(entry.at) > CACHE_TTL_MS) return null;
  return entry.data;
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
  try {
    const cached = priceCache.get(cacheKey);
    if (!options.forceRefresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
    if (!options.forceRefresh) {
      const fileCached = readCachedPrices(providerKey, serviceCode);
      if (fileCached) {
        priceCache.set(cacheKey, { at: Date.now(), data: fileCached });
        return fileCached;
      }
    }
    if (providerKey === "server1" && DEBUG_HERO) console.log(`[HeroSMS] Fetching USD prices for ${serviceCode}`);
    const data = await requestProviderWithFailover(providerKey, { action: "getPrices", service: serviceCode }, "json");
    if (!data || typeof data !== "object") throw new Error("Provider returned an invalid JSON payload");
    priceCache.set(cacheKey, { at: Date.now(), data });
    writeCachedPrices(providerKey, serviceCode, data);
    return data;
  } catch (error) {
    if (providerKey === "server1" && DEBUG_HERO) console.error("[HeroSMS] getServicePrices failed:", error.message);
    logBotError("getServicePrices", error, { serviceCode, providerKey });
    return null;
  }
}

async function requestNumber(serviceCode, countryId, providerKey = "server2", options = {}) {
  try {
    const params = { action: "getNumber", service: serviceCode, country: countryId };
    if (options.maxPriceUsd !== undefined && options.maxPriceUsd !== null) params.maxPrice = Number(options.maxPriceUsd);
    return String(await requestProviderWithFailover(providerKey, params, "text") || "").trim();
  } catch (error) {
    if (providerKey === "server1" && DEBUG_HERO) console.error("[HeroSMS] requestNumber failed:", error.message);
    logBotError("requestNumber", error, { serviceCode, countryId, providerKey });
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
  return Number((usd * USD_TO_RUB).toFixed(2));
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
};
