const { sendOrEditMessage } = require("./profileService");
const { getUserLang } = require("../locales");
const { formatRuble, escapeHtml } = require("../utils/formatters");
const { getUserState, setUserState, clearUserState } = require("./stateStore");
const { logBotError } = require("./errorLogger");
const { safeTelegramCall } = require("./telegramSafe");
const { buildVaultxServiceCard } = require("../utils/serviceHeroCards");
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
const FRAME = "━━━━━━━━━━━━━━━━━━━";

function topupCard(title, lines, footer) {
  return [
    "💠  𝐕 𝐀 𝐔 𝐋 𝐓 - 𝐗  💠",
    FRAME,
    title,
    ...lines,
    FRAME,
    footer,
  ].join("\n");
}

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
  return `${Number(amount || 0).toFixed(2)} â‚½`;
}

function buildCategoriesText(lang, user) {
  return buildVaultxServiceCard(lang, "game_topup");
}

function buildGamesText(lang, category, balance) {
  return [
    tr(lang, "âœ… <b>ط§ط®طھط± ط§ظ„ظ„ط¹ط¨ط©</b>", "âœ… <b>Select a game</b>"),
    "",
    `${tr(lang, "ًں“‚ ط§ظ„ظ‚ط³ظ…", "ًں“‚ Category")} : <b>${escapeHtml(lang === "en" ? category.name_en : category.name_ar)}</b>`,
    `${tr(lang, "ًں’° ط±طµظٹط¯ظƒ", "ًں’° Your balance")} : <b>${formatRuble(balance)}</b>`,
  ].join("\n");
}

function buildPackagesText(lang, category, game, balance) {
  if (lang === "ar") {
    return topupCard(
      "♦️ ❨ بـاقـــات الـشـحـــن والأسـعـــار ❩ ♦️",
      [
        `🎮 اللعبة: <b>${game.emoji} ${escapeHtml(gameName(lang, game))}</b>`,
        "💡 تتوفر باقات ثابتة بأسعار مخفضة ومنافسة جداً.",
        "💡 يمكنك اختيار (شحن مخصص) لتحديد كمية معينة.",
        "💡 جميع الأسعار شاملة رسوم التحويل والتنفيذ.",
      ],
      "⬇️ يرجى تحديد الباقة أو كمية الشحن المطلوبة ⬇️"
    );
  }

  return topupCard(
    "♦️ ❨ TOP-UP PACKAGES & PRICES ❩ ♦️",
    [
      `🎮 Game: <b>${game.emoji} ${escapeHtml(gameName(lang, game))}</b>`,
      "💡 Fixed discounted packages are available.",
      "💡 You can pick Custom Top-up for a specific quantity.",
      "💡 All prices include transfer and execution fees.",
    ],
    "⬇️ Please select a package or custom top-up amount ⬇️"
  );
}

function buildFixedInfoRows(lang, packageItemRub) {
  return [
    {
      left: lang === "ar" ? packageItemRub.units_ar : packageItemRub.units_en,
      right: tr(lang, "ًںŒگ ط§ظ„ظپط¦ط©", "ًںŒگ Package"),
    },
    {
      left: priceRubLabel(packageItemRub.priceRub),
      right: tr(lang, "ًں’° ط§ظ„ط³ط¹ط±", "ًں’° Price"),
    },
    {
      left: tr(lang, "طھظ„ظ‚ط§ط¦ظٹ", "Automatic"),
      right: tr(lang, "ًںŒں ظ†ظˆط¹ ط§ظ„ط´ط­ظ†", "ًںŒں Top-up Type"),
    },
    {
      left: tr(lang, "ط®ظ„ط§ظ„ 4 ط³ط§ط¹ط§طھ", "Within 4 hours"),
      right: tr(lang, "âڈ° ظˆظ‚طھ ط§ظ„ط´ط­ظ†", "âڈ° Delivery Time"),
    },
  ];
}

function buildInfoText(lang, game, packageItemRub) {
  if (lang === "ar") {
    return topupCard(
      "♦️ ❨ مـعـــرف الـلاعـــب ( I D ) ❩ ♦️",
      [
        "💡 يرجى التأكد من نسخ المعرف (ID) بشكل صحيح.",
        "💡 الشحن يتم عبر الآيدي فقط، ولا نطلب كلمة المرور.",
        "💡 خطأ في إدخال الآيدي قد يؤدي لشحن حساب آخر!",
      ],
      "⬇️ يرجى إرسال الآيدي (ID) الخاص بك في رسالة ⬇️"
    );
  }

  return topupCard(
    "♦️ ❨ PLAYER I D ❩ ♦️",
    [
      "💡 Make sure your player ID is copied correctly.",
      "💡 Top-up is done by ID only, no password is required.",
      "💡 Wrong ID may charge another account.",
    ],
    "⬇️ Please send your player ID in one message ⬇️"
  );
}

