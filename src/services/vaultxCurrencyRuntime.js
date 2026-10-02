'use strict';
const TelegramBot = require('node-telegram-bot-api');
const { AppStore } = require('./appStore');
const currencyService = require('./currencyService');
const { setUserState, getUserState, clearUserState } = require('./stateStore');
const { sendTransferConfirm } = require('./profileService');
const RATES_RUB_PER_UNIT = Object.freeze({ USD: 30, RUB: 1, YER: 30 / 530, SAR: 30 / 3.7 });
function normalizeCurrency(value){return currencyService.normalizeCurrency(value);}
function userForChat(chatId){const store=global.__VAULTX_APP_STORE;return store&&chatId!=null?store.findUserById(chatId):null;}
function userCurrency(chatId){return normalizeCurrency(userForChat(chatId)?.currency||'USD');}
function rubToDisplay(amountRub,currency){const code=normalizeCurrency(currency);const n=Number(amountRub);if(!Number.isFinite(n))return null;return `${currencyService.formatPriceNumber(n/RATES_RUB_PER_UNIT[code])} ${code}`;}
function convert(amount,sourceCurrency,targetCurrency){const n=Number(String(amount).replace(',','.'));const source=normalizeCurrency(sourceCurrency);if(!Number.isFinite(n))return null;return rubToDisplay(n*RATES_RUB_PER_UNIT[source],targetCurrency);}
function replaceMoney(text, targetCurrency, context = '') {
  const target = normalizeCurrency(targetCurrency);
  let result = String(text ?? '').replace(/â‚½/g, 'RUB').replace(/₽\s*RUB\b/gi, 'RUB');
  const number = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)';
  const parseAmount = value => Number(/^\d{1,3}(?:,\d{3})+/.test(value) ? value.replace(/,/g, '') : value.replace(',', '.'));
  // Only monetary labels without a following currency are legacy RUB values.
  // Never infer prices from arbitrary numbers: quantities, IDs and dates occur
  // in the same messages and callback buttons.
  const barePrice = new RegExp(`(سعر الوحدة|السعر|التكلفة|الإجمالي|الرصيد|المبلغ|Unit Price|Price|Cost|Total|Balance|Amount)(\\s*[:：=|\\-]?\\s*)(${number})(?![0-9.,]|\\s*(?:RUB|USD|YER|SAR|₽|\\$|روبل|دولار|ر\\.ي|ر\\.س))`, 'gi');
  result = result.replace(barePrice,
    (whole, label, separator, value) => `${label}${separator}${rubToDisplay(parseAmount(value), target)}`);
  const suffix = new RegExp(`${number}\\s*(RUB|USD|YER|SAR|₽|\\$|روبل|دولار|ر\\.ي|ر\\.س)`, 'gi');
  const currencyCode = unit => ({ '₽': 'RUB', 'روبل': 'RUB', '$': 'USD', 'دولار': 'USD', 'ر.ي': 'YER', 'ر.س': 'SAR' }[unit] || unit.toUpperCase());
  result = result.replace(suffix, (whole, value, unit) => convert(parseAmount(value), currencyCode(unit), target) || whole);
  result = result.replace(new RegExp(`([₽$])\\s*${number}`, 'g'),
    (whole, unit, value) => convert(parseAmount(value), unit === '₽' ? 'RUB' : 'USD', target) || whole);
  return result;
}
function transformMarkup(markup,currency){if(!markup||typeof markup!=='object')return markup;if(Array.isArray(markup))return markup.map(x=>transformMarkup(x,currency));const out={...markup};const callback=String(out.callback_data||'');if(typeof out.text==='string'&&!/^(?:currency:|wallet:)/.test(callback))out.text=replaceMoney(out.text,currency,callback);for(const key of ['inline_keyboard','keyboard'])if(Array.isArray(out[key]))out[key]=out[key].map(row=>transformMarkup(row,currency));return out;}
function patchStore(){const original=AppStore.prototype.normalizeUser;if(original.__vaultxFinalCurrencyPatch)return;function patched(user){global.__VAULTX_APP_STORE=this;return original.call(this,user);}patched.__vaultxFinalCurrencyPatch=true;AppStore.prototype.normalizeUser=patched;}
function currencyKeyboard(lang,current){return currencyService.getCurrencyKeyboard(lang,current);}
const { CONVERSION_PAIRS } = currencyService;
function conversionKeyboard(lang){return{inline_keyboard:CONVERSION_PAIRS.map(([from,to])=>[{text:`💱 ${from} → ${to}`,callback_data:`currency:convert:${from}:${to}`}]).concat([[{text:lang==='ar'?'🔙 رجوع':'🔙 Back',callback_data:'action:transfer_balance'}]])};}
function conversionText(lang){return lang==='ar'?'💱 <b>تحويل العملات</b>\n\nاختر العملة التي تريد التحويل منها وإليها.\n\nسيتم خصم المبلغ من رصيد العملة الأولى وإضافة الناتج إلى العملة الثانية.':'💱 <b>Currency Conversion</b>\n\nChoose the source and target currencies.\nThe source wallet will be debited and the converted amount added to the target wallet.';}
function conversionPrompt(lang,from,to){return lang==='ar'?`💱 تحويل <b>${from}</b> إلى <b>${to}</b>\n\nأرسل الآن المبلغ المراد تحويله.\nمثال: <code>5</code>\n\nأرسل Cancel للإلغاء.`:`💱 Convert <b>${from}</b> to <b>${to}</b>\n\nSend the amount to convert.\nExample: <code>5</code>\n\nSend Cancel to cancel.`;}
function patchTelegramOutput() {
  const patch = (name, textIndex, optionsIndex, chatResolver) => {
    const original = TelegramBot.prototype[name];
    if (typeof original !== 'function' || original.__vaultxFinalCurrencyPatch) return;
    const wrapped = function (...args) {
      const chatId = chatResolver ? chatResolver(args) : args[0];
      const currency = userCurrency(chatId);
      const originalOptions = args[optionsIndex];
      const preserve = Boolean(originalOptions?.vaultx_preserve_currency);
      if (originalOptions && typeof originalOptions === 'object') {
        const options = { ...originalOptions };
        delete options.vaultx_preserve_currency;
        if (!preserve) {
          if (typeof options.caption === 'string') options.caption = replaceMoney(options.caption, currency);
          if (options.reply_markup) options.reply_markup = transformMarkup(options.reply_markup, currency);
        }
        args[optionsIndex] = options;
      }
      if (!preserve && textIndex !== null && typeof args[textIndex] === 'string') args[textIndex] = replaceMoney(args[textIndex], currency);
      if (!preserve && name === 'editMessageReplyMarkup') args[0] = transformMarkup(args[0], currency);
      return original.apply(this, args);
    };
    wrapped.__vaultxFinalCurrencyPatch = true;
    TelegramBot.prototype[name] = wrapped;
  };
  patch('sendMessage', 1, 2);
  for (const name of ['sendPhoto', 'sendDocument', 'sendVideo', 'sendAudio']) patch(name, null, 2);
  patch('editMessageText', 0, 1, args => args[1]?.chat_id);
  patch('editMessageCaption', 0, 1, args => args[1]?.chat_id);
  patch('editMessageReplyMarkup', null, 1, args => args[1]?.chat_id);
}

