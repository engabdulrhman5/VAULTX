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
const USD_TO_RUB = 30;

function pickText(lang, ar, en) {
  return lang === "en" ? en : ar;
}

function pickName(lang, item) {
  return lang === "en" ? item.name_en : item.name_ar;
}

function formatGameTopupPrice(price) {
  return `${Number(price || 0).toFixed(2)} ₽`;
}

function toRub(usdValue) {
  const usd = Number(usdValue || 0);
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Number((usd * USD_TO_RUB).toFixed(2));
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
      "âœ… <b>ط´ط­ظ† ط§ظ„ط£ظ„ط¹ط§ط¨</b>",
      "",
      `ًں‘‹ ظ…ط±ط­ط¨ظ‹ط§ <b>${username}</b> ط¨ظƒ ظپظٹ ظ‚ط³ظ… ط´ط­ظ† ط§ظ„ط£ظ„ط¹ط§ط¨`,
      "â€¢â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â€¢",
      "ًں“Œ ظٹط±ط¬ظ‰ ط§ط®طھظٹط§ط± ط§ظ„ظ‚ط³ظ… ظ…ظ† ط§ظ„ط£ط³ظپظ„",
      "âڑ، ط®ط¯ظ…ط§طھظ†ط§ ط³ط±ظٹط¹ط© ظˆظ…ظ†ط¸ظ…ط©",
    ].join("\n");
  }

  return [
    "âœ… <b>Game Top-up</b>",
    "",
    `ًں‘‹ Welcome <b>${username}</b> to Game Top-up`,
    "â€¢â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â€¢",
    "ًں“Œ Please choose a category below",
    "âڑ، Fast and organized services",
  ].join("\n");
}

function buildGamesText(lang, category, pageIndex, totalPages, balance) {
  return [
    pickText(lang, "âœ… <b>ط§ط®طھط± ط§ظ„ظ„ط¹ط¨ط© ظ…ظ† ط§ظ„ظ‚ط³ظ…</b>", "âœ… <b>Choose a game from category</b>"),
    "",
    `${pickText(lang, "ًں“‚ ط§ظ„ظ‚ط³ظ…", "ًں“‚ Category")} : <b>${escapeHtml(pickName(lang, category))}</b>`,
    `${pickText(lang, "ًں“„ ط§ظ„طµظپط­ط©", "ًں“„ Page")} : <b>${pageIndex + 1}/${totalPages}</b>`,
    `${pickText(lang, "ًں’° ط±طµظٹط¯ظƒ", "ًں’° Balance")} : <b>${formatRuble(balance)}</b>`,
  ].join("\n");
}

function buildPackagesText(lang, category, game, balance) {
  return [
    pickText(lang, "âœ… <b>ط§ط®طھط± ط§ظ„ط¨ط§ظ‚ط©</b>", "âœ… <b>Choose package</b>"),
    "",
    `${pickText(lang, "ًں“‚ ط§ظ„ظ‚ط³ظ…", "ًں“‚ Category")} : <b>${escapeHtml(pickName(lang, category))}</b>`,
    `${pickText(lang, "ًںژ® ط§ظ„ظ„ط¹ط¨ط©", "ًںژ® Game")} : <b>${game.emoji} ${escapeHtml(pickName(lang, game))}</b>`,
    `${pickText(lang, "ًں’° ط±طµظٹط¯ظƒ", "ًں’° Balance")} : <b>${formatRuble(balance)}</b>`,
  ].join("\n");
}

function buildFixedRequestInfoRows(lang, game, packageItem) {
  return [
    {
      left: lang === "ar" ? packageItem.units_ar : packageItem.units_en,
      right: pickText(lang, "ًںŒگ ط§ظ„ظپط¦ط©", "ًںŒگ Package"),
    },
    {
      left: formatGameTopupPrice(toRub(packageItem.priceRub)),
      right: pickText(lang, "ًں’° ط§ظ„ط³ط¹ط±", "ًں’° Price"),
    },
    {
      left: pickText(lang, "طھظ„ظ‚ط§ط¦ظٹ", "Automatic"),
      right: pickText(lang, "ًںŒں ظ†ظˆط¹ ط§ظ„ط´ط­ظ†", "ًںŒں Top-up Type"),
    },
    {
      left: pickText(lang, "ط®ظ„ط§ظ„ 4 ط³ط§ط¹ط§طھ", "Within 4 hours"),
      right: pickText(lang, "âڈ° ظˆظ‚طھ ط§ظ„ط´ط­ظ†", "âڈ° Delivery Time"),
    },
  ];
}

