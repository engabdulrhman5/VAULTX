"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");
const os = require("os");
const { spawnSync } = require("child_process");
const TelegramBot = require("node-telegram-bot-api");
const { AppStore } = require("../src/services/appStore");
const currency = require("../src/services/currencyService");
const { verifyInitData } = require("../src/services/webAppAuth");
const { verifyCryptoPayWebhook } = require("../src/services/cryptoPayAuth");
const { calculateVirtualNumberPrice, extractPrice } = require("../src/services/grizzlyService");
const { getCountryList } = require("../src/services/grizzlyMenuService");
const { GAME_TOPUP_CATALOG } = require("../src/constants/gameTopupCatalog");
const { replaceMoney, conversionKeyboard, CONVERSION_PAIRS } = require("../src/services/vaultxCurrencyRuntime");

function memoryStore() {
  const store = Object.create(AppStore.prototype);
  store.users = [];
  store.transactions = [];
  store.config = { services: {}, botStats: {} };
  store.persistAll = () => {};
  return store;
}

test("one USD converts at the fixed rates through every pair", () => {
  assert.deepEqual(Object.fromEntries(currency.CURRENCY_CODES.map((code) =>
    [code, currency.convert(1, "USD", code)])), { USD: 1, RUB: 30, YER: 530, SAR: 3.7 });
  assert.equal(currency.convert(530, "YER", "SAR"), 3.7);
  assert.equal(currency.convert(30, "RUB", "USD"), 1);
  assert.equal(currency.DEFAULT_CURRENCY, "USD");
  assert.equal(currency.formatCurrency(16, "USD"), "0.54 $");
});

test("old RUB balance remains intact and wallets cannot overdraw", () => {
  const store = memoryStore();
  const old = store.normalizeUser({ userId: 101, balance: 300, language: "ar", currency: "RUB" });
  store.users.push(old, store.normalizeUser({ userId: 202, balances: { USD: 0 }, currency: "USD" }));
  assert.equal(old.balances.RUB, 300);
  assert.equal(old.balance, 300);
  assert.equal(store.deductBalance(101, 301), null);
  assert.equal(store.deductBalance(101, -1), null);
  assert.equal(store.addBalanceInCurrency(101, -1, "USD"), null);
  assert.equal(store.transferPreferred(101, 202, 30, "RUB", "USD"), true);
  assert.equal(old.balances.RUB, 270);
  assert.equal(store.getBalance(202, "USD"), 1);
  assert.equal(store.convertBalance(101, 30, "RUB", "USD"), 1);
  assert.equal(store.convertBalance(101, 1, "USD", "YER"), 530);
  assert.equal(store.getBalance(101, "YER"), 530);
  assert.equal(store.convertBalance(101, 30, "RUB", "YER"), null);
  assert.equal(store.convertBalance(101, 999, "RUB", "USD"), null);
  assert.equal(store.convertBalance(202, 0.0000001, "USD", "RUB"), null);
  assert.equal(store.transferInCurrency(202, 101, 0.0000001, "USD"), false);
  const previousRub = store.getBalance(101, "RUB");
  const previousUsd = store.getBalance(101, "USD");
  const previousTransactions = store.transactions.length;
  store.persistAll = () => { throw new Error("disk unavailable"); };
  assert.throws(() => store.convertBalance(101, 30, "RUB", "USD"), /disk unavailable/);
  assert.equal(store.getBalance(101, "RUB"), previousRub);
  assert.equal(store.getBalance(101, "USD"), previousUsd);
  assert.equal(store.transactions.length, previousTransactions);
});

