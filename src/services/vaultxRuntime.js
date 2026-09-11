'use strict';

const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');
const { AppStore } = require('./appStore');
const { normalizeCurrency, getCurrencyKeyboard } = require('./currencyService');
const { setUserState, getUserState } = require('./stateStore');
const { getUserLang, t } = require('../locales');
const { safeTelegramCall } = require('./telegramSafe');
const { CRYPTOMUS_MERCHANT_ID, CRYPTOMUS_API_KEY, PUBLIC_BASE_URL, USD_TO_RUB_RATE } = require('../config');

const CURRENCY_RUB_PER_UNIT = { RUB: 1, USD: 30, YER: 30 / 53, SAR: 30 / 3.7 };
const CURRENCY_DECIMALS = { RUB: 2, USD: 2, YER: 2, SAR: 2 };

function currencyFromUser(user) {
  return normalizeCurrency(user?.currency || 'RUB');
}

function amountToRub(amount, sourceCurrency) {
  const value = Number(amount);
  const code = normalizeCurrency(sourceCurrency);
  if (!Number.isFinite(value)) return 0;
  return value * CURRENCY_RUB_PER_UNIT[code];
}

function rubToCurrency(amountRub, targetCurrency) {
  const code = normalizeCurrency(targetCurrency);
  const rub = Number(amountRub);
  if (!Number.isFinite(rub)) return 0;
  return rub / CURRENCY_RUB_PER_UNIT[code];
}

function formatDisplay(amountRub, currency) {
  const code = normalizeCurrency(currency);
  const value = rubToCurrency(amountRub, code);
  const decimals = CURRENCY_DECIMALS[code] ?? 2;
  const rounded = Number(value.toFixed(decimals));
  return `${rounded.toLocaleString('en-US', { maximumFractionDigits: decimals })} ${code}`;
}

function convertMoneyToken(amount, sourceCurrency, targetCurrency) {
  return formatDisplay(amountToRub(amount, sourceCurrency), targetCurrency);
}

function replaceMoney(text, targetCurrency) {
  let output = String(text ?? '');
  if (!output) return output;
  const target = normalizeCurrency(targetCurrency);

  // Legacy game-topup strings used '$' to label RUB. Normalize only those
  // explicit financial labels before processing genuine USD values.
  output = output.replace(/(سعر\s*الوحدة|Unit\s*price)([^0-9$]*)([0-9]+(?:[.,][0-9]+)?)\s*\$/gi, '$1$2$3 RUB');
  output = output.replace(/(السعر|Price)([^0-9$]*)([0-9]+(?:[.,][0-9]+)?)\s*\$/gi, '$1$2$3 RUB');
  output = output.replace(/â‚½/g, 'RUB');

  const patterns = [
    { re: /₽\s*([0-9]+(?:[.,][0-9]+)?)/g, cur: 'RUB' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*₽/g, cur: 'RUB' },
    { re: /\bRUB\s*([0-9]+(?:[.,][0-9]+)?)/gi, cur: 'RUB' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*RUB\b/gi, cur: 'RUB' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*روبل/g, cur: 'RUB' },
    { re: /\bUSD\s*([0-9]+(?:[.,][0-9]+)?)/gi, cur: 'USD' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*USD\b/gi, cur: 'USD' },
    { re: /\$\s*([0-9]+(?:[.,][0-9]+)?)/g, cur: 'USD' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*\$/g, cur: 'USD' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*دولار/g, cur: 'USD' },
    { re: /\bYER\s*([0-9]+(?:[.,][0-9]+)?)/gi, cur: 'YER' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*YER\b/gi, cur: 'YER' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*(?:ر\.ي|ريال\s*يمني)/g, cur: 'YER' },
    { re: /\bSAR\s*([0-9]+(?:[.,][0-9]+)?)/gi, cur: 'SAR' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*SAR\b/gi, cur: 'SAR' },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*(?:ر\.س|ريال\s*سعودي)/g, cur: 'SAR' },
  ];
  for (const { re, cur } of patterns) {
    output = output.replace(re, (whole, raw) => {
      const value = Number(String(raw).replace(',', '.'));
      return Number.isFinite(value) ? convertMoneyToken(value, cur, target) : whole;
    });
  }
  return output;
}

