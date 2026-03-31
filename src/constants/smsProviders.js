const SMS_PROVIDERS = {
  server1: {
    key: "server1",
    name: "Hero",
    baseUrl: "https://hero-sms.com/stubs/handler_api.php",
    apiKey: process.env.HERO_SMS_API_KEY || "",
  },
  server2: {
    key: "server2",
    name: "Grizzly",
    baseUrl: "https://api.grizzlysms.com/stubs/handler_api.php",
    apiKey: process.env.GRIZZLY_API_KEY || "",
  },
};

function getSmsProvider(providerKey = "server2") {
  return SMS_PROVIDERS[providerKey] || SMS_PROVIDERS.server2;
}

module.exports = {
  SMS_PROVIDERS,
  getSmsProvider,
};
