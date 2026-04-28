const { ADMIN_CHANNEL_ID } = require("../config");
const { getUserLang } = require("../locales");
const { safeTelegramCall } = require("./telegramSafe");
const { logBotError } = require("./errorLogger");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value, max = 400) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function buildAdminMessage(user, payload) {
  const rows = [
    "<b>VaultX WebApp Request</b>",
    `User: ${escapeHtml(user?.firstName || "-")} ${user?.username ? `(@${escapeHtml(user.username)})` : ""}`,
    `User ID: <code>${Number(user?.userId || 0)}</code>`,
    `Action: <code>${escapeHtml(payload.action || "unknown")}</code>`,
  ];

  const details = payload?.details && typeof payload.details === "object" ? payload.details : {};
  const mapped = Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .slice(0, 18)
    .map(([k, v]) => `• ${escapeHtml(k)}: ${escapeHtml(truncate(v, 180))}`);

  if (mapped.length) {
    rows.push("");
    rows.push("<b>Details</b>");
    rows.push(...mapped);
  }

  return rows.join("\n");
}

async function handleVaultXWebAppData(bot, msg, appStore) {
  try {
    const raw = String(msg?.web_app_data?.data || "").trim();
    if (!raw) return false;

    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      return false;
    }

    if (String(payload?.type || "") !== "vaultx_webapp_request") {
      return false;
    }

    const user = appStore.findUserById(msg.from.id) || appStore.getOrCreateUser(msg.from);
    const lang = getUserLang(user);

    const action = String(payload.action || "").trim() || "webapp_action";
    const details = payload?.details && typeof payload.details === "object" ? payload.details : {};

    appStore.addTransaction({
      type: "webapp_request",
      userId: user.userId,
      serviceKey: "webapp",
      method: "VaultX WebApp",
      status: "submitted",
      webAction: action,
      webDetails: details,
    });

    await safeTelegramCall("handleVaultXWebAppData.notifyUser", () =>
      bot.sendMessage(
        msg.chat.id,
        lang === "ar"
          ? "✅ تم استلام طلبك من واجهة VaultX Pro بنجاح، وسيتم تنفيذ الإجراء وفق نوع الخدمة."
          : "✅ Your request from VaultX Pro has been received successfully."
      )
    );

    await safeTelegramCall("handleVaultXWebAppData.notifyAdmin", () =>
      bot.sendMessage(
        ADMIN_CHANNEL_ID,
        buildAdminMessage(user, payload),
        { parse_mode: "HTML", disable_web_page_preview: true }
      )
    );

    return true;
  } catch (error) {
    logBotError("handleVaultXWebAppData", error, { userId: msg.from?.id });
    return false;
  }
}

module.exports = {
  handleVaultXWebAppData,
};
