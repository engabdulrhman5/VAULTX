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

function getCurrencyPrompt(lang, current) {
  return lang === "ar"
    ? `💱 اختر عملتك المفضلة\n\nالعملة الحالية: ${normalizeCurrency(current)}\n\nيمكنك تغييرها لاحقاً من الإعدادات.`
    : `💱 Choose your preferred currency\n\nCurrent currency: ${normalizeCurrency(current)}\n\nYou can change it later from Settings.`;
}
function getCaptchaCode() { return String(Math.floor(10000 + Math.random() * 90000)); }

function convertUserFacingRub(text) {
  const currency = normalizeCurrency(global.__VAULTX_ACTIVE_CURRENCY || "RUB");
  if (currency === "RUB") return text;
  return String(text || "")
    .replace(/₽\s*([0-9]+(?:\.[0-9]+)?)/g, (_, value) => formatCurrency(Number(value), currency))
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*RUB\b/gi, (_, value) => formatCurrency(Number(value), currency))
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*روبل/g, (_, value) => formatCurrency(Number(value), currency))
    .replace(/روبل/g, currency === "YER" ? "ريال يمني" : currency === "SAR" ? "ريال سعودي" : currency === "USD" ? "دولار" : "روبل")
    .replace(/₽/g, currency === "USD" ? "$" : currency === "YER" ? "ر.ي" : currency === "SAR" ? "ر.س" : "₽");
}

async function showCurrencySelection(bot, query, user, mode = "registration") {
  const lang = locales.getUserLang(user);
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

  const originalGetUserLang = locales.getUserLang;
  locales.getUserLang = function patchedGetUserLang(user) {
    if (user?.currency) global.__VAULTX_ACTIVE_CURRENCY = normalizeCurrency(user.currency);
    return originalGetUserLang(user);
  };

  const originalSendMessage = TelegramBot.prototype.sendMessage;
  TelegramBot.prototype.sendMessage = function patchedSendMessage(chatId, text, options, callback) {
    return originalSendMessage.call(this, chatId, convertUserFacingRub(text), options, callback);
  };

  const originalEditMessageText = TelegramBot.prototype.editMessageText;
  TelegramBot.prototype.editMessageText = function patchedEditMessageText(text, options, callback) {
    return originalEditMessageText.call(this, convertUserFacingRub(text), options, callback);
  };

  const originalOn = TelegramBot.prototype.on;
  TelegramBot.prototype.on = function patchedOn(event, handler) {
    if (event === "callback_query") {
      const wrapped = async function currencyAwareCallback(query) {
        const appStore = global.__VAULTX_APP_STORE;
        try {
          if (query?.data?.startsWith("setlang_") && appStore) return completeLanguageSelection(this, query, appStore);
          if (query?.data === "menu:change_currency" && appStore) {
            const user = appStore.getOrCreateUser(query.from);
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
}

install();
module.exports = { install };
