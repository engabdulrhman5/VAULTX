const fs = require("fs");
const { BOT_ERRORS_PATH } = require("../config");

const botErrors = [];

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
  const entry = {
    scope,
    message: error?.message || String(error),
    stack: error?.stack || null,
    meta,
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