function buildRequestInfoText(lang, game, packageItem) {
  const amountLabel = packageItem
    ? (lang === "ar" ? packageItem.units_ar : packageItem.units_en)
    : pickText(lang, "ط´ط­ظ† ظ…ط®طµطµ", "Custom top-up");
  const priceLabel = packageItem
    ? formatGameTopupPrice(toRub(packageItem.priceRub))
    : "";

  if (lang === "ar") {
    return [
      `âœ… ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ط®ط¯ظ…ط©: ط´ط­ظ† <b>${escapeHtml(pickName(lang, game))}</b>`,
      "",
      `ًں’µ ط§ظ„ط³ط¹ط±: <b>${priceLabel || "-"}</b>`,
      `ًںھھ ط§ظ„ظ…ط·ظ„ظˆط¨: <b>${escapeHtml(game.idLabelAr || "ID")}</b>`,
      "",
      "ًں“© ط£ط±ط³ظ„ ط§ظ„ط¢ظ† ط§ظ„ظ…ط·ظ„ظˆط¨ ظƒظ…ط§ ظ‡ظˆ ظ…ظˆط¶ط­ ظپظٹ ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ط®ط¯ظ…ط©",
      "",
      `â€¢ ${amountLabel} â€¢`,
    ].join("\n");
  }

  return [
    `âœ… Service info: Top-up <b>${escapeHtml(pickName(lang, game))}</b>`,
    "",
    `ًں’µ Price: <b>${priceLabel || "-"}</b>`,
    `ًںھھ Required: <b>${escapeHtml(game.idLabelEn || "ID")}</b>`,
    "",
    "ًں“© Send the required value exactly as shown below",
    "",
    `â€¢ ${amountLabel} â€¢`,
  ].join("\n");
}

function buildCustomAmountPrompt(lang, game) {
  const unitLabel = lang === "ar" ? game.custom.unitLabelAr : game.custom.unitLabelEn;
  return [
    pickText(lang, "ًں› ï¸ڈ ط§ط®طھط±طھ ط§ظ„ط´ط­ظ† ط§ظ„ظ…ط®طµطµ", "ًں› ï¸ڈ You selected custom top-up"),
    "",
    `${pickText(lang, "ًں“¦ ط§ظ„ظˆط­ط¯ط©", "ًں“¦ Unit")} : <b>${escapeHtml(unitLabel)}</b>`,
    `${pickText(lang, "ًں’° ط§ظ„ط³ط¹ط± ظ„ظ„ظˆط­ط¯ط©", "ًں’° Unit price")} : <b>${formatGameTopupPrice(toRub(game.custom.unitPriceRub))}</b>`,
    `${pickText(lang, "ًں“‰ ط§ظ„ط­ط¯ ط§ظ„ط£ط¯ظ†ظ‰", "ًں“‰ Minimum")} : <b>${game.custom.min}</b>`,
    `${pickText(lang, "ًں“ˆ ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰", "ًں“ˆ Maximum")} : <b>${game.custom.max}</b>`,
    "",
    pickText(lang, "âœچï¸ڈ ط£ط±ط³ظ„ ط§ظ„ظƒظ…ظٹط© ط§ظ„ظ…ط·ظ„ظˆط¨ط© (ط£ط±ظ‚ط§ظ… ظپظ‚ط·)", "âœچï¸ڈ Send required quantity (numbers only)"),
  ].join("\n");
}

