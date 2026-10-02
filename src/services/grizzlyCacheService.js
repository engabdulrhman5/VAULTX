const fs = require("fs");
const path = require("path");
const { logBotError } = require("./errorLogger");
const { grizzlyCountries } = require("../constants/grizzly");
const { getServicePrices, getCachedPriceInfo, calculateVirtualNumberPrice } = require("./grizzlyService");

const CACHE_FILE_PATH = path.resolve(__dirname, "../pricesCache.json");
const CACHE_TTL_MS = 30 * 60 * 1000;
const USD_TO_RUB = 30;
let memoryCache = null;

function readCacheFile() {
  if (memoryCache) return memoryCache;
  try { if (!fs.existsSync(CACHE_FILE_PATH)) return {}; memoryCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, "utf8") || "{}") || {}; return memoryCache; }
  catch (error) { logBotError("grizzlyCache.readCacheFile", error); return {}; }
}
function writeCacheFile(data) { try { fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(data, null, 2), "utf8"); memoryCache = data; } catch (error) { logBotError("grizzlyCache.writeCacheFile", error); } }

async function fetchAndCachePrices() {
  try {
    const payload = await getServicePrices("wa", "server2", { forceRefresh: true });
    const priceInfo = getCachedPriceInfo("wa", "server2");
    if (!payload || !priceInfo) return readCacheFile();
    const result = { wa: [], fetchedAt: priceInfo.at, ttlMs: CACHE_TTL_MS, sourceCurrency: "USD", usdToRub: USD_TO_RUB };
    Object.entries(payload || {}).forEach(([countryId, countryInfo]) => {
      const entry = countryInfo?.wa || countryInfo;
      const count = Number(entry?.count ?? entry?.qty ?? entry?.stock ?? 0);
      const priceUsd = Number(entry?.cost ?? entry?.price ?? 0);
      const meta = grizzlyCountries[countryId];
      if (!count || count <= 0 || !Number.isFinite(priceUsd) || priceUsd <= 0 || !meta) return;
      result.wa.push({ countryId: String(countryId), priceUsd: Number(priceUsd.toFixed(6)), priceRub: calculateVirtualNumberPrice(priceUsd), name_ar: meta.name_ar, flag: meta.flag, count: Math.floor(count) });
    });
    result.wa.sort((a, b) => a.priceRub - b.priceRub);
    writeCacheFile(result);
    return result;
  } catch (error) { logBotError("grizzlyCache.fetchAndCachePrices", error); return readCacheFile(); }
}

function getCachedCountries(serviceCode = "wa") {
  const cache = readCacheFile();
  const fetchedAt = Number(cache.fetchedAt || 0);
  if (fetchedAt && Date.now() - fetchedAt > CACHE_TTL_MS) return [];
  return Array.isArray(cache[serviceCode]) ? cache[serviceCode] : [];
}

module.exports = { grizzlyCountries, fetchAndCachePrices, getCachedCountries };
