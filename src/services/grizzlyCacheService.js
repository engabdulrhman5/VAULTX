const fs = require("fs");
const path = require("path");
const { logBotError } = require("./errorLogger");
const { grizzlyCountries } = require("../constants/grizzly");

const CACHE_FILE_PATH = path.resolve(__dirname, "../pricesCache.json");

function readCacheFile() {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) {
      return {};
    }

    const raw = fs.readFileSync(CACHE_FILE_PATH, "utf8");
    return JSON.parse(raw || "{}") || {};
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
    const apiKey = process.env.GRIZZLY_API_KEY;
    if (!apiKey) {
      throw new Error("Missing GRIZZLY_API_KEY");
    }

    const url = `https://api.grizzlysms.com/stubs/handler_api.php?api_key=${encodeURIComponent(apiKey)}&action=getPrices`;
    const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });

    if (!response.ok) {
      throw new Error(`Grizzly API HTTP ${response.status}`);
    }

    const payload = await response.json();
    const result = {};

    const serviceCode = "wa";
    result[serviceCode] = [];

    Object.entries(payload || {}).forEach(([countryId, countryInfo]) => {
      const count = Number(countryInfo?.count ?? countryInfo?.qty ?? countryInfo?.stock ?? 0);
      const originalPriceUsd = Number(countryInfo?.cost ?? countryInfo?.price ?? 0);

      if (!count || count <= 0 || !Number.isFinite(originalPriceUsd) || originalPriceUsd <= 0) {
        return;
      }

      if (!grizzlyCountries[countryId]) {
        return;
      }

      const finalPriceRub = Math.ceil(parseFloat(originalPriceUsd) * 25 * 1.20);
      const meta = grizzlyCountries[countryId];

      result[serviceCode].push({
        countryId: String(countryId),
        priceRub: finalPriceRub,
        name_ar: meta.name_ar,
        flag: meta.flag,
      });
    });

    result[serviceCode].sort((a, b) => a.priceRub - b.priceRub);
    writeCacheFile(result);
    return result;
  } catch (error) {
    logBotError("grizzlyCache.fetchAndCachePrices", error);
    return readCacheFile();
  }
}

function getCachedCountries(serviceCode = "wa") {
  const cache = readCacheFile();
  return Array.isArray(cache[serviceCode]) ? cache[serviceCode] : [];
}

module.exports = {
  grizzlyCountries,
  fetchAndCachePrices,
  getCachedCountries,
};
