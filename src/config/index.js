require("dotenv").config();

const path = require("path");

const adminIds = String(process.env.ADMIN_IDS || process.env.ADMIN_ID || "")
  .split(",")
  .map((value) => Number(String(value).trim()))
  .filter(Number.isFinite);
const ADMIN_ID = adminIds[0] || null;
const BOT_TOKEN = process.env.BOT_TOKEN;
const LOG_CHANNEL_ID = Number(process.env.LOG_CHANNEL_ID || -1003822505585);
const ACTIVATIONS_CHANNEL_ID = Number(process.env.ACTIVATIONS_CHANNEL_ID || -1003311851705);
const PRO_ACCOUNTS_CHANNEL_ID = Number(process.env.PRO_ACCOUNTS_CHANNEL_ID || -1003869626536);
const ADMIN_CHANNEL_ID = Number(process.env.ADMIN_CHANNEL_ID || PRO_ACCOUNTS_CHANNEL_ID);

module.exports = {
  ADMIN_ID,
  ADMIN_IDS: adminIds,
  BOT_TOKEN,
  LOG_CHANNEL_ID,
  ACTIVATIONS_CHANNEL_ID,
  PRO_ACCOUNTS_CHANNEL_ID,
  ADMIN_CHANNEL_ID,
  USERS_DB_PATH: path.join(__dirname, "..", "..", "data", "users.json"),
  CONFIG_DB_PATH: path.join(__dirname, "..", "..", "data", "config.json"),
  TRANSACTIONS_DB_PATH: path.join(__dirname, "..", "..", "data", "transactions.json"),
  STATES_DB_PATH: path.join(__dirname, "..", "..", "data", "states.json"),
  STORE_DB_PATH: path.join(__dirname, "..", "..", "data", "store.json"),
  BOT_ERRORS_PATH: path.join(__dirname, "..", "..", "data", "bot-errors.json"),
  USERS_EXPORT_PATH: path.join(__dirname, "..", "..", "runtime", "users-export.txt"),
};
