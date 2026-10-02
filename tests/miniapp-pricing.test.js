'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { formatPriceNumber } = require('../src/services/currencyService');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'webapp', 'vaultx-app.html'), 'utf8');
const appScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(script => script.includes('const BOOT ='));

function app() {
  const context = vm.createContext({ window: {}, document: { addEventListener() {} } });
  const bootstrap = { lang: 'ar', user: { currency: 'USD', balances: {} }, methods: [] };
  // Execute the real inline functions while leaving network/bootstrap work out
  // of this isolated rendering test.
  const script = appScript.replace('__BOOTSTRAP_JSON__', JSON.stringify(bootstrap)).replace(/\n    boot\(\);/, '');
  vm.runInContext(script, context);
  return context;
}

test('Mini App tiny price display retains leading zeros and rounds upward', () => {
  const context = app();
  for (const [amount, expected] of [
    [0.000001, '0.0000010 USD'],
    [0.0000012345, '0.0000013 USD'],
    [0.0000000000012345, '0.0000000000013 USD'],
    [0.004321, '0.0044 USD'],
    [1.231, '1.24 USD'],
  ]) {
    assert.equal(vm.runInContext(`moneyUsd(${amount})`, context), expected);
    assert.equal(formatPriceNumber(amount), expected.replace(' USD', ''));
  }
  vm.runInContext("state.user.currency='YER'", context);
  assert.equal(vm.runInContext('moneyUsd(0.000001)', context), '0.00053 YER');
});

test('real SMM rows use per-unit RUB fields as prices and keep min/max as quantities', () => {
  const context = app();
  vm.runInContext("state.smm.services=[{id:'service-123',name:'Views',pricePerUnitRub:0.00003,min:1000,max:500000}];", context);
  let row = vm.runInContext('socialBoost()', context);
  assert.match(row, /0\.0000010 USD \/ وحدة • Min 1000 • Max 500000/);
  assert.match(row, /data-smm-service="service-123"/);
  vm.runInContext("state.user.currency='SAR'", context);
  row = vm.runInContext('socialBoost()', context);
  assert.match(row, /0\.0000037 SAR \/ وحدة • Min 1000 • Max 500000/);
  assert.doesNotMatch(row, /Min 3700|Max 1,850,000/);
  assert.equal((vm.runInContext('convert()', context).match(/<option /g) || []).length, 6);
});