const { safeTelegramCall } = require('./telegramSafe');
const { logBotError } = require('./errorLogger');
const { escapeHtml, normalizeNumericText, parseAmountInput, formatWalletNumber } = require('../utils/formatters');
const { sendOrEditMessage, sendTransferHome } = require('./profileService');
const walletOptions = { parse_mode: 'HTML', vaultx_preserve_currency: true };
const mainButton = lang => ({ text: lang === 'ar' ? '🏠 الرئيسية' : '🏠 Main Menu', callback_data: 'menu:main' });
const cancelButton = lang => ({ text: lang === 'ar' ? '❌ إلغاء' : '❌ Cancel', callback_data: 'transfer:currency' });
const isCanceled = raw => ['cancel', 'إلغاء', 'الغاء'].includes(String(raw).trim().toLowerCase());
const validAmount = amount => Number.isFinite(amount) && amount > 0 && Number(amount.toFixed(6)) > 0 && Math.abs(amount - Number(amount.toFixed(6))) <= 1e-12;

async function handleWalletCallback(bot, query) {
  const data = String(query?.data || '');
  if (data !== 'transfer:currency' && data !== 'transfer:confirm' && !data.startsWith('currency:convert:')) return false;
  const store = global.__VAULTX_APP_STORE;
  const user = store?.findUserById(query?.from?.id);
  if (!user) return false;
  const lang = user.language || 'ar';
  if (!user.isVerified) {
    await safeTelegramCall('wallet.unverified', () => bot.answerCallbackQuery(query.id, {
      text: lang === 'ar' ? 'أكمل التسجيل أولاً عبر /start.' : 'Complete registration with /start first.', show_alert: true,
    }));
    return true;
  }
  if (data.startsWith('currency:convert:')) {
    const [, , from, to] = data.split(':');
    if (!currencyService.canConvert(from, to)) {
      await safeTelegramCall('wallet.invalidPair', () => bot.answerCallbackQuery(query.id, { text: lang === 'ar' ? 'تحويل غير متاح.' : 'Invalid conversion.', show_alert: true }));
      return true;
    }
  }
  await safeTelegramCall('wallet.callback.answer', () => bot.answerCallbackQuery(query.id));
  const chatId = query.message?.chat?.id || query.from.id;
  const messageId = query.message?.message_id;
  if (data === 'transfer:currency') {
    clearUserState(user.userId);
    await sendOrEditMessage(bot, chatId, conversionText(lang), conversionKeyboard(lang), messageId, 'wallet.conversionMenu');
    return true;
  }
  if (data.startsWith('currency:convert:')) {
    const [, , from, to] = data.split(':');
    setUserState(user.userId, 'AWAITING_CURRENCY_CONVERSION', { fromCurrency: from, toCurrency: to });
    const available = formatWalletNumber(store.getBalance(user.userId, from));
    const balanceLine = lang === 'ar' ? `\n\nرصيدك المتاح: ${available} ${from}` : `\n\nAvailable balance: ${available} ${from}`;
    await sendOrEditMessage(bot, chatId, conversionPrompt(lang, from, to) + balanceLine,
      { inline_keyboard: [[cancelButton(lang)]] }, messageId, 'wallet.conversionPrompt');
    return true;
  }
  const state = getUserState(user.userId);
  const receiver = state?.name === 'AWAITING_TRANSFER_CONFIRM' ? store.findUserById(state.targetUserId) : null;
  const amountRub = Number(state?.amount || 0);
  const from = state?.currency || user.currency;
  if (!receiver || !Number.isFinite(amountRub) || amountRub <= 0) {
    clearUserState(user.userId);
    await sendTransferHome(bot, chatId, user, { messageId });
    return true;
  }
  const senderBalanceBefore = store.getBalance(user.userId, from);
  const receiverBalanceBefore = store.getBalance(receiver.userId, receiver.currency);
  if (!store.transferPreferred(user.userId, receiver.userId, amountRub, from, receiver.currency)) {
    await safeTelegramCall('wallet.transfer.insufficient', () => bot.sendMessage(chatId,
      lang === 'ar' ? '❌ رصيد المحفظة المحددة غير كافٍ. ابدأ تحويلاً جديداً.' : '❌ Insufficient wallet balance. Start a new transfer.', walletOptions));
    return true;
  }
  clearUserState(user.userId);
  const sent = formatWalletNumber(senderBalanceBefore - store.getBalance(user.userId, from));
  const received = formatWalletNumber(store.getBalance(receiver.userId, receiver.currency) - receiverBalanceBefore);
  const senderReceipt = lang === 'ar'
    ? `✅ تم تحويل <b>${sent} ${from}</b> إلى المستخدم <code>${receiver.userId}</code> بنجاح.`
    : `✅ <b>${sent} ${from}</b> transferred successfully to <code>${receiver.userId}</code>.`;
  await sendOrEditMessage(bot, chatId, senderReceipt, { inline_keyboard: [[mainButton(lang)]] }, messageId, 'wallet.transfer.receipt');
  const senderName = escapeHtml(user.firstName || user.username || 'User');
  await safeTelegramCall('wallet.transfer.received', () => bot.sendMessage(receiver.userId, receiver.language === 'ar'
    ? `📥 تم استلام <b>${received} ${receiver.currency}</b> من ${senderName}.`
    : `📥 You received <b>${received} ${receiver.currency}</b> from ${senderName}.`, walletOptions));
  return true;
}

