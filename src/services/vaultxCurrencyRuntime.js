'use strict';

// Final presentation layer for all Telegram output. Internal accounting remains RUB.
const TelegramBot = require('node-telegram-bot-api');
const { AppStore } = require('./appStore');
const currencyService = require('./currencyService');

const RATES_RUB_PER_UNIT = Object.freeze({
  RUB: 1,
  USD: 30,
  YER: 30 / 530,
  SAR: 30 / 3.7,
});

// Keep the shared currency service consistent with the requested fixed rates.
if (currencyService?.CURRENCIES?.YER) currencyService.CURRENCIES.YER.rubPerUnit = RATES_RUB_PER_UNIT.YER;
if (currencyService?.CURRENCIES?.USD) currencyService.CURRENCIES.USD.rubPerUnit = RATES_RUB_PER_UNIT.USD;
if (currencyService?.CURRENCIES?.SAR) currencyService.CURRENCIES.SAR.rubPerUnit = RATES_RUB_PER_UNIT.SAR;
if (currencyService) currencyService.USD_TO_RUB = 30;

function normalizeCurrency(value) {
  const code = String(value || 'RUB').trim().toUpperCase();
  return RATES_RUB_PER_UNIT[code] ? code : 'RUB';
}

function rubToDisplay(amountRub, currency) {
  const code = normalizeCurrency(currency);
  const n = Number(amountRub);
  if (!Number.isFinite(n)) return null;
  const value = n / RATES_RUB_PER_UNIT[code];
  const decimals = code === 'RUB' ? 2 : 2;
  return `${Number(value.toFixed(decimals)).toLocaleString('en-US', { maximumFractionDigits: decimals })} ${code}`;
}

function convert(amount, sourceCurrency, targetCurrency) {
  const n = Number(String(amount).replace(',', '.'));
  const source = normalizeCurrency(sourceCurrency);
  if (!Number.isFinite(n)) return null;
  return rubToDisplay(n * RATES_RUB_PER_UNIT[source], targetCurrency);
}

function userForChat(chatId) {
  const store = global.__VAULTX_APP_STORE;
  return store && chatId != null ? store.findUserById(chatId) : null;
}

function userCurrency(chatId) {
  return normalizeCurrency(userForChat(chatId)?.currency || 'RUB');
}

const MONEY_WORDS = /(السعر|سعر|التكلفة|تكلفة|المبلغ|الرصيد|الإجمالي|اجمالي|الخصم|بعد الخصم|الحد الأدنى|الحد الاقصى|الحد الأقصى|سعر الوحدة|لكل\s*1000|price|cost|amount|balance|total|discount|minimum|maximum|unit\s*price|per\s*1000)/i;
const PRICE_CALLBACK = /(buy|purchase|number|virtual|sms|smm|game|topup|package|price|cost|order|service|offer)/i;

