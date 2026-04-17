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

const USD_TO_RUB = 30;

function tr(lang, ar, en) {
  return lang === "en" ? en : ar;
}

function gameName(lang, game) {
  return lang === "en" ? game.name_en : game.name_ar;
}

function toRub(usdValue) {
  const usd = Number(usdValue || 0);
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Number((usd * USD_TO_RUB).toFixed(2));
}

function priceRubLabel(amount) {
  return `${Number(amount || 0).toFixed(2)} ₽`;
}

function buildCategoriesText(lang, user) {
  const username = escapeHtml(user.firstName || user.username || String(user.userId || ""));
  if (lang === "ar") {
    return [
      "✅ <b>قسم شحن الألعاب</b>",
      "",
      `👋 مرحبًا <b>${username}</b> بك في قسم شحن الألعاب`,
      "•────────────•",
      "📌 يرجى اختيار القسم من الأسفل",
      "⚡ خدماتنا سريعة ومنظمة",
    ].join("\n");
  }

  return [
    "✅ <b>Game Top-up Section</b>",
    "",
    `👋 Welcome <b>${username}</b> to Game Top-up`,
    "•────────────•",
    "📌 Please choose a category below",
    "⚡ Fast and organized services",
  ].join("\n");
}

function buildGamesText(lang, category, balance) {
  return [
    tr(lang, "✅ <b>اختر اللعبة</b>", "✅ <b>Select a game</b>"),
    "",
    `${tr(lang, "📂 القسم", "📂 Category")} : <b>${escapeHtml(lang === "en" ? category.name_en : category.name_ar)}</b>`,
    `${tr(lang, "💰 رصيدك", "💰 Your balance")} : <b>${formatRuble(balance)}</b>`,
  ].join("\n");
}

function buildPackagesText(lang, category, game, balance) {
  return [
    tr(lang, "✅ <b>اختر الباقة</b>", "✅ <b>Select a package</b>"),
    "",
    `${tr(lang, "📂 القسم", "📂 Category")} : <b>${escapeHtml(lang === "en" ? category.name_en : category.name_ar)}</b>`,
    `${tr(lang, "🎮 اللعبة", "🎮 Game")} : <b>${game.emoji} ${escapeHtml(gameName(lang, game))}</b>`,
    `${tr(lang, "💰 رصيدك", "💰 Your balance")} : <b>${formatRuble(balance)}</b>`,
  ].join("\n");
}

function buildFixedInfoRows(lang, packageItemRub) {
  return [
    {
      left: lang === "ar" ? packageItemRub.units_ar : packageItemRub.units_en,
      right: tr(lang, "🌐 الفئة", "🌐 Package"),
    },
    {
      left: priceRubLabel(packageItemRub.priceRub),
      right: tr(lang, "💰 السعر", "💰 Price"),
    },
    {
      left: tr(lang, "تلقائي", "Automatic"),
      right: tr(lang, "🌟 نوع الشحن", "🌟 Top-up Type"),
    },
    {
      left: tr(lang, "خلال 4 ساعات", "Within 4 hours"),
      right: tr(lang, "⏰ وقت الشحن", "⏰ Delivery Time"),
    },
  ];
}

function buildInfoText(lang, game, packageItemRub) {
  const amountLabel = packageItemRub
    ? (lang === "ar" ? packageItemRub.units_ar : packageItemRub.units_en)
    : tr(lang, "شحن مخصص", "Custom top-up");
  const priceLabel = packageItemRub ? priceRubLabel(packageItemRub.priceRub) : "-";

  if (lang === "ar") {
    return [
      `✅ معلومات الخدمة: شحن <b>${escapeHtml(gameName(lang, game))}</b>`,
      "",
      `💵 السعر: <b>${priceLabel}</b>`,
      `🪪 المطلوب: <b>${escapeHtml(game.idLabelAr || "ID")}</b>`,
      "",
      `📩 أرسل الآن ${escapeHtml(game.idLabelAr || "ID")} الخاص بك`,
      "",
      `• ${amountLabel} •`,
    ].join("\n");
  }

  return [
    `✅ Service info: Top-up <b>${escapeHtml(gameName(lang, game))}</b>`,
    "",
    `💵 Price: <b>${priceLabel}</b>`,
    `🪪 Required: <b>${escapeHtml(game.idLabelEn || "ID")}</b>`,
    "",
    `📩 Send your ${escapeHtml(game.idLabelEn || "ID")} now`,
    "",
    `• ${amountLabel} •`,
  ].join("\n");
}

