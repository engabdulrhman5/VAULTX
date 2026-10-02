"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MINUTE = 60 * 1000;

function evaluateService(file, dependencies, env = {}, clock = { now: Date.now() }) {
  const filename = path.resolve(__dirname, "../src/services", file);
  const module = { exports: {} };
  class ClockDate extends Date { static now() { return clock.now; } }
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports, __dirname: path.dirname(filename), Date: ClockDate,
    process: { env: { DEBUG_HERO: "0", ...env } }, URL, URLSearchParams, Buffer,
    console: { log() {}, error() {} },
    setTimeout: () => ({ unref() {} }),
    require: (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(require.resolve(name, { paths: [path.dirname(filename)] })),
  }, { filename });
  return module.exports;
}

function smsHarness(initial = {}, get = async () => ({ status: 200, data: {} })) {
  const clock = { now: Date.now() };
  let fileReads = 0;
  const logs = [];
  const constants = {
    grizzlyServices: { whatsapp: "wa", telegram: "tg" },
    getGrizzlyServiceCode: (app) => /^(telegram|tg)$/i.test(app) ? "tg" : /^(whatsapp|wa)$/i.test(app) ? "wa" : null,
    getGrizzlyCountryMeta: (id) => ({ id: String(id), name_ar: "الولايات المتحدة", name_en: "United States", flag: "🇺🇸" }),
  };
  const dependencies = {
    axios: { get },
    fs: { existsSync: () => true, readFileSync: () => { fileReads += 1; return JSON.stringify(initial); } },
    "../config": { VIRTUAL_CACHE_PATH: "/virtual-cache.json", ACTIVATIONS_CHANNEL_ID: 0 },
    "../constants/grizzly": constants,
    "../constants/smsProviders": { getSmsProvider: (key) => ({ key, apiKey: "test-only-key", baseUrl: "https://provider.invalid/api" }) },
    "./jsonStorage": { saveData() {} },
    "./errorLogger": { logBotError: (...args) => logs.push(args) },
    "../utils/network": { getAxiosNetworkOptions: () => ({}) },
  };
  const service = evaluateService("grizzlyService.js", dependencies, {}, clock);
  return { service, clock, logs, dependencies, fileReads: () => fileReads };
}

function prices(at, cost = 1, count = 5) {
  return { "prices:server1:wa": { at, data: { 187: { wa: { cost, count } } } } };
}

test("cached navigation preserves timestamps and never awaits a provider", async () => {
  let networkCalls = 0;
  const at = Date.now() - 20 * MINUTE;
  const harness = smsHarness(prices(at), async () => { networkCalls += 1; throw new Error("provider offline"); });
  assert.equal((await harness.service.getServicePrices("wa", "server1", { cachedOnly: true }))[187].wa.cost, 1);
  harness.clock.now += 11 * MINUTE;
  assert.equal(harness.service.getCachedPriceInfo("wa", "server1").stale, true);
  assert.equal(harness.service.getCachedPriceInfo("wa", "server1").at, at);
  assert.equal((await harness.service.getServicePrices("wa", "server1", { cachedOnly: true }))[187].wa.cost, 1);
  assert.equal(await harness.service.getServicePrices("wa", "server1", { cachedOnly: true, allowStale: false }), null);
  harness.clock.now += 24 * 60 * MINUTE;
  assert.equal(await harness.service.getServicePrices("wa", "server1", { cachedOnly: true }), null);
  assert.equal(networkCalls, 0);
  assert.equal(harness.fileReads(), 1);
});

