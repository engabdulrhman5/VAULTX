const fs = require("fs");
const path = require("path");
const { ADMIN_ID, USERS_EXPORT_PATH } = require("../config");
const { clearUserState, getUserState, setUserState } = require("../services/stateStore");
const {
  sendMainMenu,
  sendAdminPanel,
  sendServicePricesMenu,
  sendServiceToggleMenu,
} = require("../services/profileService");
const { sendStarsCheckout } = require("../services/topupService");
const { safeTelegramCall } = require("../services/telegramSafe");
const { logBotError } = require("../services/errorLogger");
const { formatRuble, escapeHtml, getDisplayName } = require("../utils/formatters");
const { notifyAdmin } = require("./startHandler");
const { getUserLang } = require("../locales");
const { handleVirtualNumbersTextInput } = require("../services/virtualNumbersFlowService");
const { handleSocialBoostTextInput } = require("../services/serviceMenusService");

async function exportUsersList(bot, chatId, appStore) {
  try {
    fs.mkdirSync(path.dirname(USERS_EXPORT_PATH), { recursive: true });
    const content = appStore
      .getUsers()
      .map((user) => `${user.userId} | ${user.username || "-"} | ${user.firstName || "-"}`)
      .join("\n");
    fs.writeFileSync(USERS_EXPORT_PATH, content, "utf8");

    await safeTelegramCall("exportUsersList", () =>
      bot.sendDocument(chatId, USERS_EXPORT_PATH, {}, {
        filename: "vaultx-users.txt",
        contentType: "text/plain",
      })
    );
  } catch (error) {
    logBotError("exportUsersList", error, { chatId });
  }
}

async function handleTransferInput(bot, msg, appStore) {
  try {
    const state = getUserState(msg.from.id);
    if (!state || state.name !== "AWAITING_TRANSFER") {
      return false;
    }

    if (msg.text.trim().toLowerCase() === "cancel") {
      clearUserState(msg.from.id);
      const user = appStore.findUserById(msg.from.id);
      await safeTelegramCall("handleTransferInput.cancel", () =>
        bot.sendMessage(msg.chat.id, "تم إلغاء عملية تحويل الرصيد.")
      );
      await sendMainMenu(bot, msg.chat.id, user);
      return true;
    }

    const lines = msg.text.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length !== 2) {
      await safeTelegramCall("handleTransferInput.invalidFormat", () =>
        bot.sendMessage(msg.chat.id, "الرجاء إرسال سطرين فقط: السطر الأول ID والسطر الثاني المبلغ.")
      );
      return true;
    }

    const sender = appStore.findUserById(msg.from.id);
    const targetUserId = Number(lines[0]);
    const amount = Number(lines[1]);
    const receiver = appStore.findUserById(targetUserId);

    if (!receiver) {
      await safeTelegramCall("handleTransferInput.receiverMissing", () =>
        bot.sendMessage(msg.chat.id, "المستخدم الهدف غير موجود.")
      );
      return true;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      await safeTelegramCall("handleTransferInput.invalidAmount", () =>
        bot.sendMessage(msg.chat.id, "المبلغ غير صالح.")
      );
      return true;
    }

    if (sender.balance < amount) {
      await safeTelegramCall("handleTransferInput.insufficient", () =>
        bot.sendMessage(msg.chat.id, "رصيدك غير كافٍ.")
      );
      return true;
    }

    appStore.deductBalance(sender.userId, amount);
    appStore.addBalance(receiver.userId, amount);
    const updatedSender = appStore.incrementTransactions(sender.userId);
    appStore.incrementTransactions(receiver.userId);

    appStore.addTransaction({
      type: "transfer_out",
      userId: sender.userId,
      targetUserId: receiver.userId,
      amount,
    });
    appStore.addTransaction({
      type: "transfer_in",
      userId: receiver.userId,
      targetUserId: sender.userId,
      amount,
    });

    await notifyAdmin(
      bot,
      [
        "<b>User Transfer</b>",
        `From: <code>${sender.userId}</code>`,
        `To: <code>${receiver.userId}</code>`,
        `Amount: ${formatRuble(amount)} RUB`,
      ].join("\n")
    );

    if (sender.invitedBy && sender.referralCommissionCount < 2) {
      const referrer = appStore.findUserById(sender.invitedBy);
      if (referrer) {
        const commission = Number((amount * 0.1).toFixed(2));
        appStore.addBalance(referrer.userId, commission);
        appStore.updateUser(sender.userId, {
          referralCommissionCount: sender.referralCommissionCount + 1,
        });
        appStore.addTransaction({
          type: "referral_commission",
          userId: referrer.userId,
          targetUserId: sender.userId,
          amount: commission,
        });
        await safeTelegramCall("handleTransferInput.referralCommission", () =>
          bot.sendMessage(referrer.userId, `تمت إضافة عمولة إحالة بقيمة ${formatRuble(commission)} RUB إلى رصيدك.`)
        );
      }
    }

    clearUserState(sender.userId);

    await safeTelegramCall("handleTransferInput.senderNotify", () =>
      bot.sendMessage(
        msg.chat.id,
        [
          "<b>=== تم تحويل الرصيد بنجاح ===</b>",
          "",
          `تم إرسال ${formatRuble(amount)} RUB إلى <code>${receiver.userId}</code>.`,
        ].join("\n"),
        { parse_mode: "HTML" }
      )
    );

    await safeTelegramCall("handleTransferInput.receiverNotify", () =>
      bot.sendMessage(
        receiver.userId,
        [
          "<b>=== تم استلام رصيد ===</b>",
          "",
          `استلمت ${formatRuble(amount)} RUB من ${escapeHtml(getDisplayName(sender))}.`,
        ].join("\n"),
        { parse_mode: "HTML" }
      )
    );

    await sendMainMenu(bot, msg.chat.id, updatedSender);
    return true;
  } catch (error) {
    logBotError("handleTransferInput", error, { userId: msg.from?.id });
    return false;
  }
}

