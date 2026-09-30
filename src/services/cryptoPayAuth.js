"use strict";

const crypto = require("crypto");

function verifyCryptoPayWebhook(rawBody, signature, token) {
  if (!token || typeof rawBody !== "string" || typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const key = crypto.createHash("sha256").update(token).digest();
  const expected = crypto.createHmac("sha256", key).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

module.exports = { verifyCryptoPayWebhook };
