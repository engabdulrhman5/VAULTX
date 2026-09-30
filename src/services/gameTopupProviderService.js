const axios = require("axios");
const { logBotError } = require("./errorLogger");

function isProviderConfigured() {
  return Boolean(String(process.env.GAME_TOPUP_API_URL || "").trim() && String(process.env.GAME_TOPUP_API_KEY || "").trim());
}

async function executeGameTopupOrder({ game, playerId, packageItem = null, quantity = null }) {
  const apiUrl = String(process.env.GAME_TOPUP_API_URL || "").trim();
  const apiKey = String(process.env.GAME_TOPUP_API_KEY || "").trim();

  if (!apiUrl || !apiKey) {
    return {
      success: false,
      error: "provider_not_configured",
    };
  }

  const payload = {
    key: apiKey,
    action: "add",
    service: String(game.providerServiceId || game.key),
    player_id: String(playerId || ""),
  };

  if (packageItem) {
    payload.package_name = String(packageItem.units_en || packageItem.units_ar || "");
    payload.quantity = 1;
  } else {
    payload.quantity = Number(quantity || 0);
  }

  try {
    const postBody = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => postBody.append(key, String(value)));

    const response = await axios.post(apiUrl, postBody.toString(), {
      timeout: 20000,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data = response?.data;
    if (data && (data.order || data.id)) {
      return {
        success: true,
        orderId: String(data.order || data.id),
        provider: "remote",
        status: "created",
        raw: data,
      };
    }
    if (data && data.error) {
      return {
        success: false,
        error: String(data.error),
        raw: data,
      };
    }
  } catch (error) {
    logBotError("gameTopupProvider.execute.post", error, { gameKey: game?.key });
    // A timeout may occur after the provider accepted an order. A second GET
    // would create a duplicate purchase, so leave it for reconciliation.
    return { success: false, error: "provider_unconfirmed" };
  }
  return { success: false, error: "provider_error" };
}

module.exports = {
  isProviderConfigured,
  executeGameTopupOrder,
};
