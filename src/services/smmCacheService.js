const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { selectedServiceIds, getServiceInfo } = require("../constants/smmServices");
const { logBotError } = require("./errorLogger");
const { getAxiosNetworkOptions } = require("../utils/network");
const { saveData } = require("./jsonStorage");
const { formatPriceNumber } = require("./currencyService");

const CACHE_FILE = path.join(__dirname, "..", "..", "smm_cache.json");
const { SMM_API_URL, SMM_API_KEY } = process.env;
const smmProxyUrl = String(process.env.SMM_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim();
const smmNetworkOptions = getAxiosNetworkOptions(smmProxyUrl);
let servicesMemory = null;
let servicesUpdatedAt = 0;
let refreshRequest = null;
let publicCatalogRequest = null;
let lastRefreshAttempt = 0;
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_STALE_PRICE_MS = 24 * 60 * 60 * 1000;

function parseApiUrls(raw) {
  return String(raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getSmmApiUrls() {
  const urls = parseApiUrls(process.env.SMM_API_URL || SMM_API_URL);
  return urls.length ? urls : [];
}

function normalizeApiResponse(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.services)) return data.services;
  return [];
}

function loadCacheFile() {
  if (servicesMemory) return servicesMemory;
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    servicesMemory = Array.isArray(parsed.services) ? parsed.services : [];
    servicesUpdatedAt = Number(parsed.at) || Date.parse(parsed.fetchedAt || parsed.lastUpdated || "") || 0;
    return servicesMemory;
  } catch (error) {
    return (servicesMemory = []);
  }
}

function findMetaValue(text, patterns) {
  const source = String(text || "");
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return null;
}

function inferQuality(text) {
  const source = String(text || "").toLowerCase();
  if (/(real|high quality|hq|premium|guaranteed|30 day|365|lifetime)/i.test(source)) return "high";
  if (/(lq|low quality|bot|cheap|cheapest)/i.test(source)) return "low";
  if (/(fast|instant|quick|0 - 1|0-1|up to)/i.test(source)) return "fast";
  return "medium";
}

function parseServiceMeta(service) {
  const combined = [service.name, service.desc, service.description].filter(Boolean).join("\n");
  return {
    startTime: findMetaValue(combined, [/\[\s*Start\s*Time\s*:\s*([^\]]+)\]/i, /start(?:\s*time)?\s*[:\-]\s*([^\n]+)/i]),
    speed: findMetaValue(combined, [/\[\s*Speed\s*:\s*([^\]]+)\]/i, /speed\s*[:\-]\s*([^\n]+)/i]),
    dropRate: findMetaValue(combined, [/\[\s*Drop(?:\s*Rate)?\s*:\s*([^\]]+)\]/i, /drop(?:\s*rate)?\s*[:\-]\s*([^\n]+)/i]),
    refillText: findMetaValue(combined, [/\[\s*Refill\s*:\s*([^\]]+)\]/i, /refill(?:\s*status)?\s*[:\-]\s*([^\n]+)/i]),
    quality: inferQuality(combined),
  };
}

function calculatePricePerUnitRub(rateValue) {
  const rate = Number(rateValue || 0);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Number((((rate / 1000) * 30) * 1.3).toPrecision(12));
}

function calculatePricePer1000Rub(rateValue) {
  const rate = Number(rateValue || 0);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Number(((rate * 30) * 1.3).toPrecision(12));
}

