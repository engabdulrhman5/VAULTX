const { logBotError } = require("./errorLogger");
const { getGrizzlyServiceCode, getGrizzlyCountryMeta } = require("../constants/grizzly");
const { getSmsProvider } = require("../constants/smsProviders");

const CACHE_TTL_MS = 2 * 60 * 1000;
const GRIZZLY_PRICES_PAGE_SIZE = 36;
const priceCache = new Map();

function getCacheKey(providerKey, serviceCode) {
  return `prices:${providerKey}:${serviceCode}`;
}

function buildProviderUrl(providerKey, params) {
  const provider = getSmsProvider(providerKey);
  const apiKey = provider.apiKey;
  if (!apiKey) {
    throw new Error(`Missing API key for provider ${provider.key}`);
  }

  const query = new URLSearchParams({
    api_key: apiKey,
    ...params,
  });
  return `${provider.baseUrl}?${query.toString()}`;
}

function parseGrizzlyResponse(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) {
    throw new Error("Empty response from Grizzly API");
  }

  if (/^(BAD_|ERROR|NO_)/i.test(trimmed)) {
    throw new Error(`Grizzly API error: ${trimmed}`);
  }

  return JSON.parse(trimmed);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json,text/plain;q=0.9,*/*;q=0.8" },
  });

  if (!response.ok) {
    throw new Error(`Grizzly API HTTP ${response.status}`);
  }

  return parseGrizzlyResponse(await response.text());
}

async function fetchText(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "text/plain,*/*;q=0.8" },
  });

  if (!response.ok) {
    throw new Error(`Grizzly API HTTP ${response.status}`);
  }

  return String(await response.text()).trim();
}

async function getServicePrices(serviceCode, providerKey = "server2") {
  try {
    const cacheKey = getCacheKey(providerKey, serviceCode);
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.data;
    }

    const data = await fetchJson(buildProviderUrl(providerKey, {
      action: "getPrices",
      service: serviceCode,
    }));
    priceCache.set(cacheKey, { at: Date.now(), data });
    return data;
  } catch (error) {
    logBotError("getServicePrices", error, { serviceCode, providerKey });
    return null;
  }
}

async function requestNumber(serviceCode, countryId, providerKey = "server2") {
  try {
    const url = buildProviderUrl(providerKey, {
      action: "getNumber",
      service: serviceCode,
      country: countryId,
    });
    const responseText = await fetchText(url);
    return String(responseText || "").trim();
  } catch (error) {
    logBotError("requestNumber", error, { serviceCode, countryId, providerKey });
    return null;
  }
}

async function getSmsStatus(activationId, providerKey = "server2") {
  try {
    const url = buildProviderUrl(providerKey, {
      action: "getStatus",
      id: activationId,
    });
    return await fetchText(url);
  } catch (error) {
    logBotError("getSmsStatus", error, { activationId, providerKey });
    return null;
  }
}

async function cancelNumber(activationId, providerKey = "server2") {
  try {
    const url = buildProviderUrl(providerKey, {
      action: "setStatus",
      status: "8",
      id: activationId,
    });
    return await fetchText(url);
  } catch (error) {
    logBotError("cancelNumber", error, { activationId, providerKey });
    return null;
  }
}

function extractPriceEntry(countryEntry, serviceCode) {
  if (!countryEntry || typeof countryEntry !== "object") {
    return null;
  }

  if (countryEntry[serviceCode] && typeof countryEntry[serviceCode] === "object") {
    return countryEntry[serviceCode];
  }

  return countryEntry;
}

function toNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function extractPrice(prices, countryId, serviceCode) {
  const countryBlock = prices?.[String(countryId)];
  const priceEntry = extractPriceEntry(countryBlock, serviceCode);
  return toNumber(priceEntry?.cost ?? priceEntry?.price);
}

function calculateVirtualNumberPrice(apiPrice) {
  return Math.ceil(parseFloat(apiPrice) * 25 * 1.20);
}

async function getGrizzlyVirtualNumberCatalog(appName, options = {}) {
  const serviceCode = getGrizzlyServiceCode(appName);
  if (!serviceCode) {
    return { appName, serviceCode: null, countries: [] };
  }

  const prices = await getServicePrices(serviceCode, options.providerKey || "server2");
  if (!prices || typeof prices !== "object") {
    return { appName, serviceCode, countries: [] };
  }

  const countries = Object.entries(prices)
    .map(([countryId, countryEntry]) => {
      const priceEntry = extractPriceEntry(countryEntry, serviceCode);
      const supplierPrice = toNumber(priceEntry?.cost ?? priceEntry?.price);
      const availableCount = toNumber(priceEntry?.count ?? priceEntry?.qty ?? priceEntry?.stock);

      if (supplierPrice === null || availableCount === null || availableCount <= 0) {
        return null;
      }

      return {
        id: String(countryId),
        serviceCode,
        providerKey: options.providerKey || "server2",
        supplierPrice: Number(supplierPrice.toFixed(2)),
        sellPrice: calculateVirtualNumberPrice(supplierPrice),
        availableCount: Math.floor(availableCount),
        ...getGrizzlyCountryMeta(countryId),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.sellPrice !== right.sellPrice) {
        return left.sellPrice - right.sellPrice;
      }

      return right.availableCount - left.availableCount;
    });

  return { appName, serviceCode, countries };
}

function paginateVirtualNumberCountries(countries, pageIndex, pageSize = GRIZZLY_PRICES_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(countries.length / pageSize));
  const safePageIndex = Math.max(0, Math.min(Number(pageIndex) || 0, totalPages - 1));
  const start = safePageIndex * pageSize;

  return {
    items: countries.slice(start, start + pageSize),
    totalPages,
    pageIndex: safePageIndex,
    totalItems: countries.length,
  };
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
};