function transformMarkup(markup, currency) {
  if (!markup || typeof markup !== 'object') return markup;
  if (Array.isArray(markup)) return markup.map((item) => transformMarkup(item, currency));
  const result = { ...markup };
  if (typeof result.text === 'string') result.text = replaceMoney(result.text, currency);
  for (const key of ['inline_keyboard', 'keyboard']) {
    if (Array.isArray(result[key])) result[key] = result[key].map((row) => transformMarkup(row, currency));
  }
  return result;
}

function getUserForChat(chatId) {
  const store = global.__VAULTX_APP_STORE;
  return store && chatId ? store.findUserById(chatId) : null;
}

function getCurrencyForChat(chatId) {
  return currencyFromUser(getUserForChat(chatId));
}

let cryptomusWebhookContext = null;

function patchAppStore() {
  const originalNormalizeUser = AppStore.prototype.normalizeUser;
  if (!originalNormalizeUser.__vaultxCurrencyPatched) {
    const patched = function patchedNormalizeUser(user) {
      global.__VAULTX_APP_STORE = this;
      const normalized = originalNormalizeUser.call(this, user);
      normalized.currency = normalizeCurrency(user?.currency || normalized.currency || 'RUB');
      return normalized;
    };
    patched.__vaultxCurrencyPatched = true;
    AppStore.prototype.normalizeUser = patched;
  }

  const originalAddTransaction = AppStore.prototype.addTransaction;
  if (!originalAddTransaction.__vaultxCurrencyPatched) {
    const patched = function patchedAddTransaction(entry) {
      const next = { ...entry };
      if (next.type === 'topup_cryptomus_pending') {
        const user = this.findUserById(next.userId);
        const selectedCurrency = currencyFromUser(user);
        const entered = Number(next.amountUsd || 0);
        if (Number.isFinite(entered) && entered > 0 && selectedCurrency !== 'USD') {
          const amountRub = Number(amountToRub(entered, selectedCurrency).toFixed(2));
          next.amount = amountRub;
          next.amountUsd = Number((amountRub / Number(USD_TO_RUB_RATE || 30)).toFixed(2));
          next.displayCurrency = selectedCurrency;
          next.displayAmount = entered;
        }
      }
      return originalAddTransaction.call(this, next);
    };
    patched.__vaultxCurrencyPatched = true;
    AppStore.prototype.addTransaction = patched;
  }

  const originalAddBalance = AppStore.prototype.addBalance;
  if (!originalAddBalance.__vaultxCryptomusGuardPatched) {
    const guarded = function guardedAddBalance(userId, amount) {
      const ctx = cryptomusWebhookContext;
      if (ctx && Number(ctx.userId) === Number(userId)) {
        const pending = this.transactions.find((tx) =>
          tx.type === 'topup_cryptomus_pending' && String(tx.cryptomusOrderId || '') === String(ctx.orderId || '')
        );
        if (!pending) throw new Error('Cryptomus order is not pending or belongs to another user');
        if (String(ctx.currency || '').toUpperCase() !== 'USD') throw new Error('Cryptomus invoice currency mismatch');
        const paidUsd = Number(ctx.amount || 0);
        const expectedUsd = Number(pending.amountUsd || 0);
        if (!Number.isFinite(paidUsd) || paidUsd <= 0 || !Number.isFinite(expectedUsd) || expectedUsd <= 0) throw new Error('Invalid Cryptomus payment amount');
        const status = String(ctx.status || '').toLowerCase();
        if (status === 'paid' && Math.abs(paidUsd - expectedUsd) > 0.01) throw new Error('Cryptomus paid amount mismatch');
        if (status === 'paid_over' && paidUsd + 0.01 < expectedUsd) throw new Error('Cryptomus paid_over amount mismatch');
        const expectedRub = Number((paidUsd * Number(USD_TO_RUB_RATE || 30)).toFixed(2));
        if (Math.abs(Number(amount) - expectedRub) > 0.02) throw new Error('Cryptomus RUB conversion mismatch');
      }
      try {
        return originalAddBalance.call(this, userId, amount);
      } finally {
        if (ctx && Number(ctx.userId) === Number(userId)) cryptomusWebhookContext = null;
      }
    };
    guarded.__vaultxCryptomusGuardPatched = true;
    AppStore.prototype.addBalance = guarded;
  }
}

