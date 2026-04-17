const { sendOrEditMessage } = require("./profileService");
const { getUserLang } = require("../locales");
const { formatRuble, escapeHtml } = require("../utils/formatters");
const { getUserState, setUserState, clearUserState } = require("./stateStore");
const { logBotError } = require("./errorLogger");
const { safeTelegramCall } = require("./telegramSafe");
const {
  getGameTopupCatalog,
  getCategoryByKey,
  getGamesByCategory,
  getGameByKey,
} = require("./gameTopupCatalogService");
const { executeGameTopupOrder, isProviderConfigured } = require("./gameTopupProviderService");
const {
  getGameTopupCategoriesKeyboard,
  getGameTopupGamesKeyboard,
  getGameTopupPackagesKeyboard,
  getGameTopupRequestInfoKeyboard,
} = require("../keyboards/serviceMenusKeyboard");

const GAME_TOPUP_PAGE_SIZE = 10;

function pickText(lang, ar, en) {
  return lang === "en" ? en : ar;
}

function pickName(lang, item) {
  return lang === "en" ? item.name_en : item.name_ar;
}

function formatGameTopupPrice(price) {
  return `${Number(price || 0).toFixed(2)} ₽`;
}

function paginate(items, pageIndex, pageSize = GAME_TOPUP_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.max(0, Math.min(Number(pageIndex) || 0, totalPages - 1));
  return {
    totalPages,
    pageIndex: safePage,
    items: items.slice(safePage * pageSize, safePage * pageSize + pageSize),
  };
}

function buildCategoriesText(lang, user) {
  const username = escapeHtml(user.firstName || user.username || String(user.userId || ""));
  if (lang === "ar") {
    return [
      "✅ <b>شحن الألعاب</b>",
      "",
      `👋 مرحبًا <b>${username}</b> بك في قسم شحن الألعاب`,
      "•────────────•",
      "📌 يرجى اختيار القسم من الأسفل",
      "⚡ خدماتنا سريعة ومنظمة",
    ].join("\n");
  }

  return [
    "✅ <b>Game Top-up</b>",
    "",
    `👋 Welcome <b>${username}</b> to Game Top-up`,
    "•────────────•",
    "📌 Please choose a category below",
    "⚡ Fast and organized services",
  ].join("\n");
}

function buildGamesText(lang, category, pageIndex, totalPages, balance) {
  return [
    pickText(lang, "✅ <b>اختر اللعبة من القسم</b>", "✅ <b>Choose a game from category</b>"),
    "",
    `${pickText(lang, "📂 القسم", "📂 Category")} : <b>${escapeHtml(pickName(lang, category))}</b>`,
    `${pickText(lang, "📄 الصفحة", "📄 Page")} : <b>${pageIndex + 1}/${totalPages}</b>`,
    `${pickText(lang, "💰 رصيدك", "💰 Balance")} : <b>${formatRuble(balance)}</b>`,
  ].join("\n");
}

function buildPackagesText(lang, category, game, balance) {
  return [
    pickText(lang, "✅ <b>اختر الباقة</b>", "✅ <b>Choose package</b>"),
    "",
    `${pickText(lang, "📂 القسم", "📂 Category")} : <b>${escapeHtml(pickName(lang, category))}</b>`,
    `${pickText(lang, "🎮 اللعبة", "🎮 Game")} : <b>${game.emoji} ${escapeHtml(pickName(lang, game))}</b>`,
    `${pickText(lang, "💰 رصيدك", "💰 Balance")} : <b>${formatRuble(balance)}</b>`,
  ].join("\n");
}

function buildFixedRequestInfoRows(lang, game, packageItem) {
  return [
    {
      left: lang === "ar" ? packageItem.units_ar : packageItem.units_en,
      right: pickText(lang, "🌐 الفئة", "🌐 Package"),
    },
    {
      left: formatGameTopupPrice(packageItem.priceRub),
      right: pickText(lang, "💰 السعر", "💰 Price"),
    },
    {
      left: pickText(lang, "تلقائي", "Automatic"),
      right: pickText(lang, "🌟 نوع الشحن", "🌟 Top-up Type"),
    },
    {
      left: pickText(lang, "خلال 4 ساعات", "Within 4 hours"),
      right: pickText(lang, "⏰ وقت الشحن", "⏰ Delivery Time"),
    },
  ];
}

