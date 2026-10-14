
const json = (res, status, body) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Access-Control-Allow-Origin",
    process.env.ALLOWED_ORIGIN || "*"
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  return res.status(status).json(body);
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  // Secret key must remain on the server.
  const expected = process.env.WA_SEND_API_KEY;
  const provided = (req.headers.authorization || "")
    .replace(/^Bearer\s+/i, "");

  if (!expected || !provided || provided !== expected) {
    return json(res, 401, { error: "Unauthorized" });
  }

  const {
    to,
    message,
    templateName,
    languageCode
  } = req.body || {};

  if (!/^\d{8,15}$/.test(String(to || ""))) {
    return json(res, 400, {
      error: "Recipient must be digits with country code"
    });
  }

  const phoneId = process.env.WA_PHONE_NUMBER_ID;
  const token = process.env.WA_ACCESS_TOKEN;
  const version = process.env.WA_API_VERSION;

  if (!phoneId || !token || !version) {
    return json(res, 503, {
      error: "WhatsApp credentials are not configured"
    });
  }

  let payload;

  if (templateName) {
    if (
      typeof templateName !== "string" ||
      !/^[a-zA-Z0-9_]+$/.test(templateName)
    ) {
      return json(res, 400, {
        error: "Invalid template name"
      });
    }

    payload = {
      messaging_product: "whatsapp",
      to: String(to),
      type: "template",
      template: {
        name: templateName,
        language: {
          code: languageCode || "en_US"
        }
      }
    };
  } else {
    if (
      typeof message !== "string" ||
      !message.trim() ||
      message.length > 4000
    ) {
      return json(res, 400, {
        error: "Message is required (max 4000 characters)"
      });
    }

    payload = {
      messaging_product: "whatsapp",
      to: String(to),
      type: "text",
      text: {
        preview_url: false,
        body: message.trim()
      }
    };
  }

  try {
    const upstream = await fetch(
      `https://graph.facebook.com/${version}/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      return json(res, upstream.status, {
        error: "Meta WhatsApp API rejected the request",
        details: data.error?.message || "Unknown API error",
        code: data.error?.code
      });
    }

    return json(res, 200, {
      ok: true,
      messageId: data.messages?.[0]?.id || null,
      contacts: data.contacts || []
    });
  } catch (error) {
    return json(res, 502, {
      error: "Could not reach Meta WhatsApp API"
    });
  }
}
