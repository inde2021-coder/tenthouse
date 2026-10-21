# WhatsApp Cloud API Webhook (Hindi)

Webhook route implementation is in `src/server.js` so the raw request body can be signature-verified before processing.

- Callback URL: `https://YOUR_BACKEND_DOMAIN/webhooks/whatsapp`
- Verify token: set `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in backend environment and enter the exact same value in Meta App Dashboard.
- App secret: set `WHATSAPP_APP_SECRET`; POST requests without a valid `X-Hub-Signature-256` are rejected.
- Subscribe the WhatsApp Business Account webhook to the `messages` field.
- Sending uses `POST /api/whatsapp/send` with `x-admin-token`; configure `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`.
- The backend must be publicly reachable over HTTPS. Meta's webhook setup cannot point to localhost.
- WhatsApp-initiated replies must comply with Meta's customer-service window and approved template rules.

Security/production notes: configure a strong `ADMIN_API_TOKEN`; do not expose it in public frontend code. Inbox and processed-message deduplication are currently in-memory in this starter, so configure durable storage before relying on them for production. Test with a Meta test number first.
