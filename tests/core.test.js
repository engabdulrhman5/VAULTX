"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");
const TelegramBot = require("node-telegram-bot-api");
const { AppStore } = require("../src/services/appStore");
const currency = require("../src/services/currencyService");
const { verifyInitData } = require("../src/services/webAppAuth");
const { verifyCryptoPayWebhook } = require("../src/services/cryptoPayAuth");
const { calculateVirtualNumberPrice, extractPrice } = require("../src/services/grizzlyService");
const { getCountryList } = require("../src/services/grizzlyMenuService");
const { GAME_TOPUP_CATALOG } = require("../src/constants/gameTopupCatalog");
const { replaceMoney } = require("../src/services/vaultxCurrencyRuntime");

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
  assert.equal(currency.formatCurrency(16, "USD"), "0.533333 $");
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
  assert.equal(store.convertBalance(101, 30, "RUB", "YER"), 530);
  assert.equal(store.getBalance(101, "YER"), 530);
  assert.equal(store.convertBalance(101, 999, "RUB", "USD"), null);
  assert.equal(store.convertBalance(202, 0.0000001, "USD", "RUB"), null);
  assert.equal(store.transferInCurrency(202, 101, 0.0000001, "USD"), false);
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
  assert.match(country.text, /0\.533333 \$/);
  assert.equal(currency.convert(16 / 30, "USD", "YER"), 282.6666666666667);
  assert.equal(calculateVirtualNumberPrice(-2), 0);
  const game = GAME_TOPUP_CATALOG.games[0];
  assert.equal(game.packages[0].priceUsd, 1);
  assert.equal(game.packages[0].priceRub, 1); // compatibility alias stores USD
});

test("messages convert prices without changing quantities or IDs", () => {
  assert.equal(replaceMoney("Price: 30 RUB | ID: 123456", "YER"), "Price: 530 YER | ID: 123456");
  assert.equal(replaceMoney("السعر: 1,500 RUB", "USD"), "السعر: 50 USD");
  assert.equal(replaceMoney("100 USD", "SAR"), "370 SAR");
  assert.equal(replaceMoney("16 RUB", "USD"), "0.533333 USD");
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
