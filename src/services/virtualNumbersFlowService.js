const { ACTIVATIONS_CHANNEL_ID } = require("../config");
const { sendOrEditMessage } = require("./profileService");
const { safeTelegramCall } = require("./telegramSafe");
const { logBotError } = require("./errorLogger");
const { getUserLang, t } = require("../locales");
const { getUserState, setUserState, clearUserState } = require("./stateStore");
const { getGrizzlyCountryMeta, getGrizzlyServiceCode, grizzlyServices } = require("../constants/grizzly");
const { getSmsProvider } = require("../constants/smsProviders");
const { getServicePrices, extractPrice, requestNumber, getSmsStatus, cancelNumber } = require("./grizzlyService");
const fs = require("fs");
const path = require("path");

const PAGE_SIZE = 28;
const OFFER_LIMIT = 38;
const OTHER_APP_PAGE_SIZE = 16;
const MOST_AVAILABLE_LIMIT = 80;
const VIRTUAL_CACHE_PATH = path.resolve(__dirname, "..", "..", "data", "virtual-number-cache.json");
const COUNTRY_CACHE_TTL = 24 * 60 * 60 * 1000;

const APPS = [
  { key: "wa", icon: "🛍", labelAr: "واتساب", labelEn: "WhatsApp", offer: true },
  { key: "tg", icon: "🎲", labelAr: "تيليجرام", labelEn: "Telegram", offer: true },
  { key: "ig", icon: "🥂", labelAr: "إنستغرام", labelEn: "Instagram" },
  { key: "fb", icon: "🎯", labelAr: "فيسبوك", labelEn: "Facebook" },
  { key: "tw", icon: "🐤", labelAr: "تويتر", labelEn: "Twitter" },
  { key: "tt", icon: "🎬", labelAr: "تيك توك", labelEn: "TikTok" },
  { key: "go", icon: "🌐", labelAr: "جوجل", labelEn: "Google" },
  { key: "sn", icon: "🧿", labelAr: "سناب", labelEn: "Snapchat" },
  { key: "wc", icon: "🧬", labelAr: "وي شات", labelEn: "WeChat" },
  { key: "im", icon: "💎", labelAr: "ايمو", labelEn: "IMO" },
  { key: "pp", icon: "💳", labelAr: "بايبال", labelEn: "PayPal" },
  { key: "vb", icon: "📞", labelAr: "فايبر", labelEn: "Viber" },
];

const APP_TO_SERVICE = {
  wa: "wa",
  tg: "tg",
  ig: "ig",
  fb: "fb",
  tw: "tw",
  tt: "tt",
  go: "go",
  sn: "sn",
  wc: "go",
  hj: "fb",
  im: "im",
  pp: "pp",
  vb: "vi",
};

const TOP_SERVICE_CODES = new Set(["wa", "tg", "ig", "fb", "tw", "tt", "go", "sn", "im"]);

const SERVICE_DISPLAY = {
  wa: { ar: "واتساب", en: "WhatsApp", icon: "🛍" },
  tg: { ar: "تيليجرام", en: "Telegram", icon: "🎲" },
  ig: { ar: "إنستغرام", en: "Instagram", icon: "🥂" },
  fb: { ar: "فيسبوك", en: "Facebook", icon: "🎯" },
  tw: { ar: "تويتر", en: "Twitter", icon: "🐤" },
  tt: { ar: "تيك توك", en: "TikTok", icon: "🎬" },
  go: { ar: "جوجل", en: "Google", icon: "🌐" },
  sn: { ar: "سناب", en: "Snapchat", icon: "🧿" },
  wc: { ar: "وي شات", en: "WeChat", icon: "🧬" },
  hj: { ar: "حراج", en: "Haraj", icon: "🏷" },
  im: { ar: "ايمو", en: "IMO", icon: "💎" },
  pp: { ar: "بايبال", en: "PayPal", icon: "💳" },
  vi: { ar: "فايبر", en: "Viber", icon: "📞" },
  ds: { ar: "ديسكورد", en: "Discord", icon: "🎮" },
  am: { ar: "أمازون", en: "Amazon", icon: "📦" },
  ap: { ar: "آبل", en: "Apple", icon: "🍎" },
  ms: { ar: "مايكروسوفت", en: "Microsoft", icon: "🪟" },
  li: { ar: "لينكدإن", en: "LinkedIn", icon: "💼" },
  ub: { ar: "أوبر", en: "Uber", icon: "🚕" },
  nf: { ar: "نتفلكس", en: "Netflix", icon: "🎞" },
  sf: { ar: "سبوتيفاي", en: "Spotify", icon: "🎧" },
  yt: { ar: "يوتيوب", en: "YouTube", icon: "▶️" },
};

const APP_ALIASES = {
  WhatsApp: "wa",
  Telegram: "tg",
  Instagram: "ig",
  Facebook: "fb",
  Twitter: "tw",
  TikTok: "tt",
  Google: "go",
  Snapchat: "sn",
  Snap: "sn",
  WeChat: "wc",
  "Wei Chat": "wc",
  "وي شات": "wc",
  Haraj: "hj",
  IMO: "im",
  PayPal: "pp",
  Viber: "vb",
};

const SERVER_LIST = [
  { key: "server1", labelAr: "السيرفر (1)", labelEn: "Server (1)", providerKey: "server1", rowSize: 2 },
  { key: "server2", labelAr: "السيرفر (2)", labelEn: "Server (2)", providerKey: "server2", rowSize: 2 },
  { key: "server3", labelAr: "السيرفر (3)", labelEn: "Server (3)", providerKey: null, rowSize: 2 },
  { key: "server4", labelAr: "السيرفر (4)", labelEn: "Server (4)", providerKey: null, rowSize: 2 },
];

let countryLookup = null;
let countryLookupAt = 0;
let unifiedCountriesLookup = null;
let unifiedCountriesLookupAt = 0;

function getText(lang) {
  return lang === "ar"
    ? {
        title: "💚 <b>WELCOME</b>",
        appHelp: "✦ قائمة التطبيقات المتوفرة\n✦ اختر التطبيق ثم السيرفر ثم الدولة\n✦ سيتم عرض الأسعار بشكل مباشر",
        offersWa: "💙 عروض واتساب",
        offersTg: "💚 عروض تيليجرام",
        back: t(lang, "common_back") || "↩️ عودة",
        noNumbers: "🐼 لا توجد أرقام متاحة حاليًا في هذا السيرفر.\nقم بتجربة سيرفر آخر 💙",
        loading: "جاري شراء رقم...",
        chooseServer: "🎯 <b>اختيار السيرفر</b>",
        chooseCountry: "🌍 <b>اختر الدولة</b>",
        choosePrice: "💰 <b>السعر</b>",
        offersTitle: "🔥⚡ عرض {app}",
        offersHint: "يتم اختيار الأرخص والأكثر توفرًا من جميع السيرفرات",
        pageLabel: "الصفحة",
        buyNow: "🛒 شراء الرقم",
        change: "✦ تغيير الرقم",
        code: "✦ طلب الكود",
        verify: "• تحقق من الرقم في {app} •",
        cancel: "✦ إلغاء الطلب",
        pendingCode: "قيد الانتظار 📩",
        status: "RECEIVED ... 🔎",
        created: "إنشاء",
        expires: "انتهاء",
        waiting: "⏳ لم يصل الكود بعد، حاول بعد ثوانٍ",
        cancelled: "✅ تم إلغاء الطلب واسترجاع {price}₽",
        buyFailed: "لا يوجد أرقام حاليًا",
        insufficient: "رصيدك غير كافٍ",
        noPrice: "لا يوجد سعر متاح حاليًا",
        otherApps: "تطبيقات أخرى",
        mostAvailable: "🎲 الأكثر توفرًا",
        searchCountry: "🚀 بحث عن دولة",
        searchPrompt: "أرسل مفتاح الدولة للبحث (مثال: +1)",
        searchEmpty: "لا توجد نتائج مطابقة لهذا المفتاح.",
        searchHeaderServer: "🧩 السيرفر",
        searchHeaderPrice: "💰 السعر",
        priceHeaderServer: "🧩 السيرفر",
        priceHeaderPrice: "💰 السعر",
        buySameServer: "طلب رقم من السيرفر",
      }
    : {
        title: "💚 <b>WELCOME</b>",
        appHelp: "✦ Available applications\n✦ Pick app -> server -> country\n✦ Prices are shown instantly",
        offersWa: "💙 WhatsApp Offers",
        offersTg: "💚 Telegram Offers",
        back: t(lang, "common_back") || "↩️ Back",
        noNumbers: "🐼 No numbers are available on this server now.\nPlease try another server 💙",
        loading: "Trying to buy number...",
        chooseServer: "🎯 <b>Select Server</b>",
        chooseCountry: "🌍 <b>Choose Country</b>",
        choosePrice: "💰 <b>Price</b>",
        offersTitle: "🔥⚡ {app} Offer",
        offersHint: "Cheapest and best-stock numbers from all servers",
        pageLabel: "Page",
        buyNow: "🛒 Buy Number",
        change: "✦ Change Number",
        code: "✦ Request Code",
        verify: "• Verify in {app} •",
        cancel: "✦ Cancel Order",
        pendingCode: "Pending 📩",
        status: "RECEIVED ... 🔎",
        created: "Created",
        expires: "Expires",
        waiting: "⏳ Code has not arrived yet, try again in a few seconds",
        cancelled: "✅ Order canceled and {price}₽ refunded",
        buyFailed: "No numbers available now",
        insufficient: "Insufficient balance",
        noPrice: "No price available now",
        otherApps: "Other Apps",
        mostAvailable: "🎲 Most Available",
        searchCountry: "🚀 Search Country",
        searchPrompt: "Send country key to search (example: +1)",
        searchEmpty: "No matching countries for this key.",
        searchHeaderServer: "🧩 Server",
        searchHeaderPrice: "💰 Price",
        priceHeaderServer: "🧩 Server",
        priceHeaderPrice: "💰 Price",
        buySameServer: "Buy from this server",
      };
}

