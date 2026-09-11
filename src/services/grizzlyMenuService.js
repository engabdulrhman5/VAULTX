const { getServicePrices, extractPrice } = require("./grizzlyService");
const { grizzlyServices, grizzlyCountries, getGrizzlyServiceCode, getGrizzlyCountryMeta } = require("../constants/grizzly");
const { getGrizzlyCountriesKeyboard } = require("../keyboards/grizzlyKeyboard");
const { sendOrEditMessage } = require("./profileService");
const { getUserLang, t, getArray } = require("../locales");
const { formatUsd } = require("./currencyService");

const PAGE_SIZE = 36;

function buildCountryButton(lang, id, apiPriceUsd, currency = "RUB") {
  if (!grizzlyCountries[String(id)]) return null;
  const country = getGrizzlyCountryMeta(id);
  const name = lang === "ar"
    ? country.name_ar || t(lang, `grizzly_country_${id}`) || t(lang, "grizzly_country_other")
    : t(lang, `grizzly_country_${id}`) || country.name_ar || t(lang, "grizzly_country_other");
  const usd = Number(apiPriceUsd);
  const finalPrice = Number.isFinite(usd) && usd > 0 ? usd : 0;
  if (finalPrice <= 0) return null;
  return {
    id: String(id),
    price: finalPrice * 30,
    text: `${formatUsd(finalPrice, currency, { decimals: finalPrice < 1 ? 4 : 2 })} : ${country.flag} ${name} 🚀`,
  };
}

function getCountryList(lang, prices, serviceCode, currency = "RUB") {
  return Object.keys(prices || {})
    .map((id) => buildCountryButton(lang, id, extractPrice(prices, id, serviceCode), currency))
    .filter(Boolean)
    .sort((left, right) => left.price - right.price);
}

function findServiceLabel(lang, serviceKey) {
  const topApps = getArray(lang, "virtualNumbers_topApps");
  const otherPages = getArray(lang, "virtualNumbers_otherPages");
  const otherApps = Array.isArray(otherPages) ? otherPages.flat() : [];
  return [...topApps, ...otherApps].find((label) => getGrizzlyServiceCode(label) === serviceKey) || serviceKey;
}

function resolveServiceCode(appLabelOrKey) {
  const normalized = String(appLabelOrKey || "").toLowerCase();
  return Object.values(grizzlyServices).includes(normalized) ? normalized : getGrizzlyServiceCode(appLabelOrKey);
}

async function sendGrizzlyCountriesMenu(bot, chatId, user, appLabelOrKey, page = 0, options = {}) {
  const lang = getUserLang(user);
  const currency = user?.currency || "RUB";
  const providerKey = options.providerKey || "server2";
  const serviceCode = resolveServiceCode(appLabelOrKey);

  if (!serviceCode) return sendOrEditMessage(bot, chatId, t(lang, "grizzly_price_error"), { inline_keyboard: [[{ text: t(lang, "common_back"), callback_data: "service:virtual_numbers" }]] }, options.messageId, "sendGrizzlyCountriesMenu.unsupported");

  const prices = await getServicePrices(serviceCode, providerKey);
  if (!prices) return sendOrEditMessage(bot, chatId, t(lang, "grizzly_price_error"), { inline_keyboard: [[{ text: t(lang, "common_back"), callback_data: "service:virtual_numbers" }]] }, options.messageId, "sendGrizzlyCountriesMenu.noPrices");

  const list = getCountryList(lang, prices, serviceCode, currency);
  const featuredCountry = list[0] || null;
  const pagedCountries = featuredCountry ? list.slice(1) : list;
  const totalPages = Math.max(1, Math.ceil(pagedCountries.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = pagedCountries.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const serviceLabel = findServiceLabel(lang, serviceCode);
  const text = [
    t(lang, "grizzly_header"), "",
    `${t(lang, "grizzly_service_label")}: ${serviceLabel}`,
    `${t(lang, "virtualNumbers_provider_label")} ${providerKey === "server1" ? "1" : "2"}`,
    t(lang, "virtualNumbers_first_row_note"),
    t(lang, "grizzly_select_country"), "",
    `${t(lang, "grizzly_page_label")}: ${safePage + 1}/${totalPages}`,
  ].join("\n");

  return sendOrEditMessage(bot, chatId, text, getGrizzlyCountriesKeyboard(pageItems, providerKey, serviceCode, safePage, totalPages, lang, featuredCountry), options.messageId, "sendGrizzlyCountriesMenu");
}

async function sendGrizzlyCountryDetails(bot, chatId, user, serviceCode, countryId, options = {}) {
  const lang = getUserLang(user);
  const currency = user?.currency || "RUB";
  const providerKey = options.providerKey || "server2";
  const prices = serviceCode ? await getServicePrices(serviceCode, providerKey) : null;
  const apiPriceUsd = prices ? extractPrice(prices, countryId, serviceCode) : null;
  const priceText = apiPriceUsd === null ? t(lang, "grizzly_price_unavailable") : formatUsd(apiPriceUsd, currency, { decimals: Number(apiPriceUsd) < 1 ? 4 : 2 });
  const country = getGrizzlyCountryMeta(countryId);
  const countryName = lang === "ar"
    ? country.name_ar || t(lang, `grizzly_country_${countryId}`) || t(lang, "grizzly_country_other")
    : t(lang, `grizzly_country_${countryId}`) || country.name_ar || t(lang, "grizzly_country_other");
  const serviceLabel = findServiceLabel(lang, serviceCode);
  const body = t(lang, "grizzly_selected_body")
    .replace("{service}", serviceLabel)
    .replace("{country}", `${country.flag} ${countryName}`)
    .replace("{price}", priceText);
  const text = [`<b>${t(lang, "grizzly_selected_title")}</b>`, "", body].join("\n");
  return sendOrEditMessage(bot, chatId, text, { inline_keyboard: [[{ text: t(lang, "common_back"), callback_data: "service:virtual_numbers" }]] }, options.messageId, "sendGrizzlyCountryDetails");
}

module.exports = { sendGrizzlyCountriesMenu, sendGrizzlyCountryDetails };
