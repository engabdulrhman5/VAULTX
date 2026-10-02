'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultx-currency-flow-'));
process.env.VAULTX_DATA_DIR = directory;
process.env.RENDER = '';
for (const [name, contents] of [['users', '[]'], ['config', '{}'], ['transactions', '[]']]) fs.writeFileSync(path.join(directory, `${name}.json`), contents);
require('../src/services/vaultxRuntime');
const { handleWalletCallback, handleWalletMessage, CONVERSION_PAIRS } = require('../src/services/vaultxCurrencyRuntime');
const TelegramBot = require('node-telegram-bot-api');
const { AppStore } = require('../src/services/appStore');
const { getUserState, setUserState, clearUserState } = require('../src/services/stateStore');
const currency = require('../src/services/currencyService');
const { sendMainMenu, sendAccountMenu } = require('../src/services/profileService');
const { parseAmountInput } = require('../src/utils/formatters');
after(() => fs.rmSync(directory, { recursive: true, force: true }));

function fixture(verified = true) {
  const store = Object.create(AppStore.prototype);
  store.users = [];
  store.transactions = [];
  store.config = { services: {}, botStats: {} };
  store.persistAll = () => {};
  store.users.push(store.normalizeUser({ userId: 101, firstName: 'A', currency: 'USD', language: 'ar', isVerified: verified, balances: { USD: 10, RUB: 30, YER: 530, SAR: 3.7 } }));
  const bot = new TelegramBot('test:token', { polling: false });
  const requests = [];
  let failEdits = false;
  bot._request = async (method, options) => {
    const form = { ...options.form };
    if (typeof form.reply_markup === "string") form.reply_markup = JSON.parse(form.reply_markup);
    requests.push({ method, ...form });
    if (failEdits && method === 'editMessageText') throw new Error('message can no longer be edited');
    return { message_id: 9, chat: { id: 101 } };
  };
  let legacyCallbacks = 0;
  bot.on('callback_query', async () => { legacyCallbacks += 1; });
  clearUserState(101);
  return { store, bot, requests, failEdits: () => { failEdits = true; }, callback: data => bot.listeners('callback_query')[0].call(bot, { id: 'q', data, from: { id: 101 }, message: { chat: { id: 101 }, message_id: 9 } }), legacyCount: () => legacyCallbacks };
}

function lastText(requests) { return [...requests].reverse().find(entry => ['sendMessage', 'editMessageText'].includes(entry.method)); }

test('actual stacked callback routing completes language → currency → CAPTCHA with one answer per tap', async () => {
  const f = fixture(false);
  await f.callback('setlang_ar');
  assert.equal(getUserState(101).name, 'AWAITING_CURRENCY');
  assert.equal(f.requests.filter(entry => entry.method === 'answerCallbackQuery').length, 1);
  assert.equal(lastText(f.requests).reply_markup.inline_keyboard.flat().some(button => button.callback_data === 'menu:settings'), false);
  await f.callback('currency:set:YER');
  assert.equal(getUserState(101).name, 'AWAITING_CAPTCHA');
  assert.equal(f.store.findUserById(101).currency, 'YER');
  assert.equal(f.requests.filter(entry => entry.method === 'answerCallbackQuery').length, 2);
  assert.equal(f.legacyCount(), 0);
});

test('settings and wallet taps retain four independent amounts in exactly two rows', async () => {
  const f = fixture();
  await f.callback('menu:currency');
  assert.equal(lastText(f.requests).reply_markup.inline_keyboard.flat().filter(button => button.callback_data.startsWith('currency:set:')).length, 4);
  await f.callback('currency:set:SAR');
  assert.equal(f.store.findUserById(101).currency, 'SAR');
  assert.match(lastText(f.requests).text, /SAR/);
  await f.callback('wallet:select:YER');
  const menu = lastText(f.requests);
  assert.deepEqual(menu.reply_markup.inline_keyboard.slice(0, 2).map(row => row.length), [2, 2]);
  assert.deepEqual(menu.reply_markup.inline_keyboard.slice(0, 2).flat().map(button => button.text), ['$ 10.00', '₽ 30.00', '✓ ر.ي 530.00', 'ر.س 3.70']);
  assert.equal(menu.text.includes('الريال اليمني'), false);
  assert.equal(f.store.findUserById(101).currency, 'YER');
  assert.equal(f.requests.filter(entry => entry.method === 'answerCallbackQuery').length, 3);
  assert.equal(f.legacyCount(), 0);
  await sendAccountMenu(f.bot, 101, f.store.findUserById(101));
  assert.match(lastText(f.requests).text, /الروبل الروسي: <b>30<\/b>/);
  assert.match(lastText(f.requests).text, /الدولار الأمريكي: <b>10<\/b>/);
});

