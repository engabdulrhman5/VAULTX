const { ACTIVATIONS_CHANNEL_ID } = require("../config");
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

async function sendTopupHome(bot, chatId, options = {}) {
  const lang = options.lang || "ar";
  const text = [t(lang, "topup_title"), "", t(lang, "topup_subtitle"), "", t(lang, "topup_instant")].join("\n");
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

async function notifyTopupChannel(bot, userId, amountRub, lang = "ar") {
  return safeTelegramCall("notifyTopupChannel", () =>
    bot.sendMessage(
      ACTIVATIONS_CHANNEL_ID,
      [
        t(lang, "topup_notify_title"),
        "",
        `${t(lang, "topup_notify_user_id")}: <code>${userId}</code>`,
        `${t(lang, "topup_notify_amount")}: ${formatRuble(amountRub)} RUB`,
        `${t(lang, "topup_notify_method")}: Telegram Stars`,
      ].join("\n"),
      {
        parse_mode: "HTML",
        disable_notification: true,
      }
    )
  );
}

module.exports = {
  sendTopupHome,
  sendCountryTopupMenu,
  sendStarsPrompt,
  sendStarsCheckout,
  sendPlaceholderTopupMethod,
  createStarsInvoice,
  notifyTopupChannel,
};