function buildRequestInfoText(lang, game, packageItem) {
  const amountLabel = packageItem
    ? (lang === "ar" ? packageItem.units_ar : packageItem.units_en)
    : pickText(lang, "شحن مخصص", "Custom top-up");
  const priceLabel = packageItem
    ? formatGameTopupPrice(packageItem.priceRub)
    : "";

  if (lang === "ar") {
    return [
      `✅ معلومات الخدمة: شحن <b>${escapeHtml(pickName(lang, game))}</b>`,
      "",
      `💵 السعر: <b>${priceLabel || "-"}</b>`,
      `🪪 المطلوب: <b>${escapeHtml(game.idLabelAr || "ID")}</b>`,
      "",
      "📩 أرسل الآن المطلوب كما هو موضح في معلومات الخدمة",
      "",
      `• ${amountLabel} •`,
    ].join("\n");
  }

  return [
    `✅ Service info: Top-up <b>${escapeHtml(pickName(lang, game))}</b>`,
    "",
    `💵 Price: <b>${priceLabel || "-"}</b>`,
    `🪪 Required: <b>${escapeHtml(game.idLabelEn || "ID")}</b>`,
    "",
    "📩 Send the required value exactly as shown below",
    "",
    `• ${amountLabel} •`,
  ].join("\n");
}

function buildCustomAmountPrompt(lang, game) {
  const unitLabel = lang === "ar" ? game.custom.unitLabelAr : game.custom.unitLabelEn;
  return [
    pickText(lang, "🛠️ اخترت الشحن المخصص", "🛠️ You selected custom top-up"),
    "",
    `${pickText(lang, "📦 الوحدة", "📦 Unit")} : <b>${escapeHtml(unitLabel)}</b>`,
    `${pickText(lang, "💰 السعر للوحدة", "💰 Unit price")} : <b>${formatGameTopupPrice(game.custom.unitPriceRub)}</b>`,
    `${pickText(lang, "📉 الحد الأدنى", "📉 Minimum")} : <b>${game.custom.min}</b>`,
    `${pickText(lang, "📈 الحد الأقصى", "📈 Maximum")} : <b>${game.custom.max}</b>`,
    "",
    pickText(lang, "✍️ أرسل الكمية المطلوبة (أرقام فقط)", "✍️ Send required quantity (numbers only)"),
  ].join("\n");
}

function buildOrderSummaryText(lang, details) {
  return [
    pickText(lang, "✅ تم تنفيذ طلب الشحن بنجاح", "✅ Top-up order completed"),
    "",
    `${pickText(lang, "🧾 رقم الطلب", "🧾 Order ID")} : <code>${details.orderId}</code>`,
    `${pickText(lang, "🎮 اللعبة", "🎮 Game")} : ${details.gameName}`,
    `${pickText(lang, "🪪 الآيدي", "🪪 ID")} : <code>${escapeHtml(details.playerId)}</code>`,
    `${pickText(lang, "📦 الباقة", "📦 Package")} : ${escapeHtml(details.packageLabel)}`,
    `${pickText(lang, "💰 السعر", "💰 Price")} : <b>${formatGameTopupPrice(details.totalPrice)}</b>`,
    `${pickText(lang, "⚙️ الحالة", "⚙️ Status")} : <b>${details.statusLabel}</b>`,
  ].join("\n");
}

async function sendGameTopupCategoriesMenu(bot, chatId, user, options = {}) {
  const lang = getUserLang(user);
  const catalog = await getGameTopupCatalog();
  const text = buildCategoriesText(lang, user);
  const keyboard = getGameTopupCategoriesKeyboard(catalog.categories, lang);
  return sendOrEditMessage(bot, chatId, text, keyboard, options.messageId, "sendGameTopupCategoriesMenu");
}

async function sendGameTopupGamesMenu(bot, chatId, user, categoryKey, pageIndex, options = {}) {
  const lang = getUserLang(user);
  const catalog = await getGameTopupCatalog();
  const category = getCategoryByKey(catalog, categoryKey);
  if (!category) {
    return sendGameTopupCategoriesMenu(bot, chatId, user, options);
  }

  const games = getGamesByCategory(catalog, categoryKey);
  const paged = paginate(games, pageIndex, GAME_TOPUP_PAGE_SIZE);
  const text = buildGamesText(lang, category, paged.pageIndex, paged.totalPages, user.balance);
  const keyboard = getGameTopupGamesKeyboard(paged.items, category.key, paged.pageIndex, paged.totalPages, lang);
  return sendOrEditMessage(bot, chatId, text, keyboard, options.messageId, "sendGameTopupGamesMenu");
}

