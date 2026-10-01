// USD is the source of truth for all conversions. RUB helpers below only adapt
// older purchase code and historical transactions that were stored in rubles.
const CURRENCIES = {
  USD: { code: "USD", symbol: "$", nameAr: "الدولار الأمريكي", nameEn: "US Dollar", unitsPerUsd: 1 },
  RUB: { code: "RUB", symbol: "₽", nameAr: "الروبل الروسي", nameEn: "Russian Ruble", unitsPerUsd: 30 },
  YER: { code: "YER", symbol: "ر.ي", nameAr: "الريال اليمني", nameEn: "Yemeni Rial", unitsPerUsd: 530 },
  SAR: { code: "SAR", symbol: "ر.س", nameAr: "الريال السعودي", nameEn: "Saudi Riyal", unitsPerUsd: 3.7 },
};

const CURRENCY_CODES = Object.freeze(Object.keys(CURRENCIES));
const USD_TO_RUB = 30;
const DEFAULT_CURRENCY = "USD";
const CONVERSION_PAIRS = Object.freeze([["USD", "YER"], ["YER", "USD"], ["USD", "SAR"], ["SAR", "USD"], ["USD", "RUB"], ["RUB", "USD"]]);
function canConvert(from, to) { return CONVERSION_PAIRS.some(([source, target]) => source === from && target === to); }

function normalizeCurrency(value) {
  const code = String(value || "").trim().toUpperCase();
  return CURRENCIES[code] ? code : DEFAULT_CURRENCY;
}
function currencyToRub(amount, currency = DEFAULT_CURRENCY) {
  return currencyToUsd(amount, currency) * USD_TO_RUB;
}
function rubToCurrency(amountRub, currency = DEFAULT_CURRENCY) {
  return usdToCurrency(Number(amountRub) / USD_TO_RUB, currency);
}
function currencyToUsd(amount, currency = DEFAULT_CURRENCY) {
  const value = Number(amount);
  return Number.isFinite(value) ? value / CURRENCIES[normalizeCurrency(currency)].unitsPerUsd : 0;
}
function usdToCurrency(amountUsd, currency = DEFAULT_CURRENCY) {
  const value = Number(amountUsd);
  return Number.isFinite(value) ? value * CURRENCIES[normalizeCurrency(currency)].unitsPerUsd : 0;
}
function convert(amount, fromCurrency, toCurrency) { return usdToCurrency(currencyToUsd(amount, fromCurrency), toCurrency); }
// Prices are rounded up for display, so a quoted price never understates the
// charge. For sub-unit prices keep zeros and two significant decimal digits.
function formatPriceNumber(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return "0.00";
  if (value === 0) return "0.00";
  const decimals = value >= 1 ? 2 : Math.max(2, 1 - Math.floor(Math.log10(value)));
  const scale = 10 ** Math.min(decimals, 12);
  const rounded = Math.ceil(Number(value.toPrecision(14)) * scale - 1e-10) / scale;
  return rounded.toLocaleString("en-US", { minimumFractionDigits: Math.min(decimals, 12), maximumFractionDigits: Math.min(decimals, 12) });
}
function formatCurrency(amountRub, currency = DEFAULT_CURRENCY, options = {}) {
  const code = normalizeCurrency(currency); const value = rubToCurrency(amountRub, code);
  if (!Number.isInteger(options.decimals)) return `${formatPriceNumber(value)} ${CURRENCIES[code].symbol}`;
  const decimals = Math.max(0, options.decimals);
  return `${Number(value.toFixed(decimals)).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals })} ${CURRENCIES[code].symbol}`;
}
function formatAmount(amount, currency = DEFAULT_CURRENCY, options = {}) { return formatCurrency(currencyToRub(amount, currency), currency, options); }
function formatUsd(amountUsd, currency = DEFAULT_CURRENCY, options = {}) { return formatCurrency(Number(amountUsd || 0) * USD_TO_RUB, currency, options); }
function getCurrencyKeyboard(lang = "ar", current = DEFAULT_CURRENCY, registration = false) {
  const code = normalizeCurrency(current); const name = (currency) => lang === "ar" ? currency.nameAr : currency.nameEn;
  return {
    inline_keyboard: [
      ["USD", "RUB"].map((key) => ({ text: `${key === code ? "✅ " : ""}${CURRENCIES[key].symbol} ${name(CURRENCIES[key])}`, callback_data: `currency:set:${key}` })),
      ["YER", "SAR"].map((key) => ({ text: `${key === code ? "✅ " : ""}${CURRENCIES[key].symbol} ${name(CURRENCIES[key])}`, callback_data: `currency:set:${key}` })),
      ...(registration ? [] : [[{ text: lang === "ar" ? "🔙 رجوع" : "🔙 Back", callback_data: "menu:settings" }]]),
    ],
  };
}
module.exports = { CURRENCIES, CURRENCY_CODES, USD_TO_RUB, DEFAULT_CURRENCY, CONVERSION_PAIRS, canConvert, normalizeCurrency, currencyToUsd, currencyToRub, rubToCurrency, convert, usdToCurrency, formatPriceNumber, formatCurrency, formatAmount, formatUsd, getCurrencyKeyboard };
