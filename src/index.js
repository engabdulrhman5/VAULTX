require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { BOT_TOKEN } = require("./config");
const { AppStore } = require("./services/appStore");
const { logBotError } = require("./services/errorLogger");
const { safeTelegramCall } = require("./services/telegramSafe");
const { requestNumber, getSmsStatus, cancelNumber } = require("./services/grizzlyService");
const { getSmsProvider } = require("./constants/smsProviders");
const {
  fetchAndCachePrices,
  getCachedCountries,
  grizzlyCountries,
} = require("./services/grizzlyCacheService");
const {
  handleStart,
  handleLanguageSelection,
  handleCaptchaInput,
} = require("./handlers/startHandler");
const { handleAdminCommand } = require("./handlers/adminHandler");
const { handleTextMessage } = require("./handlers/messageHandler");
const { handleCallbackQuery } = require("./handlers/callbackHandler");
const { handlePreCheckoutQuery, handleSuccessfulPayment } = require("./handlers/paymentHandler");
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

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const appStore = new AppStore();
const appContext = {
  botUsername: "VaultX",
};

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

function buildAppDisplayName(serviceCode) {
  const appMap = {
    wa: "واتس اب -𝗪𝗛𝗔𝗧𝗦𝗔𝗣𝗣🛍 🎛 •",
    tg: "تيليجرام -𝗧𝗘𝗟𝗘𝗚𝗥𝗔𝗠🛍 🎛 •",
  };
  return appMap[serviceCode] || `${serviceCode} 🛍 🎛 •`;
}

function buildProviderDisplayName(providerKey) {
  return getSmsProvider(providerKey).name || providerKey;
}

function buildOrderReceipt({ activationId, number, countryLabel, appDisplayName, providerName, finalPriceRub, createdAt, codeLabel }) {
  return `➖ رقم الطلب : ${activationId} 🛎\n➖ الدولة : ${countryLabel} •\n➖ الرقم : <code>+${number}</code> ☎️•\n➖ الكود : ${codeLabel}\n➖ الحالة : RECEIVED ... 🔎 •\n➖ التطبيق : ${appDisplayName}\n➖ السرفر : ${providerName} 🧭 •\n➖ السعر : ₽ ${finalPriceRub} 🏷 •\n\n➖ انشاء : ${formatActivationDateTime(createdAt)}   📭•\n➖ انتهاء : ${getExpiryDateTime(createdAt)}  📫•`;
}

function buildSmsReceivedText({ number, code, password = "غير متاح" }) {
  return `✅ 𝐍𝗨𝐌𝐁𝐄𝐑 : <code>+${number}</code>\n💬 𝐂𝐎𝐃𝐄 : <code>${code}</code>\n🔐 𝐏𝐀𝐒𝐒𝐖𝐎𝐑𝐃 : <code>${password}</code>\n\n🌴 اضغط على الكود أو الرقم للنسخ 😌🌸`;
}

