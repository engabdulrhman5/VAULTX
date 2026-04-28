const { t } = require("../locales");
const { PUBLIC_BASE_URL, TELEGRAM_WEBAPP_URL } = require("../config");

function getVaultXWebAppUrl() {
  const explicit = String(TELEGRAM_WEBAPP_URL || "").trim();
  if (explicit) return explicit;
  const base = String(PUBLIC_BASE_URL || "").trim();
  if (!base) return "";
  return `${base.replace(/\/+$/, "")}/webapp/app?lang=ar`;
}


function getMainMenuKeyboard(lang = "ar") {
  const webAppUrl = getVaultXWebAppUrl();
  const webAppRow = webAppUrl
    ? [[{ text: "🚀 VaultX Pro App", web_app: { url: webAppUrl } }]]
    : [];

  return {
    inline_keyboard: [
      [{ text: t(lang, "btn_virtual_numbers"), callback_data: "service:virtual_numbers" }],
      [
        { text: t(lang, "btn_social_boost"), callback_data: "service:social_boost" },
        { text: t(lang, "btn_game_topup"), callback_data: "service:game_topup" },
      ],
      [
        { text: t(lang, "btn_social_accounts"), callback_data: "service:social_accounts" },
        { text: t(lang, "btn_pro_accounts"), callback_data: "service:pro_accounts" },
      ],
      [{ text: t(lang, "btn_cloud_services"), callback_data: "service:cloud_services" }],
      [
        { text: t(lang, "btn_virtual_visa"), callback_data: "service:virtual_visa" },
        { text: t(lang, "btn_temporary_emails"), callback_data: "service:temporary_emails" },
      ],
      [{ text: t(lang, "btn_other_services"), callback_data: "service:other_services" }],
      [
        { text: t(lang, "btn_recharge"), callback_data: "service:balance_topup" },
        { text: t(lang, "btn_transfer"), callback_data: "action:transfer_balance" },
      ],
      [{ text: t(lang, "btn_account"), callback_data: "menu:account" }],
      [
        { text: t(lang, "btn_referral"), callback_data: "menu:referral" },
        { text: t(lang, "btn_support"), url: "https://t.me/Engineeer000" },
      ],
      ...webAppRow,
      [{ text: t(lang, "btn_settings"), callback_data: "menu:settings" }],
    ],
  };
}

function getBackToMainMenuKeyboard(lang = "ar") {
  return {
    inline_keyboard: [[{ text: t(lang, "common_back"), callback_data: "menu:main" }]],
  };
}

function getAccountMenuKeyboard(lang = "ar") {
  return {
    inline_keyboard: [
      [
        { text: lang === "ar" ? "🛒 سجل عملياتي وطلباتي" : "🛒 My Orders & History", callback_data: "account:history" },
      ],
      [{ text: lang === "ar" ? "⚙️ إعدادات الإشعارات" : "⚙️ Notification Settings", callback_data: "account:notifications" }],
      [{ text: lang === "ar" ? "🎁 استرداد كود هدية" : "🎁 Redeem Gift Code", callback_data: "account:gift_redeem" }],
      [{ text: t(lang, "common_back"), callback_data: "menu:main" }],
    ],
  };
}

function getReferralMenuKeyboard(lang = "ar") {
  return {
    inline_keyboard: [
      [{ text: lang === "ar" ? "🔗 رابط الإحالة الخاص بي" : "🔗 My Referral Link", callback_data: "referral:link" }],
      [{ text: lang === "ar" ? "📊 إحصائيات فريقي" : "📊 Team Stats", callback_data: "referral:team_stats" }],
      [{ text: lang === "ar" ? "💸 أرباحي من الإحالة" : "💸 Referral Earnings", callback_data: "referral:earnings" }],
      [{ text: t(lang, "common_back"), callback_data: "menu:main" }],
    ],
  };
}

function getTransferMenuKeyboard(lang = "ar") {
  return {
    inline_keyboard: [
      [{ text: lang === "ar" ? "💸 بدء تحويل جديد" : "💸 Start New Transfer", callback_data: "transfer:start" }],
      [{ text: lang === "ar" ? "📜 سجل حوالاتي" : "📜 My Transfer History", callback_data: "transfer:history" }],
      [{ text: t(lang, "common_back"), callback_data: "menu:main" }],
    ],
  };
}