async function handleTopupStarsAmountInput(bot, msg) {
  try {
    const state = getUserState(msg.from.id);
    if (!state || state.name !== "AWAITING_TOPUP_STARS_AMOUNT") {
      return false;
    }

    if (msg.text.trim().toLowerCase() === "cancel") {
      clearUserState(msg.from.id);
      await safeTelegramCall("handleTopupStarsAmountInput.cancel", () =>
        bot.sendMessage(msg.chat.id, "تم إلغاء عملية شحن الرصيد.")
      );
      return true;
    }

    if (!/^\d+$/.test(msg.text.trim())) {
      await safeTelegramCall("handleTopupStarsAmountInput.invalidText", () =>
        bot.sendMessage(msg.chat.id, "❌ الرجاء إدخال رقم صحيح فقط لعدد الروبل.")
      );
      return true;
    }

    const amountRub = Number(msg.text.trim());
    if (!Number.isFinite(amountRub) || amountRub <= 0) {
      await safeTelegramCall("handleTopupStarsAmountInput.invalidAmount", () =>
        bot.sendMessage(msg.chat.id, "❌ يجب أن يكون المبلغ أكبر من صفر.")
      );
      return true;
    }

    clearUserState(msg.from.id);
    await sendStarsCheckout(bot, msg.chat.id, amountRub);
    return true;
  } catch (error) {
    logBotError("handleTopupStarsAmountInput", error, { userId: msg.from?.id });
    return false;
  }
}

async function handleCustomServiceRequest(bot, msg) {
  try {
    const state = getUserState(msg.from.id);
    if (!state || state.name !== "AWAITING_CUSTOM_SERVICE") {
      return false;
    }

    clearUserState(msg.from.id);

    await notifyAdmin(
      bot,
      [
        "<b>Custom Service Request</b>",
        `User ID: <code>${msg.from.id}</code>`,
        `Username: ${msg.from.username ? `@${escapeHtml(msg.from.username)}` : "غير محدد"}`,
        "",
        escapeHtml(msg.text),
      ].join("\n")
    );

    await safeTelegramCall("handleCustomServiceRequest.confirm", () =>
      bot.sendMessage(
        msg.chat.id,
        "✅ تم إرسال طلبك إلى الإدارة بنجاح. يرجى الانتظار لحين مراجعة طلبك والتواصل معك."
      )
    );

    return true;
  } catch (error) {
    logBotError("handleCustomServiceRequest", error, { userId: msg.from?.id });
    return false;
  }
}