async function sendGameTopupPackagesMenu(bot, chatId, user, gameKey, categoryKey, pageIndex, options = {}) {
  const lang = getUserLang(user);
  const catalog = await getGameTopupCatalog();
  const game = getGameByKey(catalog, gameKey);
  const category = getCategoryByKey(catalog, categoryKey || game?.categoryKey);

  if (!game || !category) {
    return sendGameTopupCategoriesMenu(bot, chatId, user, options);
  }

  const text = buildPackagesText(lang, category, game, user.balance);
  const keyboard = getGameTopupPackagesKeyboard(game, category.key, Number(pageIndex) || 0, lang);
  return sendOrEditMessage(bot, chatId, text, keyboard, options.messageId, "sendGameTopupPackagesMenu");
}

async function startGameTopupIdInput(bot, chatId, user, selection, options = {}) {
  const lang = getUserLang(user);
  const catalog = await getGameTopupCatalog();
  const game = getGameByKey(catalog, selection.gameKey);
  if (!game) {
    return sendGameTopupCategoriesMenu(bot, chatId, user, options);
  }

  const packageItem = selection.isCustom ? null : game.packages[Number(selection.packageIndex)];
  if (!selection.isCustom && !packageItem) {
    return sendGameTopupPackagesMenu(bot, chatId, user, game.key, selection.categoryKey, selection.pageIndex, options);
  }

  setUserState(user.userId, "GAME_TOPUP_WAIT_ID", {
    gameKey: game.key,
    categoryKey: selection.categoryKey,
    pageIndex: Number(selection.pageIndex) || 0,
    isCustom: Boolean(selection.isCustom),
    packageIndex: selection.isCustom ? null : Number(selection.packageIndex),
  });

  const rowsData = packageItem
    ? buildFixedRequestInfoRows(lang, game, packageItem)
    : buildFixedRequestInfoRows(lang, game, {
      units_ar: "مخصص",
      units_en: "Custom",
      priceRub: game.custom.unitPriceRub,
    });

  await sendOrEditMessage(
    bot,
    chatId,
    buildRequestInfoText(lang, game, packageItem),
    getGameTopupRequestInfoKeyboard(rowsData, `service_menu:game_topup:game:${game.key}:cat:${selection.categoryKey}:page:${selection.pageIndex}`, lang),
    options.messageId,
    "startGameTopupIdInput"
  );

  await safeTelegramCall("gameTopup.idPrompt", () =>
    bot.sendMessage(
      chatId,
      pickText(
        lang,
        `🪪 يرجى إرسال ${game.idLabelAr || "ID"} الخاص بك في ${pickName(lang, game)}`,
        `🪪 Please send your ${game.idLabelEn || "ID"} for ${pickName(lang, game)}`
      )
    )
  );
  return true;
}

async function processTopupOrder(bot, msg, appStore, payload) {
  const user = appStore.findUserById(msg.from.id);
  const lang = getUserLang(user);
  const catalog = await getGameTopupCatalog();
  const game = getGameByKey(catalog, payload.gameKey);
  if (!user || !game) {
    clearUserState(msg.from.id);
    return true;
  }

  const totalPrice = Number(payload.totalPrice || 0);
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
    clearUserState(msg.from.id);
    await safeTelegramCall("gameTopup.invalidPrice", () => bot.sendMessage(msg.chat.id, pickText(lang, "❌ سعر الطلب غير صالح.", "❌ Invalid order price.")));
    return true;
  }

  if (user.balance < totalPrice) {
    await safeTelegramCall("gameTopup.insufficientBalance", () => bot.sendMessage(msg.chat.id, pickText(lang, "❌ رصيدك غير كافٍ لإتمام الطلب.", "❌ Insufficient balance.")));
    return true;
  }

  const orderResult = await executeGameTopupOrder({
    game,
    playerId: payload.playerId,
    packageItem: payload.packageItem || null,
    quantity: payload.quantity || null,
  });

  if (!orderResult.success) {
    await safeTelegramCall("gameTopup.orderFailed", () => bot.sendMessage(msg.chat.id, pickText(lang, "❌ تعذر تنفيذ الطلب من المزود حالياً.", "❌ Provider could not process order now.")));
    return true;
  }

  appStore.deductBalance(user.userId, totalPrice);
  appStore.incrementTransactions(user.userId);
  appStore.addProfit(totalPrice);
  appStore.addTransaction({
    type: "game_topup_order",
    serviceKey: "game_topup",
    userId: user.userId,
    amount: totalPrice,
    gameKey: game.key,
    gameNameAr: game.name_ar,
    gameNameEn: game.name_en,
    playerId: payload.playerId,
    packageLabel: payload.packageLabel,
    quantity: payload.quantity || null,
    providerOrderId: orderResult.orderId,
    provider: orderResult.provider,
    providerStatus: orderResult.status,
  });

  clearUserState(user.userId);

  const statusLabel = orderResult.provider === "remote"
    ? pickText(lang, "تم الإرسال إلى المزود", "Submitted to provider")
    : pickText(lang, "تم الحجز محلياً (بدون مزود)", "Saved locally (provider disabled)");

  await safeTelegramCall("gameTopup.orderSuccess", () =>
    bot.sendMessage(
      msg.chat.id,
      buildOrderSummaryText(lang, {
        orderId: orderResult.orderId,
        gameName: `${game.emoji} ${pickName(lang, game)}`,
        playerId: payload.playerId,
        packageLabel: payload.packageLabel,
        totalPrice,
        statusLabel,
      }),
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: pickText(lang, "🎮 متابعة شحن الألعاب", "🎮 Continue Game Top-up"), callback_data: "service:game_topup" }],
          ],
        },
      }
    )
  );

  return true;
}

