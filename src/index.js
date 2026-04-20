require("dotenv").config();
const http = require("http");
const TelegramBot = require("node-telegram-bot-api");
const { BOT_TOKEN, ADMIN_CHANNEL_ID } = require("./config");
const { AppStore } = require("./services/appStore");
const { logBotError } = require("./services/errorLogger");
const { safeTelegramCall } = require("./services/telegramSafe");
const { isNetworkPermissionError } = require("./utils/network");
const { requestNumber, getSmsStatus, cancelNumber } = require("./services/grizzlyService");
const { getSmsProvider } = require("./constants/smsProviders");
const { t, getUserLang } = require("./locales");
const {
  fetchAndCachePrices,
  getCachedCountries,
  grizzlyCountries,
} = require("./services/grizzlyCacheService");
const { fetchAndCacheSmmServices } = require("./services/smmCacheService");
const {
  handleStart,
  handleLanguageSelection,
  handleCaptchaInput,
} = require("./handlers/startHandler");
const { handleAdminCommand } = require("./handlers/adminHandler");
const { handleTextMessage } = require("./handlers/messageHandler");
const { handleCallbackQuery } = require("./handlers/callbackHandler");
const { handleVirtualNumbersCallback } = require("./services/virtualNumbersFlowService");
const { handlePreCheckoutQuery, handleSuccessfulPayment } = require("./handlers/paymentHandler");
const { notifyTopupChannel, convertAssetAmountToRub } = require("./services/topupService");
const {
  setupBotCommands,
  handleMenuCommand,
  handleAccountCommand,
  handleAddFundsCommand,
  handleSupportCommand,
  handleSettingsCommand,
} = require("./services/commandService");

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing. Add it to your environment before starting the bot.");
}

