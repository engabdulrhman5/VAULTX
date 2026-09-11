const TelegramBot = require("node-telegram-bot-api");
const { AppStore } = require("./appStore");
const { normalizeCurrency, getCurrencyKeyboard, formatCurrency } = require("./currencyService");
const { setUserState, getUserState } = require("./stateStore");
const locales = require("../locales");
const mainKeyboard = require("../keyboards/mainMenuKeyboard");

const originalSettingsKeyboard = mainKeyboard.getSettingsMenuKeyboard;
mainKeyboard.getSettingsMenuKeyboard = function patchedSettingsKeyboard(lang = "ar") {
  const keyboard = originalSettingsKeyboard(lang);
  const rows = keyboard.inline_keyboard || [];
  const backIndex = rows.findIndex((row) => row.some((button) => button.callback_data === "menu:main"));
  const row = [{ text: lang === "ar" ? "💱 العملة المفضلة" : "💱 Preferred Currency", callback_data: "menu:change_currency" }];
  if (backIndex >= 0) rows.splice(backIndex, 0, row); else rows.push(row);
  return keyboard;
};

const { sendMainMenu, sendSettingsMenu } = require("./profileService");
const { safeTelegramCall } = require("./telegramSafe");
let installed = false;
const activeCurrencyByChat = new Map();

function getCurrencyForChat(chatId) {
  return normalizeCurrency(activeCurrencyByChat.get(String(chatId)) || "RUB");
}

function rememberChatCurrency(chatId, currency) {
  if (chatId === undefined || chatId === null) return;
  activeCurrencyByChat.set(String(chatId), normalizeCurrency(currency));
}

function getCurrencyPrompt(lang, current) {
  return lang === "ar"
    ? `💱 اختر عملتك المفضلة\n\nالعملة الحالية: ${normalizeCurrency(current)}\n\nيمكنك تغييرها لاحقاً من الإعدادات.`
    : `💱 Choose your preferred currency\n\nCurrent currency: ${normalizeCurrency(current)}\n\nYou can change it later from Settings.`;
}
function getCaptchaCode() { return String(Math.floor(10000 + Math.random() * 90000)); }

function convertUserFacingRub(text, currency = "RUB") {
  const code = normalizeCurrency(currency);
  if (code === "RUB") return text;
  return String(text || "")
    .replace(/₽\s*([0-9]+(?:\.[0-9]+)?)/g, (_, value) => formatCurrency(Number(value), code))
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*RUB\b/gi, (_, value) => formatCurrency(Number(value), code))
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*روبل/g, (_, value) => formatCurrency(Number(value), code))
    .replace(/روبل/g, code === "YER" ? "ريال يمني" : code === "SAR" ? "ريال سعودي" : code === "USD" ? "دولار" : "روبل")
    .replace(/₽/g, code === "USD" ? "$" : code === "YER" ? "ر.ي" : code === "SAR" ? "ر.س" : "₽");
}

async function showCurrencySelection(bot, query, user, mode = "registration") {
  const lang = locales.getUserLang(user);
  rememberChatCurrency(query.message?.chat?.id || query.from?.id, user.currency);
  if (mode === "registration") setUserState(user.userId, "AWAITING_CURRENCY", { language: lang });
  return safeTelegramCall("currency.showSelection", () => bot.editMessageText(getCurrencyPrompt(lang, user.currency), {
    chat_id: query.message?.chat?.id || query.from.id,
    message_id: query.message?.message_id,
    parse_mode: "HTML",
    reply_markup: getCurrencyKeyboard(lang, user.currency),
  }));
}

async function completeLanguageSelection(bot, query, appStore) {
  const selectedLanguage = query.data === "setlang_en" ? "en" : "ar";
  const user = appStore.getOrCreateUser(query.from);
  const updatedUser = appStore.updateUser(user.userId, { language: selectedLanguage });
  if (!updatedUser) return true;
  rememberChatCurrency(query.message?.chat?.id || query.from?.id, updatedUser.currency);
  await safeTelegramCall("currency.language.answer", () => bot.answerCallbackQuery(query.id, { text: selectedLanguage === "ar" ? "تم حفظ اللغة، اختر العملة الآن" : "Language saved, choose your currency now" }));
  if (updatedUser.isVerified) {
    await sendMainMenu(bot, query.message.chat.id, updatedUser, { messageId: query.message.message_id });
    return true;
  }
  await showCurrencySelection(bot, query, updatedUser, "registration");
  return true;
}

