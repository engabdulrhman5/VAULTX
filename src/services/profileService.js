const {
  getMainMenuKeyboard,
  getBackToMainMenuKeyboard,
  getAccountMenuKeyboard,
  getSettingsMenuKeyboard,
  getChannelsKeyboard,
  getAdminPanelKeyboard,
  getServicesManagementKeyboard,
} = require("../keyboards/mainMenuKeyboard");
const { escapeHtml, formatRuble, getDisplayName } = require("../utils/formatters");
const { safeTelegramCall } = require("./telegramSafe");
const { getUserLang, t } = require("../locales");
const { getVipTier } = require("../utils/vip");

async function sendOrEditMessage(bot, chatId, text, replyMarkup, messageId, scope) {
  const payload = {
    parse_mode: "HTML",
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
  };

  if (messageId) {
    return safeTelegramCall(scope || "editMessageText", () =>
      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...payload,
      })
    );
  }

  return safeTelegramCall(scope || "sendMessage", () => bot.sendMessage(chatId, text, payload));
}

function buildMainMenuText(user) {
  const lang = getUserLang(user);

  return [
    `<b>${t(lang, "mainMenu_header")}</b>`,
    "",
    `👤 ${escapeHtml(getDisplayName(user))}`,
    `🆔 <code>${user.userId}</code>`,
    `💰 ${formatRuble(user.balance)}`,
    `👑 ${escapeHtml(getVipTier(user.totalDeposits))}`,
  ].join("\n");
}

function buildAccountText(user) {
  const lang = getUserLang(user);
  return [
    `<b>${t(lang, "account_title")}</b>`,
    "",
    `🆔 <code>${user.userId}</code>`,
    `💰 ${formatRuble(user.balance)}`,
    `📦 ${user.transactionsCount}`,
    `👑 ${escapeHtml(getVipTier(user.totalDeposits))}`,
  ].join("\n");
}

function buildAccountProfileText(user) {
  const lang = getUserLang(user);
  return [
    `<b>${t(lang, "account_profile_title")}</b>`,
    "",
    `👤 ${escapeHtml(getDisplayName(user))}`,
    `🆔 <code>${user.userId}</code>`,
    `💰 ${formatRuble(user.balance)}`,
    `📦 ${user.transactionsCount}`,
  ].join("\n");
}

function buildHistoryText(lang, transactions) {
  const body = transactions.length
    ? transactions
        .map((tx, index) => `${index + 1}. ${tx.type} | ${formatRuble(tx.amount || 0)} RUB | ${tx.createdAt}`)
        .join("\n")
    : t(lang, "account_history_empty");

  return [`<b>${t(lang, "account_history_title")}</b>`, "", body].join("\n");
}

function buildVipInfoText(user) {
  const lang = getUserLang(user);
  return [
    `<b>${t(lang, "account_vip_title")}</b>`,
    "",
    t(lang, "account_vip_body"),
    "",
    `👑 ${escapeHtml(getVipTier(user.totalDeposits))}`,
  ].join("\n");
}

function buildReferralText(lang, user, botUsername) {
  return [
    `<b>${t(lang, "referral_title")}</b>`,
    "",
    escapeHtml(t(lang, "referral_body")),
    "",
    `<code>https://t.me/${botUsername}?start=${user.userId}</code>`,
  ].join("\n");
}

function buildSettingsText(lang) {
  return [`<b>${t(lang, "settings_title")}</b>`, "", t(lang, "settings_body")].join("\n");
}

function buildChannelsText(lang) {
  return [`<b>${t(lang, "channels_title")}</b>`, "", t(lang, "channels_body")].join("\n");
}

function buildPublicStatsText(lang, stats) {
  return [
    `<b>${t(lang, "stats_title")}</b>`,
    "",
    `${t(lang, "stats_users")}: ${stats.totalUsers}`,
    `${t(lang, "stats_transactions")}: ${stats.totalTransactions}`,
    `${t(lang, "stats_services")}: ${stats.activeServices}`,
  ].join("\n");
}