function getAppByKey(appKey) {
  return APPS.find((item) => item.key === appKey) || APPS[0];
}

function toServiceAppKey(serviceCode) {
  return `svc_${String(serviceCode || "").trim().toLowerCase()}`;
}

function isServiceAppKey(appKey) {
  return /^svc_[a-z0-9]+$/i.test(String(appKey || ""));
}

function serviceCodeFromAppKey(appKey) {
  if (APP_TO_SERVICE[appKey]) {
    return APP_TO_SERVICE[appKey];
  }
  if (isServiceAppKey(appKey)) {
    return String(appKey).slice(4).toLowerCase();
  }
  return "wa";
}

function normalizeAppKey(raw) {
  const value = decodeURIComponent(String(raw || "")).trim();
  if (isServiceAppKey(value)) {
    return value.toLowerCase();
  }
  if (APP_TO_SERVICE[value]) {
    return value;
  }
  if (APP_ALIASES[value]) {
    return APP_ALIASES[value];
  }

  const serviceCode = getGrizzlyServiceCode(value);
  const fromService = Object.entries(APP_TO_SERVICE).find(([, code]) => code === serviceCode);
  return fromService?.[0] || "wa";
}

function getAppLabel(lang, appKey) {
  if (isServiceAppKey(appKey)) {
    const code = serviceCodeFromAppKey(appKey);
    const meta = SERVICE_DISPLAY[code];
    if (meta) {
      return lang === "ar" ? meta.ar : meta.en;
    }
    return code.toUpperCase();
  }
  const app = getAppByKey(appKey);
  return lang === "ar" ? app.labelAr : app.labelEn;
}

function getServiceCode(appKey) {
  return serviceCodeFromAppKey(appKey);
}

function getServiceDisplay(lang, serviceCode) {
  const code = String(serviceCode || "").toLowerCase();
  const meta = SERVICE_DISPLAY[code];
  if (meta) {
      return {
        name: lang === "ar" ? meta.ar : meta.en,
        icon: meta.icon || "🧩",
      };
  }
  return {
    name: code.toUpperCase(),
    icon: "🧩",
  };
}

function readVirtualCacheFile() {
  try {
    if (!fs.existsSync(VIRTUAL_CACHE_PATH)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(VIRTUAL_CACHE_PATH, "utf8") || "{}") || {};
  } catch (error) {
    logBotError("virtualNumbersFlow.readVirtualCacheFile", error);
    return {};
  }
}

function getSnapshotKey(providerKey) {
  return `virtual-number-snapshot:v4:${providerKey}:wa`;
}

function getProviderSnapshotCountries(providerKey) {
  const cache = readVirtualCacheFile();
  const countries = cache[getSnapshotKey(providerKey)]?.data?.countries;
  if (!Array.isArray(countries)) {
    return [];
  }

  return countries
    .map((item) => ({
      id: String(item.id || ""),
      code: String(item.code || item.id || ""),
      dialCode: String(item.dialCode || ""),
      name_en: item.name_en || null,
      name_ar: item.name_ar || null,
      flag: item.flag || "🌍",
      providerCountryId: String(item.providerCountryId || ""),
      providerKey: item.providerKey || providerKey,
      availableCount: Number(item.availableCount || 0),
      sellPrice: Number(item.sellPrice || 0),
      hasPrice: Boolean(item.hasPrice),
    }))
    .filter((item) => item.code && item.providerCountryId);
}

function getUnifiedCountries() {
  if (unifiedCountriesLookup && Date.now() - unifiedCountriesLookupAt < COUNTRY_CACHE_TTL) {
    return unifiedCountriesLookup;
  }

  const server1 = getProviderSnapshotCountries("server1");
  const server2 = getProviderSnapshotCountries("server2");
  const map = new Map();

  [...server1, ...server2].forEach((item) => {
    const key = String(item.code || item.id).toUpperCase();
    const current = map.get(key);
    if (!current) {
      map.set(key, {
        countryId: key,
        code: key,
        dialCode: item.dialCode || "",
        name_en: item.name_en || key,
        name_ar: item.name_ar || item.name_en || key,
        flag: item.flag || "🌍",
        providerMap: {
          [item.providerKey]: {
            providerCountryId: item.providerCountryId,
            availableCount: item.availableCount,
            sellPrice: item.sellPrice,
          },
        },
      });
      return;
    }

    current.providerMap[item.providerKey] = {
      providerCountryId: item.providerCountryId,
      availableCount: item.availableCount,
      sellPrice: item.sellPrice,
    };
    if (!current.name_en && item.name_en) current.name_en = item.name_en;
    if (!current.name_ar && item.name_ar) current.name_ar = item.name_ar;
    if (!current.dialCode && item.dialCode) current.dialCode = item.dialCode;
    if ((!current.flag || current.flag === "🌍") && item.flag) current.flag = item.flag;
  });

  unifiedCountriesLookup = map;
  unifiedCountriesLookupAt = Date.now();
  return unifiedCountriesLookup;
}

function normalizeCountryRecord(raw) {
  const id = String(raw?.id || raw?.code || "");
  if (!id) {
    return null;
  }
  const fallback = getGrizzlyCountryMeta(raw?.providerCountryId || id);
  return {
    id,
    code: raw?.code || null,
    dialCode: raw?.dialCode || null,
    name_en: raw?.name_en || raw?.nameEn || fallback?.name_en || null,
    name_ar: raw?.name_ar || raw?.nameAr || fallback?.name_ar || raw?.name_en || raw?.nameEn || null,
    flag: raw?.flag || fallback?.flag || "🌍",
    providerCountryId: raw?.providerCountryId ? String(raw.providerCountryId) : null,
  };
}

