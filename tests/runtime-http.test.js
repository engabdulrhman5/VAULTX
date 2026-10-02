"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");

const repositoryRoot = path.resolve(__dirname, "..");
const token = "123456:synthetic-integration-token";

function signedIdentity(id) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id }),
  });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

async function localServer(handler) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

const pythonAvailable = spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;
for (const launcher of ["node", "python"]) {
test(`${launcher} direct entry boots currency callbacks and signed HTTP wallets on Render Free`, { timeout: 15000, skip: launcher === "python" && !pythonAvailable }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vaultx-full-runtime-"));
  const dataDirectory = path.join(root, "data");
  fs.cpSync(path.join(repositoryRoot, "src"), path.join(root, "src"), { recursive: true });
  fs.copyFileSync(path.join(repositoryRoot, "main.py"), path.join(root, "main.py"));
  fs.mkdirSync(dataDirectory);
  fs.writeFileSync(path.join(dataDirectory, "users.json"), JSON.stringify([
    { userId: 101, currency: "USD", language: "ar", isVerified: true,
      balances: { USD: 5, RUB: 60, YER: 1060, SAR: 7.4 }, transactionsCount: 2 },
    { userId: 202, currency: "USD", language: "en", isVerified: true,
      balances: { USD: 1, RUB: 0, YER: 0, SAR: 0 }, transactionsCount: 3 },
  ]));
  fs.writeFileSync(path.join(dataDirectory, "config.json"), "{}");
  fs.writeFileSync(path.join(dataDirectory, "transactions.json"), "[]");
  // The real Telegram client uses the local HTTP stub. Price refreshes use
  // Axios, so block every external provider/catalog call before app preload.
  const shim = path.join(root, "test-network.cjs");
  fs.writeFileSync(shim, `const axios=require('axios');for(const name of ['get','post','put','delete','request'])axios[name]=async()=>{throw Error('External calls disabled in runtime test')};`);

  const telegramMethods = [];
  const telegramCalls = [];
  const updates = [];
  let nextUpdateId = 1000;
  const telegram = await localServer((req, res) => {
    const method = req.url.split("/").pop().split("?")[0];
    telegramMethods.push(method);
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const fields = body ? Object.fromEntries(new URLSearchParams(body)) : {};
      telegramCalls.push({ method, ...fields });
      let result = true;
      if (method === "getUpdates") result = updates.splice(0);
      if (method === "getMe") result = { id: 999, is_bot: true, first_name: "Test Bot", username: "VaultXTestBot" };
      if (method === "sendMessage" || method === "editMessageText") result = { message_id: 77, chat: { id: Number(fields.chat_id || 202) }, text: fields.text || "test" };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  const availablePort = await localServer((req, res) => res.end());
  const port = availablePort.address().port;
  await new Promise((resolve) => availablePort.close(resolve));

  const env = {
    ...process.env,
    NODE_PATH: path.join(repositoryRoot, "node_modules"),
    NODE_OPTIONS: `--require=${shim}`,
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ""}`,
    BOT_TOKEN: token,
    PORT: String(port),
    RENDER: "true",
    RENDER_GIT_COMMIT: "integration-runtime-revision",
    RENDER_EXTERNAL_URL: "",
    VAULTX_DATA_DIR: "",
    VAULTX_REQUIRE_PERSISTENT_STORAGE: "",
    VAULTX_BOOTSTRAP_FROM_BUNDLE: "",
    TELEGRAM_BASE_API_URL: `http://127.0.0.1:${telegram.address().port}`,
    TELEGRAM_PROXY_URL: "", TELEGRAM_WEBAPP_URL: "", PUBLIC_BASE_URL: "",
    HTTPS_PROXY: "", HTTP_PROXY: "", ALL_PROXY: "", https_proxy: "", http_proxy: "", all_proxy: "",
    HERO_SMS_API_KEY: "", HERO_API_KEY: "", GRIZZLY_API_KEY: "",
    HERO_PROXY_URL: "", GRIZZLY_PROXY_URL: "", SMS_PROXY_URL: "", SMM_PROXY_URL: "",
    SMM_API_URL: "", SMM_API_KEY: "", GAME_TOPUP_API_URL: "", GAME_TOPUP_API_KEY: "",
    CRYPTO_PAY_TOKEN: "", CRYPTO_BOT_TOKEN: "", CRYPTOMUS_API_KEY: "", CRYPTOMUS_MERCHANT_ID: "",
    GMAIL_IMAP_USER: "", GMAIL_IMAP_APP_PASSWORD: "", SMS_WEBHOOK_TOKEN: "",
    DOTENV_CONFIG_PATH: path.join(root, "absent.env"),
  };
  const child = spawn(launcher === "python" ? "python3" : process.execPath,
    [launcher === "python" ? "main.py" : "src/index.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-30000); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    telegram.closeAllConnections();
    await new Promise((resolve) => telegram.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  const request = async (route, payload, identity = signedIdentity(101)) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: payload === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "x-telegram-init-data": identity },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(1000),
    });
    return { status: response.status, body: await response.json() };
  };
  const deadline = Date.now() + 8000;
  let health;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, output);
    try { health = await request("/health"); if (health.status === 200) break; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.ok(health, `Runtime did not become ready:\n${output}`);
  assert.equal(health.status, 200);
  assert.equal(health.body.storageMode, "ephemeral");
  assert.equal(health.body.storagePathConfigured, false);
  assert.equal(health.body.revision, "integration-runtime-revision");
  assert.equal(health.body.build, "2026-10-02-4");
  assert.deepEqual(health.body.features.currencies, ["USD", "RUB", "YER", "SAR"]);
  assert.deepEqual(health.body.features.conversionPairs,
    [["USD", "YER"], ["YER", "USD"], ["USD", "SAR"], ["SAR", "USD"], ["USD", "RUB"], ["RUB", "USD"]]);
  assert.equal(health.body.features.priceBase, "USD");
  assert.equal(health.body.features.currencyRouter, true);

  const readSnapshot = () => JSON.parse(fs.readFileSync(path.join(dataDirectory, "vaultx-state.json"), "utf8"));
  const readStates = () => {
    const file = path.join(dataDirectory, "states.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  };
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, output);
      const value = predicate();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`${label} did not complete through the real Telegram polling entry:\n${output}`);
  };
  const pushMessage = (id, text) => updates.push({ update_id: nextUpdateId++, message: {
    message_id: nextUpdateId, date: Math.floor(Date.now() / 1000), text,
    from: { id, is_bot: false, first_name: `Synthetic ${id}` }, chat: { id, type: "private" },
  } });
  const pushCallback = (id, data, callbackId) => updates.push({ update_id: nextUpdateId++, callback_query: {
    id: callbackId, data, chat_instance: "synthetic-chat",
    from: { id, is_bot: false, first_name: `Synthetic ${id}` },
    message: { message_id: 77, date: Math.floor(Date.now() / 1000), chat: { id, type: "private" }, text: "menu" },
  } });
  const markupOf = (call) => call.reply_markup ? JSON.parse(call.reply_markup) : {};
  const lastCurrencyMenu = (id) => [...telegramCalls].reverse().find((call) =>
    Number(call.chat_id) === id && markupOf(call).inline_keyboard?.flat().some((button) => button.callback_data === "currency:set:USD"));

  pushMessage(101, "/version");
  const versionReply = await waitFor(() => telegramCalls.find((call) => call.method === "sendMessage"
    && Number(call.chat_id) === 101 && call.text?.includes("2026-10-02-4")), "version command");
  assert.ok(versionReply.text.includes("integration-runtime-revision".slice(0, 12)));

  pushMessage(303, "/start");
  await waitFor(() => telegramCalls.find((call) => Number(call.chat_id) === 303
    && markupOf(call).inline_keyboard?.flat().some((button) => button.callback_data === "setlang_ar")), "language prompt");
  pushCallback(303, "setlang_ar", "registration-language");
  await waitFor(() => readStates()[303]?.name === "AWAITING_CURRENCY", "registration currency selection");
  await waitFor(() => lastCurrencyMenu(303), "registration currency keyboard");
  assert.deepEqual(markupOf(lastCurrencyMenu(303)).inline_keyboard.map((row) => row.length), [2, 2]);
  pushCallback(303, "currency:set:SAR", "registration-currency");
  const captcha = await waitFor(() => readStates()[303]?.name === "AWAITING_CAPTCHA" && readStates()[303].captchaCode, "CAPTCHA after currency selection");
  pushMessage(303, captcha);
  await waitFor(() => readSnapshot().users.find((user) => user.userId === 303)?.isVerified, "CAPTCHA verification");
  const menu = await waitFor(() => [...telegramCalls].reverse().find((call) => Number(call.chat_id) === 303
    && markupOf(call).inline_keyboard?.flat().some((button) => button.callback_data === "service:virtual_numbers")), "verified main menu");
  assert.match(menu.text, /\$ 0\.00  ·  ₽ 0\.00\nر\.ي 0\.00  ·  ر\.س 0\.00/);
  assert.equal(markupOf(menu).inline_keyboard.flat().some((button) => button.callback_data?.startsWith("wallet:")), false);
  const beforeWalletTaps = structuredClone(readSnapshot().users.find((user) => user.userId === 303));
  const beforeWalletState = readStates()[303];
  for (const [data, callbackId] of [["wallet:display:USD", "retired-wallet-display"], ["wallet:select:RUB", "retired-wallet-selection"]]) {
    const callsBeforeRetiredTap = telegramCalls.length;
    pushCallback(303, data, callbackId);
    const refreshed = await waitFor(() => telegramCalls.slice(callsBeforeRetiredTap).find((call) => Number(call.chat_id) === 303
      && markupOf(call).inline_keyboard?.flat().some((button) => button.callback_data === "service:virtual_numbers")), "retired wallet menu refresh");
    assert.equal(refreshed.text, menu.text);
    assert.equal(markupOf(refreshed).inline_keyboard.flat().some((button) => button.callback_data?.startsWith("wallet:")), false);
    const acknowledgment = telegramCalls.find((call) => call.method === "answerCallbackQuery" && call.callback_query_id === callbackId);
    assert.ok(acknowledgment);
    assert.equal(acknowledgment.text, undefined);
    assert.deepEqual(readSnapshot().users.find((user) => user.userId === 303), beforeWalletTaps);
    assert.deepEqual(readStates()[303], beforeWalletState);
  }
  pushCallback(303, "menu:currency", "settings-currency");
  await waitFor(() => telegramCalls.some((call) => call.method === "answerCallbackQuery" && call.callback_query_id === "settings-currency"), "currency menu acknowledgment");
  pushCallback(303, "currency:set:USD", "settings-currency-change");
  await waitFor(() => readSnapshot().users.find((user) => user.userId === 303)?.currency === "USD", "verified preferred currency update");

  // Exercise the six real callback routes and their subsequent text inputs;
  // no direct runtime helper calls bypass Telegram's EventEmitter wrappers.
  pushCallback(101, "transfer:currency", "conversion-home");
  const conversions = await waitFor(() => [...telegramCalls].reverse().find((call) => Number(call.chat_id) === 101
    && markupOf(call).inline_keyboard?.flat().some((button) => button.callback_data === "currency:convert:USD:YER")), "conversion menu");
  assert.deepEqual(markupOf(conversions).inline_keyboard.flat().filter((button) => button.callback_data?.startsWith("currency:convert:")).map((button) => button.callback_data),
    ["currency:convert:USD:YER", "currency:convert:YER:USD", "currency:convert:USD:SAR", "currency:convert:SAR:USD", "currency:convert:USD:RUB", "currency:convert:RUB:USD"]);
  for (const [from, to, amount] of [["USD", "YER", 1], ["YER", "USD", 530], ["USD", "SAR", 1], ["SAR", "USD", 3.7], ["USD", "RUB", 1], ["RUB", "USD", 30]]) {
    const before = readSnapshot().transactions.filter((tx) => tx.type === "currency_conversion").length;
    pushCallback(101, `currency:convert:${from}:${to}`, `pair-${from}-${to}`);
    await waitFor(() => readStates()[101]?.name === "AWAITING_CURRENCY_CONVERSION"
      && readStates()[101].fromCurrency === from && readStates()[101].toCurrency === to, `${from} to ${to} input prompt`);
    pushMessage(101, String(amount));
    await waitFor(() => readSnapshot().transactions.filter((tx) => tx.type === "currency_conversion").length === before + 1, `${from} to ${to} conversion`);
  }
  assert.deepEqual(readSnapshot().users.find((user) => user.userId === 101).balances, { USD: 5, RUB: 60, YER: 1060, SAR: 7.4 });

  const forged = signedIdentity(101).replace(encodeURIComponent('"id":101'), encodeURIComponent('"id":202'));
  assert.notEqual(forged, signedIdentity(101));
  assert.equal((await request("/webapp/profile?user_id=202", undefined, forged)).status, 401);
  assert.equal((await request("/webapp/transfer", { target_id: 101, amount: 1, currency: "USD", user_id: 202 }, "")).status, 401);
  const profile = await request("/webapp/profile?user_id=202");
  assert.equal(profile.status, 200);
  assert.equal(profile.body.profile.id, 101);

  for (const [from, to, amount] of [
    ["USD", "YER", 1], ["YER", "USD", 530],
    ["USD", "SAR", 1], ["SAR", "USD", 3.7],
    ["USD", "RUB", 1], ["RUB", "USD", 30],
  ]) {
    const result = await request("/webapp/convert", { from, to, amount });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.ok, true);
  }
  assert.equal((await request("/webapp/convert", { from: "YER", to: "SAR", amount: 1 })).status, 400);
  assert.equal((await request("/webapp/convert", { from: "USD", to: "RUB", amount: 0.000000001 })).status, 400);
  let snapshot = JSON.parse(fs.readFileSync(path.join(dataDirectory, "vaultx-state.json"), "utf8"));
  assert.equal(snapshot.transactions.filter((tx) => tx.type === "currency_conversion").length, 12);
  assert.deepEqual(snapshot.users.find((user) => user.userId === 101).balances, { USD: 5, RUB: 60, YER: 1060, SAR: 7.4 });

  const transfer = await request("/webapp/transfer", { target_id: 202, currency: "USD", amount: 1, user_id: 202 });
  assert.equal(transfer.status, 200, JSON.stringify(transfer.body));
  snapshot = JSON.parse(fs.readFileSync(path.join(dataDirectory, "vaultx-state.json"), "utf8"));
  const sender = snapshot.users.find((user) => user.userId === 101);
  const receiver = snapshot.users.find((user) => user.userId === 202);
  assert.equal(sender.balances.USD, 4);
  assert.equal(receiver.balances.USD, 2);
  assert.equal(sender.transactionsCount, 3);
  assert.equal(receiver.transactionsCount, 4);
  assert.deepEqual(snapshot.transactions.filter((tx) => /^transfer_/.test(tx.type)).map((tx) => [tx.type, tx.userId, tx.amount, tx.currency]),
    [["transfer_out", 101, 1, "USD"], ["transfer_in", 202, 1, "USD"]]);
  assert.ok(telegramMethods.includes("getMe"), `Bootstrap did not call local Telegram stub:\n${output}`);
  assert.equal(child.exitCode, null, output);
});
}