function buildEntry(apiService, previousEntry = null) {
  const serviceId = String(apiService.service || apiService.id || apiService.sid || previousEntry?.serviceId || "");
  const serviceInfo = getServiceInfo(serviceId);
  if (!serviceInfo) return previousEntry;

  const rateUsdPer1000 = Number(apiService.rate ?? previousEntry?.rateUsdPer1000 ?? previousEntry?.rate ?? 0);
  const pricePerUnitRub = calculatePricePerUnitRub(rateUsdPer1000) ?? previousEntry?.pricePerUnitRub ?? null;
  const pricePer1000Rub = calculatePricePer1000Rub(rateUsdPer1000) ?? previousEntry?.pricePer1000Rub ?? null;
  const meta = parseServiceMeta(apiService);
  const description = String(apiService.desc || apiService.description || previousEntry?.description || "").trim();

  return {
    service: Number(apiService.service || apiService.id || apiService.sid || previousEntry?.service || serviceId),
    name: apiService.name || previousEntry?.name || serviceInfo.service.name_ar,
    nameAr: serviceInfo.service.name_ar,
    nameEn: serviceInfo.service.name_en,
    type: apiService.type || previousEntry?.type || "Default",
    rate: String(apiService.rate ?? previousEntry?.rate ?? rateUsdPer1000 ?? ""),
    min: Number(apiService.min ?? previousEntry?.min ?? 0),
    max: Number(apiService.max ?? previousEntry?.max ?? 0),
    dripfeed: typeof apiService.dripfeed === "boolean" ? apiService.dripfeed : Boolean(previousEntry?.dripfeed),
    refill: typeof apiService.refill === "boolean" ? apiService.refill : previousEntry?.refill,
    cancel: typeof apiService.cancel === "boolean" ? apiService.cancel : previousEntry?.cancel,
    category: apiService.category || previousEntry?.category || serviceInfo.category.label_en,
    serviceId,
    categoryKey: serviceInfo.category.key,
    categoryLabelAr: serviceInfo.category.label_ar,
    categoryLabelEn: serviceInfo.category.label_en,
    platformKey: serviceInfo.platform.key,
    platformLabelAr: serviceInfo.platform.label_ar,
    platformLabelEn: serviceInfo.platform.label_en,
    rateUsdPer1000,
    pricePerUnitUsd: rateUsdPer1000 > 0 ? Number((rateUsdPer1000 * 1.3 / 1000).toPrecision(12)) : (pricePerUnitRub === null ? null : pricePerUnitRub / 30),
    pricePer1000Usd: rateUsdPer1000 > 0 ? Number((rateUsdPer1000 * 1.3).toPrecision(12)) : (pricePer1000Rub === null ? null : pricePer1000Rub / 30),
    pricePerUnitRub,
    pricePerUnitRubFormatted: pricePerUnitRub !== null ? formatPriceNumber(pricePerUnitRub) : previousEntry?.pricePerUnitRubFormatted || null,
    pricePer1000Rub,
    pricePer1000RubFormatted: pricePer1000Rub !== null ? formatPriceNumber(pricePer1000Rub) : previousEntry?.pricePer1000RubFormatted || null,
    description,
    startTime: meta.startTime || previousEntry?.startTime || null,
    speed: meta.speed || previousEntry?.speed || null,
    dropRate: meta.dropRate || previousEntry?.dropRate || null,
    quality: meta.quality || previousEntry?.quality || "medium",
    refillStatus: apiService.refill === true ? "available" : apiService.refill === false ? (meta.refillText || "unavailable") : (meta.refillText || previousEntry?.refillStatus || null),
    cancelStatus: apiService.cancel === true ? "available" : apiService.cancel === false ? "unavailable" : (previousEntry?.cancelStatus || null),
    providerName: apiService.name || previousEntry?.providerName || "",
    priceUpdatedAt: Date.now(),
  };
}

function getCachedSmmServices() {
  const services = loadCacheFile();
  if (services.some((item) => Date.now() - Number(item.priceUpdatedAt ?? servicesUpdatedAt) >= CACHE_TTL_MS) || !services.length) scheduleSmmRefresh();
  return services.filter((item) => {
    const at = Number(item.priceUpdatedAt ?? servicesUpdatedAt);
    return at > 0 && at <= Date.now() + 5 * 60 * 1000 && Date.now() - at <= MAX_STALE_PRICE_MS;
  });
}

function getCachedSmmServiceById(serviceId) {
  const id = String(serviceId);
  return getCachedSmmServices().find((item) => String(item.serviceId) === id) || null;
}

async function fetchAndCacheSmmServices() {
  if (refreshRequest) return refreshRequest;
  lastRefreshAttempt = Date.now();
  refreshRequest = refreshSmmServices();
  try { return await refreshRequest; } finally { refreshRequest = null; }
}

function scheduleSmmRefresh() {
  if (refreshRequest || Date.now() - lastRefreshAttempt < 60 * 1000 || !getSmmApiUrls().length || !SMM_API_KEY) return false;
  void fetchAndCacheSmmServices().catch((error) => logBotError("scheduleSmmRefresh", error));
  return true;
}

async function refreshSmmServices() {
  const previousServices = loadCacheFile().map((item) => ({ ...item, priceUpdatedAt: Number(item.priceUpdatedAt ?? servicesUpdatedAt) }));
  const previousMap = new Map(previousServices.map((item) => [String(item.serviceId), item]));

  const apiUrls = getSmmApiUrls();
  if (!apiUrls.length || !SMM_API_KEY) {
    const error = new Error("SMM_API_URL and SMM_API_KEY must be defined in the environment.");
    logBotError("fetchAndCacheSmmServices.missingEnv", error);
    return previousServices;
  }

  for (const apiUrl of apiUrls) {
    try {
      const response = await axios.get(`${apiUrl}?key=${encodeURIComponent(SMM_API_KEY)}&action=services`, {
        timeout: 10000,
        ...smmNetworkOptions,
      });
      const apiServices = normalizeApiResponse(response.data);
      const filteredMap = new Map();

      for (const apiService of apiServices) {
        if (!apiService || typeof apiService !== "object") continue;
        const serviceId = String(apiService.service || apiService.id || apiService.sid || "");
        if (!selectedServiceIds.includes(serviceId)) continue;
        const rate = Number(apiService.rate);
        const min = Number(apiService.min);
        const max = Number(apiService.max);
        if (!Number.isFinite(rate) || rate <= 0 || !Number.isSafeInteger(min) || min < 0 || !Number.isSafeInteger(max) || max < min) continue;
        filteredMap.set(serviceId, buildEntry(apiService, previousMap.get(serviceId)));
      }

      const mergedServices = selectedServiceIds
        .map((serviceId) => filteredMap.get(serviceId) || previousMap.get(serviceId) || null)
        .filter(Boolean);

      if (!filteredMap.size || !mergedServices.length) return previousServices;

      saveData(CACHE_FILE, { fetchedAt: new Date().toISOString(), lastUpdated: new Date().toISOString(), services: mergedServices });
      servicesMemory = mergedServices;
      servicesUpdatedAt = Date.now();
      return mergedServices;
    } catch (error) {
      logBotError("fetchAndCacheSmmServices", error, { apiUrl });
    }
  }

  return previousServices;
}

