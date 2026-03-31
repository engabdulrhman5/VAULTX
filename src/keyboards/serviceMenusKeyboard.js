const { t } = require("../locales");

function chunkButtons(items, mapFn, perRow = 2) {
  const rows = [];
  for (let index = 0; index < items.length; index += perRow) {
    rows.push(items.slice(index, index + perRow).map((item, innerIndex) => mapFn(item, index + innerIndex)));
  }
  return rows;
}

function getVirtualNumbersKeyboard(lang = "ar") {
  return {
    inline_keyboard: [
      [{ text: t(lang, "virtualNumbers_offerWhatsapp"), callback_data: "service_menu:virtual_numbers:offers:wa" }],
      [{ text: t(lang, "virtualNumbers_offerTelegram"), callback_data: "service_menu:virtual_numbers:offers:tg" }],
      [{ text: t(lang, "virtualNumbers_server1"), callback_data: "service_menu:virtual_numbers:server:server1" }],
      [{ text: t(lang, "virtualNumbers_server2"), callback_data: "service_menu:virtual_numbers:server:server2" }],
      [{ text: t(lang, "common_back_main"), callback_data: "menu:main" }],
    ],
  };
}

function getVirtualNumbersProviderAppsKeyboard(apps, providerKey, pageIndex, totalPages, lang = "ar") {
  const rows = [
    ...chunkButtons(apps, (app) => ({
      text: app,
      callback_data: `service_menu:virtual_numbers:server:${providerKey}:app:${encodeURIComponent(app)}`,
    })),
  ];

  const navigationRow = [];
  if (pageIndex < totalPages - 1) {
    navigationRow.push({ text: t(lang, "common_next"), callback_data: `service_menu:virtual_numbers:server:${providerKey}:other:${pageIndex + 1}` });
  }
  if (pageIndex > 0) {
    navigationRow.push({ text: t(lang, "common_previous"), callback_data: `service_menu:virtual_numbers:server:${providerKey}:other:${pageIndex - 1}` });
  }
  if (navigationRow.length) {
    rows.push(navigationRow);
  }

  rows.push([{ text: t(lang, "common_back"), callback_data: "service:virtual_numbers" }]);
  return { inline_keyboard: rows };
}

function getVirtualNumbersCountriesKeyboard(appName, countries, pageIndex, totalPages, lang = "ar") {
  const encodedAppName = encodeURIComponent(appName);
  const rows = [
    ...countries.map((country) => [
      {
        text: `${country.flag} ${country.name_ar} • ${country.sellPrice} RUB`,
        callback_data: `service_menu:virtual_numbers:country:${encodedAppName}:${country.id}:${pageIndex}`,
      },
    ]),
  ];

  const navigationRow = [];
  if (pageIndex > 0) {
    navigationRow.push({
      text: t(lang, "common_previous"),
      callback_data: `service_menu:virtual_numbers:prices:${encodedAppName}:${pageIndex - 1}`,
    });
  }
  if (pageIndex < totalPages - 1) {
    navigationRow.push({
      text: t(lang, "common_next"),
      callback_data: `service_menu:virtual_numbers:prices:${encodedAppName}:${pageIndex + 1}`,
    });
  }
  if (navigationRow.length) {
    rows.push(navigationRow);
  }

  rows.push([{ text: t(lang, "common_back"), callback_data: "service:virtual_numbers" }]);
  return { inline_keyboard: rows };
}

function getVirtualNumberCountryDetailsKeyboard(appName, countryId, pageIndex, lang = "ar") {
  const encodedAppName = encodeURIComponent(appName);
  return {
    inline_keyboard: [
      [
        {
          text: lang === "ar" ? "تحديث الأسعار" : "Refresh prices",
          callback_data: `service_menu:virtual_numbers:country:${encodedAppName}:${countryId}:${pageIndex}`,
        },
      ],
      [
        {
          text: t(lang, "common_back"),
          callback_data: `service_menu:virtual_numbers:prices:${encodedAppName}:${pageIndex}`,
        },
      ],
    ],
  };
}

function getSocialBoostKeyboard(apps, lang = "ar") {
  return {
    inline_keyboard: [
      ...chunkButtons(apps, (app) => ({
        text: app,
        callback_data: `service_menu:social_boost:app:${encodeURIComponent(app)}`,
      })),
      [{ text: t(lang, "common_back"), callback_data: "menu:main" }],
    ],
  };
}

function getSocialBoostServicesKeyboard(services, appKey, lang = "ar") {
  return {
    inline_keyboard: [
      ...chunkButtons(services, (service, index) => ({
        text: service,
        callback_data: `social_boost_service:${appKey}:${index}`,
      })),
      [{ text: t(lang, "common_back"), callback_data: "service:social_boost" }],
    ],
  };
}