test("concurrent provider refreshes share one request and a bad payload keeps the last quote", async () => {
  let finish;
  let calls = 0;
  const at = Date.now() - 31 * MINUTE;
  const harness = smsHarness(prices(at), () => { calls += 1; return new Promise((resolve) => { finish = resolve; }); });
  const first = harness.service.getServicePrices("wa", "server1", { forceRefresh: true });
  const second = harness.service.getServicePrices("wa", "server1", { forceRefresh: true });
  assert.equal(calls, 1);
  assert.equal((await harness.service.getServicePrices("wa", "server1", { cachedOnly: true }))[187].wa.cost, 1);
  finish({ status: 200, data: { error: "provider unavailable" } });
  assert.equal((await first)[187].wa.cost, 1);
  assert.equal((await second)[187].wa.cost, 1);
  assert.equal(harness.service.getCachedPriceInfo("wa", "server1").at, at);
  assert.equal(harness.service.getVirtualCacheVersion(), 0);
});

test("country options reuse parsed memory and invalidate after a refreshed quote", async () => {
  const at = Date.now();
  const snapshot = (providerKey) => ({ at, data: { countries: [{ id: "US", code: "US", providerCountryId: "187", providerKey, name_ar: "الولايات المتحدة", name_en: "United States", flag: "🇺🇸", dialCode: "+1" }] } });
  const harness = smsHarness({
    ...prices(at),
    "prices:server2:wa": { at, data: { 187: { wa: { cost: 2, count: 8 } } } },
    "virtual-number-snapshot:v4:server1:wa": snapshot("server1"),
    "virtual-number-snapshot:v4:server2:wa": snapshot("server2"),
  }, async () => ({ status: 200, data: { 187: { wa: { cost: 0.5, count: 4 } } } }));
  const flow = evaluateService("virtualNumbersFlowService.js", { ...harness.dependencies, "./grizzlyService": harness.service }, {}, harness.clock);
  const catalog = await flow.getProviderCatalog("wa", "server1");
  for (let i = 0; i < 100; i += 1) {
    assert.equal(await flow.getProviderCatalog("wa", "server1"), catalog);
    const rows = await flow.getCountryPriceRows("ar", "wa", "US");
    assert.deepEqual(Array.from(rows, (row) => row.price), [30, 60]);
  }
  assert.equal(harness.fileReads(), 1);
  await harness.service.getServicePrices("wa", "server1", { forceRefresh: true });
  const rows = await flow.getCountryPriceRows("ar", "wa", "US");
  assert.deepEqual(Array.from(rows, (row) => row.price), [15, 60]);
  assert.equal(harness.fileReads(), 1);
});

