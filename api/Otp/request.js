const crypto = require("crypto");
const admin = require("firebase-admin");
const axios = require("axios");
function getFirebase() {
if (!admin.apps.length) {
const serviceAccount = JSON.parse(
process.env.FIREBASE_SERVICE_ACCOUNT
);
admin.initializeApp({
credential: admin.credential.cert(serviceAccount)
});
}
return admin.firestore();
}
module.exports = async function handler(req, res) {
res.setHeader("Cache-Control", "no-store");
if (req.method !== "POST") {
return res.status(405).json({ error: "POST method required" });
}
try {
const {
mobile,
purpose = "customer_booking",
bookingId = ""
} = req.body || {};
const digits = String(mobile || "").replace(/\D/g, "");
const phone = digits.length === 10
  ? "91" + digits
  : digits;

if (!/^[1-9]\d{9,14}$/.test(phone)) {
  return res.status(400).json({
    error: "Valid mobile number is required"
  });
}

const template = process.env.WA_AUTH_TEMPLATE_NAME;
const language = process.env.WA_AUTH_TEMPLATE_LANGUAGE;
const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
const accessToken = process.env.WA_ACCESS_TOKEN;
const apiVersion = process.env.WA_API_VERSION || "v23.0";

if (
  !template ||
  !language ||
  !phoneNumberId ||
  !accessToken ||
  !process.env.FIREBASE_SERVICE_ACCOUNT
) {
  return res.status(500).json({
    error: "OTP service configuration is incomplete"
  });
}

const db = getFirebase();
const otp = crypto.randomInt(100000, 1000000).toString();
const requestId = crypto.randomUUID();
const otpHash = crypto
  .createHash("sha256")
  .update(otp)
  .digest("hex");

const ref = db.collection("whatsappOtps").doc(requestId);

await ref.set({
  mobile: phone,
  purpose: String(purpose).slice(0, 50),
  bookingId: String(bookingId).slice(0, 100),
  otpHash,
  attempts: 0,
  verified: false,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  expiresAt: admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + 5 * 60 * 1000)
  )
});

try {
  await axios.post(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "template",
      template: {
        name: template,
        language: { code: language },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: otp }
            ]
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [
              { type: "text", text: otp }
            ]
          }
        ]
      }
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      timeout: 15000
    }
  );
} catch (error) {
  await ref.delete().catch(() => {});
  console.error(
    "WhatsApp OTP send failed:",
    error.response?.data || error.message
  );
  return res.status(502).json({
    error: "WhatsApp OTP could not be sent. Check the approved template configuration."
  });
}

return res.status(200).json({
  success: true,
  requestId,
  otpRequestId: requestId,
  expiresIn: 300
});

} catch (error) {
console.error("OTP request failed:", error.message);
return res.status(500).json({
error: "OTP request failed"
});
}
};
