const { ACTIVATIONS_CHANNEL_ID } = require("../config");
const axios = require("axios");
const {
  getTopupHomeKeyboard,
  getSaudiTopupKeyboard,
  getYemenTopupKeyboard,
  getEgyptTopupKeyboard,
  getGlobalTopupKeyboard,
  getStarsPayKeyboard,
} = require("../keyboards/topupKeyboard");
const { sendOrEditMessage } = require("./profileService");
const { safeTelegramCall } = require("./telegramSafe");
const { formatRuble } = require("../utils/formatters");
const { t } = require("../locales");
const { buildVaultxServiceCard } = require("../utils/serviceHeroCards");
const { CRYPTO_PAY_TOKEN } = require("../config");

const CRYPTO_PAY_BASE_URL = "https://pay.crypt.bot/api";
const CRYPTO_SUPPORTED_ASSETS = ["USDT", "TON", "TRX", "BTC", "ETH"];
const CRYPTO_ASSET_PRECISION = {
  USDT: 2,
  TON: 3,
  TRX: 2,
  BTC: 8,
  ETH: 8,
};

function buildCryptoAssetKeyboard(lang = "ar") {
  return {
    inline_keyboard: [
      [
        { text: "USDT", callback_data: "topup:crypto:asset:USDT" },
        { text: "TON", callback_data: "topup:crypto:asset:TON" },
        { text: "TRX", callback_data: "topup:crypto:asset:TRX" },
      ],
      [
        { text: "BTC", callback_data: "topup:crypto:asset:BTC" },
        { text: "ETH", callback_data: "topup:crypto:asset:ETH" },
      ],
      [{ text: t(lang, "common_back"), callback_data: "service:balance_topup" }],
    ],
  };
}

function buildCryptoInvoiceKeyboard(payUrl, lang = "ar") {
  return {
    inline_keyboard: [
      [{ text: lang === "ar" ? "💳 فتح رابط الدفع" : "💳 Open Payment Link", url: payUrl }],
      [{ text: lang === "ar" ? "↩️ رجوع" : "↩️ Back", callback_data: "service:balance_topup" }],
    ],
  };
}

function roundNumber(value, digits = 2) {
  const factor = Math.pow(10, digits);
  return Math.ceil(Number(value) * factor) / factor;
}

async function callCryptoPayApi(method, payload = {}) {
  if (!CRYPTO_PAY_TOKEN) {
    throw new Error("CRYPTO_PAY_TOKEN is missing");
  }

  const response = await axios.post(`${CRYPTO_PAY_BASE_URL}/${method}`, payload, {
    headers: {
      "Crypto-Pay-API-Token": CRYPTO_PAY_TOKEN,
      "Content-Type": "application/json",
    },
    timeout: 20000,
  });

  if (!response?.data?.ok) {
    throw new Error(`Crypto Pay API error: ${response?.data?.error?.name || "unknown_error"}`);
  }

  return response.data.result;
}

function findDirectRate(rates, source, target) {
  const direct = rates.find((item) => item.source === source && item.target === target);
  if (direct && Number(direct.rate) > 0) {
    return Number(direct.rate);
  }
  return null;
}

function resolveAssetToRubRate(rates, asset) {
  const directAssetRub = findDirectRate(rates, asset, "RUB");
  if (directAssetRub) {
    return directAssetRub;
  }

  const directRubAsset = findDirectRate(rates, "RUB", asset);
  if (directRubAsset) {
    return 1 / directRubAsset;
  }

  const assetUsdt = findDirectRate(rates, asset, "USDT");
  const usdtRub = findDirectRate(rates, "USDT", "RUB");
  if (assetUsdt && usdtRub) {
    return assetUsdt * usdtRub;
  }

  const assetUsd = findDirectRate(rates, asset, "USD");
  const usdRub = findDirectRate(rates, "USD", "RUB");
  if (assetUsd && usdRub) {
    return assetUsd * usdRub;
  }

  return null;
}

async function fetchCryptoExchangeRates() {
  const result = await callCryptoPayApi("getExchangeRates", {});
  if (Array.isArray(result)) {
    return result;
  }
  if (Array.isArray(result?.rates)) {
    return result.rates;
  }
  return [];
}