// cache is managed by grizzlyCacheService
fetchAndCachePrices();
setInterval(fetchAndCachePrices, 24 * 60 * 60 * 1000);

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

    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;

    // Part A: display from daily cache for virtual numbers app item
    if (query.data && query.data.startsWith("menu_virtual_numbers_wa")) {
      const parts = query.data.split(":");
      const page = Math.max(0, Number(parts[1] ?? 0));

      const availableCountries = getCachedCountries("wa").filter((country) => Boolean(grizzlyCountries[country.countryId]));
      if (!Array.isArray(availableCountries) || availableCountries.length === 0) {
        await safeTelegramCall("callback_query.virtual_numbers.empty", () =>
          bot.answerCallbackQuery(query.id, { text: "⏳ لم يتم تحميل الأسعار بعد. حاول مرة أخرى بعد قليل", show_alert: true })
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
        const buttonText = `₽${finalPriceRub} : ${countryData.flag} ${countryData.name_ar} 🚀`;
        const callbackData = `buy_num_wa_${country.countryId}_${finalPriceRub}`;

        currentRow.push({ text: buttonText, callback_data: callbackData });

        if (currentRow.length === 2 || index === pageItems.length - 1) {
          keyboard.push(currentRow);
          currentRow = [];
        }
      });

      const paginationRow = [];
      if (currentPage > 0) {
        paginationRow.push({ text: "⬅️ السابق", callback_data: `menu_virtual_numbers_wa:${currentPage - 1}` });
      }
      if (currentPage < totalPages - 1) {
        paginationRow.push({ text: "التالي ➡️", callback_data: `menu_virtual_numbers_wa:${currentPage + 1}` });
      }
      if (paginationRow.length) keyboard.push(paginationRow);

      keyboard.push([{ text: "🔙 العودة", callback_data: "service:virtual_numbers" }]);

      await safeTelegramCall("callback_query.virtual_numbers.menu", () =>
        bot.editMessageText(`اختر الدولة لشراء رقم افتراضي من Grizzly (صفحة ${currentPage + 1}/${totalPages})`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: keyboard },
        })
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
        bot.answerCallbackQuery(query.id, { text: "⏳ Trying to buy... جاري محاولة الشراء", show_alert: false })
      );

      if (!Number.isFinite(price) || price <= 0) {
        await safeTelegramCall("callback_query.buy_num.invalid", () =>
          bot.sendMessage(chatId, "سعر غير صالح. حاول مرة أخرى.")
        );
        return;
      }

      const currentUser = appStore.findUserById(user.userId);
      if (!currentUser || currentUser.balance < price) {
        await safeTelegramCall("callback_query.buy_num.insufficient", () =>
          bot.sendMessage(chatId, "رصيدك غير كافٍ لطلب الرقم.")
        );
        return;
      }

      const result = await requestNumber(serviceCode, countryId, providerKey);
      if (!result || /^(BAD_|ERROR)/i.test(result)) {
        await safeTelegramCall("callback_query.buy_num.failed", () =>
          bot.sendMessage(chatId, "عذراً، لم نتمكن من الحصول على رقم الآن. حاول لاحقاً.")
        );
        return;
      }

      if (result === "NO_NUMBERS" || result === "NO_BALANCE") {
        await safeTelegramCall("callback_query.buy_num.known_failure", () =>
          bot.sendMessage(chatId, "لا يوجد أرقام متاحة لهذه الدولة حالياً.")
        );
        return;
      }

      if (!String(result).includes("ACCESS_NUMBER")) {
        await safeTelegramCall("callback_query.buy_num.unknown", () =>
          bot.sendMessage(chatId, "حدث خطأ في استجابة Grizzly، الرجاء المحاولة مرة أخرى.")
        );
        return;
      }

      const [, activationId, number] = String(result).split(":");
      appStore.deductBalance(currentUser.userId, price);
      const countryMeta = grizzlyCountries[countryId] || { name_ar: "دولة أخرى", flag: "🌍" };
      const countryLabel = countryId === "random"
        ? "عشوائي 🎲"
        : `${countryMeta.name_ar} ${countryMeta.flag}`;
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

      const serviceName = buildAppDisplayName(serviceCode);
      const verifyUrl = buildVerifyUrl(serviceCode, number);
      const purchaseText = buildOrderReceipt({
        activationId,
        number,
        countryLabel: purchaseTx.countryLabel || `${countryMeta.name_ar} ${countryMeta.flag}`,
        appDisplayName: serviceName,
        providerName: buildProviderDisplayName(providerKey),
        finalPriceRub: price,
        createdAt: purchaseTx.createdAt,
        codeLabel: "قيد الانتظار 📩",
      });

      await safeTelegramCall("callback_query.buy_num.success", () =>
        bot.editMessageText(purchaseText, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "تغيير الرقم", callback_data: `change_num_${providerKey}_${activationId}_${price}_${serviceCode}_${countryId}` }],
              [{ text: "طلب الكود", callback_data: `checksms_${providerKey}_${activationId}` }],
              [{ text: "التحقق من الرقم 💬", url: verifyUrl }],
              [{ text: "إلغاء الطلب", callback_data: `cancelnum_${providerKey}_${activationId}_${price}` }],
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
          bot.sendMessage(chatId, "لا يمكن تغيير الرقم حالياً بسبب الرصيد.")
        );
        return;
      }

      const result = await requestNumber(serviceCode, countryId, providerKey);
      if (!result || /^(NO_|BAD_|ERROR)/i.test(result) || !String(result).includes("ACCESS_NUMBER")) {
        await safeTelegramCall("callback_query.change_num.failed", () =>
          bot.sendMessage(chatId, "تعذر تغيير الرقم حالياً، تم استرجاع الرصيد.")
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
        countryLabel: `${countryMeta.name_ar} ${countryMeta.flag}`,
      });

      const verifyUrl = buildVerifyUrl(serviceCode, number);
      const purchaseText = buildOrderReceipt({
        activationId: newActivationId,
        number,
        countryLabel: purchaseTx.countryLabel,
        appDisplayName: buildAppDisplayName(serviceCode),
        providerName: buildProviderDisplayName(providerKey),
        finalPriceRub: price,
        createdAt: purchaseTx.createdAt,
        codeLabel: "قيد الانتظار 📩",
      });

      await safeTelegramCall("callback_query.change_num.success", () =>
        bot.editMessageText(purchaseText, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "تغيير الرقم", callback_data: `change_num_${providerKey}_${newActivationId}_${price}_${serviceCode}_${countryId}` }],
              [{ text: "طلب الكود", callback_data: `checksms_${providerKey}_${newActivationId}` }],
              [{ text: "التحقق من الرقم 💬", url: verifyUrl }],
              [{ text: "إلغاء الطلب", callback_data: `cancelnum_${providerKey}_${newActivationId}_${price}` }],
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
          bot.answerCallbackQuery(query.id, { text: "⏳ لم يصل الكود بعد...", show_alert: true })
        );
        return;
      }

      if (status.startsWith("STATUS_OK")) {
        const code = status.split(":")[1] || "";
        const purchaseTx = appStore.getLatestTransactionByActivationId(activationId);
        const serviceCode = purchaseTx?.serviceCode || "wa";
        const verifyUrl = buildVerifyUrl(serviceCode, purchaseTx?.number || "");
        const newText = buildSmsReceivedText({
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
                [{ text: "التحقق من الرقم 💬", url: verifyUrl }],
              ],
            },
          })
        );
        return;
      }

      await safeTelegramCall("callback_query.checksms.unknown", () =>
        bot.answerCallbackQuery(query.id, { text: "⏳ الحالة غير معروفة حالياً.", show_alert: true })
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
        bot.editMessageText(`❌ تم إلغاء الرقم واسترجاع ${price}₽`, {
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
  } catch (error) {
    logBotError("bootstrap", error);
    console.log("Telegram bot is running...");
  }
}

bootstrap();

console.log("🤖 VaultX Bot is running and Grizzly cache is loaded...");