test("an uncertain activation request is not resubmitted to provider mirrors", async () => {
  let calls = 0;
  const harness = smsHarness({}, async () => { calls += 1; throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" }); });
  const result = await harness.service.requestNumber("wa", "187", "server1", { maxPriceUsd: 1 });
  assert.equal(result, "PROVIDER_UNCONFIRMED");
  assert.equal(calls, 1);
});

test("SMM timeouts preserve uncertainty without a duplicate GET or mirror submission", async () => {
  let posts = 0;
  let gets = 0;
  const service = evaluateService("smmCacheService.js", {
    axios: { post: async () => { posts += 1; throw new Error("timeout"); }, get: async () => { gets += 1; return { data: { order: 123 } }; } },
    fs: { readFileSync: () => JSON.stringify({ services: [] }) },
    "./errorLogger": { logBotError() {} },
    "./jsonStorage": { saveData() {} },
    "../utils/network": { getAxiosNetworkOptions: () => ({}) },
  }, { SMM_API_URL: "https://first.invalid/api,https://second.invalid/api", SMM_API_KEY: "test-only-key" });
  const result = await service.createSmmOrder({ serviceId: "10143", link: "https://example.test/profile", quantity: 100 });
  assert.equal(result.error, "provider_unconfirmed");
  assert.equal(result.unconfirmed, true);
  assert.equal(posts, 1);
  assert.equal(gets, 0);
});

test("derived WhatsApp cache does not make a failed refresh look fresh", async () => {
  const at = Date.now() - 40 * MINUTE;
  let written;
  const service = evaluateService("grizzlyCacheService.js", {
    fs: { existsSync: () => true, readFileSync: () => "{}", writeFileSync: (filename, value) => { written = JSON.parse(value); } },
    "./grizzlyService": {
      getServicePrices: async () => ({ 187: { wa: { cost: 1, count: 5 } } }),
      getCachedPriceInfo: () => ({ at, stale: true }),
      calculateVirtualNumberPrice: (cost) => Math.ceil(cost * 30),
    },
    "./errorLogger": { logBotError() {} },
    "../constants/grizzly": { grizzlyCountries: { 187: { name_ar: "الولايات المتحدة", flag: "🇺🇸" } } },
  });
  await service.fetchAndCachePrices();
  assert.equal(written.fetchedAt, at);
  assert.equal(service.getCachedCountries().length, 0);
});

test("a partial SMM refresh preserves omitted service timestamps", async () => {
  const { selectedServiceIds } = require("../src/constants/smmServices");
  const [firstId, secondId] = selectedServiceIds;
  const oldAt = Date.now() - 2 * 24 * 60 * MINUTE;
  const initial = { fetchedAt: new Date(oldAt).toISOString(), services: [firstId, secondId].map((id) => ({ service: Number(id), serviceId: id, rate: "1", min: 10, max: 1000, pricePerUnitRub: 0.039 })) };
  let written;
  const service = evaluateService("smmCacheService.js", {
    axios: { get: async () => ({ data: [{ service: Number(firstId), name: "Current provider service", rate: "2", min: 10, max: 1000 }] }) },
    fs: { readFileSync: () => JSON.stringify(initial) },
    "./errorLogger": { logBotError() {} },
    "./jsonStorage": { saveData: (filename, value) => { written = value; } },
    "../utils/network": { getAxiosNetworkOptions: () => ({}) },
  }, { SMM_API_URL: "https://provider.invalid/api", SMM_API_KEY: "test-only-key" });
  await service.fetchAndCacheSmmServices();
  assert.equal(service.getCachedSmmServiceById(firstId).rateUsdPer1000, 2);
  assert.equal(service.getCachedSmmServiceById(secondId), null);
  assert.equal(written.services.find((entry) => String(entry.serviceId) === secondId).priceUpdatedAt, oldAt);
});

test("concurrent number taps reserve once and an uncertain order stays recorded", async () => {
  const { AppStore } = require("../src/services/appStore");
  const store = Object.create(AppStore.prototype);
  store.users = [store.normalizeUser({ userId: 101, currency: "USD", balances: { USD: 10 }, language: "ar", isVerified: true })];
  store.transactions = [];
  store.config = { services: {}, botStats: {} };
  store.persistAll = () => {};
  const at = Date.now();
  const harness = smsHarness({
    ...prices(at),
    "virtual-number-snapshot:v4:server1:wa": { at, data: { countries: [{ id: "US", code: "US", providerCountryId: "187", providerKey: "server1", name_ar: "الولايات المتحدة", name_en: "United States", flag: "🇺🇸" }] } },
  });
  let finish;
  let purchases = 0;
  const states = new Map();
  const flow = evaluateService("virtualNumbersFlowService.js", {
    ...harness.dependencies,
    "./grizzlyService": { ...harness.service, requestNumber: () => { purchases += 1; return new Promise((resolve) => { finish = resolve; }); } },
    "./stateStore": { getUserState: (id) => states.get(id), setUserState: (id, name, data) => states.set(id, { name, ...data }), clearUserState: (id) => states.delete(id) },
  }, {}, harness.clock);
  const bot = { editMessageText: async () => ({}), answerCallbackQuery: async () => ({}), sendMessage: async () => ({}) };
  const query = { id: "first", data: "vnm:buy:server1:wa:US:30", from: { id: 101 }, message: { chat: { id: 101 }, message_id: 5 } };
  const first = flow.handleVirtualNumbersCallback(bot, query, store);
  for (let i = 0; i < 30 && !finish; i += 1) await Promise.resolve();
  assert.equal(purchases, 1);
  assert.equal(store.getBalance(101, "USD"), 9);
  assert.equal(store.transactions.length, 1);
  assert.equal(store.transactions[0].status, "pending");
  assert.equal(await flow.handleVirtualNumbersCallback(bot, { ...query, id: "duplicate" }, store), true);
  assert.equal(purchases, 1);
  finish("PROVIDER_UNCONFIRMED");
  assert.equal(await first, true);
  assert.equal(store.transactions[0].status, "provider_unconfirmed");
  assert.equal(store.getBalance(101, "USD"), 9);
  assert.equal(await flow.handleVirtualNumbersCallback(bot, { ...query, id: "retry" }, store), true);
  assert.equal(purchases, 1);
});

test("number price buttons render each selected currency without a Telegram patch", async () => {
  const at = Date.now();
  const snapshot = (providerKey) => ({ at, data: { countries: [{ id: "US", code: "US", providerCountryId: "187", providerKey, name_ar: "الولايات المتحدة", name_en: "United States", flag: "🇺🇸" }] } });
  const harness = smsHarness({
    ...prices(at),
    "prices:server2:wa": { at, data: { 187: { wa: { cost: 2, count: 5 } } } },
    "virtual-number-snapshot:v4:server1:wa": snapshot("server1"),
    "virtual-number-snapshot:v4:server2:wa": snapshot("server2"),
  });
  const flow = evaluateService("virtualNumbersFlowService.js", {
    ...harness.dependencies, "./grizzlyService": harness.service,
    "./stateStore": { getUserState: () => null, setUserState() {}, clearUserState() {} },
  }, {}, harness.clock);
  let markup;
  const bot = { answerCallbackQuery: async () => ({}), editMessageText: async (body, options) => { markup = options.reply_markup; return {}; } };
  const query = { id: "quote", data: "vnm:country:wa:US:0", from: { id: 101 }, message: { chat: { id: 101 }, message_id: 5 } };
  for (const [currency, expected] of [["USD", "1.00 $"], ["RUB", "30.00 ₽"], ["YER", "530.00 ر.ي"], ["SAR", "3.70 ر.س"]]) {
    const store = { getOrCreateUser: () => ({ userId: 101, language: "ar", currency }) };
    assert.equal(await flow.handleVirtualNumbersCallback(bot, query, store), true);
    const buttons = markup.inline_keyboard.flat();
    assert.equal(buttons.find((button) => button.callback_data === "vnm:buy:server1:wa:US:30").text, expected);
    assert.equal(buttons.filter((button) => button.callback_data.startsWith("vnm:buy:")).length, 4);
  }
});

test("unknown apps never silently use WhatsApp and unrelated aliases do not use Google or Facebook", async () => {
  const at = Date.now();
  const harness = smsHarness({
    ...prices(at),
    "prices:server1:go": { at, data: { 187: { go: { cost: 1, count: 5 } } } },
    "prices:server1:fb": { at, data: { 187: { fb: { cost: 1, count: 5 } } } },
  });
  const flow = evaluateService("virtualNumbersFlowService.js", { ...harness.dependencies, "./grizzlyService": harness.service }, {}, harness.clock);
  assert.equal((await flow.getProviderCatalog("unsupported", "server1")).length, 0);
  assert.equal((await flow.getProviderCatalog("wc", "server1")).length, 0);
  assert.equal((await flow.getProviderCatalog("hj", "server1")).length, 0);
});

test("SMM sub-unit quotes remain nonzero and menu text uses the selected currency", async () => {
  const { selectedServiceIds, getServiceInfo } = require("../src/constants/smmServices");
  const id = selectedServiceIds[0];
  const cache = evaluateService("smmCacheService.js", {
    axios: { get: async () => ({ data: [{ service: Number(id), name: "Tiny price", rate: "0.001", min: 10, max: 1000 }] }) },
    fs: { readFileSync: () => JSON.stringify({ services: [] }) },
    "./errorLogger": { logBotError() {} }, "./jsonStorage": { saveData() {} }, "../utils/network": { getAxiosNetworkOptions: () => ({}) },
  }, { SMM_API_URL: "https://provider.invalid/api", SMM_API_KEY: "test-only-key" });
  await cache.fetchAndCacheSmmServices();
  assert.equal(cache.getCachedSmmServiceById(id).pricePerUnitRub, 0.000039);
  let rendered;
  const menus = evaluateService("serviceMenusService.js", {
    "./smmCacheService": cache,
    "./profileService": { sendOrEditMessage: async (bot, chatId, text, keyboard) => { rendered = { text, keyboard }; } },
    "./stateStore": { getUserState: () => null, setUserState() {}, clearUserState() {} },
  });
  const info = getServiceInfo(id);
  await menus.sendSocialBoostServiceDetails({}, 101, { userId: 101, language: "ar", currency: "USD" }, info.platform.key, info.category.key, id);
  assert.match(rendered.text, /0\.0000013 \$/);
  assert.ok(rendered.keyboard.inline_keyboard.flat().some((button) => button.text.includes("0.0013 $")));
});

test("tiny SMS supplier costs survive catalog normalization for checkout", async () => {
  const harness = smsHarness(prices(Date.now(), 0.0000004));
  const catalog = await harness.service.getGrizzlyVirtualNumberCatalog("WhatsApp", { providerKey: "server1", cachedOnly: true });
  assert.equal(catalog.countries[0].supplierPriceUsd, 0.0000004);
  assert.equal(catalog.countries[0].sellPrice, 1);
});

test("legacy number menu labels supplier USD honestly and formats the selected wallet", async () => {
  const country = { id: "187", name_ar: "أمريكا", name_en: "United States", flag: "🇺🇸", supplierPrice: 0.5, supplierPriceUsd: 0.5, sellPrice: 15, availableCount: 10 };
  let rendered;
  const menus = evaluateService("serviceMenusService.js", {
    "./grizzlyService": {
      getGrizzlyVirtualNumberCatalog: async () => ({ serviceCode: "wa", countries: [country] }),
      paginateVirtualNumberCountries: (countries) => ({ items: countries, pageIndex: 0, totalPages: 1, totalItems: countries.length }),
    },
    "./profileService": { sendOrEditMessage: async (bot, chatId, text, keyboard) => { rendered = { text, keyboard }; } },
  });
  const user = { userId: 101, language: "ar", currency: "USD" };
  await menus.sendVirtualNumberCountryDetails({}, 101, user, "WhatsApp", "187", 0);
  assert.equal((rendered.text.match(/0\.50 \$/g) || []).length, 2);
  assert.doesNotMatch(rendered.text, /RUB|₽/);
  await menus.sendVirtualNumbersCountriesMenu({}, 101, user, "WhatsApp", 0);
  assert.ok(rendered.keyboard.inline_keyboard.flat().some((button) => button.text.includes("0.50 $")));
});

test("a failed provider cancellation restores an active order for a later retry", async () => {
  const { AppStore } = require("../src/services/appStore");
  const store = Object.create(AppStore.prototype);
  store.users = [store.normalizeUser({ userId: 101, currency: "USD", balances: { USD: 9 }, language: "ar", isVerified: true })];
  store.transactions = [{ id: "purchase", type: "virtual_number_purchase", activationId: "act", providerKey: "server1", userId: 101, amount: 30, walletCurrency: "USD", status: "active" }];
  store.config = { services: {}, botStats: {} };
  store.persistAll = () => {};
  const harness = smsHarness({});
  const flow = evaluateService("virtualNumbersFlowService.js", {
    ...harness.dependencies, "./grizzlyService": { ...harness.service, cancelNumber: async () => null },
    "./stateStore": { getUserState: () => null, setUserState() {}, clearUserState() {} },
  });
  const bot = { answerCallbackQuery: async () => ({}), editMessageText: async () => ({}) };
  await flow.handleVirtualNumbersCallback(bot, { id: "cancel", data: "vnm:cancel:server1:act:30", from: { id: 101 }, message: { chat: { id: 101 }, message_id: 5 } }, store);
  assert.equal(store.transactions[0].status, "active");
  assert.equal(store.getBalance(101, "USD"), 9);
});
