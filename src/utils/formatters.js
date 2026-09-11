const { formatCurrency } = require("../services/currencyService");

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatRuble(amount, currency) {
  const selected = currency || global.__VAULTX_ACTIVE_CURRENCY || "RUB";
  return formatCurrency(amount, selected);
}

function getDisplayName(user) {
  if (user.firstName) return user.firstName;
  if (user.username) return `@${user.username}`;
  return "غير محدد";
}

function getDisplayUsername(user) {
  if (user.username) return `@${user.username}`;
  return "غير محدد";
}

module.exports = { escapeHtml, formatRuble, getDisplayName, getDisplayUsername };
