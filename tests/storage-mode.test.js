"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "..");

// Copy only implementation modules into a disposable fixture. Bootstrap tests
// must never read the repository's historical wallet data or modify it.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vaultx-storage-mode-"));
  for (const relative of [
    "src/config/index.js",
    "src/services/appStore.js",
    "src/services/currencyService.js",
    "src/services/jsonStorage.js",
  ]) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, relative), target);
  }
  const bundled = path.join(root, "data");
  const explicit = path.join(root, "restored-wallets");
  fs.mkdirSync(bundled);
  fs.mkdirSync(explicit);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (code, overrides = {}) => spawnSync(process.execPath, ["-e", code], {
    cwd: root,
    env: {
      ...process.env,
      NODE_PATH: path.join(repositoryRoot, "node_modules"),
      DOTENV_CONFIG_PATH: path.join(root, "absent.env"),
      RENDER: "",
      VAULTX_DATA_DIR: "",
      VAULTX_REQUIRE_PERSISTENT_STORAGE: "",
      VAULTX_BOOTSTRAP_FROM_BUNDLE: "",
      ...overrides,
    },
    encoding: "utf8",
    timeout: 5000,
  });
  return { root, bundled, explicit, run };
}

function seed(directory, rub = 120) {
  fs.writeFileSync(path.join(directory, "users.json"), JSON.stringify([
    { userId: 101, currency: "RUB", balance: rub, isVerified: true },
  ]));
  fs.writeFileSync(path.join(directory, "config.json"), "{}");
  fs.writeFileSync(path.join(directory, "transactions.json"), "[]");
}

test("Render Free starts with the default ephemeral data directory", (t) => {
  const { bundled, run } = fixture(t);
  seed(bundled);
  const result = run("const s=new (require('./src/services/appStore').AppStore)();if(s.getBalance(101,'RUB')!==120)throw Error('wallet changed');", { RENDER: "true" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(bundled, "vaultx-state.json")), true);
});

test("required persistent storage rejects Render without a disk and a fake disk path", (t) => {
  const { explicit, run } = fixture(t);
  const missing = run("require('./src/config')", {
    RENDER: "true", VAULTX_REQUIRE_PERSISTENT_STORAGE: "1",
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /VAULTX_DATA_DIR|persistent|mount/i);
  const fake = run("require('./src/config')", {
    RENDER: "true", VAULTX_REQUIRE_PERSISTENT_STORAGE: "1", VAULTX_DATA_DIR: explicit,
  });
  assert.notEqual(fake.status, 0);
  assert.match(fake.stderr, /persistent|mount/i);
});

test("an explicitly configured empty data directory requires deliberate bootstrap", (t) => {
  const { explicit, run } = fixture(t);
  const result = run("new (require('./src/services/appStore').AppStore)()", { VAULTX_DATA_DIR: explicit });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Incomplete wallet data/);
  assert.equal(fs.existsSync(path.join(explicit, "vaultx-state.json")), false);
});

test("bootstrap reads only the synthetic bundled data and produces a restartable snapshot", (t) => {
  const { bundled, explicit, run } = fixture(t);
  seed(bundled, 450);
  const bootstrap = run("const s=new (require('./src/services/appStore').AppStore)();if(s.getBalance(101,'RUB')!==450)throw Error('seed mismatch');", {
    VAULTX_DATA_DIR: explicit, VAULTX_BOOTSTRAP_FROM_BUNDLE: "1",
  });
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  const restart = run("const s=new (require('./src/services/appStore').AppStore)();if(s.getBalance(101,'RUB')!==450)throw Error('restart mismatch');", {
    VAULTX_DATA_DIR: explicit,
  });
  assert.equal(restart.status, 0, restart.stderr);
});

