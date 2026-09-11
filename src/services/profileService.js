const { getMainMenuKeyboard, getBackToMainMenuKeyboard, getAccountMenuKeyboard, getBackToAccountKeyboard, getReferralMenuKeyboard, getBackToReferralKeyboard, getTransferMenuKeyboard, getTransferConfirmKeyboard, getSettingsMenuKeyboard, getChannelsKeyboard, getAdminPanelKeyboard, getServicesManagementKeyboard } = require("../keyboards/mainMenuKeyboard");
const { escapeHtml, getDisplayName } = require("../utils/formatters");
const { safeTelegramCall } = require("./telegramSafe");
const { getUserLang, t } = require("../locales");
const { getVipTier } = require("../utils/vip");
const { CURRENCY_CODES, CURRENCIES, formatAmount } = require("./currencyService");

const FRAME = "━━━━━━━━━━━━━━━━━━━";
function vaultCard(title, lines, footer) { return ["💠  𝐕 𝐀 𝐔 𝐋 𝐓 - 𝐗  💠", FRAME, title, ...lines, FRAME, footer].join("\n"); }
async function sendOrEditMessage(bot, chatId, text, replyMarkup, messageId, scope) {
  const payload = { parse_mode: "HTML", reply_markup: replyMarkup, disable_web_page_preview: true };
  if (messageId) return safeTelegramCall(scope || "editMessageText", () => bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...payload }));
  return safeTelegramCall(scope || "sendMessage", () => bot.sendMessage(chatId, text, payload));
}

function walletLines(user, lang) {
  return CURRENCY_CODES.map((code) => {
    const label = lang === "ar" ? CURRENCIES[code].nameAr : CURRENCIES[code].nameEn;
    const value = formatAmount(Number(user.balances?.[code] || 0), code);
    const mark = code === user.currency ? " ⭐" : "";
    return `💰 ${label}: <b>${value}</b>${mark}`;
  });
}

function buildMainMenuText(user) {
  const lang = getUserLang(user);
  const header = lang === "ar" ? "القائمة الرئيسية" : "Main Menu";
  return [`<b>${header}</b>`, "", `👤 ${escapeHtml(getDisplayName(user))}`, `🆔 <code>${user.userId}</code>`, ...walletLines(user, lang), "", `🏅 ${escapeHtml(getVipTier(user.totalDeposits))}`].join("\n");
}

function buildAccountText(user) {
  const lang = getUserLang(user); const username = user.username ? `@${escapeHtml(user.username)}` : (lang === "ar" ? "غير متوفر" : "Not set");
  return vaultCard(lang === "ar" ? "♦️ ❨ الـمـلـــف الـشـخـصـــي ❩ ♦️" : "♦️ ❨ P E R S O N A L  P R O F I L E ❩ ♦️", [
    `${lang === "ar" ? "👤 الاسم" : "👤 Name"}: ${escapeHtml(getDisplayName(user))}`,
    `${lang === "ar" ? "🔖 المعرف" : "🔖 Username"}: ${username}`,
    `${lang === "ar" ? "🆔 الآيدي" : "🆔 ID"}: <code>${user.userId}</code>`,
    ...walletLines(user, lang),
    `${lang === "ar" ? "⭐ العملة المختارة" : "⭐ Selected Currency"}: ${CURRENCIES[user.currency]?.nameAr || user.currency}`,
  ], lang === "ar" ? "⬇️ يرجى تحديد الخيار لإدارة حسابك ⬇️" : "⬇️ Please choose an option to manage your account ⬇️");
}