function buildCustomAmountPrompt(lang, game) {
  const unitLabel = lang === "ar" ? game.custom.unitLabelAr : game.custom.unitLabelEn;
  return [
    tr(lang, "🛠️ اخترت الشحن المخصص", "🛠️ You selected custom top-up"),
    "",
    `${tr(lang, "📦 الوحدة", "📦 Unit")} : <b>${escapeHtml(unitLabel)}</b>`,
    `${tr(lang, "💰 السعر للوحدة", "💰 Unit price")} : <b>${priceRubLabel(toRub(game.custom.unitPriceRub))}</b>`,
    `${tr(lang, "📉 الحد الأدنى", "📉 Minimum")} : <b>${game.custom.min}</b>`,
    `${tr(lang, "📈 الحد الأقصى", "📈 Maximum")} : <b>${game.custom.max}</b>`,
    "",
    tr(lang, "✍️ أرسل الكمية المطلوبة (أرقام فقط)", "✍️ Send required quantity (numbers only)"),
  ].join("\n");
}

function buildInvoiceText(lang, details) {
  const done = tr(lang, "✅ تم التنفيذ", "✅ Completed");
  return [
    tr(lang, "🧾 فاتورة تنفيذ العملية", "🧾 Order Invoice"),
    "",
    `➖ ${tr(lang, "رقم الطلب", "Order ID")} : <code>${details.orderId}</code>`,
    `➖ ${tr(lang, "اللعبة", "Game")} : ${details.gameName}`,
    `➖ ${tr(lang, "الآيدي", "ID")} : <code>${escapeHtml(details.playerId)}</code>`,
    `➖ ${tr(lang, "الباقة", "Package")} : ${escapeHtml(details.packageLabel)}`,
    `➖ ${tr(lang, "السعر", "Price")} : <b>${priceRubLabel(details.totalPrice)}</b>`,
    "",
    `➖ ${tr(lang, "حالة التنفيذ", "Execution")} : <b>${done}</b>`,
    `➖ ${tr(lang, "حالة المزود", "Provider")} : <b>${details.providerStatus}</b>`,
  ].join("\n");
}

async function sendGameTopupCategoriesMenu(bot, chatId, user, options = {}) {
  const lang = getUserLang(user);
  const catalog = await getGameTopupCatalog();
  return sendOrEditMessage(
    bot,
    chatId,
    buildCategoriesText(lang, user),
    getGameTopupCategoriesKeyboard(catalog.categories, lang),
    options.messageId,
    "sendGameTopupCategoriesMenu"
  );
}

async function sendGameTopupGamesMenu(bot, chatId, user, categoryKey, options = {}) {
  const lang = getUserLang(user);
  const catalog = await getGameTopupCatalog();
  const category = getCategoryByKey(catalog, categoryKey);
  if (!category) {
    return sendGameTopupCategoriesMenu(bot, chatId, user, options);
  }

  const games = getGamesByCategory(catalog, categoryKey);
  return sendOrEditMessage(
    bot,
    chatId,
    buildGamesText(lang, category, user.balance),
    getGameTopupGamesKeyboard(games, category.key, 0, 1, lang),
    options.messageId,
    "sendGameTopupGamesMenu"
  );
}

async function sendGameTopupPackagesMenu(bot, chatId, user, gameKey, categoryKey, options = {}) {
  const lang = getUserLang(user);
  const catalog = await getGameTopupCatalog();
  const game = getGameByKey(catalog, gameKey);
  const category = getCategoryByKey(catalog, categoryKey || game?.categoryKey);
  if (!game || !category) {
    return sendGameTopupCategoriesMenu(bot, chatId, user, options);
  }

  const uiGame = {
    ...game,
    packages: game.packages.map((pkg) => ({ ...pkg, priceRub: toRub(pkg.priceRub) })),
  };

  return sendOrEditMessage(
    bot,
    chatId,
    buildPackagesText(lang, category, uiGame, user.balance),
    getGameTopupPackagesKeyboard(uiGame, category.key, 0, lang),
    options.messageId,
    "sendGameTopupPackagesMenu"
  );
}

