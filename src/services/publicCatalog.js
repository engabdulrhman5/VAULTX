// Public provider data only. Never copy provider responses wholesale into GitHub.
const { grizzlyServices } = require("../constants/grizzly");
const { selectedServiceIds } = require("../constants/smmServices");

const SERVICE_CODES = [...new Set([...Object.values(grizzlyServices), "im", "pp", "hj"])];
const SMM_SERVICE_IDS = new Set(selectedServiceIds.map(String));

function publicText(value, secrets = [], max = 160) {
  if (typeof value !== "string") return "";
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  if (text.length > max || /https?:\/\/|api[_-]?key|bearer\s|token\s*[:=]/i.test(text)) return "";
  if (secrets.some((secret) => secret && text.includes(secret))) return "";
  return text;
}

function validTimestamp(value) {
  const at = Number(value);
  return Number.isSafeInteger(at) && at > 0 && at <= Date.now() + 5 * 60 * 1000 ? at : null;
}

function sanitizeSmsPrices(raw, service) {
  if (!SERVICE_CODES.includes(service) || !raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [country, value] of Object.entries(raw)) {
    if (!/^\d{1,6}$/.test(country)) continue;
    const item = value?.[service] || value;
    const cost = Number(item?.cost ?? item?.price);
    const count = Number(item?.count ?? item?.qty ?? item?.stock);
    if (!Number.isFinite(cost) || cost <= 0 || cost > 1000000 || !Number.isFinite(count) || count < 0 || count > 1e12) continue;
    out[country] = { [service]: { cost, count: Math.floor(count) } };
  }
  return out;
}

function sanitizeCountries(raw, providerKey, { secrets = [] } = {}) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw.flatMap((item) => {
    const code = String(item?.code || item?.id || "").toUpperCase();
    const providerCountryId = String(item?.providerCountryId ?? "");
    if (!/^[A-Z]{2}$/.test(code) || !/^\d{1,6}$/.test(providerCountryId) || seen.has(providerCountryId)) return [];
    seen.add(providerCountryId);
    const dialCode = /^\+?\d{1,5}$/.test(String(item.dialCode || "")) ? String(item.dialCode) : "";
    const country = {
      id: code, code, dialCode,
      name_en: publicText(item.name_en, secrets, 100) || code,
      name_ar: publicText(item.name_ar, secrets, 100) || code,
      flag: /^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(String(item.flag || "")) ? item.flag : "🌍",
      providerCountryId, providerKey,
    };
    // Optional public stock/price hints. No orders, balances, phone numbers or IDs.
    if (Number.isFinite(Number(item.availableCount)) && Number(item.availableCount) >= 0) country.availableCount = Math.floor(Number(item.availableCount));
    if (Number.isFinite(Number(item.sellPrice)) && Number(item.sellPrice) >= 0) country.sellPrice = Number(item.sellPrice);
    if (typeof item.hasPrice === "boolean") country.hasPrice = item.hasPrice;
    return [country];
  });
}

function sanitizeVirtualCache(raw, options = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, entry] of Object.entries(raw)) {
    const at = validTimestamp(entry?.at);
    if (!at) continue;
    const price = /^prices:(server1|server2):([a-z0-9]{1,12})$/.exec(key);
    if (price) {
      const data = sanitizeSmsPrices(entry.data, price[2]);
      if (Object.keys(data).length) out[key] = { at, data };
      continue;
    }
    const snapshot = /^virtual-number-snapshot:v4:(server1|server2):wa$/.exec(key);
    if (snapshot) {
      const countries = sanitizeCountries(entry.data?.countries, snapshot[1], options);
      if (countries.length) out[key] = { at, data: { countries } };
    }
  }
  return out;
}

function sanitizeSmmServices(raw, { secrets = [] } = {}) {
  const services = Array.isArray(raw) ? raw : Array.isArray(raw?.services) ? raw.services : Array.isArray(raw?.data) ? raw.data : [];
  const seen = new Set();
  return services.flatMap((item) => {
    const service = String(item?.service ?? item?.id ?? item?.serviceId ?? "");
    const rate = Number(item?.rate ?? item?.rateUsdPer1000);
    const min = Number(item?.min);
    const max = Number(item?.max);
    if (!SMM_SERVICE_IDS.has(service) || seen.has(service) || !Number.isFinite(rate) || rate <= 0 || !Number.isSafeInteger(min) || min < 0 || !Number.isSafeInteger(max) || max < min) return [];
    seen.add(service);
    const result = { service: Number(service), name: publicText(item.name, secrets), type: publicText(item.type, secrets, 50) || "Default", rate: String(rate), min, max, category: publicText(item.category, secrets) };
    for (const name of ["dripfeed", "refill", "cancel"]) if (typeof item[name] === "boolean") result[name] = item[name];
    return [result];
  });
}

module.exports = { SERVICE_CODES, sanitizeSmsPrices, sanitizeVirtualCache, sanitizeSmmServices, sanitizeCountries };