function buildHistoryText(lang, transactions) {
  const body = transactions.length ? transactions.slice(0, 5).map((tx, index) => `${index + 1}️⃣ ${escapeHtml(String(tx.serviceKey || tx.type || "-"))} - ${Number(tx.amount || 0).toLocaleString("en-US")} ${escapeHtml(String(tx.currency || "RUB"))} - ${escapeHtml(String(tx.status || (lang === "ar" ? "مكتملة" : "Completed")))}`).join("\n") : (lang === "ar" ? "لا توجد عمليات حالياً." : "No operations found yet.");
  return vaultCard(lang === "ar" ? "♦️ ❨ سـجـــل عـمـلـيـاتـــي ❩ ♦️" : "♦️ ❨ M Y  O P E R A T I O N S  L O G ❩ ♦️", [body], lang === "ar" ? "⬇️ يمكنك متابعة حالة طلباتك الحالية من هنا ⬇️" : "⬇️ You can track your current requests here ⬇️");
}
function buildVipInfoText(user) { const lang = getUserLang(user); return [`<b>${t(lang, "account_vip_title")}</b>`, "", t(lang, "account_vip_body"), "", `🏅 ${escapeHtml(getVipTier(user.totalDeposits))}`].join("\n"); }
function buildReferralText(lang, user, botUsername) {
  const link = `https://t.me/${botUsername}?start=${user.userId}`;
  return [vaultCard(lang === "ar" ? "♦️ ❨ نـظـــام الإحـالـــة والـربـــح ❩ ♦️" : "♦️ ❨ R E F E R R A L  &  E A R N I N G S ❩ ♦️", lang === "ar" ? ["💡 اربح (0.5 روبل) فور دخول أي شخص عبر رابطك.", "💡 ستحصل على (5%) من إجمالي مشترياته مدى الحياة.", "💡 ضاعف أرباحك بمشاركة الرابط في المجموعات والقنوات."] : ["💡 Earn 0.5 RUB when someone joins via your link.", "💡 Get 5% from their total purchases for life.", "💡 Share your link in groups/channels to grow profits."], lang === "ar" ? "⬇️ يرجى اختيار الإجراء المطلوب من القائمة أدناه ⬇️" : "⬇️ Please choose an action from the menu below ⬇️"), "", `🔗 ${lang === "ar" ? "رابطك الخاص" : "Your referral link"}: <code>${link}</code>`].join("\n");
}
function buildReferralStatsText(lang, payload) { return vaultCard(lang === "ar" ? "♦️ ❨ إحـصـائـيـــات فـريـقـــك ❩ ♦️" : "♦️ ❨ Y O U R  T E A M  S T A T S ❩ ♦️", lang === "ar" ? [`👥 إجمالي الدعوات: ${payload.totalInvites} مستخدم.`, `🛍️ المستخدمين النشطين: ${payload.activeUsers} مستخدم.`, `💰 إجمالي الأرباح المكتسبة: ${payload.totalEarnings} RUB.`] : [`👥 Total invites: ${payload.totalInvites} users.`, `🛍️ Active users: ${payload.activeUsers} users.`, `💰 Total earnings: ${payload.totalEarnings} RUB.`], lang === "ar" ? "⬇️ استمر في النشر لزيادة أرباحك اليومية ⬇️" : "⬇️ Keep sharing to increase your daily earnings ⬇️"); }
function buildSettingsText(lang) { return [`<b>${t(lang, "settings_title")}</b>`, "", t(lang, "settings_body")].join("\n"); }
function buildChannelsText(lang) { return [`<b>${t(lang, "channels_title")}</b>`, "", t(lang, "channels_body")].join("\n"); }
function buildPublicStatsText(lang, stats) { return [`<b>${t(lang, "stats_title")}</b>`, "", `${t(lang, "stats_users")}: ${stats.totalUsers}`, `${t(lang, "stats_transactions")}: ${stats.totalTransactions}`, `${t(lang, "stats_services")}: ${stats.activeServices}`].join("\n"); }
function buildTransferText(lang) { return vaultCard(lang === "ar" ? "♦️ ❨ تـحـويـــل الـرصـيـــد ❩ ♦️" : "♦️ ❨ B A L A N C E  T R A N S F E R ❩ ♦️", lang === "ar" ? ["💡 أرسل الرصيد لأي مشترك داخل البوت.", "💡 المبلغ يُخصم من عملتك المختارة ويُضاف للمستلم بعد التحويل بسعر العملات الحالي.", "💡 يمكنك أيضاً تحويل عملتك إلى عملة أخرى من الخيار المخصص."] : ["💡 Send balance to another subscriber.", "💡 The amount is deducted from your selected currency and converted for the receiver.", "💡 You can also convert between currencies from the dedicated option."], lang === "ar" ? "⬇️ اختر الإجراء المطلوب ⬇️" : "⬇️ Choose an action ⬇️"); }
function buildTransferPromptText(lang) { return vaultCard(lang === "ar" ? "♦️ ❨ بـيـانـات الـمـسـتـلـــم ❩ ♦️" : "♦️ ❨ R E C E I V E R  D A T A ❩ ♦️", lang === "ar" ? ["💡 السطر الأول: آيدي المستخدم", "💡 السطر الثاني: المبلغ بعملتك المختارة", "💡 مثال: 123456789 ثم 5" ] : ["💡 Line 1: User ID", "💡 Line 2: Amount in your selected currency", "💡 Example: 123456789 then 5"], lang === "ar" ? "⬇️ أرسل الآيدي والمبلغ في رسالة ⬇️" : "⬇️ Send receiver ID and amount in one message ⬇️"); }
function buildTransferConfirmText(lang, payload) { return vaultCard(lang === "ar" ? "♦️ ❨ تـأكـيـــد الـحـوالـــة ❩ ♦️" : "♦️ ❨ T R A N S F E R  C O N F I R M A T I O N ❩ ♦️", lang === "ar" ? [`📤 من حسابك: ${escapeHtml(payload.senderName)}`, `📥 إلى حساب: ${escapeHtml(payload.receiverName)} (ID: ${payload.receiverId})`, `💵 المبلغ: ${formatAmount(payload.amountRub, payload.currency)}`] : [`📤 From: ${escapeHtml(payload.senderName)}`, `📥 To: ${escapeHtml(payload.receiverName)} (ID: ${payload.receiverId})`, `💵 Amount: ${formatAmount(payload.amountRub, payload.currency)}`], lang === "ar" ? "⬇️ راجع البيانات ثم أكد العملية ⬇️" : "⬇️ Review and confirm ⬇️"); }
function buildTransferHistoryText(lang, transfers) { const body = transfers.length ? transfers.slice(0, 10).map((tx, index) => `${index + 1}. ${tx.type === "transfer_out" ? (lang === "ar" ? "إرسال" : "Sent") : (lang === "ar" ? "استلام" : "Received")} - ${Number(tx.amount || 0).toLocaleString("en-US")} ${tx.currency || "RUB"} - ${tx.createdAt || "-"}`).join("\n") : (lang === "ar" ? "لا توجد حوالات حتى الآن." : "No transfer records yet."); return vaultCard(lang === "ar" ? "♦️ ❨ سـجـــل الـحـوالـــات ❩ ♦️" : "♦️ ❨ T R A N S F E R  H I S T O R Y ❩ ♦️", [body], lang === "ar" ? "⬇️ يمكنك بدء تحويل جديد في أي وقت ⬇️" : "⬇️ You can start a new transfer at any time ⬇️"); }
function buildNotificationText(lang, enabled) { return vaultCard(lang === "ar" ? "♦️ ❨ إعـــدادات الإشـعـــارات ❩ ♦️" : "♦️ ❨ N O T I F I C A T I O N  S E T T I N G S ❩ ♦️", [lang === "ar" ? `🔔 حالة إشعارات العروض: ${enabled ? "مفعلة" : "متوقفة"}` : `🔔 Promotional alerts: ${enabled ? "Enabled" : "Disabled"}`, lang === "ar" ? "💡 يمكنك تغييرها في أي وقت." : "💡 You can change this anytime."], lang === "ar" ? "⬇️ اختر الإجراء المناسب ⬇️" : "⬇️ Choose the required action ⬇️"); }
function buildGiftPromptText(lang) { return vaultCard(lang === "ar" ? "♦️ ❨ اسـتـــرداد كـــود هـديـــة ❩ ♦️" : "♦️ ❨ R E D E E M  G I F T  C O D E ❩ ♦️", lang === "ar" ? ["💡 أدخل كود الهدية كما وصلك.", "💡 سيتم إضافة القيمة إلى عملتك المختارة." ] : ["💡 Enter the gift code exactly as provided.", "💡 Its value will be added to your selected currency."], lang === "ar" ? "⬇️ أرسل الكود الآن ⬇️" : "⬇️ Send your gift code now ⬇️"); }
function buildAdminPanelText(lang) { return [`<b>${t(lang, "admin_title")}</b>`, "", t(lang, "admin_panel_body")].join("\n"); }

