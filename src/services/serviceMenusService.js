const {
  getVirtualNumbersKeyboard,
  getVirtualNumbersProviderAppsKeyboard,
  getVirtualNumbersCountriesKeyboard,
  getVirtualNumberCountryDetailsKeyboard,
  getSocialBoostKeyboard,
  getSocialBoostServicesKeyboard,
  getProMainKeyboard,
  getProSubcategoryKeyboard,
  getSocialAccountsCategoriesKeyboard,
  getSocialAccountsPlatformsKeyboard,
  getCloudServicesKeyboard,
  getTemporaryEmailsKeyboard,
  getTempEmailActionsKeyboard,
  getVirtualVisaKeyboard,
  getGameTopupKeyboard,
  getOtherServicesKeyboard,
} = require("../keyboards/serviceMenusKeyboard");
const { sendOrEditMessage } = require("./profileService");
const { safeTelegramCall } = require("./telegramSafe");
const { logBotError } = require("./errorLogger");
const { getGrizzlyVirtualNumberCatalog, paginateVirtualNumberCountries } = require("./grizzlyService");
const { getUserLang, getArray, t } = require("../locales");
const { escapeHtml } = require("../utils/formatters");

async function sendVirtualNumbersMenu(bot, chatId, user, options = {}) {
  const lang = getUserLang(user);
  return sendOrEditMessage(bot, chatId, t(lang, "virtualNumbers_inst"), getVirtualNumbersKeyboard(lang), options.messageId, "sendVirtualNumbersMenu");
}

async function sendVirtualNumbersProviderMenu(bot, chatId, user, providerKey, pageIndex, options = {}) {
  const lang = getUserLang(user);
  const topApps = getArray(lang, "virtualNumbers_topApps");
  const pages = [topApps, ...getArray(lang, "virtualNumbers_otherPages")];
  const safeIndex = Math.max(0, Math.min(pageIndex, pages.length - 1));
  const providerLabel = providerKey === "server1" ? t(lang, "virtualNumbers_server1") : t(lang, "virtualNumbers_server2");
  const text = `${t(lang, "virtualNumbers_inst")}\n\n${providerLabel}\n${safeIndex + 1}/${pages.length}`;
  return sendOrEditMessage(
    bot,
    chatId,
    text,
    getVirtualNumbersProviderAppsKeyboard(pages[safeIndex] || [], providerKey, safeIndex, pages.length, lang),
    options.messageId,
    "sendVirtualNumbersProviderMenu"
  );
}

function buildVirtualNumbersCountriesText(lang, appName, countriesPage) {
  const title = lang === "ar" ? "أسعار الأرقام المتاحة" : "Available number prices";
  const lines = [
    `📱 <b>${title}</b>`,
    "",
    `${lang === "ar" ? "التطبيق" : "App"}: <b>${escapeHtml(appName)}</b>`,
    `${lang === "ar" ? "الصفحة" : "Page"}: ${countriesPage.pageIndex + 1}/${countriesPage.totalPages}`,
    `${lang === "ar" ? "عدد الدول" : "Countries"}: ${countriesPage.totalItems}`,
  ];

  if (countriesPage.items.length) {
    lines.push("", lang === "ar" ? "اختر الدولة لعرض السعر والتوفر:" : "Select a country to view pricing and stock:");
  }

  return lines.join("\n");
}

function buildVirtualNumberCountryDetailsText(lang, appName, country) {
  const labels = lang === "ar"
    ? {
        title: "تفاصيل الرقم الوهمي",
        app: "التطبيق",
        country: "الدولة",
        stock: "الكمية المتاحة",
        supplier: "سعر Grizzly",
        finalPrice: "سعر البيع",
        note: "يمكنك الآن متابعة ربط خطوة الشراء الفعلية فوق هذه البيانات.",
      }
    : {
        title: "Virtual number details",
        app: "App",
        country: "Country",
        stock: "Available stock",
        supplier: "Grizzly price",
        finalPrice: "Selling price",
        note: "You can connect the purchase step on top of this pricing block next.",
      };

  return [
    `📱 <b>${labels.title}</b>`,
    "",
    `${labels.app}: <b>${escapeHtml(appName)}</b>`,
    `${labels.country}: ${country.flag} ${escapeHtml(country.name_ar)}`,
    `${labels.stock}: <b>${country.availableCount}</b>`,
    `${labels.supplier}: <code>${country.supplierPrice} RUB</code>`,
    `${labels.finalPrice}: <code>${country.sellPrice} RUB</code>`,
    "",
    labels.note,
  ].join("\n");
}