async function handleWalletMessage(bot, msg) {
  const store = global.__VAULTX_APP_STORE;
  const user = store?.findUserById(msg?.from?.id);
  const state = getUserState(msg?.from?.id);
  if (!user || !user.isVerified || !['AWAITING_CURRENCY_CONVERSION', 'AWAITING_TRANSFER_PAYLOAD'].includes(state?.name)) return false;
  const raw = String(msg.text || '').trim();
  if (!raw) return false;
  const lang = user.language || 'ar';
  if (raw.startsWith('/')) { clearUserState(user.userId); return false; }
  if (isCanceled(raw)) {
    clearUserState(user.userId);
    await sendTransferHome(bot, msg.chat.id, user);
    return true;
  }
  const reply = text => safeTelegramCall('wallet.input.reply', () => bot.sendMessage(msg.chat.id, text, walletOptions));
  if (state.name === 'AWAITING_CURRENCY_CONVERSION') {
    const amount = parseAmountInput(raw);
    const from = state.fromCurrency;
    const to = state.toCurrency;
    if (!currencyService.canConvert(from, to)) { clearUserState(user.userId); await sendTransferHome(bot, msg.chat.id, user); return true; }
    if (!validAmount(amount)) {
      await reply(lang === 'ar' ? '❌ أرسل مبلغاً أكبر من صفر، وبحد أقصى ٦ منازل عشرية.' : '❌ Enter a positive amount with at most six decimal places.');
      return true;
    }
    const available = store.getBalance(user.userId, from);
    if (available + 1e-9 < amount) {
      await reply(lang === 'ar' ? `❌ رصيد ${from} غير كافٍ. رصيدك: ${formatWalletNumber(available)} ${from}`
        : `❌ Insufficient ${from} balance. Available: ${formatWalletNumber(available)} ${from}`);
      return true;
    }
    const converted = store.convertBalance(user.userId, amount, from, to);
    if (converted === null) {
      await reply(lang === 'ar' ? '❌ تعذر تحويل هذا المبلغ. أرسل مبلغاً أكبر أو ابدأ تحويلاً جديداً.' : '❌ Unable to convert this amount. Try a larger amount or start again.');
      return true;
    }
    clearUserState(user.userId);
    const receipt = lang === 'ar'
      ? `✅ تم التحويل بنجاح\n\n${from}: <code>${formatWalletNumber(amount)}</code> → ${to}: <code>${formatWalletNumber(converted)}</code>\n\nرصيد ${to} الجديد: <code>${formatWalletNumber(store.getBalance(user.userId, to))}</code>`
      : `✅ Conversion completed\n\n${from}: <code>${formatWalletNumber(amount)}</code> → ${to}: <code>${formatWalletNumber(converted)}</code>\n\nNew ${to} balance: <code>${formatWalletNumber(store.getBalance(user.userId, to))}</code>`;
    await safeTelegramCall('wallet.conversion.receipt', () => bot.sendMessage(msg.chat.id, receipt, { ...walletOptions, reply_markup: {
      inline_keyboard: [[{ text: lang === 'ar' ? '💱 تحويل آخر' : '💱 Convert Again', callback_data: 'transfer:currency' }], [mainButton(lang)]],
    } }));
    return true;
  }
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length !== 2 || !/^\d+$/.test(normalizeNumericText(lines[0]))) {
    await reply(lang === 'ar' ? 'أرسل سطرين: آيدي المستلم ثم المبلغ بعملتك المختارة.' : 'Send two lines: receiver ID, then the amount in your selected currency.');
    return true;
  }
  const receiver = store.findUserById(Number(normalizeNumericText(lines[0])));
  const amount = parseAmountInput(lines[1]);
  if (!receiver) { await reply(lang === 'ar' ? '❌ هذا الآيدي غير مسجل في البوت.' : '❌ Receiver ID is not registered.'); return true; }
  if (receiver.userId === user.userId) { await reply(lang === 'ar' ? '❌ لا يمكنك التحويل إلى نفسك.' : '❌ You cannot transfer to yourself.'); return true; }
  if (!validAmount(amount)) { await reply(lang === 'ar' ? '❌ المبلغ غير صالح. استخدم حتى ٦ منازل عشرية.' : '❌ Invalid amount. Use up to six decimal places.'); return true; }
  const available = store.getBalance(user.userId, user.currency);
  if (available + 1e-9 < amount) { await reply(lang === 'ar' ? `❌ رصيدك غير كافٍ: ${formatWalletNumber(available)} ${user.currency}` : `❌ Insufficient balance: ${formatWalletNumber(available)} ${user.currency}`); return true; }
  const amountRub = currencyService.currencyToRub(amount, user.currency);
  setUserState(user.userId, 'AWAITING_TRANSFER_CONFIRM', { targetUserId: receiver.userId, amount: amountRub, currency: user.currency, amountCurrency: amount });
  await sendTransferConfirm(bot, msg.chat.id, user, {
    senderName: user.firstName || user.username || 'User', receiverName: receiver.firstName || receiver.username || 'User',
    receiverId: receiver.userId, amountRub, currency: user.currency,
  });
  return true;
}

function patchTelegramRouting() {
  const originalOn = TelegramBot.prototype.on;
  if (originalOn.__vaultxCurrencyRouterPatch) return;
  const wrappedOn = function (event, listener) {
    if (!['callback_query', 'message'].includes(event)) return originalOn.call(this, event, listener);
    return originalOn.call(this, event, async payload => {
      try {
        const handled = event === 'callback_query' ? await handleWalletCallback(this, payload) : await handleWalletMessage(this, payload);
        if (handled) return;
      } catch (error) {
        logBotError('wallet.router', error, { userId: payload?.from?.id });
        await safeTelegramCall('wallet.router.error', () => this.sendMessage(payload.message?.chat?.id || payload.chat?.id || payload.from.id,
          'تعذر إكمال العملية. حاول مرة أخرى. / Unable to complete the action. Please retry.', walletOptions));
        return;
      }
      return listener.call(this, payload);
    });
  };
  wrappedOn.__vaultxCurrencyRouterPatch = true;
  TelegramBot.prototype.on = wrappedOn;
}
patchStore();
patchTelegramOutput();
patchTelegramRouting();
module.exports = { replaceMoney, conversionKeyboard, CONVERSION_PAIRS, handleWalletCallback, handleWalletMessage };