async function handleGameTopupTextInput(bot, msg, appStore) {
  try {
    const state = getUserState(msg.from.id);
    if (!state || (state.name !== "GAME_TOPUP_WAIT_ID" && state.name !== "GAME_TOPUP_WAIT_AMOUNT")) {
      return false;
    }

    const user = appStore.findUserById(msg.from.id) || appStore.getOrCreateUser(msg.from);
    const lang = getUserLang(user);
    const text = String(msg.text || "").trim();
    if (!text) return true;

    if (["cancel", "إلغاء", "الغاء"].includes(text.toLowerCase())) {
      clearUserState(user.userId);
      await safeTelegramCall("gameTopup.cancel", () => bot.sendMessage(msg.chat.id, pickText(lang, "تم إلغاء العملية.", "Operation cancelled.")));
      return true;
    }

    const catalog = await getGameTopupCatalog();
    const game = getGameByKey(catalog, state.gameKey);
    if (!game) {
      clearUserState(user.userId);
      return true;
    }

    if (state.name === "GAME_TOPUP_WAIT_ID") {
      if (state.isCustom) {
        setUserState(user.userId, "GAME_TOPUP_WAIT_AMOUNT", {
          gameKey: state.gameKey,
          categoryKey: state.categoryKey,
          pageIndex: state.pageIndex,
          playerId: text,
        });
        await safeTelegramCall("gameTopup.customAmountPrompt", () =>
          bot.sendMessage(msg.chat.id, buildCustomAmountPrompt(lang, game), { parse_mode: "HTML" })
        );
        return true;
      }

      const packageItem = game.packages[Number(state.packageIndex)];
      if (!packageItem) {
        clearUserState(user.userId);
        return true;
      }

      return processTopupOrder(bot, msg, appStore, {
        gameKey: game.key,
        playerId: text,
        packageItem,
        quantity: 1,
        packageLabel: lang === "ar" ? packageItem.units_ar : packageItem.units_en,
        totalPrice: packageItem.priceRub,
      });
    }

    if (!/^\d+$/.test(text)) {
      await safeTelegramCall("gameTopup.invalidAmountFormat", () =>
        bot.sendMessage(msg.chat.id, pickText(lang, "❌ الرجاء إرسال الكمية أرقام فقط.", "❌ Please send quantity as numbers only."))
      );
      return true;
    }

    const quantity = Number(text);
    if (!Number.isFinite(quantity) || quantity < game.custom.min || quantity > game.custom.max) {
      await safeTelegramCall("gameTopup.invalidAmountRange", () =>
        bot.sendMessage(
          msg.chat.id,
          pickText(
            lang,
            `❌ الكمية خارج النطاق المسموح (${game.custom.min} - ${game.custom.max}).`,
            `❌ Quantity out of allowed range (${game.custom.min} - ${game.custom.max}).`
          )
        )
      );
      return true;
    }

    const totalPrice = Number((quantity * game.custom.unitPriceRub).toFixed(2));
    const unitLabel = lang === "ar" ? game.custom.unitLabelAr : game.custom.unitLabelEn;
    return processTopupOrder(bot, msg, appStore, {
      gameKey: game.key,
      playerId: state.playerId,
      quantity,
      packageLabel: `${quantity} ${unitLabel}`,
      totalPrice,
    });
  } catch (error) {
    logBotError("handleGameTopupTextInput", error, { userId: msg.from?.id });
    return false;
  }
}

module.exports = {
  sendGameTopupCategoriesMenu,
  sendGameTopupGamesMenu,
  sendGameTopupPackagesMenu,
  startGameTopupIdInput,
  handleGameTopupTextInput,
  isGameTopupProviderConfigured: isProviderConfigured,
};