async function refreshPublicSmmCatalog() {
  if (publicCatalogRequest) return publicCatalogRequest;
  const url = String(process.env.VAULTX_PUBLIC_SMM_CATALOG_URL || "https://raw.githubusercontent.com/engabdulrhman5/VAULTX/provider-catalog/catalog/smm-services.json");
  publicCatalogRequest = (async () => {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) throw new Error("Public catalog must use an HTTPS URL without credentials");
      const response = await axios.get(url, { timeout: 5000, maxContentLength: 2 * 1024 * 1024 });
      const { sanitizeSmmServices } = require("./publicCatalog");
      const incoming = sanitizeSmmServices(response.data);
      const at = Number(response.data?.at);
      if (!Number.isSafeInteger(at) || at <= 0 || at > Date.now() + 5 * 60 * 1000 || !incoming.length) return 0;
      const previous = loadCacheFile();
      const services = new Map(previous.map((item) => [String(item.serviceId), { ...item, priceUpdatedAt: Number(item.priceUpdatedAt ?? servicesUpdatedAt) }]));
      let merged = 0;
      for (const raw of incoming) {
        const id = String(raw.service);
        const existing = services.get(id);
        if (Number(existing?.priceUpdatedAt ?? servicesUpdatedAt) >= at) continue;
        const entry = buildEntry(raw, existing);
        if (!entry) continue;
        services.set(id, { ...entry, priceUpdatedAt: at });
        merged += 1;
      }
      if (!merged) return 0;
      servicesMemory = [...services.values()];
      saveData(CACHE_FILE, { at: servicesUpdatedAt, services: servicesMemory });
      return merged;
    } catch (error) {
      logBotError("refreshPublicSmmCatalog", error);
      return 0;
    }
  })();
  try { return await publicCatalogRequest; } finally { publicCatalogRequest = null; }
}

async function createSmmOrder({ serviceId, link, quantity }) {
  const apiUrls = getSmmApiUrls();
  if (!apiUrls.length || !SMM_API_KEY) {
    return { success: false, error: "missing_env" };
  }

  const payload = {
    key: SMM_API_KEY,
    action: "add",
    service: String(serviceId),
    link: String(link || ""),
    quantity: Number(quantity),
  };

  for (const apiUrl of apiUrls) {
    try {
      const postBody = new URLSearchParams();
      Object.entries(payload).forEach(([key, value]) => postBody.append(key, String(value)));

      const postResponse = await axios.post(apiUrl, postBody.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 20000,
        ...smmNetworkOptions,
      });
      const data = postResponse?.data;
      if (data && (data.order || data.id)) {
        return { success: true, orderId: String(data.order || data.id), raw: data };
      }
      if (data && data.error) {
        return { success: false, error: String(data.error), raw: data };
      }
      return { success: false, error: "provider_unconfirmed", unconfirmed: true };
    } catch (error) {
      logBotError("createSmmOrder.post", error, { serviceId, quantity, apiUrl });
      // Only an explicit method rejection permits the alternate GET form.
      // A timeout or server error may already have created the order.
      if (Number(error.response?.status) !== 405) {
        if (!error.response || Number(error.response.status) >= 500) return { success: false, error: "provider_unconfirmed", unconfirmed: true };
        return { success: false, error: "provider_rejected" };
      }
    }

    try {
      const getResponse = await axios.get(apiUrl, {
        params: payload,
        timeout: 20000,
        ...smmNetworkOptions,
      });
      const data = getResponse?.data;
      if (data && (data.order || data.id)) {
        return { success: true, orderId: String(data.order || data.id), raw: data };
      }
      if (data && data.error) {
        return { success: false, error: String(data.error), raw: data };
      }
      return { success: false, error: "provider_unconfirmed", unconfirmed: true };
    } catch (error) {
      logBotError("createSmmOrder.get", error, { serviceId, quantity, apiUrl });
      if (!error.response || Number(error.response.status) >= 500) return { success: false, error: "provider_unconfirmed", unconfirmed: true };
      return { success: false, error: "provider_rejected" };
    }
  }

  return { success: false, error: "network_error" };
}

module.exports = {
  fetchAndCacheSmmServices,
  getCachedSmmServices,
  getCachedSmmServiceById,
  createSmmOrder,
  refreshPublicSmmCatalog,
};
