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

test('dashboard balance squares are display-only and Settings keeps currency selection', async () => {
  const context = app();
  vm.runInContext("state.user={currency:'RUB',balances:{USD:1.23,RUB:2.34,YER:3.45,SAR:4.56}}", context);
  const header = vm.runInContext('topBar()', context);
  const cells = [...header.matchAll(/<div data-balance="([A-Z]+)"[^>]*>[\s\S]*?<\/div>/g)];
  assert.deepEqual(cells.map(cell => cell[1]), ['USD', 'RUB', 'YER', 'SAR']);
  assert.match(header, /grid grid-cols-2/);
  for (const cell of cells) {
    assert.match(cell[0], /aspect-square/);
    assert.match(cell[0], /border-vxline/);
    assert.doesNotMatch(cell[0], /<button|data-wallet|aria-pressed|tabindex|role="button"|border-vxblue|✓/);
  }
  assert.match(cells[0][0], /\$ 1\.23/);
  assert.match(cells[1][0], /₽ 2\.34/);
  assert.match(cells[2][0], /ر\.ي 3\.45/);
  assert.match(cells[3][0], /ر\.س 4\.56/);
  assert.doesNotMatch(html, /data-wallet/);
  assert.match(vm.runInContext('settings()', context), /<select id="preferredCurrency"/);

  // Bind the real Settings control and exercise its existing API action.
  vm.runInContext(`
    const preferredControl={value:'SAR'};
    let currencyRequest=null;
    document.querySelectorAll=()=>[];
    document.querySelector=()=>null;
    document.getElementById=id=>id==='preferredCurrency'?preferredControl:null;
    apiFetch=async(url,options)=>{currencyRequest={url,options};return{json:async()=>({ok:true,profile:{currency:'SAR',balances:{USD:1.23,RUB:2.34,YER:3.45,SAR:4.56}}})};};
    render=()=>{};toast=()=>{};
    bind();
  `, context);
  await vm.runInContext('preferredControl.onchange()', context);
  assert.equal(vm.runInContext('currency()', context), 'SAR');
  assert.equal(vm.runInContext('currencyRequest.url', context), '/webapp/currency');
  assert.equal(vm.runInContext('JSON.parse(currencyRequest.options.body).currency', context), 'SAR');
});
