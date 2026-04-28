const fs = require("fs");
const path = require("path");
const { getGatewayMethodConfig } = require("./topupService");

const TEMPLATE_PATH = path.resolve(__dirname, "..", "webapp", "vaultx-app.html");

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function getLevelFromTransactions(count) {
  const n = Number(count || 0);
  if (n >= 100) return "Legend";
  if (n >= 50) return "Elite";
  if (n >= 20) return "Pro";
  if (n >= 8) return "Active";
  return "Newbie";
}

function renderVaultXWebAppPage(req, res, appStore) {
  const lang = String(req?.query?.lang || "ar").toLowerCase() === "en" ? "en" : "ar";
  const initialScreen = String(req?.query?.screen || "dashboard").toLowerCase();
  const initialMethod = String(req?.query?.method || "").toLowerCase();
  const userId = Number(req?.query?.user_id || 0);
  const user = appStore.findUserById(userId) || {
    userId,
    firstName: "Guest",
    username: "",
    balance: 0,
    transactionsCount: 0,
  };

  const paymentMethods = ["binance", "jeeb", "vodafone"]
    .map((key) => {
      const cfg = getGatewayMethodConfig(key) || {};
      return {
        key,
        title_ar: cfg.title_ar || key,
        title_en: cfg.title_en || key,
        account_id: cfg.account_id || "",
        local_currency: cfg.local_currency || (key === "binance" ? "USD" : key === "jeeb" ? "YER" : "EGP"),
        rub_per_unit: Number(cfg.rub_per_unit || 0),
        local_per_rub: Number(cfg.local_per_rub || 0),
      };
    });

  const bootstrap = {
    lang,
    initialScreen,
    initialMethod,
    user: {
      id: Number(user.userId || 0),
      firstName: user.firstName || "User",
      username: user.username || "",
      balanceRub: Number(user.balance || 0),
      level: getLevelFromTransactions(user.transactionsCount || 0),
      xp: Math.min(100, Number(user.transactionsCount || 0) * 5),
    },
    methods: paymentMethods,
  };

  let template = "";
  try {
    template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  } catch (_) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("WebApp template not found");
    return;
  }

  const html = template
    .replace(/__LANG__/g, lang)
    .replace(/__DIR__/g, lang === "ar" ? "rtl" : "ltr")
    .replace("__BOOTSTRAP_JSON__", safeJson(bootstrap));

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

module.exports = {
  renderVaultXWebAppPage,
};
