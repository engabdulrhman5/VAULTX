const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { logBotError } = require("./errorLogger");
const { grizzlyCountries } = require("../constants/grizzly");
const { getSmsProvider } = require("../constants/smsProviders");
const { getAxiosNetworkOptions } = require("../utils/network");

const CACHE_FILE_PATH = path.resolve(__dirname, "../pricesCache.json");
const CACHE_TTL_MS = 30 * 60 * 1000;
const USD_TO_RUB = 30;

function readCacheFile() {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) return {};
    return JSON.parse(fs.readFileSync(CACHE_FILE_PATH, "utf8") || "{}") || {};
  } catch (error) {
    logBotError("grizzlyCache.readCacheFile", error);
    return {};
  }
}

function writeCacheFile(data) {
  try {
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    logBotError("grizzlyCache.writeCacheFile", error);
  }
}

async function fetchAndCachePrices() {
  try {
    const provider = getSmsProvider("server2");
    if (!provider.apiKey || !provider.baseUrl) throw new Error("Missing GRIZZLY_API_KEY");

    const url = `${provider.baseUrl}?api_key=${encodeURIComponent(provider.apiKey)}&action=getPrices`;
    const response = await axios.get(url, {
      timeout: 20000,
      headers: { Accept: "application/json,text/plain;q=0.9,*/*;q=0.8" },
      ...getAxiosNetworkOptions(String(process.env.GRIZZLY_PROXY_URL || process.env.SMS_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim()),
    });
    const raw = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    const payload = JSON.parse(String(raw || "{}"));
    const result = { wa: [], fetchedAt: Date.now(), ttlMs: CACHE_TTL_MS, sourceCurrency: "USD", usdToRub: USD_TO_RUB };

    Object.entries(payload || {}).forEach(([countryId, countryInfo]) => {
      const count = Number(countryInfo?.count ?? countryInfo?.qty ?? countryInfo?.stock ?? 0);
      const priceUsd = Number(countryInfo?.cost ?? countryInfo?.price ?? 0);
      const meta = grizzlyCountries[countryId];
      if (!count || count <= 0 || !Number.isFinite(priceUsd) || priceUsd <= 0 || !meta) return;

      result.wa.push({
        countryId: String(countryId),
        priceUsd: Number(priceUsd.toFixed(6)),
        priceRub: Number((priceUsd * USD_TO_RUB).toFixed(2)),
        name_ar: meta.name_ar,
        flag: meta.flag,
        count: Math.floor(count),
      });
    });

    result.wa.sort((a, b) => a.priceRub - b.priceRub);
    writeCacheFile(result);
    return result;
  } catch (error) {
    logBotError("grizzlyCache.fetchAndCachePrices", error);
    return readCacheFile();
  }
}

function getCachedCountries(serviceCode = "wa") {
  const cache = readCacheFile();
  const fetchedAt = Number(cache.fetchedAt || 0);
  if (fetchedAt && Date.now() - fetchedAt > CACHE_TTL_MS) return [];
  return Array.isArray(cache[serviceCode]) ? cache[serviceCode] : [];
}

module.exports = {
  grizzlyCountries,
  fetchAndCachePrices,
  getCachedCountries,
};