module.exports = {
  sendOrEditMessage,
  sendMainMenu: (bot, chatId, user, options = {}) => sendOrEditMessage(bot, chatId, buildMainMenuText(user), getMainMenuKeyboard(getUserLang(user)), options.messageId, "sendMainMenu"),
  sendAccountMenu: (bot, chatId, user, options = {}) => sendOrEditMessage(bot, chatId, buildAccountText(user), getAccountMenuKeyboard(getUserLang(user)), options.messageId, "sendAccountMenu"),
  sendAccountProfile: (bot, chatId, user, options = {}) => sendOrEditMessage(bot, chatId, buildAccountText(user), getBackToMainMenuKeyboard(getUserLang(user)), options.messageId, "sendAccountProfile"),
  sendTransactionHistory: (bot, chatId, user, transactions, options = {}) => sendOrEditMessage(bot, chatId, buildHistoryText(getUserLang(user), transactions), getBackToAccountKeyboard(getUserLang(user)), options.messageId, "sendTransactionHistory"),
  sendVipInfo: (bot, chatId, user, options = {}) => sendOrEditMessage(bot, chatId, buildVipInfoText(user), getBackToMainMenuKeyboard(getUserLang(user)), options.messageId, "sendVipInfo"),
  sendReferralMenu: (bot, chatId, user, botUsername, options = {}) => sendOrEditMessage(bot, chatId, buildReferralText(getUserLang(user), user, botUsername), getReferralMenuKeyboard(getUserLang(user)), options.messageId, "sendReferralMenu"),
  sendReferralStats: (bot, chatId, user, stats, options = {}) => sendOrEditMessage(bot, chatId, buildReferralStatsText(getUserLang(user), stats), getBackToReferralKeyboard(getUserLang(user)), options.messageId, "sendReferralStats"),
  sendTransferHome: (bot, chatId, user, options = {}) => sendOrEditMessage(bot, chatId, buildTransferText(getUserLang(user)), getTransferMenuKeyboard(getUserLang(user)), options.messageId, "sendTransferHome"),
  sendTransferPrompt: (bot, chatId, user, options = {}) => sendOrEditMessage(bot, chatId, buildTransferPromptText(getUserLang(user)), { inline_keyboard: [[{ text: getUserLang(user) === "ar" ? "🔙 عودة" : "🔙 Back", callback_data: "transfer:cancel" }]] }, options.messageId, "sendTransferPrompt"),
  sendTransferConfirm: (bot, chatId, user, payload, options = {}) => sendOrEditMessage(bot, chatId, buildTransferConfirmText(getUserLang(user), payload), getTransferConfirmKeyboard(getUserLang(user)), options.messageId, "sendTransferConfirm"),
  sendTransferHistory: (bot, chatId, user, transfers, options = {}) => sendOrEditMessage(bot, chatId, buildTransferHistoryText(getUserLang(user), transfers), { inline_keyboard: [[{ text: getUserLang(user) === "ar" ? "🔙 العودة للتحويل" : "🔙 Back to Transfer", callback_data: "action:transfer_balance" }]] }, options.messageId, "sendTransferHistory"),
  sendNotificationSettings: (bot, chatId, user, options = {}) => sendOrEditMessage(bot, chatId, buildNotificationText(getUserLang(user), Boolean(user.notifyPromotions !== false)), { inline_keyboard: [[{ text: getUserLang(user) === "ar" ? "✅ تفعيل الإشعارات" : "✅ Enable Notifications", callback_data: "account:notify:on" }], [{ text: getUserLang(user) === "ar" ? "🚫 إيقاف الإشعارات" : "🚫 Disable Notifications", callback_data: "account:notify:off" }], [{ text: getUserLang(user) === "ar" ? "🔙 العودة لحسابي" : "🔙 Back to My Account", callback_data: "menu:account" }]] }, options.messageId, "sendNotificationSettings"),
  sendGiftCodePrompt: (bot, chatId, user, options = {}) => sendOrEditMessage(bot, chatId, buildGiftPromptText(getUserLang(user)), getBackToAccountKeyboard(getUserLang(user)), options.messageId, "sendGiftCodePrompt"),
  sendSettingsMenu: (bot, chatId, options = {}) => sendOrEditMessage(bot, chatId, buildSettingsText(options.lang || "ar"), getSettingsMenuKeyboard(options.lang || "ar"), options.messageId, "sendSettingsMenu"),
  sendChannelsMenu: (bot, chatId, options = {}) => sendOrEditMessage(bot, chatId, buildChannelsText(options.lang || "ar"), getChannelsKeyboard(options.lang || "ar"), options.messageId, "sendChannelsMenu"),
  sendPublicStats: (bot, chatId, stats, options = {}) => sendOrEditMessage(bot, chatId, buildPublicStatsText(options.lang || "ar", stats), getBackToMainMenuKeyboard(options.lang || "ar"), options.messageId, "sendPublicStats"),
  sendTransferInstructions: (bot, chatId, options = {}) => sendOrEditMessage(bot, chatId, buildTransferText(options.lang || "ar"), getBackToMainMenuKeyboard(options.lang || "ar"), options.messageId, "sendTransferInstructions"),
  sendAdminPanel: (bot, chatId, options = {}) => sendOrEditMessage(bot, chatId, buildAdminPanelText(options.lang || "ar"), getAdminPanelKeyboard(options.lang || "ar"), options.messageId, "sendAdminPanel"),
  sendServiceToggleMenu: (bot, chatId, services, options = {}) => sendOrEditMessage(bot, chatId, `<b>${t(options.lang || "ar", "admin_btn_manage_services")}</b>`, getServicesManagementKeyboard(services, "toggle", options.lang || "ar"), options.messageId, "sendServiceToggleMenu"),
  sendServicePricesMenu: (bot, chatId, services, options = {}) => sendOrEditMessage(bot, chatId, `<b>${t(options.lang || "ar", "admin_btn_edit_prices")}</b>`, getServicesManagementKeyboard(services, "price", options.lang || "ar"), options.messageId, "sendServicePricesMenu"),
};