async function completeCurrencySelection(bot, query, appStore, currency) {
  const user = appStore.getOrCreateUser(query.from);
  const selected = normalizeCurrency(currency);
  const updatedUser = appStore.updateUser(user.userId, { currency: selected });
  const state = getUserState(user.userId);
  const lang = locales.getUserLang(updatedUser || user);
  rememberChatCurrency(query.message?.chat?.id || query.from?.id, selected);
  await safeTelegramCall("currency.set.answer", () => bot.answerCallbackQuery(query.id, { text: lang === "ar" ? `تم اختيار ${selected} ✅` : `${selected} selected ✅` }));
  if (state?.name === "AWAITING_CURRENCY" && !(updatedUser || user).isVerified) {
    const code = getCaptchaCode();
    setUserState(user.userId, "AWAITING_CAPTCHA", { captchaCode: code });
    await safeTelegramCall("currency.registration.captcha", () => bot.editMessageText([`<b>${locales.t(lang, "start_captcha_title")}</b>`, "", `${locales.t(lang, "start_captcha_prompt")} <code>${code}</code>`].join("\n"), { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" }));
    return true;
  }
  await sendSettingsMenu(bot, query.message.chat.id, { lang, messageId: query.message.message_id });
  return true;
}

function install() {
  if (installed) return;
  installed = true;

  const originalNormalizeUser = AppStore.prototype.normalizeUser;
  AppStore.prototype.normalizeUser = function patchedNormalizeUser(user) {
    global.__VAULTX_APP_STORE = this;
    const normalized = originalNormalizeUser.call(this, user);
    normalized.currency = normalizeCurrency(user?.currency || normalized.currency);
    return normalized;
  };

  const originalSendMessage = TelegramBot.prototype.sendMessage;
  TelegramBot.prototype.sendMessage = function patchedSendMessage(chatId, text, options, callback) {
    return originalSendMessage.call(this, chatId, convertUserFacingRub(text, getCurrencyForChat(chatId)), options, callback);
  };

  const originalEditMessageText = TelegramBot.prototype.editMessageText;
  TelegramBot.prototype.editMessageText = function patchedEditMessageText(text, options, callback) {
    const chatId = options?.chat_id;
    return originalEditMessageText.call(this, chatId === undefined ? text : convertUserFacingRub(text, getCurrencyForChat(chatId)), options, callback);
  };

  const originalOn = TelegramBot.prototype.on;
  TelegramBot.prototype.on = function patchedOn(event, handler) {
    if (event === "callback_query") {
      const wrapped = async function currencyAwareCallback(query) {
        const appStore = global.__VAULTX_APP_STORE;
        try {
          if (query?.from?.id && appStore) {
            const currentUser = appStore.findUserById(query.from.id);
            if (currentUser) rememberChatCurrency(query.message?.chat?.id || query.from.id, currentUser.currency);
          }
          if (query?.data?.startsWith("setlang_") && appStore) return completeLanguageSelection(this, query, appStore);
          if (query?.data === "menu:change_currency" && appStore) {
            const user = appStore.getOrCreateUser(query.from);
            rememberChatCurrency(query.message?.chat?.id || query.from.id, user.currency);
            await safeTelegramCall("currency.menu.answer", () => this.answerCallbackQuery(query.id));
            return showCurrencySelection(this, query, user, "settings");
          }
          if (query?.data?.startsWith("currency:set:") && appStore) return completeCurrencySelection(this, query, appStore, query.data.split(":")[2]);
        } catch (error) {
          await safeTelegramCall("currency.callback.error", () => this.answerCallbackQuery(query.id, { text: "Currency error", show_alert: true }));
        }
        return handler.apply(this, arguments);
      };
      return originalOn.call(this, event, wrapped);
    }
    return originalOn.call(this, event, handler);
  };

  const originalGetUserLang = locales.getUserLang;
  locales.getUserLang = function patchedGetUserLang(user) {
    if (user?.currency && user?.userId) rememberChatCurrency(user.userId, user.currency);
    return originalGetUserLang(user);
  };
}

install();
module.exports = { install };
