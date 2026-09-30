# VAULTX Telegram Bot

## Run

```bash
cp .env.example .env
npm ci
npm test
npm start
```

Set `BOT_TOKEN` in `.env` before starting. `render.yaml` can deploy the same start command; the `/` endpoint returns `I am alive`.

## Pricing and wallets

USD is the pricing base. Fixed conversions are **1 USD = 30 RUB = 530 YER = 3.7 SAR**. New users choose USD, RUB, YER or SAR immediately after choosing a language and before CAPTCHA. They can change their preferred currency later in Settings or the Mini App.

Existing RUB prices pass through USD for display in the preferred currency. Historical RUB wallet balances remain in the RUB wallet; choosing another preferred wallet does not move funds. Users can explicitly convert between wallets. Legacy purchases still use RUB as an internal compatibility amount, while provider/game catalogs record USD amounts. Wallet deductions use the preferred wallet at the fixed rates.

The selected Grizzly and HeroSMS virtual-number service prices are interpreted as USD and cached for 30 minutes. The bot refreshes selected service prices for both providers in batches at startup and every 30 minutes. SMM selected services use a 30-minute cache. A missing API key or provider failure does not create a fabricated price or game order.

Configure `GRIZZLY_API_KEY`, `HERO_SMS_API_KEY`, `SMM_API_URL`/`SMM_API_KEY`, and `GAME_TOPUP_API_URL`/`GAME_TOPUP_API_KEY` for the respective live services. Provider credentials are intentionally absent from this repository. Verify live prices and a low-value purchase on the deployed instance before accepting production orders.

## Mini App and payment security

The Mini App sends Telegram's signed `initData` on API requests. The server validates the HMAC, date, and user identity, and never uses a client-supplied `user_id` to authorize requests. Crypto Pay webhook requests require the `crypto-pay-api-signature` header generated with `CRYPTO_PAY_TOKEN`; Cryptomus also verifies its signature. Old virtual-number buttons are routed through the current ownership, price, and refund checks.

Use HTTPS for `PUBLIC_BASE_URL` and configure `TELEGRAM_WEBAPP_URL` if hosted separately. Keep API keys and payment credentials in deployment environment variables.
The SMS payment webhook is disabled until `SMS_WEBHOOK_TOKEN` is set; configure it at the sender and in the bot environment before using automated SMS payment verification.

`npm audit --omit=dev` reports no known advisories with the current lockfile. `.npmrc` prevents npm from installing the unused legacy `request` peer of the Telegram transport; the bot's text and photo transport are covered by a local HTTP test. Historic JSON data files are tracked in this repository; move them to persistent private storage and remove them from Git history before treating the repository as a safe place for customer records.
