const { USD_TO_RUB_RATE } = require("../config");

const USD_TO_RUB = Number(USD_TO_RUB_RATE || 30);
const CURRENCIES = {
  USD: { code: "USD", symbol: "$", nameAr: "الدولار الأمريكي", nameEn: "US Dollar", rubPerUnit: USD_TO_RUB },
  RUB: { code: "RUB", symbol: "₽", nameAr: "الروبل الروسي", nameEn: "Russian Ruble", rubPerUnit: 1 },
  YER: { code: "YER", symbol: "ر.ي", nameAr: "الريال اليمني", nameEn: "Yemeni Rial", rubPerUnit: USD_TO_RUB / 53 },
  SAR: { code: "SAR", symbol: "ر.س", nameAr: "الريال السعودي", nameEn: "Saudi Riyal", rubPerUnit: USD_TO_RUB / 3.7 },
};

const DEFAULT_CURRENCY = "RUB";

function normalizeCurrency(value) {
  const code = String(value || "").trim().toUpperCase();
  return CURRENCIES[code] ? code : DEFAULT_CURRENCY;
}

function rubToCurrency(amountRub, currency = DEFAULT_CURRENCY) {
  const code = normalizeCurrency(currency);
  const rub = Number(amountRub || 0);
  if (!Number.isFinite(rub)) return 0;
  return rub / CURRENCIES[code].rubPerUnit;
}

function usdToCurrency(amountUsd, currency = DEFAULT_CURRENCY) {
  const usd = Number(amountUsd || 0);
  if (!Number.isFinite(usd)) return 0;
  return rubToCurrency(usd * USD_TO_RUB, currency);
}

function currencyToRub(amount, currency = DEFAULT_CURRENCY) {
  const code = normalizeCurrency(currency);
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return 0;
  return value * CURRENCIES[code].rubPerUnit;
}

function formatCurrency(amountRub, currency = DEFAULT_CURRENCY, options = {}) {
  const code = normalizeCurrency(currency);
  const value = rubToCurrency(amountRub, code);
  const decimals = Number.isInteger(options.decimals)
    ? Math.max(0, options.decimals)
    : (Math.abs(value) < 1 ? 4 : 2);
  const rounded = Number(value.toFixed(decimals));
  const formatted = rounded.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
  return `${formatted} ${CURRENCIES[code].symbol}`;
}

function formatUsd(amountUsd, currency = DEFAULT_CURRENCY, options = {}) {
  return formatCurrency(Number(amountUsd || 0) * USD_TO_RUB, currency, options);
}

function getCurrencyKeyboard(lang = "ar", current = DEFAULT_CURRENCY) {
  const code = normalizeCurrency(current);
  const name = (currency) => lang === "ar" ? currency.nameAr : currency.nameEn;
  return {
    inline_keyboard: [
      ["USD", "RUB"].map((key) => ({
        text: `${key === code ? "✅ " : ""}${CURRENCIES[key].symbol} ${name(CURRENCIES[key])}`,
        callback_data: `currency:set:${key}`,
      })),
      ["YER", "SAR"].map((key) => ({
        text: `${key === code ? "✅ " : ""}${CURRENCIES[key].symbol} ${name(CURRENCIES[key])}`,
        callback_data: `currency:set:${key}`,
      })),
      [{ text: lang === "ar" ? "🔙 رجوع" : "🔙 Back", callback_data: "menu:settings" }],
    ],
  };
}

module.exports = {
  CURRENCIES,
  USD_TO_RUB,
  DEFAULT_CURRENCY,
  normalizeCurrency,
  rubToCurrency,
  usdToCurrency,
  currencyToRub,
  formatCurrency,
  formatUsd,
  getCurrencyKeyboard,
};