function ensureCountryLookup() {
  if (countryLookup && Date.now() - countryLookupAt < COUNTRY_CACHE_TTL) {
    return countryLookup;
  }

  const cache = readVirtualCacheFile();
  const index = new Map();
  const keys = Object.keys(cache);
  const countryKeys = keys.filter((key) =>
    key.startsWith("hero:countries:v2:") || key.startsWith("grizzly:countries:v2:") || key === "grizzly:countries:server2"
  );

  countryKeys.forEach((key) => {
    const entry = cache[key];
    const list = Array.isArray(entry?.data) ? entry.data : [];
    list.forEach((item) => {
      const normalized = normalizeCountryRecord(item);
      if (!normalized) {
        return;
      }
      const current = index.get(normalized.id);
      if (!current) {
        index.set(normalized.id, normalized);
        if (normalized.code) {
          index.set(String(normalized.code).toUpperCase(), normalized);
        }
        return;
      }
      index.set(normalized.id, {
        ...current,
        ...normalized,
        name_en: normalized.name_en || current.name_en,
        name_ar: normalized.name_ar || current.name_ar,
        dialCode: normalized.dialCode || current.dialCode,
      });
      if (normalized.code) {
        index.set(String(normalized.code).toUpperCase(), {
          ...current,
          ...normalized,
          name_en: normalized.name_en || current.name_en,
          name_ar: normalized.name_ar || current.name_ar,
          dialCode: normalized.dialCode || current.dialCode,
        });
      }
    });
  });

  const unified = getUnifiedCountries();
  unified.forEach((item) => {
    const normalized = normalizeCountryRecord({
      id: item.countryId,
      code: item.code,
      dialCode: item.dialCode,
      name_en: item.name_en,
      name_ar: item.name_ar,
      flag: item.flag,
    });
    if (!normalized) return;
    index.set(normalized.id, normalized);
    if (normalized.code) {
      index.set(String(normalized.code).toUpperCase(), normalized);
    }
  });

  countryLookup = index;
  countryLookupAt = Date.now();
  return countryLookup;
}

function getProviderCountries(providerKey, serviceCode) {
  const unified = getUnifiedCountries();
  if (unified.size) {
    return [...unified.values()]
      .filter((item) => Boolean(item.providerMap?.[providerKey]?.providerCountryId))
      .sort((a, b) => {
        if (a.dialCode && b.dialCode && a.dialCode !== b.dialCode) {
          return a.dialCode.localeCompare(b.dialCode, "en");
        }
        return (a.name_en || "").localeCompare(b.name_en || "", "en");
      })
      .map((item) =>
        normalizeCountryRecord({
          id: item.countryId,
          code: item.code,
          dialCode: item.dialCode,
          name_en: item.name_en,
          name_ar: item.name_ar,
          flag: item.flag,
          providerCountryId: item.providerMap?.[providerKey]?.providerCountryId,
        })
      )
      .filter(Boolean);
  }

  const lookup = ensureCountryLookup();
  const cache = readVirtualCacheFile();
  const keys = providerKey === "server1"
    ? [`hero:countries:v2:${serviceCode}`, `hero:countries:${serviceCode}`]
    : ["grizzly:countries:v2:server2", "grizzly:countries:server2"];

  let list = [];
  for (const key of keys) {
    const entry = cache[key];
    if (Array.isArray(entry?.data) && entry.data.length) {
      list = entry.data;
      break;
    }
  }

  if (!list.length) {
    return [...lookup.values()].sort((a, b) => Number(a.id) - Number(b.id));
  }

  return list
    .map((item) => {
      const id = String(item.id);
      const fromLookup = lookup.get(id);
      return normalizeCountryRecord({
        id,
        code: item.code || fromLookup?.code,
        name_en: item.name_en || item.name_ar || fromLookup?.name_en,
        name_ar: item.name_ar || item.name_en || fromLookup?.name_ar,
        flag: item.flag || fromLookup?.flag,
      });
    })
    .filter(Boolean);
}

function formatPrice(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  return String(Math.ceil(value));
}

function getServerLabel(lang, serverKey) {
  const item = SERVER_LIST.find((server) => server.key === serverKey) || SERVER_LIST[0];
  return lang === "ar" ? item.labelAr : item.labelEn;
}

function buildPageRow(prefix, page, totalPages) {
  if (totalPages <= 1) {
    return [];
  }

  const maxButtons = 8;
  const currentBlock = Math.floor(page / maxButtons);
  const start = currentBlock * maxButtons;
  const end = Math.min(start + maxButtons, totalPages);
  const row = [];

  for (let i = start; i < end; i += 1) {
    row.push({
      text: i === page ? `• ${i + 1} •` : String(i + 1),
      callback_data: `${prefix}:${i}`,
    });
  }

  return [row];
}