function patchTelegramOutput() {
  const originalSendMessage = TelegramBot.prototype.sendMessage;
  if (!originalSendMessage.__vaultxCurrencyPatched) {
    const patched = function patchedSendMessage(chatId, text, options, callback) {
      const currency = getCurrencyForChat(chatId);
      const nextOptions = options && typeof options === 'object' ? { ...options } : options;
      if (nextOptions?.reply_markup) nextOptions.reply_markup = transformMarkup(nextOptions.reply_markup, currency);
      return originalSendMessage.call(this, chatId, replaceMoney(text, currency), nextOptions, callback);
    };
    patched.__vaultxCurrencyPatched = true;
    TelegramBot.prototype.sendMessage = patched;
  }

  const originalSendPhoto = TelegramBot.prototype.sendPhoto;
  if (typeof originalSendPhoto === 'function' && !originalSendPhoto.__vaultxCurrencyPatched) {
    const patched = function patchedSendPhoto(chatId, photo, options, fileOptions, callback) {
      const currency = getCurrencyForChat(chatId);
      const nextOptions = options && typeof options === 'object' ? { ...options } : options;
      if (typeof nextOptions?.caption === 'string') nextOptions.caption = replaceMoney(nextOptions.caption, currency);
      if (nextOptions?.reply_markup) nextOptions.reply_markup = transformMarkup(nextOptions.reply_markup, currency);
      return originalSendPhoto.call(this, chatId, photo, nextOptions, fileOptions, callback);
    };
    patched.__vaultxCurrencyPatched = true;
    TelegramBot.prototype.sendPhoto = patched;
  }

  const originalSendDocument = TelegramBot.prototype.sendDocument;
  if (typeof originalSendDocument === 'function' && !originalSendDocument.__vaultxCurrencyPatched) {
    const patched = function patchedSendDocument(chatId, document, options, fileOptions, callback) {
      const currency = getCurrencyForChat(chatId);
      const nextOptions = options && typeof options === 'object' ? { ...options } : options;
      if (typeof nextOptions?.caption === 'string') nextOptions.caption = replaceMoney(nextOptions.caption, currency);
      if (nextOptions?.reply_markup) nextOptions.reply_markup = transformMarkup(nextOptions.reply_markup, currency);
      return originalSendDocument.call(this, chatId, document, nextOptions, fileOptions, callback);
    };
    patched.__vaultxCurrencyPatched = true;
    TelegramBot.prototype.sendDocument = patched;
  }

  const originalEditMessageText = TelegramBot.prototype.editMessageText;
  if (!originalEditMessageText.__vaultxCurrencyPatched) {
    const patched = function patchedEditMessageText(text, options, callback) {
      const chatId = options?.chat_id;
      const currency = getCurrencyForChat(chatId);
      const nextOptions = options && typeof options === 'object' ? { ...options } : options;
      if (nextOptions?.reply_markup) nextOptions.reply_markup = transformMarkup(nextOptions.reply_markup, currency);
      return originalEditMessageText.call(this, replaceMoney(text, currency), nextOptions, callback);
    };
    patched.__vaultxCurrencyPatched = true;
    TelegramBot.prototype.editMessageText = patched;
  }
}

