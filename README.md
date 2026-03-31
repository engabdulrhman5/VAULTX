# Telegram Bot Foundation

Modular starter structure for a Telegram bot built with `node-telegram-bot-api`.

## Features

- Mock JSON database for users
- `/start` flow with language selection
- Arabic main menu with reply keyboard
- Admin-only placeholder commands
- Service placeholders for all main menu buttons

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file based on `.env.example`

3. Start the bot:

```bash
npm start
```

## Environment Variables

- `BOT_TOKEN`: Telegram bot token
- `ADMIN_IDS`: Comma-separated Telegram user IDs for admins
- `GRIZZLY_API_KEY`: Grizzly SMS API key
- `HERO_SMS_API_KEY`: Hero SMS API key
