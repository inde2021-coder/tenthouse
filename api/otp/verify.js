
const crypto = require("crypto");
const admin = require("firebase-admin");

function getFirebase() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!raw) {
      throw new Error("Firebase service account is not configured");
    }

    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw))
    });
  }

  return admin.firestore();
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "POST method required"
    });
  }

  try {
    const {
      mobile,
      otp,
      requestId,
      purpose = "customer_booking"
    } = req.body || {};

    const digits = String(mobile || "").replace(/\D/g, "");
    const phone = digits.length === 10 ? "91" + digits : digits;
    const code = String(otp || "").trim();

    if (!/^[1-9]\d{9,14}$/.test(phone)) {
      return res.status(400).json({
        error: "Valid mobile number is required"
      });
    }

    if (!/^\d{6}$/.test(code) ||
        typeof requestId !== "string" ||
        !requestId.trim()) {
      return res.status(400).json({
        error: "Valid OTP and requestId are required"
      });
    }

    const db = getFirebase();
    const ref = db.collection("whatsappOtps").doc(requestId);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(400).json({
        error: "OTP request not found or expired"
      });
    }

    const data = snap.data();

    if (data.verified) {
      return res.status(400).json({
        error: "OTP has already been used"
      });
    }

    if (
      data.mobile !== phone ||
      data.purpose !== String(purpose).slice(0, 50)
    ) {
      return res.status(400).json({
        error: "OTP request does not match"
      });
    }

    if (
      !data.expiresAt ||
      data.expiresAt.toDate().getTime() <= Date.now()
    ) {
      await ref.delete().catch(() => {});
      return res.status(400).json({
        error: "OTP expired. Request a new OTP."
      });
    }

    if ((data.attempts || 0) >= 5) {
      return res.status(429).json({
        error: "Too many incorrect attempts. Request a new OTP."
      });
    }

    const submittedHash = crypto
      .createHash("sha256")
      .update(code)
      .digest("hex");

    const expected = Buffer.from(data.otpHash || "", "hex");
    const actual = Buffer.from(submittedHash, "hex");

    const matches =
      expected.length === actual.length &&
      expected.length === 32 &&
      crypto.timingSafeEqual(expected, actual);

    if (!matches) {
      await ref.update({
        attempts: admin.firestore.FieldValue.increment(1)
      });

      return res.status(400).json({
        error: "Incorrect OTP"
      });
    }

    await ref.update({
      verified: true,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({
      success: true,
      verified: true
    });

  } catch (error) {
    console.error("OTP verification failed:", error.message);

    return res.status(500).json({
      error: "OTP verification failed"
    });
  }
};