const telegramProxyUrl = String(process.env.TELEGRAM_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim();
const telegramBaseApiUrl = String(process.env.TELEGRAM_BASE_API_URL || "").trim();
const botOptions = {
  polling: {
    autoStart: true,
    params: { timeout: 20 },
    interval: 800,
  },
  request: {
    forever: true,
  },
};
if (telegramProxyUrl) {
  botOptions.request.proxy = telegramProxyUrl;
}
if (telegramBaseApiUrl) {
  botOptions.baseApiUrl = telegramBaseApiUrl;
}

const bot = new TelegramBot(BOT_TOKEN, botOptions);
const appStore = new AppStore();
const appContext = {
  botUsername: "VaultX",
};
let pollingRestartTimer = null;
let pollingRestartDelayMs = 5000;

async function handleCryptoWebhookEvent(event) {
  const invoiceId = Number(event?.invoice_id);
  const status = String(event?.status || "").toLowerCase();
  if (!Number.isFinite(invoiceId) || status !== "paid") {
    return { ok: true, ignored: true };
  }

  const duplicate = appStore.transactions.find((tx) =>
    tx.type === "topup_crypto_paid" && Number(tx.cryptoInvoiceId) === invoiceId
  );
  if (duplicate) {
    return { ok: true, duplicate: true };
  }

  const payloadRaw = String(event?.payload || "");
  let payloadData = null;
  try {
    payloadData = JSON.parse(payloadRaw);
  } catch (_) {
    payloadData = null;
  }

  const payloadUserId = Number(payloadData?.user_id);
  const pendingTx = appStore.transactions.find((tx) =>
    tx.type === "topup_crypto_pending" && Number(tx.cryptoInvoiceId) === invoiceId
  );

  const userId = Number.isFinite(payloadUserId)
    ? payloadUserId
    : Number(pendingTx?.userId || 0);

  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error(`Webhook payload user_id missing for invoice ${invoiceId}`);
  }

  const paidAsset = String(event?.paid_asset || event?.asset || pendingTx?.cryptoAsset || "").toUpperCase();
  const paidAmountRaw = Number(event?.paid_amount || event?.amount || pendingTx?.cryptoAssetAmount || 0);

  if (!paidAsset || !Number.isFinite(paidAmountRaw) || paidAmountRaw <= 0) {
    throw new Error(`Invalid paid asset/amount for invoice ${invoiceId}`);
  }

  let creditedRub = 0;
  try {
    creditedRub = await convertAssetAmountToRub(paidAmountRaw, paidAsset);
  } catch (_) {
    creditedRub = Number(payloadData?.amount_rub || pendingTx?.amount || 0);
  }

  if (!Number.isFinite(creditedRub) || creditedRub <= 0) {
    throw new Error(`Invalid converted RUB amount for invoice ${invoiceId}`);
  }

  appStore.addBalance(userId, creditedRub);
  appStore.addDeposit(userId, creditedRub);
  const updatedUser = appStore.incrementTransactions(userId);

  appStore.addTransaction({
    type: "topup_crypto_paid",
    userId,
    amount: creditedRub,
    method: `Crypto Pay (${paidAsset})`,
    cryptoAsset: paidAsset,
    cryptoPaidAmount: paidAmountRaw,
    cryptoInvoiceId: invoiceId,
    serviceKey: "balance_topup",
    externalPayload: payloadRaw,
  });

  if (pendingTx && pendingTx.id) {
    appStore.updateTransactionById(pendingTx.id, {
      status: "paid",
      paidAt: new Date().toISOString(),
      paidAsset,
      paidAmount: paidAmountRaw,
      paidRub: creditedRub,
    });
  }

  const lang = getUserLang(updatedUser || appStore.findUserById(userId) || { language: "ar" });
  await safeTelegramCall("cryptoWebhook.notifyUser", () =>
    bot.sendMessage(
      userId,
      lang === "ar"
        ? `✅ تم شحن رصيدك بنجاح عبر Crypto Pay\n💰 المبلغ: ${creditedRub} RUB`
        : `✅ Your balance has been topped up via Crypto Pay\n💰 Amount: ${creditedRub} RUB`
    )
  );

  await notifyTopupChannel(bot, userId, creditedRub, lang, `Crypto Pay (${paidAsset})`);

  await safeTelegramCall("cryptoWebhook.notifyAdmin", () =>
    bot.sendMessage(
      ADMIN_CHANNEL_ID,
      [
        "<b>Crypto Top-up Success</b>",
        `User ID: <code>${userId}</code>`,
        `Invoice ID: <code>${invoiceId}</code>`,
        `Paid: ${paidAmountRaw} ${paidAsset}`,
        `Credited: ${creditedRub} RUB`,
      ].join("\n"),
      { parse_mode: "HTML", disable_notification: true }
    )
  );

  return { ok: true };
}

const renderPort = Number(process.env.PORT || 0);
if (Number.isFinite(renderPort) && renderPort > 0) {
  http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("I am alive");
        return;
      }

      if (req.method === "POST" && req.url === "/crypto-webhook") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > 2 * 1024 * 1024) {
            req.destroy();
          }
        });

        req.on("end", async () => {
          try {
            const parsed = body ? JSON.parse(body) : {};
            const event = parsed?.payload || parsed;
            const result = await handleCryptoWebhookEvent(event);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, ...result }));
          } catch (error) {
            logBotError("http.crypto_webhook", error, { body });
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "invalid webhook payload" }));
          }
        });
        return;
      }

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("OK");
    } catch (error) {
      logBotError("http.server", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    }
  }).listen(renderPort, "0.0.0.0", () => {
    console.log(`[web] health endpoint listening on :${renderPort}`);
  });
}

function buildVerifyUrl(serviceCode, number) {
  const normalizedNumber = String(number || "").replace(/[^\d+]/g, "");
  if (serviceCode === "tg") {
    return `https://t.me/+${normalizedNumber.replace(/^\+/, "")}`;
  }
  return `https://wa.me/${normalizedNumber.replace(/^\+/, "")}`;
}