async function sendVirtualNumbersCountriesMenu(bot, chatId, user, appName, pageIndex, options = {}) {
  const lang = getUserLang(user);

  try {
    const catalog = await getGrizzlyVirtualNumberCatalog(appName, {
      baseMarkup: options.baseMarkup,
    });

    if (!catalog.serviceCode) {
      const unsupportedText = lang === "ar"
        ? `📱 <b>Grizzly SMS</b>\n\nالتطبيق <b>${escapeHtml(appName)}</b> غير مدعوم حالياً ضمن خريطة الخدمات الحالية.`
        : `📱 <b>Grizzly SMS</b>\n\nThe app <b>${escapeHtml(appName)}</b> is not currently mapped to a Grizzly service code.`;
      return sendOrEditMessage(
        bot,
        chatId,
        unsupportedText,
        { inline_keyboard: [[{ text: t(lang, "common_back"), callback_data: "service:virtual_numbers" }]] },
        options.messageId,
        "sendVirtualNumbersCountriesMenu.unsupported"
      );
    }

    if (!catalog.countries.length) {
      const emptyText = lang === "ar"
        ? `📱 <b>${escapeHtml(appName)}</b>\n\nلا توجد أسعار متاحة حالياً من Grizzly لهذا التطبيق.`
        : `📱 <b>${escapeHtml(appName)}</b>\n\nThere are no currently available Grizzly prices for this app.`;
      return sendOrEditMessage(
        bot,
        chatId,
        emptyText,
        { inline_keyboard: [[{ text: t(lang, "common_back"), callback_data: "service:virtual_numbers" }]] },
        options.messageId,
        "sendVirtualNumbersCountriesMenu.empty"
      );
    }

    const countriesPage = paginateVirtualNumberCountries(catalog.countries, pageIndex);
    return sendOrEditMessage(
      bot,
      chatId,
      buildVirtualNumbersCountriesText(lang, appName, countriesPage),
      getVirtualNumbersCountriesKeyboard(appName, countriesPage.items, countriesPage.pageIndex, countriesPage.totalPages, lang),
      options.messageId,
      "sendVirtualNumbersCountriesMenu"
    );
  } catch (error) {
    logBotError("sendVirtualNumbersCountriesMenu", error, { appName, userId: user?.userId });
    const errorText = lang === "ar"
      ? "تعذر جلب الأسعار من Grizzly حالياً. حاول مرة أخرى بعد قليل."
      : "Failed to load Grizzly prices right now. Please try again shortly.";
    return sendOrEditMessage(
      bot,
      chatId,
      errorText,
      { inline_keyboard: [[{ text: t(lang, "common_back"), callback_data: "service:virtual_numbers" }]] },
      options.messageId,
      "sendVirtualNumbersCountriesMenu.error"
    );
  }
}

async function sendVirtualNumberCountryDetails(bot, chatId, user, appName, countryId, pageIndex, options = {}) {
  const lang = getUserLang(user);

  try {
    const catalog = await getGrizzlyVirtualNumberCatalog(appName, {
      baseMarkup: options.baseMarkup,
    });
    const country = catalog.countries.find((item) => item.id === String(countryId));

    if (!country) {
      return sendVirtualNumbersCountriesMenu(bot, chatId, user, appName, pageIndex, options);
    }

    return sendOrEditMessage(
      bot,
      chatId,
      buildVirtualNumberCountryDetailsText(lang, appName, country),
      getVirtualNumberCountryDetailsKeyboard(appName, country.id, pageIndex, lang),
      options.messageId,
      "sendVirtualNumberCountryDetails"
    );
  } catch (error) {
    logBotError("sendVirtualNumberCountryDetails", error, { appName, countryId, userId: user?.userId });
    return sendVirtualNumbersCountriesMenu(bot, chatId, user, appName, pageIndex, options);
  }
}