test("bootstrap does not overwrite an incomplete restoration", (t) => {
  const { bundled, explicit, run } = fixture(t);
  seed(bundled, 450);
  fs.writeFileSync(path.join(explicit, "users.json"), "[]");
  const result = run("new (require('./src/services/appStore').AppStore)()", {
    VAULTX_DATA_DIR: explicit, VAULTX_BOOTSTRAP_FROM_BUNDLE: "1",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Incomplete wallet data/);
  assert.equal(fs.existsSync(path.join(explicit, "vaultx-state.json")), false);
  assert.equal(fs.readFileSync(path.join(explicit, "users.json"), "utf8"), "[]");
});

test("a corrupt wallet snapshot cannot fall back to stale bundled balances", (t) => {
  const { bundled, explicit, run } = fixture(t);
  seed(bundled, 450);
  const corrupt = "{broken";
  fs.writeFileSync(path.join(explicit, "vaultx-state.json"), corrupt);
  const result = run("new (require('./src/services/appStore').AppStore)()", {
    VAULTX_DATA_DIR: explicit, VAULTX_BOOTSTRAP_FROM_BUNDLE: "1",
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(explicit, "vaultx-state.json"), "utf8"), corrupt);
});

test("subscriber transfers persist both wallets, receipts, and counters together and roll back on failure", (t) => {
  const { bundled, run } = fixture(t);
  seed(bundled);
  const result = run(`
    const assert=require('node:assert/strict');
    const {AppStore}=require('./src/services/appStore');
    const s=new AppStore();
    s.users=[s.normalizeUser({userId:101,currency:'USD',balances:{USD:3},transactionsCount:2}),
      s.normalizeUser({userId:202,currency:'YER',balances:{YER:0},transactionsCount:4})];
    s.transactions=[];
    let writes=0;
    s.persistAll=()=>{writes++};
    assert.equal(s.transferPreferred(101,202,30,'USD','YER'),true);
    assert.equal(writes,1);
    assert.equal(s.getBalance(101,'USD'),2);
    assert.equal(s.getBalance(202,'YER'),530);
    assert.deepEqual(s.users.map(u=>u.transactionsCount),[3,5]);
    assert.deepEqual(s.transactions.map(tx=>[tx.type,tx.userId,tx.amount,tx.currency]),
      [['transfer_out',101,1,'USD'],['transfer_in',202,530,'YER']]);
    const before=JSON.stringify({users:s.users,transactions:s.transactions});
    s.persistAll=()=>{throw Error('disk unavailable')};
    assert.throws(()=>s.transferPreferred(101,202,30,'USD','YER'),/disk unavailable/);
    assert.equal(JSON.stringify({users:s.users,transactions:s.transactions}),before);
  `);
  assert.equal(result.status, 0, result.stderr);
});

test("topup settlement preserves the quoted wallet and is atomic and idempotent", (t) => {
  const { bundled, run } = fixture(t);
  seed(bundled);
  const result = run(`
    const assert=require('node:assert/strict');
    const {AppStore}=require('./src/services/appStore');
    const s=new AppStore();
    s.users=[s.normalizeUser({userId:101,currency:'SAR',balances:{USD:2,SAR:7.4},totalDeposits:15,transactionsCount:2})];
    s.transactions=[{id:'invoice-1',type:'topup_crypto_pending',userId:101,amount:30,walletCurrency:'USD',status:'pending'}];
    const before=JSON.stringify({users:s.users,transactions:s.transactions});
    s.persistAll=()=>{throw Error('disk unavailable')};
    assert.throws(()=>s.settleTopup('invoice-1',{type:'topup_crypto_paid'}, {paidRub:30}),/disk unavailable/);
    assert.equal(JSON.stringify({users:s.users,transactions:s.transactions}),before);
    let writes=0;
    s.persistAll=()=>{writes++};
    assert.equal(s.settleTopup('invoice-1',{type:'topup_crypto_paid'},{paidRub:30}).userId,101);
    assert.equal(writes,1);
    assert.equal(s.getBalance(101,'USD'),3);
    assert.equal(s.getBalance(101,'SAR'),7.4);
    assert.equal(s.users[0].totalDeposits,45);
    assert.equal(s.users[0].transactionsCount,3);
    assert.equal(s.getTransactionById('invoice-1').status,'paid');
    assert.equal(s.transactions[1].amount,30);
    assert.equal(s.transactions[1].walletCurrency,'USD');
    assert.equal(s.settleTopup('invoice-1',{type:'topup_crypto_paid'}),null);
    assert.equal(s.settleTopup('missing',{type:'topup_crypto_paid'}),null);
    assert.equal(writes,1);
    assert.equal(s.transactions.length,2);
  `);
  assert.equal(result.status, 0, result.stderr);
});

test("subprecision source amounts cannot credit a target wallet without a debit", (t) => {
  const { bundled, run } = fixture(t);
  seed(bundled);
  const result = run(`
    const assert=require('node:assert/strict');
    const {AppStore}=require('./src/services/appStore');
    const s=new AppStore();
    s.users=[s.normalizeUser({userId:101,currency:'USD',balances:{USD:3}}),
      s.normalizeUser({userId:202,currency:'YER',balances:{YER:0}})];
    s.transactions=[];
    let writes=0;
    s.persistAll=()=>{writes++};
    assert.equal(s.transferPreferred(101,202,0.00000003,'USD','YER'),false);
    assert.equal(s.transferInCurrency(101,202,0.0000000001,'USD'),false);
    assert.equal(s.convertBalance(101,0.000000001,'USD','YER'),null);
    assert.equal(s.getBalance(101,'USD'),3);
    assert.equal(s.getBalance(101,'YER'),0);
    assert.equal(s.getBalance(202,'YER'),0);
    assert.equal(s.transactions.length,0);
    assert.equal(writes,0);
  `);
  assert.equal(result.status, 0, result.stderr);
});

test("currency conversion and subscriber transfer round trips cannot increase balances", (t) => {
  const { bundled, run } = fixture(t);
  seed(bundled);
  const result = run(`
    const assert=require('node:assert/strict');
    const {AppStore}=require('./src/services/appStore');
    const {currencyToRub}=require('./src/services/currencyService');
    for(const code of ['YER','SAR']) {
      const s=new AppStore();
      s.users=[s.normalizeUser({userId:101,currency:code,balances:{[code]:1}}),
        s.normalizeUser({userId:202,currency:'USD',balances:{USD:0}})];
      s.transactions=[];
      s.persistAll=()=>{};
      for(let i=0;i<20;i++) {
        const source=s.getBalance(101,code);
        const usd=s.convertBalance(101,source,code,'USD');
        assert.ok(usd>0);
        assert.ok(s.convertBalance(101,usd,'USD',code)>0);
        assert.ok(s.getBalance(101,code)<=source);
        assert.equal(s.getBalance(101,'USD'),0);
      }
      const source=s.getBalance(101,code);
      assert.equal(s.transferPreferred(101,202,currencyToRub(source,code),code,'USD'),true);
      const usd=s.getBalance(202,'USD');
      assert.equal(s.transferPreferred(202,101,currencyToRub(usd,'USD'),'USD',code),true);
      assert.ok(s.getBalance(101,code)<=source);
      assert.ok(s.getBalance(101,code)<=1);
      assert.equal(s.getBalance(202,'USD'),0);
    }
  `);
  assert.equal(result.status, 0, result.stderr);
});

test("purchase reservation and refund roll back and return the original wallet exactly once", (t) => {
  const { bundled, run } = fixture(t);
  seed(bundled);
  const result = run(`
    const assert=require('node:assert/strict');
    const {AppStore}=require('./src/services/appStore');
    const s=new AppStore();
    s.users=[s.normalizeUser({userId:101,currency:'USD',balances:{USD:3,SAR:7.4},transactionsCount:2})];
    s.transactions=[];
    const beforeReserve=JSON.stringify({users:s.users,transactions:s.transactions});
    s.persistAll=()=>{throw Error('disk unavailable')};
    assert.throws(()=>s.reservePurchase(101,30,{type:'virtual_number_purchase'}),/disk unavailable/);
    assert.equal(JSON.stringify({users:s.users,transactions:s.transactions}),beforeReserve);
    let writes=0;
    s.persistAll=()=>{writes++};
    const pending=s.reservePurchase(101,30,{type:'virtual_number_purchase'});
    assert.equal(writes,1);
    assert.equal(pending.status,'pending');
    assert.equal(pending.walletCurrency,'USD');
    assert.equal(pending.reservedAmount,1);
    assert.equal(s.getBalance(101,'USD'),2);
    assert.equal(s.users[0].transactionsCount,2);
    s.setCurrency(101,'SAR');
    const beforeRefund=JSON.stringify({users:s.users,transactions:s.transactions});
    s.persistAll=()=>{throw Error('disk unavailable')};
    assert.throws(()=>s.resolvePendingPurchase(pending.id,{status:'refunded'}),/disk unavailable/);
    assert.equal(JSON.stringify({users:s.users,transactions:s.transactions}),beforeRefund);
    s.persistAll=()=>{writes++};
    assert.equal(s.resolvePendingPurchase(pending.id,{status:'refunded'}).status,'refunded');
    assert.equal(s.getBalance(101,'USD'),3);
    assert.equal(s.getBalance(101,'SAR'),7.4);
    assert.equal(s.users[0].transactionsCount,2);
    assert.equal(writes,3);
    assert.equal(s.resolvePendingPurchase(pending.id,{status:'refunded'}),null);
    assert.equal(s.resolvePendingPurchase('missing',{status:'refunded'}),null);
    assert.equal(writes,3);
    const second=s.reservePurchase(101,30,{type:'game_topup_order'});
    assert.equal(s.getBalance(101,'SAR'),3.7);
    assert.equal(s.resolvePendingPurchase(second.id,{status:'provider_unconfirmed'}).status,'provider_unconfirmed');
    assert.equal(s.resolvePendingPurchase(second.id,{status:'completed'}).status,'completed');
    assert.equal(s.users[0].transactionsCount,3);
    assert.equal(s.resolvePendingPurchase(second.id,{status:'completed'}),null);
    assert.equal(s.resolvePendingPurchase(second.id,{status:'refunded'}),null);
    assert.equal(s.getBalance(101,'SAR'),3.7);
    assert.equal(s.users[0].transactionsCount,3);
  `);
  assert.equal(result.status, 0, result.stderr);
});