function chunk(items, size) {
  const rows = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

function getCountryLabel(lang, countryId) {
  const lookup = ensureCountryLookup();
  const unified = getUnifiedCountries();
  const normalizedKey = String(countryId || "").toUpperCase();
  const fromUnified = unified.get(normalizedKey);
  const fromLookup = lookup.get(String(countryId)) || lookup.get(normalizedKey);
  const country = fromUnified || fromLookup || getGrizzlyCountryMeta(countryId);
  const name = lang === "ar"
    ? country.name_ar || country.name_en || t(lang, `grizzly_country_${countryId}`) || t(lang, "grizzly_country_other")
    : country.name_en || t(lang, `grizzly_country_${countryId}`) || country.name_ar || t(lang, "grizzly_country_other");
  return {
    flag: country.flag || "🌍",
    name,
    dialCode: country.dialCode || "",
  };
}

function getVerifyUrl(appKey, number) {
  const raw = String(number || "").replace(/[^\d+]/g, "");
  const normalized = raw.replace(/^\+/, "");
  const routes = {
    tg: `https://t.me/+${normalized}`,
    wa: `https://wa.me/${normalized}`,
    ig: "https://www.instagram.com/accounts/login/",
    fb: "https://m.facebook.com/login/",
    tw: "https://twitter.com/i/flow/login",
    tt: "https://www.tiktok.com/login",
    go: "https://accounts.google.com/signin",
    sn: "https://accounts.snapchat.com/accounts/login",
    vb: "https://account.viber.com",
    pp: "https://www.paypal.com/signin",
  };

  return routes[appKey] || routes.wa;
}

function calculateSellPrice(apiPrice) {
  return Math.ceil(Number(apiPrice) * 25 * 1.2);
}

function getCount(entry) {
  const value = Number(entry?.count ?? entry?.qty ?? entry?.stock ?? entry?.physicalCount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function getEntry(prices, countryId, serviceCode) {
  const countryEntry = prices?.[String(countryId)];
  if (!countryEntry || typeof countryEntry !== "object") {
    return null;
  }
  return countryEntry[serviceCode] && typeof countryEntry[serviceCode] === "object"
    ? countryEntry[serviceCode]
    : countryEntry;
}

async function getProviderCatalog(appKey, providerKey) {
  const serviceCode = getServiceCode(appKey);
  const prices = await getServicePrices(serviceCode, providerKey);
  const countries = getProviderCountries(providerKey, serviceCode);
  const countryIndex = new Map(countries.map((item) => [String(item.id), item]));
  if (!prices || typeof prices !== "object") {
    return [];
  }

  return countries
    .map((country) => {
      const providerCountryId = String(country.providerCountryId || country.id);
      const apiPrice = extractPrice(prices, providerCountryId, serviceCode);
      const entry = getEntry(prices, providerCountryId, serviceCode);
      const availableCount = getCount(entry);
      if (!Number.isFinite(apiPrice) || apiPrice <= 0 || availableCount <= 0) {
        return null;
      }
      return {
        countryId: String(country.id),
        providerCountryId,
        providerKey,
        serviceCode,
        supplierPrice: Number(apiPrice),
        sellPrice: calculateSellPrice(apiPrice),
        availableCount,
        country: countryIndex.get(String(country.id)) || normalizeCountryRecord({ id: String(country.id) }),
      };
    })
    .filter(Boolean);
}

async function getOfferCatalog(appKey) {
  const [server1, server2] = await Promise.all([
    getProviderCatalog(appKey, "server1"),
    getProviderCatalog(appKey, "server2"),
  ]);

  const map = new Map();
  [...server1, ...server2].forEach((item) => {
    const current = map.get(item.countryId);
    if (!current) {
      map.set(item.countryId, item);
      return;
    }

    if (item.sellPrice < current.sellPrice) {
      map.set(item.countryId, item);
      return;
    }

    if (item.sellPrice === current.sellPrice && item.availableCount > current.availableCount) {
      map.set(item.countryId, item);
    }
  });

  return [...map.values()]
    .sort((a, b) => {
      if (a.sellPrice !== b.sellPrice) {
        return a.sellPrice - b.sellPrice;
      }
      return b.availableCount - a.availableCount;
    })
    .slice(0, OFFER_LIMIT);
}

function getStaticCountryList() {
  const merged = ensureCountryLookup();
  return [...merged.values()]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((item) => ({ countryId: String(item.id) }));
}

function getProviderServiceCodesFromCache() {
  const cache = readVirtualCacheFile();
  const keys = Object.keys(cache);
  const codes = new Set();

  keys.forEach((key) => {
    const match = key.match(/^prices:(server1|server2):([a-z0-9_]+)$/i);
    if (!match) return;
    const data = cache[key]?.data;
    if (!data || typeof data !== "object" || !Object.keys(data).length) return;
    codes.add(String(match[2]).toLowerCase());
  });

  Object.values(grizzlyServices || {}).forEach((code) => codes.add(String(code).toLowerCase()));
  return [...codes];
}

function getOtherServiceCodes() {
  const codes = getProviderServiceCodesFromCache()
    .filter((code) => !TOP_SERVICE_CODES.has(code))
    .sort((a, b) => {
      const aKnown = SERVICE_DISPLAY[a] ? 0 : 1;
      const bKnown = SERVICE_DISPLAY[b] ? 0 : 1;
      if (aKnown !== bKnown) return aKnown - bKnown;
      const aName = SERVICE_DISPLAY[a]?.en || a;
      const bName = SERVICE_DISPLAY[b]?.en || b;
      return aName.localeCompare(bName, "en");
    });
  if (!codes.includes("hj")) {
    codes.unshift("hj");
  }
  return codes;
}

function buildOtherAppsKeyboard(lang, page, totalPages, serviceCodes) {
  const rows = chunk(
    serviceCodes.map((code) => {
      const display = getServiceDisplay(lang, code);
      return {
        text: `${display.icon} ${display.name}`,
        callback_data: `vnm:app:${toServiceAppKey(code)}`,
      };
    }),
    2
  );

  const prevButton = page > 0
    ? { text: t(lang, "common_previous"), callback_data: `vnm:more:${page - 1}` }
    : { text: " ", callback_data: "noop" };
  const backButton = { text: t(lang, "common_back"), callback_data: "service:virtual_numbers" };
  const nextButton = page < totalPages - 1
    ? { text: t(lang, "common_next"), callback_data: `vnm:more:${page + 1}` }
    : { text: " ", callback_data: "noop" };

  return {
    inline_keyboard: [
      ...rows,
      [prevButton, backButton, nextButton],
    ],
  };
}

async function getBestAvailableCountries(appKey) {
  const [server1, server2] = await Promise.all([
    getProviderCatalog(appKey, "server1"),
    getProviderCatalog(appKey, "server2"),
  ]);

  const map = new Map();
  [...server1, ...server2].forEach((item) => {
    const current = map.get(item.countryId);
    const normalized = {
      countryId: item.countryId,
      country: item.country,
      totalAvailable: item.availableCount,
      entries: [{ serverKey: item.providerKey === "server1" ? "server1" : "server2", price: item.sellPrice }],
    };
    if (!current) {
      map.set(item.countryId, normalized);
      return;
    }
    current.totalAvailable += item.availableCount;
    current.entries.push({ serverKey: item.providerKey === "server1" ? "server1" : "server2", price: item.sellPrice });
  });

  return [...map.values()]
    .sort((a, b) => b.totalAvailable - a.totalAvailable)
    .slice(0, MOST_AVAILABLE_LIMIT);
}

function normalizeDialKey(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const digits = value.replace(/[^\d+]/g, "");
  if (!digits) return "";
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function buildMainMenuKeyboard(lang) {
  const offerWa = APPS.find((item) => item.key === "wa");
  const offerTg = APPS.find((item) => item.key === "tg");
  const label = (appKey) => {
    const app = getAppByKey(appKey);
    return lang === "ar" ? app.labelAr : app.labelEn;
  };

  return {
    inline_keyboard: [
      [
        { text: `${offerWa.icon} ${getText(lang).offersWa}`, callback_data: "vnm:offers:wa:0" },
        { text: `${offerTg.icon} ${getText(lang).offersTg}`, callback_data: "vnm:offers:tg:0" },
      ],
      [{ text: `${offerWa.icon} ${label("wa")}`, callback_data: "vnm:app:wa" }],
      [{ text: `${offerTg.icon} ${label("tg")}`, callback_data: "vnm:app:tg" }],
      [{ text: `🥂 ${label("ig")}`, callback_data: "vnm:app:ig" }],
      [{ text: `🎯 ${label("fb")}`, callback_data: "vnm:app:fb" }],
      [{ text: `🐤 ${label("tw")}`, callback_data: "vnm:app:tw" }],
      [
        { text: `🎬 ${label("tt")}`, callback_data: "vnm:app:tt" },
        { text: `🌐 ${label("go")}`, callback_data: "vnm:app:go" },
      ],
      [
        { text: `🧿 ${label("sn")}`, callback_data: "vnm:app:sn" },
        { text: `🧬 ${label("wc")}`, callback_data: "vnm:app:wc" },
      ],
      [{ text: `💎 ${label("im")}`, callback_data: "vnm:app:im" }],
      [{ text: `🧩 ${getText(lang).otherApps}`, callback_data: "vnm:more:0" }],
      [{ text: getText(lang).back, callback_data: "menu:main" }],
    ],
  };
}

function buildMainMenuText(lang, user) {
  const tx = getText(lang);
  return [
    tx.title,
    "",
    tx.appHelp,
    "",
    `- ${lang === "ar" ? "رصيدك" : "Balance"}: <b>${formatPrice(user.balance)}₽</b>`,
    `- ${lang === "ar" ? "اختر التطبيق المناسب ثم أكمل الخطوات" : "Choose an app then continue the steps"}`,
  ].join("\n");
}

function buildServersKeyboard(lang, appKey) {
  const tx = getText(lang);
  return {
    inline_keyboard: [
      [{ text: tx.mostAvailable, callback_data: `vnm:best:${appKey}:0` }],
      [
        { text: getServerLabel(lang, "server1"), callback_data: `vnm:srv:server1:${appKey}:0` },
        { text: getServerLabel(lang, "server2"), callback_data: `vnm:srv:server2:${appKey}:0` },
      ],
      [{ text: tx.searchCountry, callback_data: `vnm:search:${appKey}` }],
      [
        { text: getServerLabel(lang, "server3"), callback_data: `vnm:srv:server3:${appKey}:0` },
        { text: getServerLabel(lang, "server4"), callback_data: `vnm:srv:server4:${appKey}:0` },
      ],
      [{ text: getText(lang).back, callback_data: "service:virtual_numbers" }],
    ],
  };
}

function buildCountriesKeyboard(lang, appKey, serverKey, countryItems, page, totalPages, rowSize) {
  const rows = chunk(countryItems, rowSize).map((part) =>
    part.map((item) => {
      const country = getCountryLabel(lang, item.countryId);
      return {
        text: `${country.flag} ${country.name}`,
        callback_data: `vnm:country:${serverKey}:${appKey}:${item.countryId}:${page}`,
      };
    })
  );

  const prevButton = page > 0
    ? { text: t(lang, "common_previous"), callback_data: `vnm:srv:${serverKey}:${appKey}:${page - 1}` }
    : { text: " ", callback_data: "noop" };
  const backButton = { text: t(lang, "common_back"), callback_data: `vnm:app:${appKey}` };
  const nextButton = page < totalPages - 1
    ? { text: t(lang, "common_next"), callback_data: `vnm:srv:${serverKey}:${appKey}:${page + 1}` }
    : { text: " ", callback_data: "noop" };

  return {
    inline_keyboard: [
      ...rows,
      [prevButton, backButton, nextButton],
    ],
  };
}

function buildPriceKeyboard(lang, appKey, countryId, page, rows, backCallback) {
  const tx = getText(lang);
  const lines = [
    [
      { text: tx.priceHeaderPrice, callback_data: "noop" },
      { text: tx.priceHeaderServer, callback_data: "noop" },
    ],
  ];

  rows.forEach((row, index) => {
    const safePrice = formatPrice(row.price);
    const callback = `vnm:buy:${row.serverKey}:${appKey}:${countryId}:${safePrice}`;
    lines.push([
      { text: `₽ ${safePrice}`, callback_data: callback },
      { text: `${index + 1}. ${row.label}`, callback_data: callback },
    ]);
  });

  lines.push([{ text: getText(lang).back, callback_data: backCallback }]);
  return { inline_keyboard: lines };
}

function buildSearchResultKeyboard(lang, appKey, countryId, rows) {
  const tx = getText(lang);
  const keyboard = [
    [
      { text: tx.searchHeaderPrice, callback_data: "noop" },
      { text: tx.searchHeaderServer, callback_data: "noop" },
    ],
    ...rows.map((row, index) => {
      const callback = `vnm:buy:${row.serverKey}:${appKey}:${countryId}:${formatPrice(row.price)}`;
      return [
        { text: `₽ ${formatPrice(row.price)}`, callback_data: callback },
        { text: `${index + 1}. ${row.label}`, callback_data: callback },
      ];
    }),
    [{ text: tx.back, callback_data: `vnm:app:${appKey}` }],
  ];
  return { inline_keyboard: keyboard };
}

function buildOfferKeyboard(lang, appKey, offers, page, totalPages) {
  const rows = chunk(offers, 2).map((part) =>
    part.map((item) => {
      const country = getCountryLabel(lang, item.countryId);
      return {
        text: `₽${item.sellPrice} : ${country.flag} ${country.name}`,
        callback_data: `vnm:ofbuy:${appKey}:${item.countryId}`,
      };
    })
  );

  return {
    inline_keyboard: [
      ...rows,
      ...buildPageRow(`vnm:offers:${appKey}`, page, totalPages),
      [{ text: getText(lang).back, callback_data: "service:virtual_numbers" }],
    ],
  };
}

function buildReceipt(lang, input) {
  const tx = getText(lang);
  return [
    `➖ ${t(lang, "virtualNumbers_receipt_activation")} : ${input.activationId} 🛎`,
    `➖ ${t(lang, "virtualNumbers_receipt_country")} : ${input.country}`,
    `➖ ${t(lang, "virtualNumbers_receipt_number")} : <code>${input.number}</code> ☎️`,
    `➖ ${t(lang, "virtualNumbers_receipt_code")} : ${tx.pendingCode}`,
    `➖ ${t(lang, "virtualNumbers_receipt_status")} : ${tx.status}`,
    `➖ ${t(lang, "virtualNumbers_receipt_app")} : ${input.appLabel}`,
    `➖ ${t(lang, "virtualNumbers_receipt_price")} : ₽ ${formatPrice(input.price)}`,
    "",
    `➖ ${tx.created} : ${input.createdAt}`,
    `➖ ${tx.expires} : ${input.expiresAt}`,
    "",
    "🗒انتظر، قد يستغرق وصول الكود بضع ثوان",
  ].join("\n");
}

function parseStatusCode(statusText) {
  const normalized = String(statusText || "").trim();
  if (!normalized.startsWith("STATUS_OK")) {
    return null;
  }

  const parts = normalized.split(":");
  return {
    code: parts[1] || "",
    password: parts[2] || "",
  };
}

async function sendActivationToChannel(bot, lang, payload) {
  const appLabel = getAppLabel(lang, payload.appKey);
  const botUsername = String(process.env.BOT_USERNAME || "vaultx0bot").replace(/^@/, "");
  const startPayload = `vn_buy_${payload.providerKey}_${payload.appKey}_${payload.countryId}`;
  const buyUrl = `https://t.me/${botUsername}?start=${startPayload}`;
  const text = [
    `<b>Number-SMS sales | ${lang === "ar" ? "التفعيلات الناجحة" : "Successful Activations"}</b>`,
    `- ${t(lang, "virtualNumbers_receipt_activation")}: <code>${payload.activationId}</code>`,
    `- ${t(lang, "virtualNumbers_receipt_country")}: ${payload.country}`,
    `- ${t(lang, "virtualNumbers_receipt_number")}: <code>${payload.number}</code>`,
    `- ${t(lang, "virtualNumbers_receipt_app")}: ${appLabel}`,
    `- ${t(lang, "virtualNumbers_receipt_provider")}: ${getSmsProvider(payload.providerKey).name}`,
    `- ${t(lang, "virtualNumbers_receipt_price")}: ₽ ${formatPrice(payload.price)}`,
    `- ${t(lang, "virtualNumbers_sms_received_code")}: <code>${payload.code || "-"}</code>`,
    `- ${t(lang, "virtualNumbers_sms_received_password")}: <code>${payload.password || "-"}</code>`,
  ].join("\n");

  await safeTelegramCall("virtualNumbersFlow.sendActivationToChannel", () =>
    bot.sendMessage(ACTIVATIONS_CHANNEL_ID || -1003311851705, text, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: getText(lang).buySameServer, url: buyUrl }]],
      },
    })
  );
}

