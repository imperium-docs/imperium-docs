# Telegram Mini App setup (Ordem)

This guide configures Telegram for the Ordem Mini App and the required GitHub secrets.

## 1) Create a bot

In Telegram, open BotFather and run:

- /newbot

Follow the prompts and save the bot token. This token must be set as `TELEGRAM_BOT_TOKEN`.

## 2) Configure the Web App URL (menu button)

In BotFather:

- /mybots
- Select your bot
- Bot Settings
- Menu Button
- Configure a Web App

Set the URL to:

```
https://your-domain.example/ordem
```

Important: Telegram Mini Apps require a public HTTPS URL.

## 3) Optional deep link

If you have an App Short Name, the deep link format is:

```
https://t.me/<BOT_USERNAME>/<APP_SHORT_NAME>?startapp=<payload>
```

If you do not have an App Short Name, use the bot Menu Button to open the Mini App.

## 4) GitHub Secrets

Add these secrets in your repository settings:

- TELEGRAM_BOT_TOKEN
- TELEGRAM_BOT_USERNAME
- TELEGRAM_WEBAPP_URL
- JWT_SECRET
- ORDEM_DB_PATH

Notes:
- TELEGRAM_BOT_TOKEN is required for initData validation.
- TELEGRAM_WEBAPP_URL must be the public HTTPS URL.
- ORDEM_DB_PATH can be set to ./ordem.db for local use.

## 5) Test inside Telegram

- Open the bot
- Tap the Menu Button
- The Ordem Mini App should open in Telegram

## Checklist

- Auth OK (initData validated, JWT issued)
- Request OK (send request, see it in inbox)
- Accept OK (conversation created)
- Chat OK (send and receive text)