function replaceMoney(text, targetCurrency, context = '') {
  let s = String(text ?? '');
  if (!s) return s;
  const target = normalizeCurrency(targetCurrency);

  // Known legacy/malformed currency labels first.
  s = s.replace(/â‚½/g, 'RUB');
  s = s.replace(/(سعر\s*الوحدة|Unit\s*price|السعر|Price|التكلفة|Cost)([^0-9$]*)([0-9]+(?:[.,][0-9]+)?)\s*\$/gi, '$1$2$3 RUB');

  const explicit = [
    { re: /₽\s*([0-9]+(?:[.,][0-9]+)?)/g, cur: 'RUB' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*₽/g, cur: 'RUB' },
    { re: /\bRUB\s*([0-9]+(?:[.,][0-9]+)?)/gi, cur: 'RUB' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*RUB\b/gi, cur: 'RUB' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*روبل/g, cur: 'RUB' },
    { re: /\bUSD\s*([0-9]+(?:[.,][0-9]+)?)/gi, cur: 'USD' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*USD\b/gi, cur: 'USD' },
    { re: /\$\s*([0-9]+(?:[.,][0-9]+)?)/g, cur: 'USD' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*\$/g, cur: 'USD' },
    { re: /\bYER\s*([0-9]+(?:[.,][0-9]+)?)/gi, cur: 'YER' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*YER\b/gi, cur: 'YER' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*(?:ر\.ي|ريال\s*يمني)/g, cur: 'YER' },
    { re: /\bSAR\s*([0-9]+(?:[.,][0-9]+)?)/gi, cur: 'SAR' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*SAR\b/gi, cur: 'SAR' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*(?:ر\.س|ريال\s*سعودي)/g, cur: 'SAR' },
  ];
  for (const item of explicit) {
    s = s.replace(item.re, (whole, raw) => convert(raw, item.cur, target) || whole);
  }

  // Some old screens have a bare number after a financial label. Convert only
  // the financial token, never arbitrary IDs/quantities.
  s = s.replace(/(السعر|سعر|التكلفة|تكلفة|المبلغ|الرصيد|الإجمالي|اجمالي|الخصم|بعد الخصم|الحد الأدنى|الحد الاقصى|الحد الأقصى|سعر الوحدة|Price|Cost|Amount|Balance|Total|Discount|Minimum|Maximum|Unit\s*Price)(\s*[:：=|\-]?\s*)([0-9]+(?:[.,][0-9]+)?)(?!\s*(?:ID|id|OTP|%|متابع|متابعين|طلب|Order))/gi,
    (whole, label, sep, raw) => `${label}${sep}${convert(raw, 'RUB', target) || raw}`
  );

  // Price-only inline buttons used by virtual numbers/game packages/SMM.
  if (PRICE_CALLBACK.test(String(context)) || MONEY_WORDS.test(s)) {
    s = s.replace(/(^|[|•·]\s*)([0-9]+(?:[.,][0-9]+)?)\s*(?=$|[|•·])/g,
      (whole, prefix, raw) => `${prefix}${convert(raw, 'RUB', target) || raw}`
    );
  }

  return s;
}

function transformMarkup(markup, currency) {
  if (!markup || typeof markup !== 'object') return markup;
  if (Array.isArray(markup)) return markup.map((x) => transformMarkup(x, currency));
  const out = { ...markup };
  const callback = String(out.callback_data || '');
  if (typeof out.text === 'string') out.text = replaceMoney(out.text, currency, callback);
  for (const key of ['inline_keyboard', 'keyboard']) {
    if (Array.isArray(out[key])) out[key] = out[key].map((row) => transformMarkup(row, currency));
  }
  return out;
}

function patchStore() {
  const original = AppStore.prototype.normalizeUser;
  if (original.__vaultxFinalCurrencyPatch) return;
  function patched(user) {
    global.__VAULTX_APP_STORE = this;
    const normalized = original.call(this, user);
    normalized.currency = normalizeCurrency(user?.currency || normalized.currency || 'RUB');
    return normalized;
  }
  patched.__vaultxFinalCurrencyPatch = true;
  AppStore.prototype.normalizeUser = patched;
}

function patchTelegram() {
  const patch = (name, textIndex, optionsIndex, chatResolver) => {
    const original = TelegramBot.prototype[name];
    if (typeof original !== 'function' || original.__vaultxFinalCurrencyPatch) return;
    const wrapped = function (...args) {
      const chatId = chatResolver ? chatResolver(args) : args[0];
      const currency = userCurrency(chatId);
      if (typeof args[textIndex] === 'string') args[textIndex] = replaceMoney(args[textIndex], currency);
      const options = args[optionsIndex];
      if (options && typeof options === 'object') {
        if (typeof options.caption === 'string') options.caption = replaceMoney(options.caption, currency);
        if (options.reply_markup) options.reply_markup = transformMarkup(options.reply_markup, currency);
      }
      return original.apply(this, args);
    };
    wrapped.__vaultxFinalCurrencyPatch = true;
    TelegramBot.prototype[name] = wrapped;
  };

  patch('sendMessage', 1, 2);
  patch('sendPhoto', 1, 2);
  patch('sendDocument', 1, 2);
  patch('sendVideo', 1, 2);
  patch('sendAudio', 1, 2);
  patch('editMessageText', 0, 1, (args) => args[1]?.chat_id);
  patch('editMessageCaption', 0, 1, (args) => args[1]?.chat_id);
  patch('editMessageReplyMarkup', 0, 1, (args) => args[1]?.chat_id);
}

patchStore();
patchTelegram();