function pad(num) {
  return String(num).padStart(2, "0");
}

function formatDate(date) {
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} | ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getDates() {
  const created = new Date();
  const expires = new Date(created.getTime() + 20 * 60 * 1000);
  return {
    createdAt: formatDate(created),
    expiresAt: formatDate(expires),
  };
}

function resolveProviderCountryId(serverKey, countryId) {
  const providerKey = serverKey === "server1" ? "server1" : "server2";
  const unified = getUnifiedCountries();
  const byIso = unified.get(String(countryId || "").toUpperCase());
  if (byIso?.providerMap?.[providerKey]?.providerCountryId) {
    return String(byIso.providerMap[providerKey].providerCountryId);
  }
  return String(countryId);
}

async function handleBuy(bot, query, appStore, serverKey, appKey, countryId, price) {
  const user = appStore.getOrCreateUser(query.from);
  const lang = getUserLang(user);
  const tx = getText(lang);
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const priceValue = Number(price);
  const state = getUserState(user.userId);
  const backPage = Number.isFinite(Number(state?.vnPage)) ? Number(state.vnPage) : 0;

  if (!Number.isFinite(priceValue) || priceValue <= 0) {
    await safeTelegramCall("virtualNumbersFlow.handleBuy.invalidPrice", () =>
      bot.answerCallbackQuery(query.id, { text: tx.noPrice, show_alert: true })
    );
    return true;
  }

  const retryMarkup = {
    inline_keyboard: [
      [{ text: "🔄 " + (lang === "ar" ? "إعادة المحاولة" : "Retry"), callback_data: `vnm:buy:${serverKey}:${appKey}:${countryId}:${formatPrice(priceValue || 0)}` }],
      [{ text: tx.back, callback_data: `vnm:srv:${serverKey}:${appKey}:${backPage}` }],
    ],
  };

  await safeTelegramCall("virtualNumbersFlow.handleBuy.loadingPanel", () =>
    bot.editMessageText(`⏳ ${tx.loading}`, {
      chat_id: chatId,
        message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: tx.back, callback_data: `vnm:srv:${serverKey}:${appKey}:${backPage}` }]] },
    })
  );

  if (serverKey === "server3" || serverKey === "server4") {
    await safeTelegramCall("virtualNumbersFlow.handleBuy.unavailable", () =>
      bot.editMessageText(`🐼 ${tx.noNumbers}`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: retryMarkup,
      })
    );
    return true;
  }

  const providerKey = serverKey === "server1" ? "server1" : "server2";
  const currentUser = appStore.findUserById(user.userId);
  if (!currentUser || Number(currentUser.balance) < priceValue) {
    await safeTelegramCall("virtualNumbersFlow.handleBuy.insufficient", () =>
      bot.answerCallbackQuery(query.id, { text: tx.insufficient, show_alert: true })
    );
    return true;
  }

  await safeTelegramCall("virtualNumbersFlow.handleBuy.loading", () =>
    bot.answerCallbackQuery(query.id, { text: tx.loading, show_alert: false })
  );

  const serviceCode = getServiceCode(appKey);
  const providerCountryId = resolveProviderCountryId(serverKey, countryId);
  const response = await requestNumber(serviceCode, providerCountryId, providerKey);
  if (!response || /^(BAD_|ERROR|NO_)/i.test(response) || !String(response).includes("ACCESS_NUMBER")) {
    await safeTelegramCall("virtualNumbersFlow.handleBuy.noNumbers", () =>
      bot.editMessageText(`🐼 ${tx.buyFailed}`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: retryMarkup,
      })
    );
    return true;
  }

  const [, activationId, numberRaw] = String(response).split(":");
  const number = numberRaw.startsWith("+") ? numberRaw : `+${numberRaw}`;
  appStore.deductBalance(currentUser.userId, priceValue);
  const dates = getDates();
  const countryMeta = getCountryLabel(lang, countryId);
  const appLabel = getAppLabel(lang, appKey);

  appStore.addTransaction({
    type: "virtual_number_purchase",
    userId: currentUser.userId,
    amount: priceValue,
    providerKey,
    serviceCode,
    appKey,
    countryId,
    activationId,
    number,
    createdAt: new Date().toISOString(),
  });

  setUserState(currentUser.userId, "VN_ACTIVE_ORDER", {
    providerKey,
    appKey,
    countryId,
    activationId,
    price: priceValue,
  });

  const verifyLabel = tx.verify.replace("{app}", appLabel);
  const verifyUrl = getVerifyUrl(appKey, number);
  const receipt = buildReceipt(lang, {
    activationId,
    country: `${countryMeta.flag} ${countryMeta.name}`,
    number,
    appLabel: `${appLabel}`,
    price: priceValue,
    createdAt: dates.createdAt,
    expiresAt: dates.expiresAt,
  });

  await safeTelegramCall("virtualNumbersFlow.handleBuy.receipt", () =>
    bot.editMessageText(receipt, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: tx.change, callback_data: `vnm:chg:${providerKey}:${activationId}:${formatPrice(priceValue)}:${appKey}:${countryId}` }],
          [{ text: tx.code, callback_data: `vnm:code:${providerKey}:${activationId}:${appKey}` }],
          [{ text: verifyLabel, url: verifyUrl }],
          [{ text: tx.cancel, callback_data: `vnm:cancel:${providerKey}:${activationId}:${formatPrice(priceValue)}` }],
        ],
      },
    })
  );

  return true;
}