async function sendSocialBoostMenu(bot, chatId, user, options = {}) {
  const lang = getUserLang(user);
  return sendOrEditMessage(bot, chatId, t(lang, "socialBoost_inst"), getSocialBoostKeyboard(getArray(lang, "socialBoost_apps"), lang), options.messageId, "sendSocialBoostMenu");
}

async function sendSocialBoostServicesMenu(bot, chatId, user, appKey, appLabel, options = {}) {
  const lang = getUserLang(user);
  const services = getArray(lang, `socialBoost_services_${appKey}`);
  if (!services.length) {
    return sendOrEditMessage(
      bot,
      chatId,
      t(lang, "socialBoost_service_placeholder"),
      { inline_keyboard: [[{ text: t(lang, "common_back"), callback_data: "service:social_boost" }]] },
      options.messageId,
      "sendSocialBoostServicesMenu.empty"
    );
  }

  const header = t(lang, "socialBoost_service_header").replace("{app}", appLabel);
  return sendOrEditMessage(
    bot,
    chatId,
    header,
    getSocialBoostServicesKeyboard(services, appKey, lang),
    options.messageId,
    "sendSocialBoostServicesMenu"
  );
}

async function sendProAccountsMenu(bot, chatId, user, options = {}) {
  const lang = getUserLang(user);
  return sendOrEditMessage(bot, chatId, t(lang, "proAccounts_inst"), getProMainKeyboard(getArray(lang, "proAccounts_mainCategories"), lang), options.messageId, "sendProAccountsMenu");
}

async function sendProSubcategoryMenu(bot, chatId, user, subcategoryKey, options = {}) {
  const lang = getUserLang(user);
  const map = {
    ai: "proAccounts_ai",
    subscriptions: "proAccounts_subscriptions",
    verification: "proAccounts_verification",
  };
  const items = getArray(lang, map[subcategoryKey]);
  if (!items.length) {
    return sendProAccountsMenu(bot, chatId, user, options);
  }
  return sendOrEditMessage(bot, chatId, t(lang, "proAccounts_inst"), getProSubcategoryKeyboard(items, subcategoryKey, lang), options.messageId, "sendProSubcategoryMenu");
}

async function sendSocialAccountsMenu(bot, chatId, user, options = {}) {
  const lang = getUserLang(user);
  return sendOrEditMessage(bot, chatId, t(lang, "socialAccounts_inst"), getSocialAccountsCategoriesKeyboard(getArray(lang, "socialAccounts_categories"), lang), options.messageId, "sendSocialAccountsMenu");
}

async function sendSocialAccountsPlatformsMenu(bot, chatId, user, categoryKey, options = {}) {
  const lang = getUserLang(user);
  return sendOrEditMessage(bot, chatId, t(lang, "socialAccounts_inst"), getSocialAccountsPlatformsKeyboard(getArray(lang, "socialAccounts_platforms"), categoryKey, lang), options.messageId, "sendSocialAccountsPlatformsMenu");
}

async function sendServiceSelectionPlaceholder(bot, chatId, user, title, options = {}) {
  const lang = getUserLang(user);
  const text = [`<b>=== ${title} ===</b>`, "", t(lang, "common_placeholder_saved")].join("\n");
  const replyMarkup = { inline_keyboard: [[{ text: t(lang, "common_back"), callback_data: options.backCallback || "menu:main" }]] };

  if (options.messageId) {
    return safeTelegramCall("sendServiceSelectionPlaceholder.edit", () =>
      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: options.messageId,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      })
    );
  }

  return safeTelegramCall("sendServiceSelectionPlaceholder.send", () => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: replyMarkup }));
}

async function sendCloudServicesMenu(bot, chatId, user, options = {}) {
  const lang = getUserLang(user);
  return sendOrEditMessage(bot, chatId, t(lang, "cloudServices_inst"), getCloudServicesKeyboard(getArray(lang, "cloudServices_items"), lang), options.messageId, "sendCloudServicesMenu");
}

