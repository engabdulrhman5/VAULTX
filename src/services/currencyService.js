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
function formatCurrency(amountRub, currency = DEFAULT_CURRENCY, options = {}) {
  const code = normalizeCurrency(currency); const value = rubToCurrency(amountRub, code);
  const decimals = Number.isInteger(options.decimals) ? Math.max(0, options.decimals) : (Math.abs(value - Number(value.toFixed(2))) > 1e-8 ? 6 : 2);
  return `${Number(value.toFixed(decimals)).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals })} ${CURRENCIES[code].symbol}`;
}
function formatAmount(amount, currency = DEFAULT_CURRENCY, options = {}) { return formatCurrency(currencyToRub(amount, currency), currency, options); }
function formatUsd(amountUsd, currency = DEFAULT_CURRENCY, options = {}) { return formatCurrency(Number(amountUsd || 0) * USD_TO_RUB, currency, options); }
function getCurrencyKeyboard(lang = "ar", current = DEFAULT_CURRENCY) {
  const code = normalizeCurrency(current); const name = (currency) => lang === "ar" ? currency.nameAr : currency.nameEn;
  return {
    inline_keyboard: [
      ["USD", "RUB"].map((key) => ({ text: `${key === code ? "✅ " : ""}${CURRENCIES[key].symbol} ${name(CURRENCIES[key])}`, callback_data: `currency:set:${key}` })),
      ["YER", "SAR"].map((key) => ({ text: `${key === code ? "✅ " : ""}${CURRENCIES[key].symbol} ${name(CURRENCIES[key])}`, callback_data: `currency:set:${key}` })),
      [{ text: lang === "ar" ? "🔙 رجوع" : "🔙 Back", callback_data: "menu:settings" }],
    ],
  };
}
module.exports = { CURRENCIES, CURRENCY_CODES, USD_TO_RUB, DEFAULT_CURRENCY, normalizeCurrency, currencyToUsd, currencyToRub, rubToCurrency, convert, usdToCurrency, formatCurrency, formatAmount, formatUsd, getCurrencyKeyboard };