async function handleCode(bot, query, appStore, providerKey, activationId, appKey) {
  const user = appStore.getOrCreateUser(query.from);
  const lang = getUserLang(user);
  const tx = getText(lang);
  const status = await getSmsStatus(activationId, providerKey);
  const parsed = parseStatusCode(status);

  if (!parsed) {
    await safeTelegramCall("virtualNumbersFlow.handleCode.wait", () =>
      bot.answerCallbackQuery(query.id, { text: tx.waiting, show_alert: true })
    );
    return true;
  }

  const purchaseTx = appStore.getLatestTransactionByActivationId(activationId);
  const number = String(purchaseTx?.number || "");
  if (purchaseTx && !purchaseTx.activationNotified) {
    const countryMeta = getCountryLabel(lang, purchaseTx.countryId || "");
    await sendActivationToChannel(bot, lang, {
      activationId,
      country: `${countryMeta.flag} ${countryMeta.name}`,
      countryId: purchaseTx.countryId || "",
      number,
      appKey,
      providerKey,
      price: purchaseTx.amount || purchaseTx.price || 0,
      code: parsed.code,
      password: parsed.password || "-",
    });
    appStore.markActivationNotified(activationId);
  }

  const message = [
    `✅ NUMBER : <code>${number}</code>`,
    `💬 CODE : <code>${parsed.code}</code>`,
    `🔐 PASSWORD : <code>${parsed.password || "-"}</code>`,
    "",
    lang === "ar" ? "🌴 اضغط على الكود أو الرقم للنسخ 😌🌸" : "🌴 Tap the code or number to copy 😌🌸",
  ].join("\n");

  await safeTelegramCall("virtualNumbersFlow.handleCode.ok", () =>
    bot.editMessageText(message, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: getText(lang).verify.replace("{app}", getAppLabel(lang, appKey)), url: getVerifyUrl(appKey, number) }],
        ],
      },
    })
  );

  return true;
}

async function handleCancel(bot, query, appStore, providerKey, activationId, price) {
  const user = appStore.getOrCreateUser(query.from);
  const lang = getUserLang(user);
  await cancelNumber(activationId, providerKey);
  const amount = Number(price);
  if (Number.isFinite(amount) && amount > 0) {
    appStore.addBalance(user.userId, amount);
    appStore.addTransaction({
      type: "virtual_number_refund",
      userId: user.userId,
      amount,
      providerKey,
      activationId,
    });
  }

  const text = getText(lang).cancelled.replace("{price}", formatPrice(amount));
  await safeTelegramCall("virtualNumbersFlow.handleCancel", () =>
    bot.editMessageText(text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
    })
  );
  return true;
}

async function handleChange(bot, query, appStore, providerKey, activationId, price, appKey, countryId) {
  await handleCancel(bot, query, appStore, providerKey, activationId, price);
  return handleBuy(bot, query, appStore, providerKey === "server1" ? "server1" : "server2", appKey, countryId, price);
}

async function handleVirtualNumbersTextInput(bot, msg, appStore) {
  try {
    const state = getUserState(msg.from.id);
    if (!state || state.name !== "VN_AWAIT_COUNTRY_KEY") {
      return false;
    }

    const user = appStore.getOrCreateUser(msg.from);
    const lang = getUserLang(user);
    const text = getText(lang);
    const appKey = normalizeAppKey(state.vnApp || "wa");
    const key = normalizeDialKey(msg.text);

    if (!key) {
      await safeTelegramCall("virtualNumbersFlow.search.invalid", () =>
        bot.sendMessage(msg.chat.id, `⚠️ ${text.searchPrompt}`)
      );
      return true;
    }

    const matchedCountries = [...getUnifiedCountries().values()]
      .filter((item) => String(item.dialCode || "").startsWith(key))
      .slice(0, PAGE_SIZE);

    if (!matchedCountries.length) {
      await safeTelegramCall("virtualNumbersFlow.search.empty", () =>
        bot.sendMessage(msg.chat.id, `⚠️ ${text.searchEmpty}`, {
          reply_markup: { inline_keyboard: [[{ text: text.back, callback_data: `vnm:app:${appKey}` }]] },
        })
      );
      return true;
    }

    const [server1, server2] = await Promise.all([
      getProviderCatalog(appKey, "server1"),
      getProviderCatalog(appKey, "server2"),
    ]);
    const rows = [];
    matchedCountries.forEach((country) => {
      const countryId = String(country.countryId || country.code || "");
      const s1 = server1.find((item) => String(item.countryId).toUpperCase() === countryId);
      const s2 = server2.find((item) => String(item.countryId).toUpperCase() === countryId);
      if (s1) {
        rows.push({
          countryId,
          serverKey: "server1",
          price: s1.sellPrice,
          label: `${country.flag} ${lang === "ar" ? country.name_ar : country.name_en} • 1`,
        });
      }
      if (s2) {
        rows.push({
          countryId,
          serverKey: "server2",
          price: s2.sellPrice,
          label: `${country.flag} ${lang === "ar" ? country.name_ar : country.name_en} • 2`,
        });
      }
    });

    if (!rows.length) {
      await safeTelegramCall("virtualNumbersFlow.search.noPrice", () =>
        bot.sendMessage(msg.chat.id, `⚠️ ${text.noPrice}`, {
          reply_markup: { inline_keyboard: [[{ text: text.back, callback_data: `vnm:app:${appKey}` }]] },
        })
      );
      return true;
    }

    clearUserState(msg.from.id);
    const body = [
      `🔎 <b>${text.searchCountry}</b>`,
      "",
      `🧩 ${getAppLabel(lang, appKey)}`,
      `${lang === "ar" ? "نتائج مفتاح الدولة" : "Country key results"}: <code>${key}</code>`,
    ].join("\n");

    const keyboard = {
      inline_keyboard: [
        [
          { text: text.searchHeaderPrice, callback_data: "noop" },
          { text: text.searchHeaderServer, callback_data: "noop" },
        ],
        ...rows.map((row, index) => {
          const callback = `vnm:buy:${row.serverKey}:${appKey}:${row.countryId}:${formatPrice(row.price)}`;
          return [
            { text: `₽ ${formatPrice(row.price)}`, callback_data: callback },
            { text: `${index + 1}. ${row.label}`, callback_data: callback },
          ];
        }),
        [{ text: text.back, callback_data: `vnm:app:${appKey}` }],
      ],
    };

    await safeTelegramCall("virtualNumbersFlow.search.results", () =>
      bot.sendMessage(msg.chat.id, body, {
        parse_mode: "HTML",
        reply_markup: keyboard,
        disable_web_page_preview: true,
      })
    );
    return true;
  } catch (error) {
    logBotError("handleVirtualNumbersTextInput", error, { userId: msg.from?.id });
    return false;
  }
}