test('currency navigation survives failed edits and changing language for verified users answers once', async () => {
  const f = fixture();
  f.failEdits();
  await f.callback('menu:currency');
  assert.equal(lastText(f.requests).method, 'sendMessage');
  await f.callback('setlang_en');
  assert.equal(lastText(f.requests).method, 'sendMessage');
  assert.match(lastText(f.requests).text, /Main Menu/);
  assert.equal(f.requests.filter(entry => entry.method === 'answerCallbackQuery').length, 2);
  assert.equal(f.legacyCount(), 0);
  const previous = f.store.findUserById(101).currency;
  await f.callback('currency:set:GBP');
  assert.equal(f.store.findUserById(101).currency, previous);
  assert.equal(f.requests.at(-1).show_alert, true);
});

test('all six conversions debit source, credit target and keep true currencies in receipts', async () => {
  for (const [from, to] of CONVERSION_PAIRS) {
    const f = fixture();
    const amount = currency.CURRENCIES[from].unitsPerUsd;
    f.store.findUserById(101).balances[from] = amount * 2;
    const beforeTarget = f.store.getBalance(101, to);
    await f.callback(`currency:convert:${from}:${to}`);
    assert.equal(getUserState(101).name, 'AWAITING_CURRENCY_CONVERSION');
    const arabic = String(amount).replace(/\d/g, digit => String.fromCharCode(0x0660 + Number(digit))).replace('.', '٫');
    assert.equal(await handleWalletMessage(f.bot, { from: { id: 101 }, chat: { id: 101 }, text: arabic }), true);
    assert.equal(f.store.getBalance(101, from), amount);
    assert.equal(f.store.getBalance(101, to), Number((beforeTarget + currency.CURRENCIES[to].unitsPerUsd).toFixed(6)));
    assert.equal(f.store.transactions.at(-1).type, 'currency_conversion');
    assert.equal(getUserState(101), null);
    assert.match(lastText(f.requests).text, new RegExp(`${from}:`));
    assert.match(lastText(f.requests).text, new RegExp(`${to}:`));
    assert.equal(f.requests.filter(entry => entry.method === 'answerCallbackQuery').length, 1);
  }
});

test('invalid conversion inputs and overdrafts cannot mutate wallets', async () => {
  const f = fixture();
  await f.callback('currency:convert:RUB:YER');
  assert.equal(getUserState(101), null);
  assert.equal(f.requests.at(-1).show_alert, true);
  await f.callback('currency:convert:USD:YER');
  const previous = { ...f.store.findUserById(101).balances };
  for (const text of ['-1', '1e3', '0.0000001', '١١', 'Infinity']) await handleWalletMessage(f.bot, { from: { id: 101 }, chat: { id: 101 }, text });
  assert.deepEqual(f.store.findUserById(101).balances, previous);
  assert.equal(f.store.transactions.length, 0);
  assert.equal(parseAmountInput('۱٬۲۳۴٫۵۶'), 1234.56);
  assert.equal(parseAmountInput('1,234.56'), 1234.56);
  assert.equal(parseAmountInput('١,٥'), 1.5);
  assert.equal(await handleWalletMessage(f.bot, { from: { id: 101 }, chat: { id: 101 }, text: 'إلغاء' }), true);
  assert.equal(getUserState(101), null);
});

test('subscriber transfers keep sender and receiver currencies and execute only once', async () => {
  const f = fixture();
  f.store.users.push(f.store.normalizeUser({ userId: 202, firstName: 'B', currency: 'SAR', language: 'ar', isVerified: true, balances: {} }));
  setUserState(101, 'AWAITING_TRANSFER_PAYLOAD');
  await handleWalletMessage(f.bot, { from: { id: 101 }, chat: { id: 101 }, text: '٢٠٢\n١٫٢٣٤٥٦٧' });
  assert.equal(getUserState(101).name, 'AWAITING_TRANSFER_CONFIRM');
  assert.match(lastText(f.requests).text, /1\.234567 USD/);
  await f.callback('transfer:confirm');
  assert.equal(f.store.getBalance(101, 'USD'), 8.765433);
  assert.equal(f.store.getBalance(202, 'SAR'), 4.567897);
  assert.equal(f.store.transactions.filter(tx => tx.type === 'transfer_out').length, 1);
  assert.match(f.requests.find(entry => entry.chat_id === 202).text, /4\.567897 SAR/);
  await f.callback('transfer:confirm');
  assert.equal(f.store.getBalance(101, 'USD'), 8.765433);
  assert.equal(f.store.transactions.filter(tx => tx.type === 'transfer_out').length, 1);
});
