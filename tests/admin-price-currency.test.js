'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultx-admin-price-'));
process.env.ADMIN_IDS = '101';
process.env.VAULTX_DATA_DIR = directory;
process.env.RENDER = '';
require('../src/services/vaultxRuntime');
require('../src/services/vaultxCurrencyRuntime');
const { AppStore } = require('../src/services/appStore');
const { handleCallbackQuery } = require('../src/handlers/callbackHandler');
const { handleTextMessage } = require('../src/handlers/messageHandler');
const { getUserState, clearUserState } = require('../src/services/stateStore');
after(() => fs.rmSync(directory, { recursive: true, force: true }));

function fixture(currency) {
  const store = Object.create(AppStore.prototype);
  store.users = [];
  store.transactions = [];
  store.config = { services: { demo: { name: 'Demo', price: 30, priceUsd: 1, enabled: true } }, botStats: {} };
  store.persistAll = () => {};
  store.users.push(store.normalizeUser({ userId: 101, currency, language: 'ar', isVerified: true }));
  const replies = [];
  const bot = { answerCallbackQuery: async () => {}, sendMessage: async (_, text) => { replies.push(text); return { message_id: 1 }; } };
  clearUserState(101);
  return { store, replies, open: () => handleCallbackQuery(bot, { id: 'q', data: 'admin:edit_price:demo', from: { id: 101 }, message: { chat: { id: 101 }, message_id: 1 } }, store, {}),
    input: text => handleTextMessage(bot, { from: { id: 101 }, chat: { id: 101 }, text }, store) };
}

test('admin price input uses captured displayed currency and Arabic digits while preserving USD base', async () => {
  for (const [code, input] of [['USD', '١'], ['YER', '٥٣٠'], ['SAR', '٣٫٧'], ['RUB', '٣٠']]) {
    const f = fixture(code);
    await f.open();
    assert.equal(getUserState(101).currency, code);
    assert.ok(f.replies[0].includes(`عملة السعر: ${code}`));
    f.store.setCurrency(101, code === 'SAR' ? 'USD' : 'SAR');
    await f.input(input);
    assert.equal(f.store.getServices().demo.price, 30);
    assert.equal(f.store.getServices().demo.priceUsd, 1);
    assert.equal(getUserState(101), null);
  }
});

test('invalid admin price input leaves the price and captured session intact', async () => {
  const f = fixture('USD');
  await f.open();
  for (const input of ['-1', 'Infinity', '1e3', 'abc']) await f.input(input);
  assert.equal(f.store.getServices().demo.price, 30);
  assert.equal(f.store.getServices().demo.priceUsd, 1);
  assert.equal(getUserState(101).currency, 'USD');
  assert.ok(f.replies.at(-1).includes('USD'));
});


test('tiny Arabic USD admin prices keep nonzero canonical USD metadata', async () => {
  const f = fixture('USD');
  await f.open();
  await f.input('٠٫٠٠٠٠٠٠٤');
  assert.equal(f.store.getServices().demo.price, 0.000012);
  assert.equal(f.store.getServices().demo.priceUsd, 0.0000004);
  assert.equal(getUserState(101), null);
});