function getTransferConfirmKeyboard(lang = "ar") {
  return {
    inline_keyboard: [
      [{ text: lang === "ar" ? "✅ تأكيد وإرسال الرصيد" : "✅ Confirm & Send Balance", callback_data: "transfer:confirm" }],
      [{ text: lang === "ar" ? "❌ إلغاء العملية" : "❌ Cancel Transfer", callback_data: "transfer:cancel" }],
    ],
  };
}

function getBackToAccountKeyboard(lang = "ar") {
  return {
    inline_keyboard: [[{ text: lang === "ar" ? "🔙 العودة لحسابي" : "🔙 Back to My Account", callback_data: "menu:account" }]],
  };
}

function getBackToReferralKeyboard(lang = "ar") {
  return {
    inline_keyboard: [[{ text: lang === "ar" ? "🔙 العودة لقسم الإحالة" : "🔙 Back to Referral", callback_data: "menu:referral" }]],
  };
}

function getSettingsMenuKeyboard(lang = "ar") {
  return {
    inline_keyboard: [
      [{ text: t(lang, "settings_btn_change_language"), callback_data: "menu:change_language" }],
      [{ text: t(lang, "settings_btn_channels"), callback_data: "menu:channels" }],
      [{ text: t(lang, "settings_btn_stats"), callback_data: "menu:public_stats" }],
      [{ text: t(lang, "common_back"), callback_data: "menu:main" }],
    ],
  };
}

function getChannelsKeyboard(lang = "ar") {
  return {
    inline_keyboard: [
      [{ text: t(lang, "channel_official"), url: "https://t.me/vaultx0001" }],
      [{ text: t(lang, "channel_activations"), url: "https://t.me/vaultx0003" }],
      [{ text: t(lang, "channel_instructions"), url: "https://t.me/vaultx0002" }],
      [{ text: t(lang, "common_back"), callback_data: "menu:settings" }],
    ],
  };
}

function getAdminPanelKeyboard(lang = "ar") {
  return {
    inline_keyboard: [
      [
        { text: t(lang, "admin_btn_view_users"), callback_data: "admin:view_users" },
        { text: t(lang, "admin_btn_export_users"), callback_data: "admin:export_users" },
      ],
      [
        { text: t(lang, "admin_btn_add_balance"), callback_data: "admin:add_balance" },
        { text: t(lang, "admin_btn_deduct_balance"), callback_data: "admin:deduct_balance" },
      ],
      [
        { text: t(lang, "admin_btn_broadcast"), callback_data: "admin:broadcast" },
        { text: t(lang, "admin_btn_earnings"), callback_data: "admin:earnings" },
      ],
      [
        { text: t(lang, "admin_btn_edit_prices"), callback_data: "admin:edit_prices" },
        { text: t(lang, "admin_btn_manage_services"), callback_data: "admin:manage_services" },
      ],
      [
        { text: t(lang, "admin_btn_upload_data"), callback_data: "admin:upload_data" },
        { text: t(lang, "admin_btn_bot_errors"), callback_data: "admin:bot_errors" },
      ],
      [{ text: t(lang, "admin_btn_detailed_stats"), callback_data: "admin:detailed_stats" }],
    ],
  };
}

function getServicesManagementKeyboard(services, mode = "toggle", lang = "ar") {
  const rows = Object.entries(services).map(([serviceKey, service]) => [
    {
      text:
        mode === "toggle"
          ? `${service.enabled ? "✅" : "❌"} ${t(lang, `btn_${serviceKey}`)}`
          : `${t(lang, `btn_${serviceKey}`)} | ${service.price} RUB`,
      callback_data: mode === "toggle" ? `admin:toggle_service:${serviceKey}` : `admin:edit_price:${serviceKey}`,
    },
  ]);

  rows.push([{ text: t(lang, "common_back"), callback_data: "admin:panel" }]);
  return { inline_keyboard: rows };
}

module.exports = {
  getMainMenuKeyboard,
  getBackToMainMenuKeyboard,
  getAccountMenuKeyboard,
  getBackToAccountKeyboard,
  getReferralMenuKeyboard,
  getBackToReferralKeyboard,
  getTransferMenuKeyboard,
  getTransferConfirmKeyboard,
  getSettingsMenuKeyboard,
  getChannelsKeyboard,
  getAdminPanelKeyboard,
  getServicesManagementKeyboard,
};
