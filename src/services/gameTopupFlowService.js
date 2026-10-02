const { sendOrEditMessage } = require("./profileService");
const { getUserLang } = require("../locales");
const { formatRuble, escapeHtml } = require("../utils/formatters");
const { rubToCurrency } = require("./currencyService");
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
const gameTopupOrdersInFlight = new Set();

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
  return `${Number(amount || 0).toFixed(2)} RUB`;
}

function buildCategoriesText(lang, user) {
  if (lang === "ar") {
    return topupCard(
      "♦️ ❨ أنــــواع الـشـحـــن ❩ ♦️",
      [
        "💡 اختر نوع الخدمة أو فئة الألعاب التي تريدها.",
        "💡 لكل نوع قائمة ألعاب وخيارات شحن مختلفة.",
        "💡 جميع الخدمات داخل هذا القسم تنفيذها فوري.",
      ],
      "⬇️ يرجى اختيار نوع الشحن من القائمة ⬇️"
    );
  }
  return topupCard(
    "♦️ ❨ TOP-UP TYPES ❩ ♦️",
    [
      "💡 Choose the service type or game category.",
      "💡 Each type has different games and packages.",
      "💡 All services in this section are instant execution.",
    ],
    "⬇️ Please choose a top-up type from the list ⬇️"
  );
}