async function convertRubToAssetAmount(amountRub, asset) {
  const rates = await fetchCryptoExchangeRates();
  const assetToRub = resolveAssetToRubRate(rates, asset);
  if (!assetToRub || !Number.isFinite(assetToRub) || assetToRub <= 0) {
    throw new Error(`Missing exchange rate for ${asset}/RUB`);
  }

  const precision = CRYPTO_ASSET_PRECISION[asset] || 6;
  return roundNumber(Number(amountRub) / assetToRub, precision);
}

async function convertAssetAmountToRub(amountAsset, asset) {
  const rates = await fetchCryptoExchangeRates();
  const assetToRub = resolveAssetToRubRate(rates, asset);
  if (!assetToRub || !Number.isFinite(assetToRub) || assetToRub <= 0) {
    throw new Error(`Missing exchange rate for ${asset}/RUB`);
  }

  return roundNumber(Number(amountAsset) * assetToRub, 2);
}

async function sendTopupHome(bot, chatId, options = {}) {
  const lang = options.lang || "ar";
  const balance = Number(options.user?.balance || 0);
  const text = buildVaultxServiceCard(lang, "balance_topup", { balance: formatRuble(balance) });
  return sendOrEditMessage(bot, chatId, text, getTopupHomeKeyboard(lang), options.messageId, "sendTopupHome");
}

async function sendCountryTopupMenu(bot, chatId, country, options = {}) {
  const lang = options.lang || "ar";
  const map = {
    saudi: { text: t(lang, "topup_country_saudi"), keyboard: getSaudiTopupKeyboard(lang) },
    yemen: { text: t(lang, "topup_country_yemen"), keyboard: getYemenTopupKeyboard(lang) },
    egypt: { text: t(lang, "topup_country_egypt"), keyboard: getEgyptTopupKeyboard(lang) },
    global: { text: t(lang, "topup_country_global"), keyboard: getGlobalTopupKeyboard(lang) },
  };

  if (!map[country]) {
    return sendTopupHome(bot, chatId, options);
  }

  return sendOrEditMessage(bot, chatId, map[country].text, map[country].keyboard, options.messageId, `sendCountryTopupMenu.${country}`);
}

async function sendStarsPrompt(bot, chatId, options = {}) {
  const lang = options.lang || "ar";
  const text = [t(lang, "topup_stars_title"), "", t(lang, "topup_stars_price"), "", t(lang, "topup_stars_prompt")].join("\n");

  return sendOrEditMessage(
    bot,
    chatId,
    text,
    { inline_keyboard: [[{ text: t(lang, "common_back"), callback_data: "service:balance_topup" }]] },
    options.messageId,
    "sendStarsPrompt"
  );
}

async function sendCryptoAssetPrompt(bot, chatId, options = {}) {
  const lang = options.lang || "ar";
  const text = lang === "ar"
    ? "🪙 اختر عملة الدفع عبر Crypto Pay:\n\nUSDT / TON / TRX / BTC / ETH"
    : "🪙 Choose your Crypto Pay currency:\n\nUSDT / TON / TRX / BTC / ETH";

  return sendOrEditMessage(
    bot,
    chatId,
    text,
    buildCryptoAssetKeyboard(lang),
    options.messageId,
    "sendCryptoAssetPrompt"
  );
}

async function sendCryptoAmountPrompt(bot, chatId, asset, options = {}) {
  const lang = options.lang || "ar";
  const text = lang === "ar"
    ? `💵 تم اختيار ${asset}\n\nأرسل مبلغ الشحن بالروبل (RUB).`
    : `💵 ${asset} selected\n\nSend top-up amount in RUB.`;

  return sendOrEditMessage(
    bot,
    chatId,
    text,
    { inline_keyboard: [[{ text: t(lang, "common_back"), callback_data: "topup:auto:crypto" }]] },
    options.messageId,
    "sendCryptoAmountPrompt"
  );
}

async function sendCryptoInvoiceCheckout(bot, chatId, data, options = {}) {
  const lang = options.lang || "ar";
  const text = lang === "ar"
    ? [
      "✅ تم إنشاء فاتورة Crypto Pay",
      "",
      `💰 المبلغ: ${formatRuble(data.amountRub)} RUB`,
      `🪙 العملة: ${data.asset}`,
      `🔢 المطلوب دفعه: ${data.amountAsset} ${data.asset}`,
      "",
      "اضغط زر الدفع لإكمال العملية.",
    ].join("\n")
    : [
      "✅ Crypto Pay invoice created",
      "",
      `💰 Amount: ${formatRuble(data.amountRub)} RUB`,
      `🪙 Asset: ${data.asset}`,
      `🔢 To pay: ${data.amountAsset} ${data.asset}`,
      "",
      "Press the payment button to complete checkout.",
    ].join("\n");

  return safeTelegramCall("sendCryptoInvoiceCheckout", () =>
    bot.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: buildCryptoInvoiceKeyboard(data.payUrl, lang),
    })
  );
}

