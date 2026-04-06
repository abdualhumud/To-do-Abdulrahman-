#!/bin/bash
# Run this script ONCE after deploying to Vercel to register your webhook URL with Telegram.
# Usage: BOT_TOKEN=xxx WEBHOOK_URL=https://your-app.vercel.app/api/webhook SECRET=mysecret bash setup-webhook.sh

BOT_TOKEN="${BOT_TOKEN:?Set BOT_TOKEN}"
WEBHOOK_URL="${WEBHOOK_URL:?Set WEBHOOK_URL}"
SECRET="${SECRET:-taskflow-secret}"

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${WEBHOOK_URL}\",
    \"secret_token\": \"${SECRET}\",
    \"allowed_updates\": [\"message\"]
  }" | python3 -m json.tool