async function handleAdminState(bot, msg, appStore) {
  try {
    const state = getUserState(msg.from.id);
    if (!state || msg.from.id !== ADMIN_ID) {
      return false;
    }
    const adminLang = getUserLang(appStore.findUserById(msg.from.id));

    if (msg.text.trim().toLowerCase() === "cancel") {
      clearUserState(msg.from.id);
      await safeTelegramCall("handleAdminState.cancel", () => bot.sendMessage(msg.chat.id, "تم إلغاء العملية."));
      await sendAdminPanel(bot, msg.chat.id, { lang: adminLang });
      return true;
    }

    if (state.name === "AWAITING_ADD_BALANCE_ID") {
      const targetUserId = Number(msg.text.trim());
      const target = appStore.findUserById(targetUserId);

      if (!target) {
        await safeTelegramCall("handleAdminState.addBalanceUserMissing", () => bot.sendMessage(msg.chat.id, "المستخدم غير موجود."));
        return true;
      }

      setUserState(msg.from.id, "AWAITING_ADD_BALANCE_AMOUNT", { targetUserId });
      await safeTelegramCall("handleAdminState.askAddAmount", () => bot.sendMessage(msg.chat.id, "أرسل المبلغ الآن."));
      return true;
    }

    if (state.name === "AWAITING_ADD_BALANCE_AMOUNT") {
      const target = appStore.findUserById(state.targetUserId);
      const amount = Number(msg.text.trim());
      if (!target || !Number.isFinite(amount) || amount <= 0) {
        await safeTelegramCall("handleAdminState.invalidAddAmount", () => bot.sendMessage(msg.chat.id, "بيانات غير صالحة."));
        return true;
      }

      appStore.addBalance(target.userId, amount);
      appStore.addTransaction({
        type: "admin_add_balance",
        userId: ADMIN_ID,
        targetUserId: target.userId,
        amount,
      });
      clearUserState(msg.from.id);
      await safeTelegramCall("handleAdminState.addDone", () => bot.sendMessage(msg.chat.id, "تمت إضافة الرصيد بنجاح."));
      await safeTelegramCall("handleAdminState.addNotifyUser", () => bot.sendMessage(target.userId, `تم شحن رصيدك بـ ${formatRuble(amount)} روبل`));
      await sendAdminPanel(bot, msg.chat.id, { lang: adminLang });
      return true;
    }

    if (state.name === "ADMIN_AWAITING_DEDUCT_BALANCE_USER") {
      setUserState(msg.from.id, "ADMIN_AWAITING_DEDUCT_BALANCE_AMOUNT", { targetUserId: Number(msg.text.trim()) });
      await safeTelegramCall("handleAdminState.askDeductAmount", () => bot.sendMessage(msg.chat.id, "أرسل المبلغ الآن."));
      return true;
    }

    if (state.name === "ADMIN_AWAITING_DEDUCT_BALANCE_AMOUNT") {
      const target = appStore.findUserById(state.targetUserId);
      const amount = Number(msg.text.trim());
      if (!target || !Number.isFinite(amount) || amount <= 0) {
        await safeTelegramCall("handleAdminState.invalidDeductAmount", () => bot.sendMessage(msg.chat.id, "بيانات غير صالحة."));
        return true;
      }

      appStore.deductBalance(target.userId, amount);
      appStore.addTransaction({
        type: "admin_deduct_balance",
        userId: ADMIN_ID,
        targetUserId: target.userId,
        amount,
      });
      clearUserState(msg.from.id);
      await safeTelegramCall("handleAdminState.deductDone", () => bot.sendMessage(msg.chat.id, "تم خصم الرصيد بنجاح."));
      await safeTelegramCall("handleAdminState.deductNotifyUser", () => bot.sendMessage(target.userId, `تم خصم ${formatRuble(amount)} روبل من رصيدك`));
      await sendAdminPanel(bot, msg.chat.id, { lang: adminLang });
      return true;
    }

    if (state.name === "ADMIN_AWAITING_BROADCAST") {
      let successCount = 0;
      for (const user of appStore.getUsers()) {
        const result = await safeTelegramCall("handleAdminState.broadcastSend", () => bot.sendMessage(user.userId, msg.text));
        if (result) {
          successCount += 1;
        }
      }

      clearUserState(msg.from.id);
      await safeTelegramCall("handleAdminState.broadcastDone", () => bot.sendMessage(msg.chat.id, `تم الإرسال إلى ${successCount} مستخدم.`));
      await sendAdminPanel(bot, msg.chat.id, { lang: adminLang });
      return true;
    }

    if (state.name === "ADMIN_AWAITING_SERVICE_PRICE") {
      const amount = Number(msg.text.trim());
      if (!Number.isFinite(amount) || amount < 0) {
        await safeTelegramCall("handleAdminState.invalidServicePrice", () => bot.sendMessage(msg.chat.id, "السعر غير صالح."));
        return true;
      }

      appStore.updateServicePrice(state.serviceKey, amount);
      clearUserState(msg.from.id);
      await safeTelegramCall("handleAdminState.servicePriceDone", () => bot.sendMessage(msg.chat.id, "تم تحديث السعر بنجاح."));
      await sendServicePricesMenu(bot, msg.chat.id, appStore.getServices());
      return true;
    }

    if (state.name === "ADMIN_AWAITING_UPLOAD_DATA") {
      clearUserState(msg.from.id);
      await safeTelegramCall("handleAdminState.uploadDone", () => bot.sendMessage(msg.chat.id, "تم استلام البيانات مبدئياً. سيتم ربط JSON / Google Sheets لاحقاً."));
      await sendAdminPanel(bot, msg.chat.id, { lang: adminLang });
      return true;
    }

    return false;
  } catch (error) {
    logBotError("handleAdminState", error, { userId: msg.from?.id });
    return false;
  }
}

async function handleTextMessage(bot, msg, appStore) {
  try {
    const virtualNumbersTextHandled = await handleVirtualNumbersTextInput(bot, msg, appStore);
    if (virtualNumbersTextHandled) {
      return;
    }

    const socialBoostHandled = await handleSocialBoostTextInput(bot, msg, appStore);
    if (socialBoostHandled) {
      return;
    }

    const adminHandled = await handleAdminState(bot, msg, appStore);
    if (adminHandled) {
      return;
    }

    const customServiceHandled = await handleCustomServiceRequest(bot, msg, appStore);
    if (customServiceHandled) {
      return;
    }

    const topupHandled = await handleTopupStarsAmountInput(bot, msg, appStore);
    if (topupHandled) {
      return;
    }

    const transferHandled = await handleTransferInput(bot, msg, appStore);
    if (transferHandled) {
      return;
    }

    return;
  } catch (error) {
    logBotError("handleTextMessage", error, { userId: msg.from?.id });
  }
}

module.exports = {
  handleTextMessage,
  exportUsersList,
};