async function createCryptoInvoiceForRub(userId, amountRub, asset) {
  const normalizedAsset = String(asset || "").toUpperCase();
  if (!CRYPTO_SUPPORTED_ASSETS.includes(normalizedAsset)) {
    throw new Error(`Unsupported crypto asset: ${asset}`);
  }

  const amountAsset = await convertRubToAssetAmount(amountRub, normalizedAsset);
  if (!Number.isFinite(amountAsset) || amountAsset <= 0) {
    throw new Error("Invalid converted crypto amount");
  }

  const payload = JSON.stringify({
    user_id: Number(userId),
    amount_rub: Number(amountRub),
    asset: normalizedAsset,
  });

  const invoice = await callCryptoPayApi("createInvoice", {
    asset: normalizedAsset,
    amount: String(amountAsset),
    payload,
  });

  return {
    invoiceId: Number(invoice.invoice_id),
    payUrl: invoice.bot_invoice_url || invoice.pay_url || invoice.mini_app_invoice_url,
    amountAsset,
    amountRub: Number(amountRub),
    asset: normalizedAsset,
    payload,
  };
}

async function sendStarsCheckout(bot, chatId, amountRub, lang = "ar") {
  const starsAmount = amountRub * 3;
  const text = [
    t(lang, "topup_checkout_title"),
    "",
    `${t(lang, "topup_checkout_amount")}: ${formatRuble(amountRub)} RUB`,
    `${t(lang, "topup_checkout_stars")}: ${formatRuble(starsAmount)}`,
    "",
    t(lang, "topup_checkout_hint"),
  ].join("\n");

  return safeTelegramCall("sendStarsCheckout", () =>
    bot.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: getStarsPayKeyboard(amountRub, lang),
    })
  );
}

async function sendPlaceholderTopupMethod(bot, chatId, methodTitle, options = {}) {
  const lang = options.lang || "ar";
  const text = [`💳 ${methodTitle}`, "", t(lang, "topup_method_placeholder")].join("\n");

  return sendOrEditMessage(
    bot,
    chatId,
    text,
    {
      inline_keyboard: [
        [{ text: t(lang, "common_back"), callback_data: "service:balance_topup" }],
        [{ text: t(lang, "common_home"), callback_data: "menu:main" }],
      ],
    },
    options.messageId,
    "sendPlaceholderTopupMethod"
  );
}

async function createStarsInvoice(bot, chatId, amountRub, lang = "ar") {
  const starsAmount = amountRub * 3;
  return safeTelegramCall("createStarsInvoice", () =>
    bot.sendInvoice(
      chatId,
      t(lang, "topup_invoice_title"),
      t(lang, "topup_invoice_desc").replace("{amount}", formatRuble(amountRub)),
      `topup_stars_${amountRub}`,
      "",
      "XTR",
      [{ label: "Telegram Stars", amount: starsAmount }]
    )
  );
}

async function notifyTopupChannel(bot, userId, amountRub, lang = "ar", method = "Telegram Stars") {
  return safeTelegramCall("notifyTopupChannel", () =>
    bot.sendMessage(
      ACTIVATIONS_CHANNEL_ID,
      [
        t(lang, "topup_notify_title"),
        "",
        `${t(lang, "topup_notify_user_id")}: <code>${userId}</code>`,
        `${t(lang, "topup_notify_amount")}: ${formatRuble(amountRub)} RUB`,
        `${t(lang, "topup_notify_method")}: ${method}`,
      ].join("\n"),
      {
        parse_mode: "HTML",
        disable_notification: true,
      }
    )
  );
}

module.exports = {
  CRYPTO_SUPPORTED_ASSETS,
  sendTopupHome,
  sendCountryTopupMenu,
  sendStarsPrompt,
  sendCryptoAssetPrompt,
  sendCryptoAmountPrompt,
  sendCryptoInvoiceCheckout,
  sendStarsCheckout,
  sendPlaceholderTopupMethod,
  createStarsInvoice,
  createCryptoInvoiceForRub,
  convertAssetAmountToRub,
  notifyTopupChannel,
};