async function handleVirtualNumbersCallback(bot, query, appStore) {
  try {
    const raw = String(query.data || "");
    const user = appStore.getOrCreateUser(query.from);
    const lang = getUserLang(user);
    const text = getText(lang);
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    if (raw === "service:virtual_numbers") {
      await sendOrEditMessage(
        bot,
        chatId,
        buildMainMenuText(lang, user),
        buildMainMenuKeyboard(lang),
        messageId,
        "virtualNumbersFlow.mainMenu"
      );
      return true;
    }

    if (raw.startsWith("service_menu:virtual_numbers:offers:")) {
      const offerKey = raw.split(":")[3] || "wa";
      query.data = `vnm:offers:${offerKey}:0`;
    } else if (raw.startsWith("service_menu:virtual_numbers:app:")) {
      const appName = raw.split(":")[3] || "WhatsApp";
      query.data = `vnm:app:${normalizeAppKey(appName)}`;
    } else if (raw.startsWith("service_menu:virtual_numbers:server:")) {
      const parts = raw.split(":");
      const serverKey = parts[3] || "server2";
      const appName = parts[5] || "WhatsApp";
      query.data = `vnm:srv:${serverKey}:${normalizeAppKey(appName)}:0`;
    } else if (raw.startsWith("service_menu:virtual_numbers:prices:")) {
      const parts = raw.split(":");
      const appName = parts[3];
      const page = Number(parts[4] || 0);
      const state = getUserState(user.userId);
      const serverKey = state?.vnServer || "server2";
      query.data = `vnm:srv:${serverKey}:${normalizeAppKey(appName)}:${page}`;
    } else if (raw.startsWith("service_menu:virtual_numbers:country:")) {
      const parts = raw.split(":");
      const appName = parts[3];
      const countryId = parts[4];
      const page = Number(parts[5] || 0);
      const state = getUserState(user.userId);
      const serverKey = state?.vnServer || "server2";
      query.data = `vnm:country:${serverKey}:${normalizeAppKey(appName)}:${countryId}:${page}`;
    }

    const data = String(query.data || "");
    if (!data.startsWith("vnm:")) {
      return false;
    }

    const parts = data.split(":");
    const action = parts[1];

    if (action === "app") {
      const appKey = normalizeAppKey(parts[2]);
      setUserState(user.userId, "VN_CONTEXT", { vnApp: appKey, vnServiceCode: getServiceCode(appKey) });
      const appLabel = getAppLabel(lang, appKey);
      const displayName = user.firstName || user.username || "User";
      const body = [
        lang === "ar" ? `مرحبًا: ${displayName}` : `Welcome: ${displayName}`,
        "────────────",
        `${lang === "ar" ? "التطبيق" : "App"}: ${appLabel}`,
        lang === "ar" ? "اختر أحد السيرفرات التالية" : "Select one of the servers below",
        lang === "ar" ? "سيرفرات متعددة وسريعة في وصول الكود" : "Multiple fast servers for quicker code delivery",
      ].join("\n");
      await sendOrEditMessage(
        bot,
        chatId,
        body,
        buildServersKeyboard(lang, appKey),
        messageId,
        "virtualNumbersFlow.appServers"
      );
      return true;
    }

    if (action === "more") {
      const page = Math.max(0, Number(parts[2] || 0));
      const codes = getOtherServiceCodes();
      const totalPages = Math.max(1, Math.ceil(codes.length / OTHER_APP_PAGE_SIZE));
      const safePage = Math.min(page, totalPages - 1);
      const items = codes.slice(safePage * OTHER_APP_PAGE_SIZE, safePage * OTHER_APP_PAGE_SIZE + OTHER_APP_PAGE_SIZE);
      const body = [
        `🧩 <b>${text.otherApps}</b>`,
        "",
        `${text.pageLabel}: ${safePage + 1}/${totalPages}`,
      ].join("\n");
      await sendOrEditMessage(
        bot,
        chatId,
        body,
        buildOtherAppsKeyboard(lang, safePage, totalPages, items),
        messageId,
        "virtualNumbersFlow.moreApps"
      );
      return true;
    }

    if (action === "search") {
      const appKey = normalizeAppKey(parts[2]);
      setUserState(user.userId, "VN_AWAIT_COUNTRY_KEY", {
        vnApp: appKey,
      });
      await sendOrEditMessage(
        bot,
        chatId,
        `🔎 <b>${text.searchPrompt}</b>`,
        { inline_keyboard: [[{ text: text.back, callback_data: `vnm:app:${appKey}` }]] },
        messageId,
        "virtualNumbersFlow.searchPrompt"
      );
      return true;
    }

    if (action === "best") {
      const appKey = normalizeAppKey(parts[2]);
      const page = Math.max(0, Number(parts[3] || 0));
      const countries = await getBestAvailableCountries(appKey);
      const totalPages = Math.max(1, Math.ceil(countries.length / PAGE_SIZE));
      const safePage = Math.min(page, totalPages - 1);
      const items = countries.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
      const body = [
        `🎲 <b>${text.mostAvailable}</b>`,
        "",
        `🧩 ${getAppLabel(lang, appKey)}`,
        `${text.pageLabel}: ${safePage + 1}/${totalPages}`,
      ].join("\n");
      const keyboard = {
        inline_keyboard: [
          ...chunk(items, 2).map((part) =>
            part.map((item) => {
              const country = getCountryLabel(lang, item.countryId);
              return {
                text: `${country.flag} ${country.name}`,
                callback_data: `vnm:bestcountry:${appKey}:${item.countryId}:${safePage}`,
              };
            })
          ),
          [
            safePage > 0 ? { text: t(lang, "common_previous"), callback_data: `vnm:best:${appKey}:${safePage - 1}` } : { text: " ", callback_data: "noop" },
            { text: t(lang, "common_back"), callback_data: `vnm:app:${appKey}` },
            safePage < totalPages - 1 ? { text: t(lang, "common_next"), callback_data: `vnm:best:${appKey}:${safePage + 1}` } : { text: " ", callback_data: "noop" },
          ],
        ],
      };
      await sendOrEditMessage(bot, chatId, body, keyboard, messageId, "virtualNumbersFlow.bestCountries");
      return true;
    }

    if (action === "bestcountry") {
      const appKey = normalizeAppKey(parts[2]);
      const countryId = parts[3];
      const page = Math.max(0, Number(parts[4] || 0));
      const [server1, server2] = await Promise.all([
        getProviderCatalog(appKey, "server1"),
        getProviderCatalog(appKey, "server2"),
      ]);
      const s1 = server1.find((item) => item.countryId === String(countryId));
      const s2 = server2.find((item) => item.countryId === String(countryId));
      const rows = [];
      if (s1) rows.push({ serverKey: "server1", price: s1.sellPrice, label: `${getCountryLabel(lang, countryId).flag} ${getCountryLabel(lang, countryId).name} • 1` });
      if (s2) rows.push({ serverKey: "server2", price: s2.sellPrice, label: `${getCountryLabel(lang, countryId).flag} ${getCountryLabel(lang, countryId).name} • 2` });
      if (!rows.length) {
        await safeTelegramCall("virtualNumbersFlow.bestcountry.empty", () =>
          bot.answerCallbackQuery(query.id, { text: text.noPrice, show_alert: true })
        );
        return true;
      }
      const country = getCountryLabel(lang, countryId);
      const body = [
        text.choosePrice,
        "",
        `🧩 ${getAppLabel(lang, appKey)}`,
        `🌍 ${country.flag} ${country.name}`,
      ].join("\n");
      await sendOrEditMessage(
        bot,
        chatId,
        body,
        buildPriceKeyboard(lang, appKey, countryId, page, rows, `vnm:best:${appKey}:${page}`),
        messageId,
        "virtualNumbersFlow.bestCountryPrice"
      );
      return true;
    }

    if (action === "searchpick") {
      const appKey = normalizeAppKey(parts[2]);
      const countryId = String(parts[3] || "").toUpperCase();
      const [server1, server2] = await Promise.all([
        getProviderCatalog(appKey, "server1"),
        getProviderCatalog(appKey, "server2"),
      ]);

      const s1 = server1.find((item) => String(item.countryId).toUpperCase() === countryId);
      const s2 = server2.find((item) => String(item.countryId).toUpperCase() === countryId);
      const rows = [];
      const country = getCountryLabel(lang, countryId);
      if (s1) rows.push({ serverKey: "server1", price: s1.sellPrice, label: `${country.flag} ${country.name} • 1` });
      if (s2) rows.push({ serverKey: "server2", price: s2.sellPrice, label: `${country.flag} ${country.name} • 2` });
      if (!rows.length) {
        await safeTelegramCall("virtualNumbersFlow.searchpick.empty", () =>
          bot.answerCallbackQuery(query.id, { text: text.noPrice, show_alert: true })
        );
        return true;
      }
      const body = [
        `🔎 <b>${text.searchCountry}</b>`,
        "",
        `🧩 ${getAppLabel(lang, appKey)}`,
        `🌍 ${country.flag} ${country.name} ${country.dialCode || ""}`,
      ].join("\n");
      await sendOrEditMessage(
        bot,
        chatId,
        body,
        buildSearchResultKeyboard(lang, appKey, countryId, rows),
        messageId,
        "virtualNumbersFlow.searchPick"
      );
      return true;
    }

    if (action === "offers") {
      const appKey = normalizeAppKey(parts[2]);
      const page = Math.max(0, Number(parts[3] || 0));
      const offers = await getOfferCatalog(appKey);
      const totalPages = Math.max(1, Math.ceil(offers.length / OFFER_LIMIT));
      const safePage = Math.min(page, totalPages - 1);
      const pageItems = offers.slice(safePage * OFFER_LIMIT, safePage * OFFER_LIMIT + OFFER_LIMIT);
      const appLabel = getAppLabel(lang, appKey);
      const body = [
        text.offersTitle.replace("{app}", appLabel),
        "",
        text.offersHint,
        `${text.pageLabel}: ${safePage + 1}/${totalPages}`,
      ].join("\n");

      await sendOrEditMessage(
        bot,
        chatId,
        body,
        buildOfferKeyboard(lang, appKey, pageItems, safePage, totalPages),
        messageId,
        "virtualNumbersFlow.offers"
      );
      return true;
    }

    if (action === "ofbuy") {
      const appKey = normalizeAppKey(parts[2]);
      const countryId = parts[3];
      const offers = await getOfferCatalog(appKey);
      const item = offers.find((offer) => offer.countryId === String(countryId));
      if (!item) {
        await safeTelegramCall("virtualNumbersFlow.ofbuy.notFound", () =>
          bot.answerCallbackQuery(query.id, { text: text.buyFailed, show_alert: true })
        );
        return true;
      }
      const serverKey = item.providerKey === "server1" ? "server1" : "server2";
      return handleBuy(bot, query, appStore, serverKey, appKey, countryId, item.sellPrice);
    }

    if (action === "srv") {
      const serverKey = parts[2];
      const appKey = normalizeAppKey(parts[3]);
      const page = Math.max(0, Number(parts[4] || 0));
      const providerKey = SERVER_LIST.find((server) => server.key === serverKey)?.providerKey;
      const rowSize = 2;

      setUserState(user.userId, "VN_CONTEXT", { vnApp: appKey, vnServer: serverKey, vnServiceCode: getServiceCode(appKey) });

      let countries = [];
      if (providerKey) {
        countries = await getProviderCatalog(appKey, providerKey);
      } else {
        countries = getStaticCountryList();
      }

      const totalPages = Math.max(1, Math.ceil(countries.length / PAGE_SIZE));
      const safePage = Math.min(page, totalPages - 1);
      const pageItems = countries.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
      const appLabel = getAppLabel(lang, appKey);

      const body = [
        `${lang === "ar" ? "التطبيق" : "App"}: ${appLabel}`,
        `${lang === "ar" ? "السيرفر" : "Server"}: ${getServerLabel(lang, serverKey)}`,
        `${lang === "ar" ? "الدول المعروضة في هذه الصفحة" : "Countries on this page"}: ${pageItems.length}`,
        lang === "ar" ? "اختر الدولة لعرض سعر الرقم المتاح مباشرة" : "Choose country to view available number prices",
        lang === "ar" ? "الأسعار محدثة تلقائيًا ويظهر المتاح فقط" : "Prices are refreshed automatically and show available stock only",
        `${text.pageLabel}: ${safePage + 1}/${totalPages}`,
      ].join("\n");

      await sendOrEditMessage(
        bot,
        chatId,
        body,
        buildCountriesKeyboard(lang, appKey, serverKey, pageItems, safePage, totalPages, rowSize),
        messageId,
        "virtualNumbersFlow.serverCountries"
      );
      return true;
    }

    if (action === "country") {
      const serverKey = parts[2];
      const appKey = normalizeAppKey(parts[3]);
      const countryId = parts[4];
      const page = Math.max(0, Number(parts[5] || 0));
      const providerKey = SERVER_LIST.find((server) => server.key === serverKey)?.providerKey;

      setUserState(user.userId, "VN_CONTEXT", { vnApp: appKey, vnServer: serverKey, vnCountry: countryId, vnPage: page });

      const rows = [];
      if (providerKey) {
        const serviceCode = getServiceCode(appKey);
        const providerCountryId = resolveProviderCountryId(serverKey, countryId);
        const prices = await getServicePrices(serviceCode, providerKey);
        const price = calculateSellPrice(extractPrice(prices, providerCountryId, serviceCode));
        if (Number.isFinite(price) && price > 0) {
          rows.push({
            serverKey,
            price,
            label: `${getCountryLabel(lang, countryId).flag} ${getCountryLabel(lang, countryId).name} • ${serverKey === "server1" ? "1" : serverKey === "server2" ? "2" : serverKey === "server3" ? "3" : "4"}`,
          });
        }
      } else {
        rows.push({
          serverKey,
          price: 10,
          label: `${getCountryLabel(lang, countryId).flag} ${getCountryLabel(lang, countryId).name} • ${serverKey === "server1" ? "1" : serverKey === "server2" ? "2" : serverKey === "server3" ? "3" : "4"}`,
        });
      }

      if (!rows.length) {
        await safeTelegramCall("virtualNumbersFlow.country.noPrice", () =>
          bot.answerCallbackQuery(query.id, { text: text.noPrice, show_alert: true })
        );
        return true;
      }

      const country = getCountryLabel(lang, countryId);
      const body = [
        `${lang === "ar" ? "التطبيق" : "App"}: ${getAppLabel(lang, appKey)}`,
        `${lang === "ar" ? "السيرفر" : "Server"}: ${serverKey.replace("server", "")}`,
        `${lang === "ar" ? "الدولة" : "Country"}: ${country.flag} ${country.name} ${country.dialCode || ""}`,
        lang === "ar" ? "اختر الصف المناسب وسيتم الشراء مباشرة" : "Select a row and purchase will start instantly",
        lang === "ar" ? "الأسعار من التحديث الثابت اليومي (24 ساعة)" : "Prices are from daily fixed cache (24h)",
      ].join("\n");

      await sendOrEditMessage(
        bot,
        chatId,
        body,
        buildPriceKeyboard(lang, appKey, countryId, page, rows, `vnm:srv:${serverKey}:${appKey}:${page}`),
        messageId,
        "virtualNumbersFlow.countryPrice"
      );
      return true;
    }

    if (action === "buy") {
      return handleBuy(bot, query, appStore, parts[2], normalizeAppKey(parts[3]), parts[4], parts[5]);
    }

    if (action === "code") {
      return handleCode(bot, query, appStore, parts[2], parts[3], normalizeAppKey(parts[4]));
    }

    if (action === "cancel") {
      return handleCancel(bot, query, appStore, parts[2], parts[3], parts[4]);
    }

    if (action === "chg") {
      return handleChange(bot, query, appStore, parts[2], parts[3], parts[4], normalizeAppKey(parts[5]), parts[6]);
    }

    return true;
  } catch (error) {
    logBotError("handleVirtualNumbersCallback", error, { data: query.data, userId: query.from?.id });
    return true;
  }
}

module.exports = {
  handleVirtualNumbersCallback,
  handleVirtualNumbersTextInput,
};