async function sendTemporaryEmailsMenu(bot, chatId, user, options = {}) {
  const lang = getUserLang(user);
  return sendOrEditMessage(bot, chatId, t(lang, "temporaryEmails_inst"), getTemporaryEmailsKeyboard(getArray(lang, "temporaryEmails_items"), lang), options.messageId, "sendTemporaryEmailsMenu");
}

function buildMockTempEmailSession() {
  const token = Math.random().toString(36).slice(2, 8);
  const domains = ["1secmail.com", "vaultxmail.net", "tempmail.dev"];
  return { email: `test${token}@${domains[Math.floor(Math.random() * domains.length)]}`, refreshCount: 0, lastCode: null };
}

function buildTempEmailText(user, session, messages = []) {
  const lang = getUserLang(user);
  const lines = [`<b>${t(lang, "temporaryEmails_title")}</b>`, "", `${t(lang, "temporaryEmails_yourMail")} <code>${session.email}</code>`];

  if (messages.length) {
    lines.push("", `<b>${t(lang, "temporaryEmails_latest")}</b>`);
    for (const message of messages) {
      lines.push(`• From: ${message.from}`);
      lines.push(`• Subject: ${message.subject}`);
      lines.push(`• Code: <code>${message.code}</code>`);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

async function sendTempEmailSession(bot, chatId, user, session, options = {}) {
  return sendOrEditMessage(bot, chatId, buildTempEmailText(user, session), getTempEmailActionsKeyboard(getUserLang(user)), options.messageId, "sendTempEmailSession");
}

function getMockTempEmailMessages(session) {
  session.refreshCount += 1;
  if (session.refreshCount % 2 !== 0) {
    return [];
  }

  const code = String(100000 + Math.floor(Math.random() * 900000));
  session.lastCode = code;
  return [{ from: "noreply@service.com", subject: "Verification Code", code }];
}

async function sendVirtualVisaMenu(bot, chatId, user, options = {}) {
  const lang = getUserLang(user);
  return sendOrEditMessage(bot, chatId, t(lang, "virtualVisa_inst"), getVirtualVisaKeyboard(getArray(lang, "virtualVisa_items"), lang), options.messageId, "sendVirtualVisaMenu");
}

async function sendGameTopupMenu(bot, chatId, user, pageIndex, options = {}) {
  const lang = getUserLang(user);
  const items = getArray(lang, "games_list");
  const totalPages = Math.ceil(items.length / 10);
  const safeIndex = Math.max(0, Math.min(pageIndex, totalPages - 1));
  const pageItems = items.slice(safeIndex * 10, safeIndex * 10 + 10);
  const text = `${t(lang, "games_inst")}\n\n${safeIndex + 1}/${totalPages}`;
  return sendOrEditMessage(bot, chatId, text, getGameTopupKeyboard(pageItems, safeIndex, totalPages, lang), options.messageId, "sendGameTopupMenu");
}

async function sendOtherServicesMenu(bot, chatId, user, options = {}) {
  const lang = getUserLang(user);
  return sendOrEditMessage(bot, chatId, t(lang, "otherServices_inst"), getOtherServicesKeyboard(getArray(lang, "otherServices_items"), lang), options.messageId, "sendOtherServicesMenu");
}

async function sendCustomServicePrompt(bot, chatId, user) {
  return safeTelegramCall("sendCustomServicePrompt", () => bot.sendMessage(chatId, t(getUserLang(user), "otherServices_prompt")));
}

module.exports = {
  sendVirtualNumbersMenu,
  sendVirtualNumbersProviderMenu,
  sendVirtualNumbersCountriesMenu,
  sendVirtualNumberCountryDetails,
  sendSocialBoostMenu,
  sendSocialBoostServicesMenu,
  sendProAccountsMenu,
  sendProSubcategoryMenu,
  sendSocialAccountsMenu,
  sendSocialAccountsPlatformsMenu,
  sendServiceSelectionPlaceholder,
  sendCloudServicesMenu,
  sendTemporaryEmailsMenu,
  buildMockTempEmailSession,
  buildTempEmailText,
  sendTempEmailSession,
  getMockTempEmailMessages,
  sendVirtualVisaMenu,
  sendGameTopupMenu,
  sendOtherServicesMenu,
  sendCustomServicePrompt,
};
