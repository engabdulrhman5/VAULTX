const { t } = require("../locales");

function getMainMenuKeyboard(lang = "ar") {
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
        { text: t(lang, "account_btn_profile"), callback_data: "account:profile" },
        { text: t(lang, "account_btn_history"), callback_data: "account:history" },
      ],
      [{ text: t(lang, "account_btn_vip"), callback_data: "account:vip_info" }],
      [{ text: t(lang, "common_back"), callback_data: "menu:main" }],
    ],
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
  getSettingsMenuKeyboard,
  getChannelsKeyboard,
  getAdminPanelKeyboard,
  getServicesManagementKeyboard,
};