function buildTransferText(lang) {
  return [`<b>${t(lang, "transfer_title")}</b>`, "", t(lang, "transfer_prompt")].join("\n");
}

function buildAdminPanelText(lang) {
  return [`<b>${t(lang, "admin_title")}</b>`, "", t(lang, "admin_panel_body")].join("\n");
}

module.exports = {
  sendOrEditMessage,
  sendMainMenu: (bot, chatId, user, options = {}) =>
    sendOrEditMessage(bot, chatId, buildMainMenuText(user), getMainMenuKeyboard(getUserLang(user)), options.messageId, "sendMainMenu"),
  sendAccountMenu: (bot, chatId, user, options = {}) =>
    sendOrEditMessage(bot, chatId, buildAccountText(user), getAccountMenuKeyboard(getUserLang(user)), options.messageId, "sendAccountMenu"),
  sendAccountProfile: (bot, chatId, user, options = {}) =>
    sendOrEditMessage(bot, chatId, buildAccountProfileText(user), getBackToMainMenuKeyboard(getUserLang(user)), options.messageId, "sendAccountProfile"),
  sendTransactionHistory: (bot, chatId, user, transactions, options = {}) =>
    sendOrEditMessage(bot, chatId, buildHistoryText(getUserLang(user), transactions), getBackToMainMenuKeyboard(getUserLang(user)), options.messageId, "sendTransactionHistory"),
  sendVipInfo: (bot, chatId, user, options = {}) =>
    sendOrEditMessage(bot, chatId, buildVipInfoText(user), getBackToMainMenuKeyboard(getUserLang(user)), options.messageId, "sendVipInfo"),
  sendReferralMenu: (bot, chatId, user, botUsername, options = {}) =>
    sendOrEditMessage(bot, chatId, buildReferralText(getUserLang(user), user, botUsername), getBackToMainMenuKeyboard(getUserLang(user)), options.messageId, "sendReferralMenu"),
  sendSettingsMenu: (bot, chatId, options = {}) =>
    sendOrEditMessage(bot, chatId, buildSettingsText(options.lang || "ar"), getSettingsMenuKeyboard(options.lang || "ar"), options.messageId, "sendSettingsMenu"),
  sendChannelsMenu: (bot, chatId, options = {}) =>
    sendOrEditMessage(bot, chatId, buildChannelsText(options.lang || "ar"), getChannelsKeyboard(options.lang || "ar"), options.messageId, "sendChannelsMenu"),
  sendPublicStats: (bot, chatId, stats, options = {}) =>
    sendOrEditMessage(bot, chatId, buildPublicStatsText(options.lang || "ar", stats), getBackToMainMenuKeyboard(options.lang || "ar"), options.messageId, "sendPublicStats"),
  sendTransferInstructions: (bot, chatId, options = {}) =>
    sendOrEditMessage(bot, chatId, buildTransferText(options.lang || "ar"), getBackToMainMenuKeyboard(options.lang || "ar"), options.messageId, "sendTransferInstructions"),
  sendAdminPanel: (bot, chatId, options = {}) =>
    sendOrEditMessage(bot, chatId, buildAdminPanelText(options.lang || "ar"), getAdminPanelKeyboard(options.lang || "ar"), options.messageId, "sendAdminPanel"),
  sendServiceToggleMenu: (bot, chatId, services, options = {}) =>
    sendOrEditMessage(bot, chatId, `<b>${t(options.lang || "ar", "admin_btn_manage_services")}</b>`, getServicesManagementKeyboard(services, "toggle", options.lang || "ar"), options.messageId, "sendServiceToggleMenu"),
  sendServicePricesMenu: (bot, chatId, services, options = {}) =>
    sendOrEditMessage(bot, chatId, `<b>${t(options.lang || "ar", "admin_btn_edit_prices")}</b>`, getServicesManagementKeyboard(services, "price", options.lang || "ar"), options.messageId, "sendServicePricesMenu"),
};