function patchTopup() {
  const topup = require('./topupService');
  if (!topup) return;

  const originalCreateCryptomusPayment = topup.createCryptomusPayment;
  if (typeof originalCreateCryptomusPayment === 'function' && !originalCreateCryptomusPayment.__vaultxPatched) {
    const patched = async function patchedCreateCryptomusPayment(enteredAmount, userId) {
      if (!CRYPTOMUS_MERCHANT_ID || !CRYPTOMUS_API_KEY) throw new Error('Cryptomus credentials are missing');
      const store = global.__VAULTX_APP_STORE;
      const user = store?.findUserById(userId);
      const currency = currencyFromUser(user);
      const entered = Number(enteredAmount);
      if (!Number.isFinite(entered) || entered <= 0) throw new Error('Invalid top-up amount');
      const amountRub = Number(amountToRub(entered, currency).toFixed(2));
      const amountUsd = Number((amountRub / Number(USD_TO_RUB_RATE || 30)).toFixed(2));
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('Invalid USD amount');
      if (!String(PUBLIC_BASE_URL || '').trim()) throw new Error('PUBLIC_BASE_URL is required for Cryptomus webhook payments');

      const orderId = `vxcm_${Number(userId)}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const body = {
        amount: amountUsd.toFixed(2),
        currency: 'USD',
        order_id: orderId,
        url_callback: `${String(PUBLIC_BASE_URL).replace(/\/+$/, '')}/cryptomus-webhook`,
        additional_data: JSON.stringify({ user_id: Number(userId), amount_rub: amountRub, display_currency: currency, display_amount: entered }),
        is_payment_multiple: false,
        lifetime: 3600,
      };
      const rawBody = JSON.stringify(body);
      const sign = crypto.createHash('md5').update(Buffer.from(rawBody, 'utf8').toString('base64') + String(CRYPTOMUS_API_KEY)).digest('hex');
      const axios = require('axios');
      const response = await axios.post('https://api.cryptomus.com/v1/payment', body, {
        headers: { merchant: CRYPTOMUS_MERCHANT_ID, sign, 'Content-Type': 'application/json' },
        timeout: 20000,
      });
      if (!response?.data || response.data.state === 1) throw new Error(`Cryptomus API error: ${response?.data?.message || 'unknown_error'}`);
      const result = response.data.result || {};
      const payUrl = result.url || result.payment_url;
      if (!payUrl) throw new Error('Cryptomus payment URL is missing');
      return { orderId, amountUsd, amountRub, displayCurrency: currency, displayAmount: entered, payUrl, invoiceId: String(result.uuid || result.invoice_uuid || ''), rawResult: result };
    };
    patched.__vaultxPatched = true;
    topup.createCryptomusPayment = patched;
  }

  const originalVerify = topup.verifyCryptomusWebhookSignature;
  if (typeof originalVerify === 'function' && !originalVerify.__vaultxPatched) {
    const patched = function patchedVerify(rawBody, signatureHeader) {
      if (!CRYPTOMUS_API_KEY) return false;
      let candidate = String(rawBody || '');
      let supplied = String(signatureHeader || '').trim();
      try {
        const parsed = JSON.parse(candidate || '{}');
        if (!supplied && parsed && parsed.sign) supplied = String(parsed.sign);
        if (parsed && parsed.sign) {
          delete parsed.sign;
          candidate = JSON.stringify(parsed);
        }
      } catch (_) {}
      if (!supplied) return false;
      const expected = crypto.createHash('md5').update(Buffer.from(candidate, 'utf8').toString('base64') + String(CRYPTOMUS_API_KEY)).digest('hex');
      const expectedBuffer = Buffer.from(expected.toLowerCase());
      const suppliedBuffer = Buffer.from(supplied.toLowerCase());
      if (expectedBuffer.length !== suppliedBuffer.length) return false;
      const verified = crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
      if (verified) {
        try {
          const verifiedPayload = JSON.parse(candidate || '{}');
          let additional = {};
          try { additional = typeof verifiedPayload.additional_data === 'string' ? JSON.parse(verifiedPayload.additional_data) : (verifiedPayload.additional_data || {}); } catch (_) { additional = {}; }
          cryptomusWebhookContext = {
            orderId: String(verifiedPayload.order_id || ''),
            userId: Number(additional.user_id || 0),
            amount: Number(verifiedPayload.payment_amount_usd || verifiedPayload.payment_amount || verifiedPayload.amount || 0),
            currency: String(verifiedPayload.currency || ''),
            status: String(verifiedPayload.status || '').toLowerCase(),
          };
          if (!cryptomusWebhookContext.userId) {
            const store = global.__VAULTX_APP_STORE;
            const pending = store?.transactions?.find((tx) => tx.type === 'topup_cryptomus_pending' && String(tx.cryptomusOrderId || '') === cryptomusWebhookContext.orderId);
            cryptomusWebhookContext.userId = Number(pending?.userId || 0);
          }
        } catch (_) {
          cryptomusWebhookContext = null;
        }
      }
      return verified;
    };
    patched.__vaultxPatched = true;
    topup.verifyCryptomusWebhookSignature = patched;
  }

  if (typeof topup.sendCryptomusUsdPrompt === 'function' && !topup.sendCryptomusUsdPrompt.__vaultxPatched) {
    const { sendOrEditMessage } = require('./profileService');
    const patched = async function patchedCryptomusPrompt(bot, chatId, options = {}) {
      const store = global.__VAULTX_APP_STORE;
      const user = store?.findUserById(chatId);
      const currency = currencyFromUser(user);
      const lang = options.lang || getUserLang(user || { language: 'ar' });
      const text = lang === 'ar'
        ? `💳 شحن الرصيد عبر Cryptomus\n\nأرسل مبلغ الشحن بعملة حسابك: ${currency}\n\nمثال: 10 USD أو 500 YER أو 37 SAR`
        : `💳 Top up via Cryptomus\n\nSend the top-up amount in your account currency: ${currency}\n\nExample: 10 USD, 500 YER, or 37 SAR`;
      return sendOrEditMessage(bot, chatId, text, { inline_keyboard: [[{ text: t(lang, 'common_back'), callback_data: 'service:balance_topup' }]] }, options.messageId, 'sendCryptomusUsdPrompt');
    };
    patched.__vaultxPatched = true;
    topup.sendCryptomusUsdPrompt = patched;
  }

  if (typeof topup.sendCryptoAssetPrompt === 'function' && !topup.sendCryptoAssetPrompt.__vaultxPatched) {
    const original = topup.sendCryptoAssetPrompt;
    const patched = async function patchedCryptoAssetPrompt(bot, chatId, options = {}) {
      if (typeof topup.sendCryptomusUsdPrompt === 'function') return topup.sendCryptomusUsdPrompt(bot, chatId, options);
      return original(bot, chatId, options);
    };
    patched.__vaultxPatched = true;
    topup.sendCryptoAssetPrompt = patched;
  }
}

function patchTopupKeyboard() {
  const keyboard = require('../keyboards/topupKeyboard');
  const original = keyboard.getTopupHomeKeyboard;
  if (typeof original !== 'function' || original.__vaultxPatched) return;
  const patched = function patchedTopupHomeKeyboard(lang = 'ar') {
    const result = original(lang);
    result.inline_keyboard = (result.inline_keyboard || []).filter((row) =>
      !row.some((button) => button?.callback_data === 'topup:auto:crypto')
    );
    return result;
  };
  patched.__vaultxPatched = true;
  keyboard.getTopupHomeKeyboard = patched;
}

async function showCurrencySelection(bot, query, user, mode = 'settings') {
  const lang = getUserLang(user || { language: 'ar' });
  if (mode === 'registration') setUserState(user.userId, 'AWAITING_CURRENCY', { language: lang });
  await safeTelegramCall('currency.menu.answer', () => bot.answerCallbackQuery(query.id));
  return safeTelegramCall('currency.menu.show', () => bot.editMessageText(
    lang === 'ar'
      ? `💱 اختر عملتك المفضلة\n\nالعملة الحالية: ${currencyFromUser(user)}\n\nيمكنك تغييرها لاحقاً من الإعدادات.`
      : `💱 Choose your preferred currency\n\nCurrent currency: ${currencyFromUser(user)}\n\nYou can change it later from Settings.`,
    { chat_id: query.message?.chat?.id || query.from.id, message_id: query.message?.message_id, parse_mode: 'HTML', reply_markup: getCurrencyKeyboard(lang, currencyFromUser(user)) }
  ));
}

async function handleCurrencyCallback(bot, query) {
  const data = String(query?.data || '');
  const store = global.__VAULTX_APP_STORE;
  if (!store) return false;
  const user = store.getOrCreateUser(query.from);

  if (data === 'menu:change_currency') {
    await showCurrencySelection(bot, query, user, 'settings');
    return true;
  }

  if (data.startsWith('currency:set:')) {
    const selected = normalizeCurrency(data.split(':')[2]);
    const updated = store.updateUser(user.userId, { currency: selected });
    const state = getUserState(user.userId);
    const lang = getUserLang(updated || user);
    await safeTelegramCall('currency.set.answer', () => bot.answerCallbackQuery(query.id, { text: lang === 'ar' ? `تم اختيار ${selected} ✅` : `${selected} selected ✅` }));

    if (state?.name === 'AWAITING_CURRENCY' && !(updated || user).isVerified) {
      const code = String(Math.floor(10000 + Math.random() * 90000));
      setUserState(user.userId, 'AWAITING_CAPTCHA', { captchaCode: code });
      await safeTelegramCall('currency.registration.captcha', () => bot.editMessageText(
        [`<b>${t(lang, 'start_captcha_title')}</b>`, '', `${t(lang, 'start_captcha_prompt')} <code>${code}</code>`].join('\n'),
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML' }
      ));
      return true;
    }
    return true;
  }

  if (data === 'setlang_ar' || data === 'setlang_en') {
    const selectedLanguage = data === 'setlang_en' ? 'en' : 'ar';
    const updated = store.updateUser(user.userId, { language: selectedLanguage });
    await safeTelegramCall('currency.language.answer', () => bot.answerCallbackQuery(query.id, { text: selectedLanguage === 'ar' ? 'تم حفظ اللغة، اختر العملة الآن' : 'Language saved, choose your currency now' }));
    if (!updated?.isVerified) return showCurrencySelection(bot, query, updated || user, 'registration');
    return false;
  }

  return false;
}

function patchCallbackRouting() {
  const originalOn = TelegramBot.prototype.on;
  if (originalOn.__vaultxPatched) return;
  const patched = function patchedOn(event, handler) {
    if (event !== 'callback_query') return originalOn.call(this, event, handler);
    const wrapped = async function wrappedCallback(query) {
      try {
        if (await handleCurrencyCallback(this, query)) return true;
        if (query?.data === 'topup:auto:crypto' || String(query?.data || '').startsWith('topup:crypto:')) {
          query = { ...query, data: 'topup:auto:cryptomus' };
        }
      } catch (error) {
        await safeTelegramCall('currency.callback.error', () => this.answerCallbackQuery(query.id, { text: 'Currency error', show_alert: true }));
        return true;
      }
      return handler.call(this, query);
    };
    return originalOn.call(this, event, wrapped);
  };
  patched.__vaultxPatched = true;
  TelegramBot.prototype.on = patched;
}

patchAppStore();
patchTopupKeyboard();
patchTopup();
patchTelegramOutput();
patchCallbackRouting();

module.exports = { replaceMoney, formatDisplay, amountToRub, rubToCurrency };
