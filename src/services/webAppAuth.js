"use strict";

const crypto = require("crypto");

// Telegram Mini App initData is signed by Telegram. Never trust user_id from
// query strings, JSON bodies, or initDataUnsafe without verifying this hash.
function verifyInitData(raw, token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof raw !== "string" || !raw || raw.length > 8192 || !token) return null;
  const params = new URLSearchParams(raw);
  const fields = [...params.keys()];
  if (new Set(fields).size !== fields.length) return null;
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !Number.isSafeInteger(authDate) ||
      authDate > nowSeconds + 60 || nowSeconds - authDate > 24 * 60 * 60) return null;
  params.delete("hash");
  const checkString = (entries) => entries.sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const supplied = Buffer.from(hash, "hex");
  const checks = [checkString([...params.entries()])];
  if (params.has("signature")) checks.push(checkString([...params.entries()].filter(([key]) => key !== "signature")));
  if (!checks.some((check) => {
    const expected = crypto.createHmac("sha256", secret).update(check).digest();
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  })) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    const id = Number(user?.id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch (_) { return null; }
}

module.exports = { verifyInitData };