function buildOrderSummaryText(lang, details) {
  const invoiceHeader = pickText(lang, "🧾 فاتورة تنفيذ العملية", "🧾 Order Invoice");
  const statusDone = pickText(lang, "✅ تم التنفيذ", "✅ Completed");
  return [
    invoiceHeader,
    "",
    `➖ ${pickText(lang, "رقم الطلب", "Order ID")} : <code>${details.orderId}</code>`,
    `➖ ${pickText(lang, "اللعبة", "Game")} : ${details.gameName}`,
    `➖ ${pickText(lang, "الآيدي", "ID")} : <code>${escapeHtml(details.playerId)}</code>`,
    `➖ ${pickText(lang, "الباقة", "Package")} : ${escapeHtml(details.packageLabel)}`,
    `➖ ${pickText(lang, "السعر", "Price")} : <b>${formatGameTopupPrice(details.totalPrice)}</b>`,
    "",
    `➖ ${pickText(lang, "حالة التنفيذ", "Execution")} : <b>${statusDone}</b>`,
    `➖ ${pickText(lang, "حالة المزود", "Provider")} : <b>${details.statusLabel}</b>`,
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

  const uiGame = {
    ...game,
    packages: game.packages.map((item) => ({
      ...item,
      priceRub: toRub(item.priceRub),
    })),
  };

  const text = buildPackagesText(lang, category, uiGame, user.balance);
  const keyboard = getGameTopupPackagesKeyboard(uiGame, category.key, Number(pageIndex) || 0, lang);
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
      units_ar: "ظ…ط®طµطµ",
      units_en: "Custom",
      priceRub: game.custom.unitPriceRub,
    });

  await sendOrEditMessage(
    bot,
    chatId,
    buildRequestInfoText(lang, game, packageItem),
    getGameTopupRequestInfoKeyboard(rowsData, `gt:g:${game.key}:${selection.categoryKey}:${selection.pageIndex}`, lang),
    options.messageId,
    "startGameTopupIdInput"
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
    await safeTelegramCall("gameTopup.invalidPrice", () => bot.sendMessage(msg.chat.id, pickText(lang, "â‌Œ ط³ط¹ط± ط§ظ„ط·ظ„ط¨ ط؛ظٹط± طµط§ظ„ط­.", "â‌Œ Invalid order price.")));
    return true;
  }

  if (user.balance < totalPrice) {
    await safeTelegramCall("gameTopup.insufficientBalance", () => bot.sendMessage(msg.chat.id, pickText(lang, "â‌Œ ط±طµظٹط¯ظƒ ط؛ظٹط± ظƒط§ظپظچ ظ„ط¥طھظ…ط§ظ… ط§ظ„ط·ظ„ط¨.", "â‌Œ Insufficient balance.")));
    return true;
  }

  const orderResult = await executeGameTopupOrder({
    game,
    playerId: payload.playerId,
    packageItem: payload.packageItem || null,
    quantity: payload.quantity || null,
  });

  if (!orderResult.success) {
    await safeTelegramCall("gameTopup.orderFailed", () => bot.sendMessage(msg.chat.id, pickText(lang, "â‌Œ طھط¹ط°ط± طھظ†ظپظٹط° ط§ظ„ط·ظ„ط¨ ظ…ظ† ط§ظ„ظ…ط²ظˆط¯ ط­ط§ظ„ظٹط§ظ‹.", "â‌Œ Provider could not process order now.")));
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
    ? pickText(lang, "طھظ… ط§ظ„ط¥ط±ط³ط§ظ„ ط¥ظ„ظ‰ ط§ظ„ظ…ط²ظˆط¯", "Submitted to provider")
    : pickText(lang, "طھظ… ط§ظ„ط­ط¬ط² ظ…ط­ظ„ظٹط§ظ‹ (ط¨ط¯ظˆظ† ظ…ط²ظˆط¯)", "Saved locally (provider disabled)");

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
            [{ text: pickText(lang, "ًںژ® ظ…طھط§ط¨ط¹ط© ط´ط­ظ† ط§ظ„ط£ظ„ط¹ط§ط¨", "ًںژ® Continue Game Top-up"), callback_data: "service:game_topup" }],
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

    if (["cancel", "ط¥ظ„ط؛ط§ط،", "ط§ظ„ط؛ط§ط،"].includes(text.toLowerCase())) {
      clearUserState(user.userId);
      await safeTelegramCall("gameTopup.cancel", () => bot.sendMessage(msg.chat.id, pickText(lang, "طھظ… ط¥ظ„ط؛ط§ط، ط§ظ„ط¹ظ…ظ„ظٹط©.", "Operation cancelled.")));
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
        totalPrice: toRub(packageItem.priceRub),
      });
    }

    if (!/^\d+$/.test(text)) {
      await safeTelegramCall("gameTopup.invalidAmountFormat", () =>
        bot.sendMessage(msg.chat.id, pickText(lang, "â‌Œ ط§ظ„ط±ط¬ط§ط، ط¥ط±ط³ط§ظ„ ط§ظ„ظƒظ…ظٹط© ط£ط±ظ‚ط§ظ… ظپظ‚ط·.", "â‌Œ Please send quantity as numbers only."))
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
            `â‌Œ ط§ظ„ظƒظ…ظٹط© ط®ط§ط±ط¬ ط§ظ„ظ†ط·ط§ظ‚ ط§ظ„ظ…ط³ظ…ظˆط­ (${game.custom.min} - ${game.custom.max}).`,
            `â‌Œ Quantity out of allowed range (${game.custom.min} - ${game.custom.max}).`
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


