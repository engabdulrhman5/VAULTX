# VAULTX Telegram Bot

## Run

```bash
cp .env.example .env
npm ci
npm test
npm start
```

Set `BOT_TOKEN` in `.env` before starting. `render.yaml` can deploy the same start command; the `/` endpoint returns `I am alive`.

## Production wallet storage and deployment

The current `render.yaml` specifies a **Free** web service. Render Free's local files are deleted on redeploy, restart, or spin-down. Do not use that plan to store customer balances. This bot now refuses to start on Render unless `VAULTX_DATA_DIR` is on a **real persistent disk mount**. An environment variable pointing at ephemeral storage is rejected. `render.persistent.example.yaml` shows a paid web service with a disk mounted at `/var/data/vaultx`; review its plan and cost before applying it. A disk can only be attached to one instance.

Before the first deployment with the disk, copy the **latest** `users.json`, `config.json`, `transactions.json`, and `states.json` from the previous instance or a verified backup into that mount. If a `vaultx-state.json` snapshot exists, it takes precedence. Do not assume the JSON files committed to this public repository represent current balances. The old Render Free instance has no shell access; missing conversions must be reconciled against actual payment and Telegram receipts by an administrator. `VAULTX_BOOTSTRAP_FROM_BUNDLE=1` allows a one-time seed from committed files only when intentionally reconciled; remove it after the initial snapshot is created. The bot fails closed on an empty disk or corrupt snapshot instead of silently resetting balances.

Wallets, settings, and transactions are written as one atomically replaced `vaultx-state.json` snapshot. `GET /health` reports the running Git revision and whether the storage path is configured. Verify the mounted disk and actual revision in Render before allowing new deposits. Keep one polling instance for the same Telegram token. Live provider availability and purchase/refund behavior still require a test with production API keys.

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
