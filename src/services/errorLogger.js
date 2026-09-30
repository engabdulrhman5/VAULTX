const fs = require("fs");
const { BOT_ERRORS_PATH } = require("../config");

const botErrors = [];
const recentErrorMap = new Map();
const DEDUPE_WINDOW_MS = 30 * 1000;

function redactSecrets(value) {
  let output = String(value || "");
  const secrets = Object.entries(process.env)
    .filter(([name, secret]) => /(?:TOKEN|SECRET|PASSWORD|API_KEY|MERCHANT_ID)/i.test(name) && String(secret || "").length >= 8)
    .map(([, secret]) => secret);
  for (const secret of secrets) output = output.replaceAll(secret, "[redacted]");
  return output.replace(/([?&](?:api_key|key|token|password)=)[^&\s"']+/gi, "$1[redacted]");
}

function loadExistingErrors() {
  try {
    if (!fs.existsSync(BOT_ERRORS_PATH)) {
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(BOT_ERRORS_PATH, "utf8") || "[]");
    if (Array.isArray(parsed)) {
      botErrors.push(...parsed);
    }
  } catch (error) {
    console.error("Failed to load bot errors:", error.message);
  }
}

function persistErrors() {
  try {
    fs.writeFileSync(BOT_ERRORS_PATH, JSON.stringify(botErrors.slice(-200), null, 2), "utf8");
  } catch (error) {
    console.error("Failed to persist bot errors:", error.message);
  }
}

function logBotError(scope, error, meta = {}) {
  const message = redactSecrets(error?.message || String(error));
  const dedupeKey = `${scope}::${message}`;
  const now = Date.now();
  const existing = recentErrorMap.get(dedupeKey);
  if (existing && now - existing < DEDUPE_WINDOW_MS) {
    return null;
  }
  recentErrorMap.set(dedupeKey, now);

  const entry = {
    scope,
    message,
    stack: error?.stack ? redactSecrets(error.stack) : null,
    meta: JSON.parse(redactSecrets(JSON.stringify(meta || {}))),
    createdAt: new Date().toISOString(),
  };

  botErrors.push(entry);
  persistErrors();
  console.error(`[${scope}]`, entry.message);
  return entry;
}

function getRecentErrors(limit = 5) {
  return botErrors.slice(-limit).reverse();
}

loadExistingErrors();

module.exports = {
  botErrors,
  logBotError,
  getRecentErrors,
};
