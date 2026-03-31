const { getBotCommands, getUserLang, t } = require("../locales");
const { sendMainMenu, sendAccountMenu, sendSettingsMenu } = require("./profileService");
const { sendTopupHome } = require("./topupService");
const { safeTelegramCall } = require("./telegramSafe");

async function setupBotCommands(bot) {
  await safeTelegramCall("setupBotCommands.default", () => bot.setMyCommands(getBotCommands("en")));
  await safeTelegramCall("setupBotCommands.en", () => bot.setMyCommands(getBotCommands("en"), { language_code: "en" }));
  await safeTelegramCall("setupBotCommands.ar", () => bot.setMyCommands(getBotCommands("ar"), { language_code: "ar" }));
}

async function handleMenuCommand(bot, msg, appStore) {
  const user = appStore.getOrCreateUser(msg.from);
  await sendMainMenu(bot, msg.chat.id, user);
}

async function handleAccountCommand(bot, msg, appStore) {
  const user = appStore.getOrCreateUser(msg.from);
  await sendAccountMenu(bot, msg.chat.id, user);
}

async function handleAddFundsCommand(bot, msg, appStore) {
  const user = appStore.getOrCreateUser(msg.from);
  await sendTopupHome(bot, msg.chat.id, { lang: getUserLang(user) });
}

async function handleSettingsCommand(bot, msg, appStore) {
  const user = appStore.getOrCreateUser(msg.from);
  await sendSettingsMenu(bot, msg.chat.id, { lang: getUserLang(user) });
}

async function handleSupportCommand(bot, msg, appStore) {
  const user = appStore.getOrCreateUser(msg.from);
  const lang = getUserLang(user);

  await safeTelegramCall("handleSupportCommand", () =>
    bot.sendMessage(msg.chat.id, t(lang, "support_text"), {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: t(lang, "btn_support"), url: "https://t.me/Engineeer000" }]],
      },
    })
  );
}

module.exports = {
  setupBotCommands,
  handleMenuCommand,
  handleAccountCommand,
  handleAddFundsCommand,
  handleSupportCommand,
  handleSettingsCommand,
};