function buildCustomAmountPrompt(lang, game) {
  const unitPriceRub = toRub(game.custom.unitPriceRub);
  if (lang === "ar") {
    return topupCard(
      "♦️ ❨ الـشـحـــن الـمـخـصـــص ❩ ♦️",
      [
        "💡 لقد اخترت إدخال كمية الشحن يدوياً حسب رغبتك.",
        `💡 سعر الوحدة: <b>${unitPriceRub}$</b> | الحد الأدنى: <b>${game.custom.min}</b>.`,
        "💡 الرجاء إدخال أرقام صحيحة فقط (مثال: 500).",
      ],
      "⬇️ يرجى كتابة الكمية التي تريد شحنها وإرسالها الآن ⬇️"
    );
  }

  return topupCard(
    "♦️ ❨ CUSTOM TOP-UP ❩ ♦️",
    [
      "💡 You selected custom amount input.",
      `💡 Unit price: <b>${unitPriceRub}$</b> | Minimum: <b>${game.custom.min}</b>.`,
      "💡 Please send numbers only (example: 500).",
    ],
    "⬇️ Please type your desired amount and send it now ⬇️"
  );
}

function buildConfirmationInvoiceText(lang, details) {
  if (lang === "ar") {
    return topupCard(
      "♦️ ❨ فـاتـــورة تـأكـيـــد الـشـحـــن ❩ ♦️",
      [
        `🎮 اللعبة: <b>${details.gameName}</b> | 🆔 الآيدي: <code>${escapeHtml(details.playerId)}</code>`,
        `📦 الباقة: <b>${escapeHtml(details.packageLabel)}</b> | 💰 السعر: <b>${details.totalPrice}$</b>`,
        "💡 سيتم خصم الرصيد وتنفيذ الشحن فور التأكيد.",
      ],
      "⬇️ يرجى مراجعة بياناتك والضغط على تأكيد لإتمام الطلب ⬇️"
    );
  }

  return topupCard(
    "♦️ ❨ TOP-UP CONFIRMATION INVOICE ❩ ♦️",
    [
      `🎮 Game: <b>${details.gameName}</b> | 🆔 ID: <code>${escapeHtml(details.playerId)}</code>`,
      `📦 Package: <b>${escapeHtml(details.packageLabel)}</b> | 💰 Price: <b>${details.totalPrice}$</b>`,
      "💡 Balance will be deducted and order starts after confirmation.",
    ],
    "⬇️ Please review and press Confirm to place your order ⬇️"
  );
}

