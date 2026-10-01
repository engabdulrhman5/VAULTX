require("dotenv").config();

const path = require("path");
const fs = require("fs");
const DATA_DIR = process.env.VAULTX_DATA_DIR
  ? path.resolve(process.env.VAULTX_DATA_DIR)
  : path.join(__dirname, "..", "..", "data");
if (process.env.RENDER && !process.env.VAULTX_DATA_DIR) {
  throw new Error("VAULTX_DATA_DIR must point to a mounted persistent disk on Render. Refusing to run wallets on ephemeral storage.");
}
if (process.env.RENDER && process.env.VAULTX_DATA_DIR) {
  // An environment variable alone does not make a directory persistent.
  // Render mounts the disk at a non-root mount point visible in mountinfo.
  const realPath = fs.realpathSync(DATA_DIR);
  const mounts = fs.readFileSync("/proc/self/mountinfo", "utf8").split("\n").map((line) => line.split(" ")[4]);
  if (!mounts.some((mount) => mount && mount !== "/" && realPath === mount)) {
    throw new Error(`VAULTX_DATA_DIR (${DATA_DIR}) is not on a mounted persistent disk`);
  }
}

const adminIds = String(process.env.ADMIN_IDS || process.env.ADMIN_ID || "")
  .split(",")
  .map((value) => Number(String(value).trim()))
  .filter(Number.isFinite);
const ADMIN_ID = adminIds[0] || null;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CRYPTO_PAY_TOKEN = process.env.CRYPTO_PAY_TOKEN || process.env.CRYPTO_BOT_TOKEN || "";
const CRYPTOMUS_MERCHANT_ID = process.env.CRYPTOMUS_MERCHANT_ID || "";
const CRYPTOMUS_API_KEY = process.env.CRYPTOMUS_API_KEY || "";
const USD_TO_RUB_RATE = 30;
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").trim();
const TELEGRAM_WEBAPP_URL = String(process.env.TELEGRAM_WEBAPP_URL || "").trim();
const SMS_WEBHOOK_TOKEN = String(process.env.SMS_WEBHOOK_TOKEN || "").trim();
const GMAIL_IMAP_USER = String(process.env.GMAIL_IMAP_USER || "").trim();
const GMAIL_IMAP_APP_PASSWORD = String(process.env.GMAIL_IMAP_APP_PASSWORD || "").trim();
const BINANCE_EMAIL_FROM = String(process.env.BINANCE_EMAIL_FROM || "do-not-reply@directmail.binance.com").trim().toLowerCase();
const LOG_CHANNEL_ID = Number(process.env.LOG_CHANNEL_ID || -1003822505585);
const ACTIVATIONS_CHANNEL_ID = Number(process.env.ACTIVATIONS_CHANNEL_ID || -1003311851705);
const PRO_ACCOUNTS_CHANNEL_ID = Number(process.env.PRO_ACCOUNTS_CHANNEL_ID || -1003869626536);
const ADMIN_CHANNEL_ID = Number(process.env.ADMIN_CHANNEL_ID || PRO_ACCOUNTS_CHANNEL_ID);

module.exports = {
  ADMIN_ID,
  ADMIN_IDS: adminIds,
  BOT_TOKEN,
  CRYPTO_PAY_TOKEN,
  CRYPTOMUS_MERCHANT_ID,
  CRYPTOMUS_API_KEY,
  USD_TO_RUB_RATE,
  PUBLIC_BASE_URL,
  TELEGRAM_WEBAPP_URL,
  SMS_WEBHOOK_TOKEN,
  GMAIL_IMAP_USER,
  GMAIL_IMAP_APP_PASSWORD,
  BINANCE_EMAIL_FROM,
  LOG_CHANNEL_ID,
  ACTIVATIONS_CHANNEL_ID,
  PRO_ACCOUNTS_CHANNEL_ID,
  ADMIN_CHANNEL_ID,
  DATA_DIR,
  STATE_SNAPSHOT_PATH: path.join(DATA_DIR, "vaultx-state.json"),
  VIRTUAL_CACHE_PATH: path.join(DATA_DIR, "virtual-number-cache.json"),
  USERS_DB_PATH: path.join(DATA_DIR, "users.json"),
  CONFIG_DB_PATH: path.join(DATA_DIR, "config.json"),
  TRANSACTIONS_DB_PATH: path.join(DATA_DIR, "transactions.json"),
  STATES_DB_PATH: path.join(DATA_DIR, "states.json"),
  STORE_DB_PATH: path.join(DATA_DIR, "store.json"),
  BOT_ERRORS_PATH: path.join(DATA_DIR, "bot-errors.json"),
  USERS_EXPORT_PATH: path.join(__dirname, "..", "..", "runtime", "users-export.txt"),
};