function buildGamesText(lang, category, balance) {
  if (lang === "ar") {
    return topupCard(
      "♦️ ❨ اخـتـيـــار الـلـعـبـــة ❩ ♦️",
      [
        `🧩 النوع: <b>${escapeHtml(category.name_ar)}</b>`,
        "💡 تم عرض الألعاب المتاحة ضمن هذا النوع.",
        "💡 اختر اللعبة المطلوبة للانتقال إلى الباقات.",
      ],
      "⬇️ يرجى اختيار اللعبة من القائمة ⬇️"
    );
  }
  return topupCard(
    "♦️ ❨ SELECT GAME ❩ ♦️",
    [
      `🧩 Type: <b>${escapeHtml(category.name_en)}</b>`,
      "💡 Available games for this type are listed below.",
      "💡 Choose your game to continue to packages.",
    ],
    "⬇️ Please select a game from the list ⬇️"
  );
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

function buildRequestInfoRows(lang, payload) {
  const categoryLabel = payload.categoryLabel;
  const gameLabel = payload.gameLabel;
  if (payload.isCustom) {
    return [
      { left: categoryLabel, right: lang === "ar" ? "🧩 النوع" : "🧩 Type" },
      { left: gameLabel, right: lang === "ar" ? "🎮 اللعبة" : "🎮 Game" },
      { left: payload.unitLabel, right: lang === "ar" ? "🧪 الوحدة" : "🧪 Unit" },
      { left: payload.unitPrice, right: lang === "ar" ? "💰 سعر الوحدة" : "💰 Unit Price" },
    ];
  }

  return [
    { left: categoryLabel, right: lang === "ar" ? "🧩 النوع" : "🧩 Type" },
    { left: gameLabel, right: lang === "ar" ? "🎮 اللعبة" : "🎮 Game" },
    { left: payload.packageLabel, right: lang === "ar" ? "📦 الباقة" : "📦 Package" },
    { left: payload.packagePrice, right: lang === "ar" ? "💰 السعر" : "💰 Price" },
  ];
}

function buildInfoText(lang, game, packageItemRub) {
  const isCustom = !packageItemRub;
  if (lang === "ar") {
    return topupCard(
      "♦️ ❨ مـعـــرف الـلاعـــب ( I D ) ❩ ♦️",
      [
        isCustom
          ? "💡 تم تجهيز طلب الشحن المخصص بناءً على اختياراتك."
          : "💡 تم تجهيز بيانات الطلب بناءً على اختياراتك السابقة.",
        "💡 الجدول بالأسفل للعرض فقط وليس للاختيار.",
        "💡 تأكد من صحة الآيدي قبل الإرسال لتجنب الشحن الخاطئ.",
      ],
      "⬇️ يرجى إرسال الآيدي (ID) الخاص بك في رسالة ⬇️"
    );
  }

  return topupCard(
    "♦️ ❨ PLAYER I D ❩ ♦️",
    [
      isCustom
        ? "💡 Custom top-up request details are prepared."
        : "💡 Order details are prepared based on your previous selections.",
      "💡 The table below is display-only (not selectable).",
      "💡 Verify your ID carefully to avoid wrong top-up.",
    ],
    "⬇️ Please send your player ID in one message ⬇️"
  );
}

function buildCustomAmountPrompt(lang, game) {
  const unitPriceRub = toRub(game.custom.unitPriceUsd ?? game.custom.unitPriceRub);
  if (lang === "ar") {
    return topupCard(
      "♦️ ❨ الـشـحـــن الـمـخـصـــص ❩ ♦️",
      [
        "💡 لقد اخترت إدخال كمية الشحن يدوياً حسب رغبتك.",
        `💡 سعر الوحدة: <b>${unitPriceRub} RUB</b> | الحد الأدنى: <b>${game.custom.min}</b>.`,
        "💡 الرجاء إدخال أرقام صحيحة فقط (مثال: 500).",
      ],
      "⬇️ يرجى كتابة الكمية التي تريد شحنها وإرسالها الآن ⬇️"
    );
  }

  return topupCard(
    "♦️ ❨ CUSTOM TOP-UP ❩ ♦️",
    [
      "💡 You selected custom amount input.",
      `💡 Unit price: <b>${unitPriceRub} RUB</b> | Minimum: <b>${game.custom.min}</b>.`,
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
        `📦 الباقة: <b>${escapeHtml(details.packageLabel)}</b> | 💰 السعر: <b>${details.totalPrice} RUB</b>`,
        "💡 سيتم خصم الرصيد وتنفيذ الشحن فور التأكيد.",
      ],
      "⬇️ يرجى مراجعة بياناتك والضغط على تأكيد لإتمام الطلب ⬇️"
    );
  }

  return topupCard(
    "♦️ ❨ TOP-UP CONFIRMATION INVOICE ❩ ♦️",
    [
      `🎮 Game: <b>${details.gameName}</b> | 🆔 ID: <code>${escapeHtml(details.playerId)}</code>`,
      `📦 Package: <b>${escapeHtml(details.packageLabel)}</b> | 💰 Price: <b>${details.totalPrice} RUB</b>`,
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
    packages: game.packages.map((pkg) => ({ ...pkg, priceRub: toRub(pkg.priceUsd ?? pkg.priceRub) })),
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
    ? { ...rawPackage, priceRub: toRub(rawPackage.priceUsd ?? rawPackage.priceRub) }
    : null;

  const category = getCategoryByKey(catalog, selection.categoryKey || game.categoryKey);
  const rowsData = packageItemRub
    ? buildRequestInfoRows(lang, {
      isCustom: false,
      categoryLabel: lang === "ar" ? (category?.name_ar || "-") : (category?.name_en || "-"),
      gameLabel: `${game.emoji} ${gameName(lang, game)}`,
      packageLabel: lang === "ar" ? packageItemRub.units_ar : packageItemRub.units_en,
      packagePrice: priceRubLabel(packageItemRub.priceRub),
    })
    : buildRequestInfoRows(lang, {
      isCustom: true,
      categoryLabel: lang === "ar" ? (category?.name_ar || "-") : (category?.name_en || "-"),
      gameLabel: `${game.emoji} ${gameName(lang, game)}`,
      unitLabel: lang === "ar" ? game.custom.unitLabelAr : game.custom.unitLabelEn,
      unitPrice: priceRubLabel(toRub(game.custom.unitPriceUsd ?? game.custom.unitPriceRub)),
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
  const reply = text => safeTelegramCall('gameTopup.orderNotice', () => bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' }));
  const pendingNotice = id => reply(tr(lang,
    `⏳ طلب الشحن قيد التحقق من المزود. المبلغ محجوز ولم يتم إرجاعه لتجنب تكرار الشحن.\nرقم المتابعة: <code>${escapeHtml(id)}</code>\nتواصل مع الدعم قبل إنشاء طلب آخر: @Engineeer000`,
    `⏳ Your top-up is awaiting provider confirmation. The amount remains reserved to avoid a duplicate order.\nReference: <code>${escapeHtml(id)}</code>\nContact support before placing another order: @Engineeer000`));
  if (gameTopupOrdersInFlight.has(user.userId)) { await reply(tr(lang, '⏳ طلبك قيد التنفيذ. انتظر نتيجة الطلب قبل المحاولة مجدداً.', '⏳ Your order is processing. Wait for its result before retrying.')); return true; }
  gameTopupOrdersInFlight.add(user.userId);
  let reserved = null;
  try {
    const catalog = await getGameTopupCatalog();
    const game = getGameByKey(catalog, payload.gameKey);
    if (!game) { clearUserState(user.userId); await reply(tr(lang, '❌ اللعبة غير متاحة حالياً.', '❌ This game is currently unavailable.')); return true; }
    const totalPrice = Number(payload.totalPrice || 0);
    if (!Number.isFinite(totalPrice) || totalPrice <= 0 || !String(payload.playerId || '').trim()) {
      clearUserState(user.userId);
      await reply(tr(lang, '❌ بيانات الطلب أو سعره غير صالح.', '❌ Invalid order details or price.'));
      return true;
    }
    const duplicate = appStore.transactions.find(tx => tx.type === 'game_topup_order'
      && Number(tx.userId) === Number(user.userId) && ['pending', 'provider_unconfirmed'].includes(tx.status)
      && tx.gameKey === game.key && String(tx.playerId) === String(payload.playerId)
      && String(tx.packageLabel || '') === String(payload.packageLabel || '') && Number(tx.quantity || 0) === Number(payload.quantity || 0));
    if (duplicate) { clearUserState(user.userId); await pendingNotice(duplicate.id); return true; }
    reserved = appStore.reservePurchase(user.userId, totalPrice, {
      type: 'game_topup_order', serviceKey: 'game_topup', gameKey: game.key,
      gameNameAr: game.name_ar, gameNameEn: game.name_en, playerId: payload.playerId,
      packageLabel: payload.packageLabel, quantity: payload.quantity || null,
    });
    if (!reserved) { await reply(tr(lang, '❌ رصيد محفظتك المختارة غير كافٍ لإتمام الطلب.', '❌ Your selected wallet has insufficient balance.')); return true; }
    // The debit and pending ledger are persisted before making an external order.
    clearUserState(user.userId);
    let orderResult;
    try {
      orderResult = await executeGameTopupOrder({ game, playerId: payload.playerId, packageItem: payload.packageItem || null, quantity: payload.quantity || null });
    } catch (error) {
      logBotError('gameTopup.providerUnconfirmed', error, { userId: user.userId, transactionId: reserved.id });
      orderResult = { success: false, error: 'provider_unconfirmed' };
    }
    if (!orderResult?.success) {
      const ambiguous = !orderResult?.error || ['provider_unconfirmed', 'provider_error'].includes(orderResult.error);
      appStore.resolvePendingPurchase(reserved.id, { status: ambiguous ? 'provider_unconfirmed' : 'refunded', providerError: String(orderResult?.error || 'provider_unconfirmed') });
      if (ambiguous) await pendingNotice(reserved.id);
      else await reply(tr(lang, '❌ رفض المزود الطلب. تمت إعادة المبلغ إلى المحفظة التي خُصم منها.', '❌ The provider rejected this order. The amount was returned to the wallet charged.'));
      return true;
    }
    const settled = appStore.resolvePendingPurchase(reserved.id, {
      status: 'completed', providerOrderId: orderResult.orderId, provider: orderResult.provider, providerStatus: orderResult.status,
    });
    if (!settled) throw new Error('Game top-up reservation could not be finalized');
    try { appStore.addProfit(totalPrice); } catch (error) { logBotError('gameTopup.profit', error, { transactionId: reserved.id }); }
    await safeTelegramCall('gameTopup.orderSuccess', () => bot.sendMessage(msg.chat.id,
      buildExecutionInvoiceText(lang, {
        orderId: orderResult.orderId, gameName: `${game.emoji} ${gameName(lang, game)}`, playerId: payload.playerId,
        packageLabel: payload.packageLabel, totalPrice, providerStatus: tr(lang, 'تم الإرسال إلى المزود', 'Submitted to provider'),
      }), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: tr(lang, '🔙 رجوع', '🔙 Back'), callback_data: 'service:game_topup' }]] } }));
    return true;
  } catch (error) {
    logBotError('gameTopup.processOrder', error, { userId: user.userId, transactionId: reserved?.id });
    if (reserved) {
      // A persistence error after contacting the provider must never refund or retry.
      try { appStore.resolvePendingPurchase(reserved.id, { status: 'provider_unconfirmed' }); } catch (_) {}
      await pendingNotice(reserved.id);
    } else await reply(tr(lang, '❌ تعذر بدء الطلب الآن. لم يتم إرسال طلب إلى المزود.', '❌ Unable to start this order. No request was sent to the provider.'));
    return true;
  } finally { gameTopupOrdersInFlight.delete(user.userId); }
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
        totalPrice: toRub(packageItem.priceUsd ?? packageItem.priceRub),
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

    const totalPrice = Number((quantity * toRub(game.custom.unitPriceUsd ?? game.custom.unitPriceRub)).toFixed(2));
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
      await safeTelegramCall("gameTopup.confirm.missingState", () => bot.sendMessage(chatId,
        gameTopupOrdersInFlight.has(user.userId)
          ? tr(lang, "⏳ طلبك قيد التنفيذ. انتظر نتيجة الطلب قبل المحاولة مجدداً.", "⏳ Your order is processing. Wait for its result before retrying.")
          : tr(lang, "انتهت الجلسة. راجع سجل عملياتك قبل إنشاء طلب جديد.", "Session expired. Check your order history before starting again.")));
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
