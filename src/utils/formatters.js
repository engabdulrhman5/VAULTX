const { formatCurrency } = require("../services/currencyService");

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatRuble(amount, currency) {
  const selected = currency || "RUB";
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

// Telegram users often enter Arabic digits and the Arabic decimal separator.
function normalizeNumericText(value) {
  return String(value ?? "").trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".").replace(/٬/g, "");
}
function parseAmountInput(value) {
  let normalized = normalizeNumericText(value);
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(normalized)) normalized = normalized.replace(/,/g, "");
  else normalized = normalized.replace(",", ".");
  return /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}
function formatWalletNumber(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0.00";
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

module.exports = { escapeHtml, formatRuble, getDisplayName, getDisplayUsername, normalizeNumericText, parseAmountInput, formatWalletNumber };