function signedInitData(token, userId, now, signature = null) {
  const pairs = new URLSearchParams({ auth_date: String(now), user: JSON.stringify({ id: userId }) });
  if (signature) pairs.set("signature", signature);
  const check = [...pairs.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  pairs.set("hash", crypto.createHmac("sha256", secret).update(check).digest("hex"));
  return pairs.toString();
}

test("Mini App accepts only fresh Telegram signed identity", () => {
  const token = "test:telegram-secret";
  const now = 1800000000;
  const valid = signedInitData(token, 101, now, "signed-third-party-field");
  assert.equal(verifyInitData(valid, token, now), 101);
  assert.equal(verifyInitData(valid.replace("101", "202"), token, now), null);
  assert.equal(verifyInitData(`${valid}&user=%7B%22id%22%3A202%7D`, token, now), null);
  assert.equal(verifyInitData(signedInitData(token, 101, now - 86401), token, now), null);
  assert.equal(verifyInitData(valid, "different-token", now), null);
});

test("Crypto Pay webhook signature binds the raw body to the token", () => {
  const token = "test-pay-token";
  const body = '{"invoice_id":42,"status":"paid"}';
  const key = crypto.createHash("sha256").update(token).digest();
  const signature = crypto.createHmac("sha256", key).update(body).digest("hex");
  assert.equal(verifyCryptoPayWebhook(body, signature, token), true);
  assert.equal(verifyCryptoPayWebhook(body + " ", signature, token), false);
  assert.equal(verifyCryptoPayWebhook(body, signature, ""), false);
});

test("provider USD prices and legacy prices produce matching RUB sale prices", () => {
  const payload = { 12: { wa: { cost: 0.51, count: 10 } } };
  assert.equal(extractPrice(payload, 12, "wa"), 0.51);
  assert.equal(calculateVirtualNumberPrice(0.51), 16);
  const country = getCountryList("en", payload, "wa", "USD")[0];
  assert.equal(country.price, 16);
  assert.match(country.text, /0\.54 \$/);
  assert.equal(currency.convert(16 / 30, "USD", "YER"), 282.6666666666667);
  assert.equal(calculateVirtualNumberPrice(-2), 0);
  const game = GAME_TOPUP_CATALOG.games[0];
  assert.equal(game.packages[0].priceUsd, 1);
  assert.equal(game.packages[0].priceRub, 1); // compatibility alias stores USD
});

test("messages convert prices without changing quantities or IDs", () => {
  assert.equal(replaceMoney("Price: 30 RUB | ID: 123456", "YER"), "Price: 530.00 YER | ID: 123456");
  assert.equal(replaceMoney("السعر: 1,500 RUB", "USD"), "السعر: 50.00 USD");
  assert.equal(replaceMoney("100 USD", "SAR"), "370.00 SAR");
  assert.equal(replaceMoney("16 RUB", "USD"), "0.54 USD");
});

test("conversion menu has six USD pairs and prices round up without hiding leading zeros", () => {
  assert.deepEqual(CONVERSION_PAIRS, [["USD", "YER"], ["YER", "USD"], ["USD", "SAR"], ["SAR", "USD"], ["USD", "RUB"], ["RUB", "USD"]]);
  assert.deepEqual(conversionKeyboard("ar").inline_keyboard.slice(0, 6).map((row) => row[0].callback_data),
    CONVERSION_PAIRS.map(([from, to]) => `currency:convert:${from}:${to}`));
  assert.equal(currency.formatPriceNumber(1.231), "1.24");
  assert.equal(currency.formatPriceNumber(0.004321), "0.0044");
  assert.equal(currency.formatPriceNumber(0.07), "0.070");
  assert.equal(currency.formatPriceNumber(0.533333), "0.54");
});

test("wallet snapshot survives a restart and invalid snapshots cannot reset balances", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vaultx-wallet-test-"));
  const env = { ...process.env, VAULTX_DATA_DIR: directory, RENDER: "" };
  const run = (code) => spawnSync(process.execPath, ["-e", code], { cwd: path.join(__dirname, ".."), env, encoding: "utf8" });
  try {
    fs.writeFileSync(path.join(directory, "users.json"), JSON.stringify([{ userId: 101, balance: 300, currency: "RUB", isVerified: true }]));
    fs.writeFileSync(path.join(directory, "config.json"), "{}");
    fs.writeFileSync(path.join(directory, "transactions.json"), "[]");
    const first = run('const s=new (require("./src/services/appStore").AppStore)(); if(s.convertBalance(101,30,"RUB","USD")!==1)process.exit(2);');
    assert.equal(first.status, 0, first.stderr);
    const second = run('const s=new (require("./src/services/appStore").AppStore)(); if(s.getBalance(101,"RUB")!==270||s.getBalance(101,"USD")!==1||s.transactions.filter(x=>x.type==="currency_conversion").length!==1)process.exit(2);');
    assert.equal(second.status, 0, second.stderr);
    fs.writeFileSync(path.join(directory, "vaultx-state.json"), "{broken");
    const corrupt = run('new (require("./src/services/appStore").AppStore)();');
    assert.notEqual(corrupt.status, 0);
    const noDisk = spawnSync(process.execPath, ["-e", 'require("./src/config")'], {
      cwd: path.join(__dirname, ".."), env: { ...process.env, RENDER: "true", VAULTX_DATA_DIR: "" }, encoding: "utf8",
    });
    assert.notEqual(noDisk.status, 0);
    const fakeDisk = spawnSync(process.execPath, ["-e", 'require("./src/config")'], {
      cwd: path.join(__dirname, ".."), env: { ...process.env, RENDER: "true", VAULTX_DATA_DIR: directory }, encoding: "utf8",
    });
    assert.notEqual(fakeDisk.status, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("cached SMS country prices open a multi-provider menu without provider calls", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vaultx-prices-test-"));
  try {
    fs.writeFileSync(path.join(directory, "users.json"), JSON.stringify([{ userId: 101, balance: 300, currency: "RUB", isVerified: true }]));
    fs.writeFileSync(path.join(directory, "config.json"), "{}");
    fs.writeFileSync(path.join(directory, "transactions.json"), "[]");
    const country = (key) => ({ id: "US", code: "US", name_en: "United States", name_ar: "أمريكا", flag: "🇺🇸", providerCountryId: "187", providerKey: key });
    const cache = {};
    for (const [key, cost] of [["server1", 0.4], ["server2", 0.5]]) {
      cache[`virtual-number-snapshot:v4:${key}:wa`] = { data: { countries: [country(key)] } };
      cache[`prices:${key}:wa`] = { at: Date.now(), data: { 187: { wa: { cost, count: 10 } } } };
    }
    fs.writeFileSync(path.join(directory, "virtual-number-cache.json"), JSON.stringify(cache));
    const code = `const {AppStore}=require('./src/services/appStore'); const {handleVirtualNumbersCallback}=require('./src/services/virtualNumbersFlowService');
      const calls=[]; const bot={answerCallbackQuery:async()=>{calls.push('answer')},editMessageText:async(_,options)=>{calls.push('edit');const buttons=options.reply_markup.inline_keyboard.flat();const prices=buttons.filter(x=>x.callback_data.startsWith('vnm:buy:'));if(calls.length===2&&prices.length!==4)throw Error('missing provider options');if(calls.length===4&&!buttons.some(x=>x.text.includes('Refresh list')))throw Error('missing empty-state retry')}};
      (async()=>{const s=new AppStore();const q={id:'q',data:'vnm:country:wa:US:0',from:{id:101},message:{chat:{id:101},message_id:9}};if(!await handleVirtualNumbersCallback(bot,q,s))process.exit(2);q.data='vnm:country:wa:CA:0';if(!await handleVirtualNumbersCallback(bot,q,s)||calls.join(',')!=='answer,edit,answer,edit')process.exit(2)})().catch(e=>{console.error(e);process.exit(3)});`;
    const result = spawnSync(process.execPath, ["-e", code], { cwd: path.join(__dirname, ".."), env: { ...process.env, VAULTX_DATA_DIR: directory, RENDER: "" }, encoding: "utf8", timeout: 4000 });
    assert.equal(result.status, 0, result.stderr);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("first language and currency selection advances to CAPTCHA with one callback answer per tap", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vaultx-onboarding-test-"));
  try {
    for (const [name, content] of [["users", "[]"], ["config", "{}"], ["transactions", "[]"]])
      fs.writeFileSync(path.join(directory, `${name}.json`), content);
    const code = `const {AppStore}=require('./src/services/appStore');const {handleCurrencyCallback}=require('./src/services/vaultxRuntime');const {getUserState}=require('./src/services/stateStore');
      const s=new AppStore();const calls=[];const bot={answerCallbackQuery:async()=>{calls.push('answer')},editMessageText:async(_,o)=>{calls.push('edit');if(calls.length===2&&o.reply_markup.inline_keyboard.some(row=>row.some(b=>b.callback_data==='menu:settings')))throw Error('registration back button');return {message_id:9}}};
      const q={id:'q',data:'setlang_ar',from:{id:101,first_name:'A'},message:{chat:{id:101},message_id:9}};
      (async()=>{if(!await handleCurrencyCallback(bot,q)||getUserState(101)?.name!=='AWAITING_CURRENCY')throw Error('language failed');q.data='currency:set:USD';if(!await handleCurrencyCallback(bot,q)||getUserState(101)?.name!=='AWAITING_CAPTCHA'||calls.join(',')!=='answer,edit,answer,edit')throw Error('currency failed')})().catch(e=>{console.error(e);process.exit(2)});`;
    const result = spawnSync(process.execPath, ["-e", code], { cwd: path.join(__dirname, ".."), env: { ...process.env, VAULTX_DATA_DIR: directory, RENDER: "" }, encoding: "utf8", timeout: 4000 });
    assert.equal(result.status, 0, result.stderr);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("Mini App inline JavaScript parses", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "webapp", "vaultx-app.html"), "utf8");
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length > 0);
  for (const [, code] of blocks) if (code.trim()) new vm.Script(code);
});

test("Telegram transport sends text and multipart photos with patched dependencies", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let size = 0;
    req.on("data", (chunk) => { size += chunk.length; });
    req.on("end", () => {
      requests.push({ path: req.url, type: req.headers["content-type"], size });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, result: { message_id: 1, chat: { id: 101 }, date: 1 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const bot = new TelegramBot("123:TEST", {
      polling: false,
      baseApiUrl: `http://127.0.0.1:${server.address().port}`,
      request: { proxy: false },
    });
    await bot.sendMessage(101, "test");
    await bot.sendPhoto(101, Buffer.from("image bytes"), {}, { filename: "image.png", contentType: "image/png" });
    assert.equal(requests.length, 2);
    assert.match(requests[0].path, /sendMessage/);
    assert.match(requests[1].type, /multipart\/form-data/);
    assert.ok(requests[1].size > 100);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