function buildExecutionInvoiceText(lang, details) {
  const done = tr(lang, "✅ تم التنفيذ", "✅ Completed");
  return [
    tr(lang, "🧾 فاتورة تنفيذ العملية", "🧾 Execution Invoice"),
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

async function sendTopupConfirmationInvoice(bot, chatId, user, payload, options = {}) {
  const lang = getUserLang(user);
  setUserState(user.userId, "GAME_TOPUP_READY_CONFIRM", payload);

  return sendOrEditMessage(
    bot,
    chatId,
    buildConfirmationInvoiceText(lang, {
      gameName: `${payload.gameEmoji || "🎮"} ${payload.gameName}`,
      playerId: payload.playerId,
      packageLabel: payload.packageLabel,
      totalPrice: Number(payload.totalPrice || 0).toFixed(2),
    }),
    {
      inline_keyboard: [
        [{ text: tr(lang, "✅ تأكيد الطلب", "✅ Confirm Order"), callback_data: "gt:confirm" }],
        [{ text: tr(lang, "❌ إلغاء", "❌ Cancel"), callback_data: "gt:cancel" }],
      ],
    },
    options.messageId,
    "sendTopupConfirmationInvoice"
  );
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
      units_ar: "ظ…ط®طµطµ",
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
      bot.sendMessage(msg.chat.id, tr(lang, "â‌Œ ط³ط¹ط± ط§ظ„ط·ظ„ط¨ ط؛ظٹط± طµط§ظ„ط­.", "â‌Œ Invalid order price."))
    );
    return true;
  }

  if (user.balance < totalPrice) {
    await safeTelegramCall("gameTopup.insufficientBalance", () =>
      bot.sendMessage(msg.chat.id, tr(lang, "â‌Œ ط±طµظٹط¯ظƒ ط؛ظٹط± ظƒط§ظپظچ ظ„ط¥طھظ…ط§ظ… ط§ظ„ط·ظ„ط¨.", "â‌Œ Insufficient balance."))
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
      bot.sendMessage(msg.chat.id, tr(lang, "â‌Œ طھط¹ط°ط± طھظ†ظپظٹط° ط§ظ„ط·ظ„ط¨ ظ…ظ† ط§ظ„ظ…ط²ظˆط¯ ط­ط§ظ„ظٹط§ظ‹.", "â‌Œ Provider could not process order now."))
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
    ? tr(lang, "طھظ… ط§ظ„ط¥ط±ط³ط§ظ„ ط¥ظ„ظ‰ ط§ظ„ظ…ط²ظˆط¯", "Submitted to provider")
    : tr(lang, "طھظ… ط§ظ„ط­ط¬ط² ظ…ط­ظ„ظٹط§ظ‹ (ط¨ط¯ظˆظ† ظ…ط²ظˆط¯)", "Saved locally (provider disabled)");

  await safeTelegramCall("gameTopup.orderSuccess", () =>
    bot.sendMessage(
      msg.chat.id,
      buildExecutionInvoiceText(lang, {
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
            [{ text: tr(lang, "ط±ط¬ظˆط¹", "Back"), callback_data: "service:game_topup" }],
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
      await safeTelegramCall("gameTopup.cancel", () =>
        bot.sendMessage(msg.chat.id, tr(lang, "طھظ… ط¥ظ„ط؛ط§ط، ط§ظ„ط¹ظ…ظ„ظٹط©.", "Operation cancelled."))
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

      await sendTopupConfirmationInvoice(bot, msg.chat.id, user, {
        gameKey: game.key,
        gameName: gameName(lang, game),
        gameEmoji: game.emoji,
        playerId: text,
        packageItem,
        quantity: 1,
        packageLabel: lang === "ar" ? packageItem.units_ar : packageItem.units_en,
        totalPrice: toRub(packageItem.priceRub),
      });
      return true;
    }

    if (!/^\d+$/.test(text)) {
      await safeTelegramCall("gameTopup.invalidAmountFormat", () =>
        bot.sendMessage(msg.chat.id, tr(lang, "â‌Œ ط§ظ„ط±ط¬ط§ط، ط¥ط±ط³ط§ظ„ ط§ظ„ظƒظ…ظٹط© ط£ط±ظ‚ط§ظ… ظپظ‚ط·.", "â‌Œ Please send quantity as numbers only."))
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
            `â‌Œ ط§ظ„ظƒظ…ظٹط© ط®ط§ط±ط¬ ط§ظ„ظ†ط·ط§ظ‚ ط§ظ„ظ…ط³ظ…ظˆط­ (${game.custom.min} - ${game.custom.max}).`,
            `â‌Œ Quantity out of allowed range (${game.custom.min} - ${game.custom.max}).`
          )
        )
      );
      return true;
    }

    const totalPrice = Number((quantity * toRub(game.custom.unitPriceRub)).toFixed(2));
    const unitLabel = lang === "ar" ? game.custom.unitLabelAr : game.custom.unitLabelEn;
    await sendTopupConfirmationInvoice(bot, msg.chat.id, user, {
      gameKey: game.key,
      gameName: gameName(lang, game),
      gameEmoji: game.emoji,
      playerId: state.playerId,
      quantity,
      packageLabel: `${quantity} ${unitLabel}`,
      totalPrice,
    });
    return true;
  } catch (error) {
    logBotError("handleGameTopupTextInput", error, { userId: msg.from?.id });
    return false;
  }
}

async function handleGameTopupCallback(bot, query, appStore) {
  try {
    const data = String(query.data || "");
    if (data !== "gt:confirm" && data !== "gt:cancel") {
      return false;
    }

    await safeTelegramCall("gameTopup.callback.answer", () => bot.answerCallbackQuery(query.id));

    const user = appStore.getOrCreateUser(query.from);
    const lang = getUserLang(user);
    const state = getUserState(user.userId);
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    if (data === "gt:cancel") {
      clearUserState(user.userId);
      await sendOrEditMessage(
        bot,
        chatId,
        tr(lang, "❌ تم إلغاء الطلب.", "❌ Order canceled."),
        { inline_keyboard: [[{ text: tr(lang, "🔙 رجوع", "🔙 Back"), callback_data: "service:game_topup" }]] },
        messageId,
        "gameTopup.cancelByCallback"
      );
      return true;
    }

    if (!state || state.name !== "GAME_TOPUP_READY_CONFIRM") {
      await safeTelegramCall("gameTopup.confirm.missingState", () =>
        bot.answerCallbackQuery(query.id, {
          text: tr(lang, "انتهت الجلسة، ابدأ من جديد.", "Session expired, start again."),
          show_alert: true,
        })
      );
      return true;
    }

    const msg = { ...query.message, from: query.from, text: "" };
    return processTopupOrder(bot, msg, appStore, state);
  } catch (error) {
    logBotError("handleGameTopupCallback", error, { userId: query.from?.id, data: query.data });
    return true;
  }
}

module.exports = {
  sendGameTopupCategoriesMenu,
  sendGameTopupGamesMenu,
  sendGameTopupPackagesMenu,
  startGameTopupIdInput,
  handleGameTopupTextInput,
  handleGameTopupCallback,
  isGameTopupProviderConfigured: isProviderConfigured,
};



