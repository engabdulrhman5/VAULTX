"use strict";

// Compatibility for older deployments that preload currencyIntegration.js.
// Use the same idempotent installers as src/index.js; a second output or global
// active-currency patch would convert prices twice and leak between chats.
function install() {
  require("./vaultxRuntime");
  require("./vaultxCurrencyRuntime");
}
install();
module.exports = { install };