async function startGameTopupIdInput(bot, chatId, user, selection, options = {}) {
  const lang = getUserLang(user);
  const catalog = await getGameTopupCatalog();
  const game = getGameByKey(catalog, selection.gameKey);
  if (!game) {
    return sendGameTopupCategoriesMenu(bot, chatId, user, options);
  }

  const rawPackage = selection.isCustom ? null : game.packages[Number(selection.packageIndex)];
  if (!selection.isCustom && !rawPackage) {
    return sendGameTopupPackagesMenu(bot, chatId, user, game.key, selection.categoryKey, options);
  }

  setUserState(user.userId, "GAME_TOPUP_WAIT_ID", {
    gameKey: game.key,
    categoryKey: selection.categoryKey,
    isCustom: Boolean(selection.isCustom),
    packageIndex: selection.isCustom ? null : Number(selection.packageIndex),
  });

  const packageItemRub = rawPackage
    ? { ...rawPackage, priceRub: toRub(rawPackage.priceRub) }
    : null;

  const rowsData = packageItemRub
    ? buildFixedInfoRows(lang, packageItemRub)
    : buildFixedInfoRows(lang, {
      units_ar: "مخصص",
      units_en: "Custom",
      priceRub: toRub(game.custom.unitPriceRub),
    });

  return sendOrEditMessage(
    bot,
    chatId,
    buildInfoText(lang, game, packageItemRub),
    getGameTopupRequestInfoKeyboard(rowsData, `gt:g:${game.key}:${selection.categoryKey}`, lang),
    options.messageId,
    "startGameTopupIdInput"
  );
}

async function processTopupOrder(bot, msg, appStore, payload) {
  const user = appStore.findUserById(msg.from.id);
  if (!user) return true;
  const lang = getUserLang(user);
  const catalog = await getGameTopupCatalog();
  const game = getGameByKey(catalog, payload.gameKey);
  if (!game) {
    clearUserState(msg.from.id);
    return true;
  }

  const totalPrice = Number(payload.totalPrice || 0);
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
    clearUserState(msg.from.id);
    await safeTelegramCall("gameTopup.invalidPrice", () =>
      bot.sendMessage(msg.chat.id, tr(lang, "❌ سعر الطلب غير صالح.", "❌ Invalid order price."))
    );
    return true;
  }

  if (user.balance < totalPrice) {
    await safeTelegramCall("gameTopup.insufficientBalance", () =>
      bot.sendMessage(msg.chat.id, tr(lang, "❌ رصيدك غير كافٍ لإتمام الطلب.", "❌ Insufficient balance."))
    );
    return true;
  }

  const orderResult = await executeGameTopupOrder({
    game,
    playerId: payload.playerId,
    packageItem: payload.packageItem || null,
    quantity: payload.quantity || null,
  });

  if (!orderResult.success) {
    await safeTelegramCall("gameTopup.orderFailed", () =>
      bot.sendMessage(msg.chat.id, tr(lang, "❌ تعذر تنفيذ الطلب من المزود حالياً.", "❌ Provider could not process order now."))
    );
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

  const providerStatus = orderResult.provider === "remote"
    ? tr(lang, "تم الإرسال إلى المزود", "Submitted to provider")
    : tr(lang, "تم الحجز محلياً (بدون مزود)", "Saved locally (provider disabled)");

  await safeTelegramCall("gameTopup.orderSuccess", () =>
    bot.sendMessage(
      msg.chat.id,
      buildInvoiceText(lang, {
        orderId: orderResult.orderId,
        gameName: `${game.emoji} ${gameName(lang, game)}`,
        playerId: payload.playerId,
        packageLabel: payload.packageLabel,
        totalPrice,
        providerStatus,
      }),
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: tr(lang, "رجوع", "Back"), callback_data: "service:game_topup" }],
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
      await safeTelegramCall("gameTopup.cancel", () =>
        bot.sendMessage(msg.chat.id, tr(lang, "تم إلغاء العملية.", "Operation cancelled."))
      );
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
        totalPrice: toRub(packageItem.priceRub),
      });
    }

    if (!/^\d+$/.test(text)) {
      await safeTelegramCall("gameTopup.invalidAmountFormat", () =>
        bot.sendMessage(msg.chat.id, tr(lang, "❌ الرجاء إرسال الكمية أرقام فقط.", "❌ Please send quantity as numbers only."))
      );
      return true;
    }

    const quantity = Number(text);
    if (!Number.isFinite(quantity) || quantity < game.custom.min || quantity > game.custom.max) {
      await safeTelegramCall("gameTopup.invalidAmountRange", () =>
        bot.sendMessage(
          msg.chat.id,
          tr(
            lang,
            `❌ الكمية خارج النطاق المسموح (${game.custom.min} - ${game.custom.max}).`,
            `❌ Quantity out of allowed range (${game.custom.min} - ${game.custom.max}).`
          )
        )
      );
      return true;
    }

    const totalPrice = Number((quantity * toRub(game.custom.unitPriceRub)).toFixed(2));
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