function getProMainKeyboard(categories, lang = "ar") {
  return {
    inline_keyboard: [
      ...categories.map((category, index) => [{ text: category, callback_data: `service_menu:pro_accounts:category:${index}` }]),
      [{ text: t(lang, "common_back"), callback_data: "menu:main" }],
    ],
  };
}

function getProSubcategoryKeyboard(items, subcategoryKey, lang = "ar") {
  return {
    inline_keyboard: [
      ...chunkButtons(items, (item, index) => ({
        text: item,
        callback_data: `service_menu:pro_accounts:item:${subcategoryKey}:${index}`,
      })),
      [{ text: t(lang, "common_back"), callback_data: "service:pro_accounts" }],
    ],
  };
}

function getSocialAccountsCategoriesKeyboard(categories, lang = "ar") {
  return {
    inline_keyboard: [
      ...chunkButtons(categories, (category) => ({
        text: category.label,
        callback_data: `service_menu:social_accounts:category:${category.key}`,
      })),
      [{ text: t(lang, "common_back"), callback_data: "menu:main" }],
    ],
  };
}

function getSocialAccountsPlatformsKeyboard(platforms, categoryKey, lang = "ar") {
  return {
    inline_keyboard: [
      ...chunkButtons(platforms, (platform) => ({
        text: platform,
        callback_data: `service_menu:social_accounts:platform:${categoryKey}:${encodeURIComponent(platform)}`,
      })),
      [{ text: t(lang, "common_back"), callback_data: "service:social_accounts" }],
    ],
  };
}

function getCloudServicesKeyboard(items, lang = "ar") {
  return {
    inline_keyboard: [
      ...chunkButtons(items, (item, index) => ({
        text: item,
        callback_data: `service_menu:cloud_services:item:${index}`,
      })),
      [{ text: t(lang, "common_back"), callback_data: "menu:main" }],
    ],
  };
}

function getTemporaryEmailsKeyboard(items, lang = "ar") {
  return {
    inline_keyboard: [
      ...chunkButtons(items, (item, index) => ({
        text: item,
        callback_data: `service_menu:temporary_emails:item:${index}`,
      })),
      [{ text: t(lang, "common_back"), callback_data: "menu:main" }],
    ],
  };
}

function getTempEmailActionsKeyboard(lang = "ar") {
  return {
    inline_keyboard: [
      [
        { text: t(lang, "temporaryEmails_btn_refresh"), callback_data: "service_menu:temporary_emails:refresh" },
        { text: t(lang, "temporaryEmails_btn_switch"), callback_data: "service_menu:temporary_emails:switch" },
      ],
      [{ text: t(lang, "common_back"), callback_data: "service:temporary_emails" }],
    ],
  };
}

function getVirtualVisaKeyboard(items, lang = "ar") {
  return {
    inline_keyboard: [
      ...chunkButtons(items, (item, index) => ({
        text: item,
        callback_data: `service_menu:virtual_visa:item:${index}`,
      })),
      [{ text: t(lang, "common_back"), callback_data: "menu:main" }],
    ],
  };
}

function getGameTopupKeyboard(items, pageIndex, totalPages, lang = "ar") {
  const rows = [
    ...chunkButtons(items, (item, index) => ({
      text: item,
      callback_data: `service_menu:game_topup:item:${pageIndex}:${index}`,
    })),
  ];

  const navigationRow = [];
  if (pageIndex < totalPages - 1) {
    navigationRow.push({ text: t(lang, "common_next"), callback_data: `service_menu:game_topup:page:${pageIndex + 1}` });
  }
  if (pageIndex > 0) {
    navigationRow.push({ text: t(lang, "common_previous"), callback_data: `service_menu:game_topup:page:${pageIndex - 1}` });
  }
  if (navigationRow.length) {
    rows.push(navigationRow);
  }

  rows.push([{ text: t(lang, "common_back"), callback_data: "menu:main" }]);
  return { inline_keyboard: rows };
}

function getOtherServicesKeyboard(items, lang = "ar") {
  return {
    inline_keyboard: [
      ...chunkButtons(items, (item, index) => ({
        text: item,
        callback_data: `service_menu:other_services:item:${index}`,
      })),
      [{ text: t(lang, "otherServices_custom"), callback_data: "service_menu:other_services:custom_request" }],
      [{ text: t(lang, "common_back"), callback_data: "menu:main" }],
    ],
  };
}

module.exports = {
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
};