function formatActivationDateTime(value) {
  const date = new Date(value);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy} | ${hh}:${min}`;
}

function getExpiryDateTime(value, minutes = 20) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  return formatActivationDateTime(date);
}

function buildAppDisplayName(lang, serviceCode) {
  const appMap = {
    wa: lang === "ar" ? "واتساب" : "WhatsApp",
    tg: lang === "ar" ? "تيليجرام" : "Telegram",
  };
  return appMap[serviceCode] || serviceCode;
}

function buildProviderDisplayName(providerKey) {
  return getSmsProvider(providerKey).name || providerKey;
}

function buildOrderReceipt(lang, { activationId, number, countryLabel, appDisplayName, providerName, finalPriceRub, createdAt, codeLabel }) {
  const lines = [
    `➖ ${t(lang, "virtualNumbers_receipt_activation")} : ${activationId} 🛎`,
    `➖ ${t(lang, "virtualNumbers_receipt_country")} : ${countryLabel} •`,
    `➖ ${t(lang, "virtualNumbers_receipt_number")} : <code>+${number}</code> ☎️•`,
    `➖ ${t(lang, "virtualNumbers_receipt_code")} : ${codeLabel}`,
    `➖ ${t(lang, "virtualNumbers_receipt_status")} : ${t(lang, "virtualNumbers_receipt_code_pending")} 🔎 •`,
    `➖ ${t(lang, "virtualNumbers_receipt_app")} : ${appDisplayName}`,
    `➖ ${t(lang, "virtualNumbers_receipt_provider")} : ${providerName} 🧭 •`,
    `➖ ${t(lang, "virtualNumbers_receipt_price")} : ₽ ${finalPriceRub} 🏷 •`,
    "",
    `➖ ${t(lang, "virtualNumbers_receipt_created")} : ${formatActivationDateTime(createdAt)}   📭•`,
    `➖ ${t(lang, "virtualNumbers_receipt_expires")} : ${getExpiryDateTime(createdAt)}  📫•`,
  ];
  return lines.join("\n");
}

function buildSmsReceivedText(lang, { number, code, password = t(lang, "virtualNumbers_sms_received_password") }) {
  return [`✅ ${t(lang, "virtualNumbers_sms_received_number")} : <code>+${number}</code>`,
    `💬 ${t(lang, "virtualNumbers_sms_received_code")} : <code>${code}</code>`,
    `🔐 ${t(lang, "virtualNumbers_sms_received_password")} : <code>${password}</code>`,
    "",
    t(lang, "virtualNumbers_copy_prompt"),
  ].join("\n");
}

// cache is managed by grizzlyCacheService and SMM cache service
fetchAndCachePrices();
fetchAndCacheSmmServices();
setInterval(fetchAndCachePrices, 24 * 60 * 60 * 1000);
setInterval(fetchAndCacheSmmServices, 24 * 60 * 60 * 1000);

bot.onText(/\/start(?:\s+(.+))?/, async (msg) => {
  try {
    appStore.incrementRequestCount();
    await handleStart(bot, msg, appStore);
  } catch (error) {
    logBotError("bot.onText.start", error, { userId: msg.from?.id });
  }
});

bot.onText(/\/menu/, async (msg) => {
  try {
    appStore.incrementRequestCount();
    await handleMenuCommand(bot, msg, appStore);
  } catch (error) {
    logBotError("bot.onText.menu", error, { userId: msg.from?.id });
  }
});

bot.onText(/\/account/, async (msg) => {
  try {
    appStore.incrementRequestCount();
    await handleAccountCommand(bot, msg, appStore);
  } catch (error) {
    logBotError("bot.onText.account", error, { userId: msg.from?.id });
  }
});

bot.onText(/\/addfunds/, async (msg) => {
  try {
    appStore.incrementRequestCount();
    await handleAddFundsCommand(bot, msg, appStore);
  } catch (error) {
    logBotError("bot.onText.addfunds", error, { userId: msg.from?.id });
  }
});

bot.onText(/\/support/, async (msg) => {
  try {
    appStore.incrementRequestCount();
    await handleSupportCommand(bot, msg, appStore);
  } catch (error) {
    logBotError("bot.onText.support", error, { userId: msg.from?.id });
  }
});

bot.onText(/\/settings/, async (msg) => {
  try {
    appStore.incrementRequestCount();
    await handleSettingsCommand(bot, msg, appStore);
  } catch (error) {
    logBotError("bot.onText.settings", error, { userId: msg.from?.id });
  }
});

bot.on("callback_query", async (query) => {
  try {
    appStore.incrementRequestCount();
    if (query.data && query.data.startsWith("setlang_")) {
      await handleLanguageSelection(bot, query, appStore);
      return;
    }

    const virtualNumbersHandled = await handleVirtualNumbersCallback(bot, query, appStore);
    if (virtualNumbersHandled) {
      return;
    }

    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    const user = appStore.getOrCreateUser(query.from);
    const lang = getUserLang(user);

    // Part A: display from daily cache for virtual numbers app item
    if (query.data && query.data.startsWith("menu_virtual_numbers_wa")) {
      const parts = query.data.split(":");
      const page = Math.max(0, Number(parts[1] ?? 0));

      const availableCountries = getCachedCountries("wa").filter((country) => Boolean(grizzlyCountries[country.countryId]));
      if (!Array.isArray(availableCountries) || availableCountries.length === 0) {
        await safeTelegramCall("callback_query.virtual_numbers.empty", () =>
          bot.answerCallbackQuery(query.id, { text: t(lang, "virtualNumbers_loading_prices"), show_alert: true })
        );
        return;
      }

      const pageSize = 36;
      const totalPages = Math.max(1, Math.ceil(availableCountries.length / pageSize));
      const currentPage = Math.min(page, totalPages - 1);
      const pageItems = availableCountries.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

      const keyboard = [];
      let currentRow = [];

      pageItems.forEach((country, index) => {
        const finalPriceRub = Number(country.priceRub ?? 0);

        const countryData = grizzlyCountries[country.countryId];
        const countryName = lang === "ar" ? countryData.name_ar : t(lang, `grizzly_country_${country.countryId}`) || countryData.name_ar;
        const buttonText = `₽${finalPriceRub} : ${countryData.flag} ${countryName} 🚀`;
        const callbackData = `buy_num_wa_${country.countryId}_${finalPriceRub}`;

        currentRow.push({ text: buttonText, callback_data: callbackData });

        if (currentRow.length === 2 || index === pageItems.length - 1) {
          keyboard.push(currentRow);
          currentRow = [];
        }
      });

      const paginationRow = [];
      if (currentPage > 0) {
        paginationRow.push({ text: t(lang, "common_previous"), callback_data: `menu_virtual_numbers_wa:${currentPage - 1}` });
      }
      if (currentPage < totalPages - 1) {
        paginationRow.push({ text: t(lang, "common_next"), callback_data: `menu_virtual_numbers_wa:${currentPage + 1}` });
      }
      if (paginationRow.length) keyboard.push(paginationRow);

      keyboard.push([{ text: t(lang, "common_back"), callback_data: "service:virtual_numbers" }]);

      await safeTelegramCall("callback_query.virtual_numbers.menu", () =>
        bot.editMessageText(
          `${t(lang, "virtualNumbers_choose_country_title")} (${t(lang, "virtualNumbers_page_counter").replace("{current}", String(currentPage + 1)).replace("{total}", String(totalPages))})`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
          }
        )
      );

      return;
    }

    // Part B: purchase action
    if (query.data && query.data.startsWith("buy_num_")) {
      const user = appStore.getOrCreateUser(query.from);
      const parts = query.data.split("_");
      const providerKey = parts.length >= 6 ? parts[2] : "server2";
      const serviceCode = parts.length >= 6 ? parts[3] : parts[2];
      const countryId = parts.length >= 6 ? parts[4] : parts[3];
      const priceRaw = parts.length >= 6 ? parts[5] : parts[4];
      const price = Number(priceRaw);

      await safeTelegramCall("callback_query.buy_num.toast", () =>
        bot.answerCallbackQuery(query.id, { text: t(lang, "virtualNumbers_buy_trying"), show_alert: false })
      );

      if (!Number.isFinite(price) || price <= 0) {
        await safeTelegramCall("callback_query.buy_num.invalid", () =>
          bot.sendMessage(chatId, t(lang, "virtualNumbers_invalid_price"))
        );
        return;
      }

      const currentUser = appStore.findUserById(user.userId);
      if (!currentUser || currentUser.balance < price) {
        await safeTelegramCall("callback_query.buy_num.insufficient", () =>
          bot.sendMessage(chatId, t(lang, "virtualNumbers_insufficient_balance"))
        );
        return;
      }

      const result = await requestNumber(serviceCode, countryId, providerKey);
      if (!result || /^(BAD_|ERROR)/i.test(result)) {
        await safeTelegramCall("callback_query.buy_num.failed", () =>
          bot.sendMessage(chatId, t(lang, "virtualNumbers_failed"))
        );
        return;
      }

      if (result === "NO_NUMBERS" || result === "NO_BALANCE") {
        await safeTelegramCall("callback_query.buy_num.known_failure", () =>
          bot.sendMessage(chatId, t(lang, "virtualNumbers_no_numbers_available"))
        );
        return;
      }

      if (!String(result).includes("ACCESS_NUMBER")) {
        await safeTelegramCall("callback_query.buy_num.unknown", () =>
          bot.sendMessage(chatId, t(lang, "virtualNumbers_api_error"))
        );
        return;
      }

      const [, activationId, number] = String(result).split(":");
      appStore.deductBalance(currentUser.userId, price);
      const countryMeta = grizzlyCountries[countryId] || { name_ar: "دولة أخرى", flag: "🌍" };
      const countryLabel = countryId === "random"
        ? t(lang, "virtualNumbers_country_random")
        : `${lang === "ar" ? countryMeta.name_ar : t(lang, `grizzly_country_${countryId}`) || countryMeta.name_ar} ${countryMeta.flag}`;
      const purchaseTx = appStore.addTransaction({
        type: "virtual_number_purchase",
        userId: currentUser.userId,
        amount: price,
        providerKey,
        serviceCode,
        countryId,
        activationId,
        number,
        countryLabel,
      });

      const serviceName = buildAppDisplayName(lang, serviceCode);
      const verifyUrl = buildVerifyUrl(serviceCode, number);
      const purchaseText = buildOrderReceipt(lang, {
        activationId,
        number,
        countryLabel: purchaseTx.countryLabel || `${countryMeta.name_ar} ${countryMeta.flag}`,
        appDisplayName: serviceName,
        providerName: buildProviderDisplayName(providerKey),
        finalPriceRub: price,
        createdAt: purchaseTx.createdAt,
        codeLabel: t(lang, "virtualNumbers_receipt_code_pending"),
      });

      await safeTelegramCall("callback_query.buy_num.success", () =>
        bot.editMessageText(purchaseText, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: t(lang, "virtualNumbers_change_number"), callback_data: `change_num_${providerKey}_${activationId}_${price}_${serviceCode}_${countryId}` }],
              [{ text: t(lang, "virtualNumbers_request_code"), callback_data: `checksms_${providerKey}_${activationId}` }],
              [{ text: t(lang, "virtualNumbers_verify_number"), url: verifyUrl }],
              [{ text: t(lang, "virtualNumbers_cancel_order"), callback_data: `cancelnum_${providerKey}_${activationId}_${price}` }],
            ],
          },
        })
      );

      return;
    }

    if (query.data && query.data.startsWith("change_num_")) {
      const user = appStore.getOrCreateUser(query.from);
      const [, , providerKey, activationId, priceRaw, serviceCode, countryId] = query.data.split("_");
      const price = Number(priceRaw);

      await cancelNumber(activationId, providerKey);
      if (Number.isFinite(price) && price > 0) {
        appStore.addBalance(user.userId, price);
        appStore.addTransaction({
          type: "virtual_number_refund",
          userId: user.userId,
          amount: price,
          providerKey,
          activationId,
        });
      }

      const currentUser = appStore.findUserById(user.userId);
      if (!currentUser || currentUser.balance < price) {
        await safeTelegramCall("callback_query.change_num.insufficient", () =>
          bot.sendMessage(chatId, t(lang, "virtualNumbers_change_number_error_balance"))
        );
        return;
      }

      const result = await requestNumber(serviceCode, countryId, providerKey);
      if (!result || /^(NO_|BAD_|ERROR)/i.test(result) || !String(result).includes("ACCESS_NUMBER")) {
        await safeTelegramCall("callback_query.change_num.failed", () =>
          bot.sendMessage(chatId, t(lang, "virtualNumbers_change_number_failed"))
        );
        return;
      }

      const [, newActivationId, number] = String(result).split(":");
      appStore.deductBalance(currentUser.userId, price);
      const countryMeta = grizzlyCountries[countryId] || { name_ar: "دولة أخرى", flag: "🌍" };
      const purchaseTx = appStore.addTransaction({
        type: "virtual_number_purchase",
        userId: currentUser.userId,
        amount: price,
        providerKey,
        serviceCode,
        countryId,
        activationId: newActivationId,
        number,
        countryLabel: `${lang === "ar" ? countryMeta.name_ar : t(lang, `grizzly_country_${countryId}`) || countryMeta.name_ar} ${countryMeta.flag}`,
      });

      const verifyUrl = buildVerifyUrl(serviceCode, number);
      const purchaseText = buildOrderReceipt(lang, {
        activationId: newActivationId,
        number,
        countryLabel: purchaseTx.countryLabel,
        appDisplayName: buildAppDisplayName(lang, serviceCode),
        providerName: buildProviderDisplayName(providerKey),
        finalPriceRub: price,
        createdAt: purchaseTx.createdAt,
        codeLabel: t(lang, "virtualNumbers_receipt_code_pending"),
      });

      await safeTelegramCall("callback_query.change_num.success", () =>
        bot.editMessageText(purchaseText, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: t(lang, "virtualNumbers_change_number"), callback_data: `change_num_${providerKey}_${newActivationId}_${price}_${serviceCode}_${countryId}` }],
              [{ text: t(lang, "virtualNumbers_request_code"), callback_data: `checksms_${providerKey}_${newActivationId}` }],
              [{ text: t(lang, "virtualNumbers_verify_number"), url: verifyUrl }],
              [{ text: t(lang, "virtualNumbers_cancel_order"), callback_data: `cancelnum_${providerKey}_${newActivationId}_${price}` }],
            ],
          },
        })
      );
      return;
    }

    // Part C: checksms and cancelnum handlers
    if (query.data && query.data.startsWith("checksms_")) {
      const parts = query.data.split("_");
      const providerKey = parts.length >= 3 ? parts[1] : "server2";
      const activationId = parts.length >= 3 ? parts[2] : parts[1];
      const status = await getSmsStatus(activationId, providerKey);

      if (!status || status.startsWith("STATUS_WAIT_CODE")) {
        await safeTelegramCall("callback_query.checksms.wait", () =>
          bot.answerCallbackQuery(query.id, { text: t(lang, "virtualNumbers_waiting_code"), show_alert: true })
        );
        return;
      }

      if (status.startsWith("STATUS_OK")) {
        const code = status.split(":")[1] || "";
        const purchaseTx = appStore.getLatestTransactionByActivationId(activationId);
        const serviceCode = purchaseTx?.serviceCode || "wa";
        const verifyUrl = buildVerifyUrl(serviceCode, purchaseTx?.number || "");
        const newText = buildSmsReceivedText(lang, {
          number: String(purchaseTx?.number || ""),
          code: String(code),
        });

        await safeTelegramCall("callback_query.checksms.ok", () =>
          bot.editMessageText(newText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: t(lang, "virtualNumbers_verify_number"), url: verifyUrl }],
              ],
            },
          })
        );
        return;
      }

      await safeTelegramCall("callback_query.checksms.unknown", () =>
        bot.answerCallbackQuery(query.id, { text: t(lang, "virtualNumbers_status_unknown"), show_alert: true })
      );
      return;
    }

    if (query.data && query.data.startsWith("cancelnum_")) {
      const user = appStore.getOrCreateUser(query.from);
      const parts = query.data.split("_");
      const providerKey = parts.length >= 4 ? parts[1] : "server2";
      const activationId = parts.length >= 4 ? parts[2] : parts[1];
      const priceRaw = parts.length >= 4 ? parts[3] : parts[2];
      const price = Number(priceRaw);

      await cancelNumber(activationId, providerKey);
      if (Number.isFinite(price) && price > 0) {
        appStore.addBalance(user.userId, price);
        appStore.addTransaction({
          type: "virtual_number_refund",
          userId: user.userId,
          amount: price,
          providerKey,
          activationId,
        });
      }

      await safeTelegramCall("callback_query.cancelnum.done", () =>
        bot.editMessageText(t(lang, "virtualNumbers_cancelled_refund").replace("{price}", String(price)), {
          chat_id: chatId,
          message_id: messageId,
        })
      );
      return;
    }

    await handleCallbackQuery(bot, query, appStore, appContext);
  } catch (error) {
    logBotError("bot.on.callback_query", error, { userId: query.from?.id, data: query.data });
    await safeTelegramCall("bot.on.callback_query.alert", () =>
      bot.answerCallbackQuery(query.id, {
        text: "حدث خطأ أثناء تنفيذ الطلب.",
        show_alert: true,
      })
    );
  }
});

bot.on("pre_checkout_query", async (query) => {
  try {
    appStore.incrementRequestCount();
    await handlePreCheckoutQuery(bot, query);
  } catch (error) {
    logBotError("bot.on.pre_checkout_query", error, { userId: query.from?.id });
  }
});

bot.on("message", async (msg) => {
  try {
    appStore.incrementRequestCount();
    const paymentHandled = await handleSuccessfulPayment(bot, msg, appStore);
    if (paymentHandled) {
      return;
    }

    if (!msg.text) {
      return;
    }

    if (msg.text.startsWith("/start")) {
      return;
    }

    const captchaHandled = await handleCaptchaInput(bot, msg, appStore);
    if (captchaHandled) {
      return;
    }

    const adminHandled = await handleAdminCommand(bot, msg, appStore);
    if (adminHandled) {
      return;
    }

    await handleTextMessage(bot, msg, appStore);
  } catch (error) {
    logBotError("bot.on.message", error, { userId: msg.from?.id });
    await safeTelegramCall("bot.on.message.reply", () =>
      bot.sendMessage(msg.chat.id, "حدث خطأ أثناء معالجة الطلب.")
    );
  }
});

bot.on("polling_error", (error) => {
  try {
    logBotError("polling_error", error);
    if (isNetworkPermissionError(error)) {
      if (!pollingRestartTimer) {
        pollingRestartTimer = setTimeout(async () => {
          pollingRestartTimer = null;
          try {
            await bot.stopPolling({ cancel: false });
          } catch (_) {}
          try {
            await bot.startPolling();
            pollingRestartDelayMs = 5000;
          } catch (restartError) {
            logBotError("polling_restart", restartError);
            pollingRestartDelayMs = Math.min(pollingRestartDelayMs * 2, 60000);
          }
        }, pollingRestartDelayMs);
      }
    }
  } catch (innerError) {
    console.error("Fatal polling logger failure:", innerError.message);
  }
});

async function bootstrap() {
  try {
    const botInfo = await bot.getMe();
    appContext.botUsername = botInfo.username;
    await setupBotCommands(bot);
    console.log(`Telegram bot is running as @${botInfo.username}`);
    if (telegramProxyUrl) {
      console.log("[telegram] proxy is enabled");
    }
    if (telegramBaseApiUrl) {
      console.log(`[telegram] custom base API URL: ${telegramBaseApiUrl}`);
    }
  } catch (error) {
    logBotError("bootstrap", error);
    console.log("Telegram bot is running...");
  }
}

bootstrap();

console.log("🤖 VaultX Bot is running and Grizzly cache is loaded...");
