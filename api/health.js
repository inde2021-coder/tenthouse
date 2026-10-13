export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  return res.status(200).json({
    ok: true,
    service: "Radhe Krishna Tent House WhatsApp backend",
    configured: Boolean(process.env.WA_PHONE_NUMBER_ID && process.env.WA_ACCESS_TOKEN && process.env.WA_API_VERSION),
    webhookConfigured: Boolean(process.env.WA_WEBHOOK_VERIFY_TOKEN && process.env.META_APP_SECRET)
  });
}
