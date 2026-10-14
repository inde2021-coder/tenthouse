
export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const hasValue = (name) =>
    typeof process.env[name] === "string" &&
    process.env[name].trim().length > 0;

  const phoneNumberIdPresent = hasValue("WA_PHONE_NUMBER_ID");
  const accessTokenPresent = hasValue("WA_ACCESS_TOKEN");
  const apiVersionPresent = hasValue("WA_API_VERSION");

  return res.status(200).json({
    ok: true,
    service: "Radhe Krishna Tent House WhatsApp backend",
    configured:
      phoneNumberIdPresent &&
      accessTokenPresent &&
      apiVersionPresent,
    checks: {
      phoneNumberIdPresent,
      accessTokenPresent,
      apiVersionPresent
    },
    webhookConfigured:
      hasValue("WA_WEBHOOK_VERIFY_TOKEN") &&
      hasValue("META_APP_SECRET")
  });
}
