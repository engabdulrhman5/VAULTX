'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultx-game-reservation-'));
process.env.VAULTX_DATA_DIR = directory;
process.env.RENDER = '';
const catalogModule = require('../src/services/gameTopupCatalogService');
const game = { key: 'test-game', name_ar: 'اللعبة', name_en: 'Game', emoji: '🎮', packages: [] };
catalogModule.getGameTopupCatalog = async () => ({ games: [game] });
const providerModule = require('../src/services/gameTopupProviderService');
let execute = async () => ({ success: true, orderId: 'order-1', provider: 'remote', status: 'created' });
providerModule.executeGameTopupOrder = async args => execute(args);
const { handleGameTopupCallback } = require('../src/services/gameTopupFlowService');
const { AppStore } = require('../src/services/appStore');
const { setUserState, clearUserState } = require('../src/services/stateStore');
after(() => fs.rmSync(directory, { recursive: true, force: true }));

function fixture() {
  const store = Object.create(AppStore.prototype);
  store.users = [];
  store.transactions = [];
  store.config = { services: {}, botStats: {} };
  store.persistAll = () => {};
  store.addProfit = () => {};
  store.users.push(store.normalizeUser({ userId: 101, currency: 'USD', language: 'ar', isVerified: true, balances: { USD: 10, SAR: 3.7 } }));
  const messages = [];
  const bot = { answerCallbackQuery: async () => {}, sendMessage: async (_, text) => { messages.push(text); return { message_id: 1 }; } };
  const payload = { gameKey: game.key, playerId: '12345', packageLabel: '60 UC', totalPrice: 30, packageItem: { units_en: '60 UC' } };
  const ready = () => setUserState(101, 'GAME_TOPUP_READY_CONFIRM', payload);
  clearUserState(101);
  ready();
  return { store, messages, ready, confirm: () => handleGameTopupCallback(bot, { id: 'q', data: 'gt:confirm', from: { id: 101 }, message: { chat: { id: 101 }, message_id: 1 } }, store) };
}

test('game order reserves a ledger and captured wallet before provider, then settles once', async () => {
  const f = fixture();
  let providerCalls = 0;
  execute = async () => {
    providerCalls += 1;
    assert.equal(f.store.transactions.length, 1);
    assert.equal(f.store.transactions[0].status, 'pending');
    assert.equal(f.store.transactions[0].walletCurrency, 'USD');
    assert.equal(f.store.getBalance(101, 'USD'), 9);
    return { success: true, orderId: 'order-1', provider: 'remote', status: 'created' };
  };
  await f.confirm();
  assert.equal(providerCalls, 1);
  assert.equal(f.store.transactions.length, 1);
  assert.equal(f.store.transactions[0].status, 'completed');
  assert.equal(f.store.transactions[0].providerOrderId, 'order-1');
  assert.equal(f.store.findUserById(101).transactionsCount, 1);
  await f.confirm();
  assert.equal(providerCalls, 1);
  assert.equal(f.store.getBalance(101, 'USD'), 9);
});

test('definite game provider rejection refunds the original wallet after a currency switch', async () => {
  const f = fixture();
  execute = async () => { f.store.setCurrency(101, 'SAR'); return { success: false, error: 'invalid_player' }; };
  await f.confirm();
  assert.equal(f.store.getBalance(101, 'USD'), 10);
  assert.equal(f.store.getBalance(101, 'SAR'), 3.7);
  assert.equal(f.store.transactions[0].status, 'refunded');
  assert.equal(f.store.findUserById(101).transactionsCount, 0);
  assert.ok(f.messages.some(text => text.includes('المحفظة التي خُصم منها')));
});

test('ambiguous response and provider exception retain reservation and prevent a retry', async () => {
  for (const response of ['provider_unconfirmed', 'provider_error', 'throw']) {
    const f = fixture();
    let providerCalls = 0;
    execute = async () => { providerCalls += 1; if (response === 'throw') throw new Error('timeout'); return { success: false, error: response }; };
    await f.confirm();
    assert.equal(f.store.getBalance(101, 'USD'), 9);
    assert.equal(f.store.transactions[0].status, 'provider_unconfirmed');
    assert.equal(f.store.findUserById(101).transactionsCount, 0);
    f.ready();
    await f.confirm();
    assert.equal(providerCalls, 1);
    assert.equal(f.store.transactions.length, 1);
    assert.equal(f.store.getBalance(101, 'USD'), 9);
    assert.ok(f.messages.some(text => text.includes('@Engineeer000')));
  }
});

test('rapid duplicate game confirms cannot create concurrent provider orders', async () => {
  const f = fixture();
  let release;
  let started;
  const providerStarted = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  let providerCalls = 0;
  execute = async () => { providerCalls += 1; started(); await pending; return { success: true, orderId: 'order-2', provider: 'remote', status: 'created' }; };
  const first = f.confirm();
  await providerStarted;
  await f.confirm();
  assert.equal(providerCalls, 1);
  release();
  await first;
  assert.equal(f.store.transactions.length, 1);
  assert.equal(f.store.getBalance(101, 'USD'), 9);
});
