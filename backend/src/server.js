
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import crypto from 'node:crypto';

const app = express();
const port = Number(process.env.PORT || 8080);
const isProd = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

const allowedOrigins = (process.env.PUBLIC_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin not allowed'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Admin-Token'
  ]
}));

app.use(express.json({
  limit: '1mb',
  verify: (req, res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  }
}));

app.use('/api/', rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false
}));

const otpStore = new Map();
const paymentLedger = [];
const whatsappBookingInbox = [];
const processedWhatsAppMessageIds = new Set();

const otpLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  message: {
    error: 'बहुत अधिक OTP अनुरोध; कुछ देर बाद प्रयास करें।'
  }
});

const phoneSchema = z.string().regex(/^\+?[1-9]\d{9,14}$/);
const moneySchema = z.number().finite().positive().max(10_000_000);

// --------------------------------------------------
// HOME AND HEALTH ROUTES
// --------------------------------------------------

app.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'Radhe Krishn Tent House Manager API',
    message: 'Backend is running',
    health: '/api/health'
  });
});

const healthHandler = (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'rk-tent-house-erp-api',
    time: new Date().toISOString()
  });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// --------------------------------------------------
// ADMIN AUTHENTICATION
// --------------------------------------------------

function authAdmin(req, res, next) {
  const expected = process.env.ADMIN_API_TOKEN;
  const received = String(req.get('x-admin-token') || '');

  if (!expected || expected.length < 32) {
    return res.status(503).json({
      error: 'Server admin token is not configured securely.'
    });
  }

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(
      receivedBuffer.length === expectedBuffer.length
        ? receivedBuffer
        : Buffer.alloc(expectedBuffer.length),
      expectedBuffer
    )
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

// --------------------------------------------------
// WHATSAPP MESSAGE SENDING
// --------------------------------------------------

async function sendWhatsAppText(to, body) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    throw new Error(
      'WhatsApp Cloud API credentials are not configured.'
    );
  }

  const version = process.env.WHATSAPP_API_VERSION || 'v23.0';

  const response = await fetch(
    `https://graph.facebook.com/${version}/${phoneId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace(/\D/g, ''),
        type: 'text',
        text: {
          preview_url: false,
          body
        }
      })
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      `WhatsApp provider returned ${response.status}`
    );
  }

  return data;
}

// --------------------------------------------------
// OTP PROVIDERS
// --------------------------------------------------

async function sendOtpProvider(phone, otp, channel) {
  const provider = process.env.OTP_PROVIDER || 'none';

  const message =
    `आपका Radha Krishna Tent House verification OTP ${otp} है। ` +
    `यह ${process.env.OTP_TTL_SECONDS || 300} सेकंड में समाप्त होगा। ` +
    'इसे किसी से साझा न करें।';

  if (channel === 'whatsapp') {
    return sendWhatsAppText(phone, message);
  }

  if (provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;

    if (!sid || !token || !from) {
      throw new Error('Twilio SMS credentials are not configured.');
    }

    const form = new URLSearchParams({
      To: phone,
      From: from,
      Body: message
    });

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(`${sid}:${token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: form
      }
    );

    if (!response.ok) {
      throw new Error('SMS provider rejected the request.');
    }

    return response.json();
  }

  if (provider === 'msg91') {
    const key = process.env.MSG91_AUTH_KEY;
    const template = process.env.MSG91_TEMPLATE_ID;

    if (!key || !template) {
      throw new Error(
        'MSG91 Auth Key and approved template ID are required.'
      );
    }

    const response = await fetch(
      'https://control.msg91.com/api/v5/otp',
      {
        method: 'POST',
        headers: {
          authkey: key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          template_id: template,
          mobile: phone.replace('+', ''),
          otp
        })
      }
    );

    if (!response.ok) {
      throw new Error('MSG91 rejected the request.');
    }

    return response.json();
  }

  if (provider === 'demo' && !isProd) {
    return { demo: true };
  }

  throw new Error(
    'OTP provider is not configured. Configure an approved SMS/WhatsApp provider.'
  );
}

// --------------------------------------------------
// OTP SEND AND VERIFY
// --------------------------------------------------

app.post('/api/otp/send', otpLimiter, async (req, res) => {
  const parsed = z.object({
    phone: phoneSchema,
    channel: z.enum(['sms', 'whatsapp', 'both']).default('sms')
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Valid international phone number and channel are required.'
    });
  }

  const { phone, channel } = parsed.data;
  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const secret = process.env.OTP_HMAC_SECRET;

  if (!secret || secret.length < 32) {
    return res.status(503).json({
      error: 'OTP_HMAC_SECRET must be configured securely.'
    });
  }

  const digest = crypto
    .createHmac('sha256', secret)
    .update(`${phone}:${otp}`)
    .digest('hex');

  try {
    const channels = channel === 'both'
      ? ['sms', 'whatsapp']
      : [channel];

    for (const item of channels) {
      await sendOtpProvider(phone, otp, item);
    }

    otpStore.set(phone, {
      digest,
      expires:
        Date.now() +
        Number(process.env.OTP_TTL_SECONDS || 300) * 1000,
      tries: 0
    });

    const output = {
      ok: true,
      message: 'OTP भेजने का अनुरोध स्वीकार हुआ।'
    };

    if (process.env.OTP_PROVIDER === 'demo' && !isProd) {
      output.demoOtp = otp;
    }

    return res.json(output);
  } catch (error) {
    return res.status(503).json({
      error: error.message || 'OTP भेजा नहीं जा सका।'
    });
  }
});

app.post('/api/otp/verify', (req, res) => {
  const parsed = z.object({
    phone: phoneSchema,
    otp: z.string().regex(/^\d{6}$/)
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'फोन और 6 अंकों का OTP आवश्यक है।'
    });
  }

  const { phone, otp } = parsed.data;
  const record = otpStore.get(phone);

  if (
    !record ||
    record.expires < Date.now() ||
    record.tries >= 5
  ) {
    otpStore.delete(phone);

    return res.status(400).json({
      verified: false,
      error: 'OTP समाप्त हो गया या उपलब्ध नहीं है।'
    });
  }

  const secret = process.env.OTP_HMAC_SECRET;

  if (!secret || secret.length < 32) {
    return res.status(503).json({
      error: 'OTP_HMAC_SECRET is not configured.'
    });
  }

  record.tries++;

  const digest = crypto
    .createHmac('sha256', secret)
    .update(`${phone}:${otp}`)
    .digest('hex');

  const receivedBuffer = Buffer.from(digest);
  const savedBuffer = Buffer.from(record.digest);

  if (
    receivedBuffer.length !== savedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, savedBuffer)
  ) {
    return res.status(400).json({
      verified: false,
      error: 'OTP गलत है।'
    });
  }

  otpStore.delete(phone);

  return res.json({ verified: true });
});

// --------------------------------------------------
// WHATSAPP WEBHOOK
// --------------------------------------------------

app.get('/webhooks/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (
    mode === 'subscribe' &&
    expected &&
    token === expected &&
    typeof challenge === 'string'
  ) {
    return res.status(200).type('text/plain').send(challenge);
  }

  return res.sendStatus(403);
});

app.post('/webhooks/whatsapp', (req, res) => {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const signature = req.get('x-hub-signature-256') || '';

  if (
    !appSecret ||
    !req.rawBody ||
    !signature.startsWith('sha256=')
  ) {
    return res.sendStatus(401);
  }

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', appSecret)
      .update(req.rawBody)
      .digest('hex');

  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return res.sendStatus(401);
  }

  try {
    const payload = req.body;

    if (payload?.object !== 'whatsapp_business_account') {
      return res.sendStatus(200);
    }

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value || [];
        const contacts = value.contacts || [];

        for (const message of value.messages || []) {
          if (
            !message.id ||
            processedWhatsAppMessageIds.has(message.id)
          ) {
            continue;
          }

          processedWhatsAppMessageIds.add(message.id);

          if (processedWhatsAppMessageIds.size > 10000) {
            processedWhatsAppMessageIds.clear();
          }

          const contact =
            contacts.find(item => item.wa_id === message.from) ||
            contacts[0] ||
            {};

          const textBody = message.type === 'text'
            ? (message.text?.body || '')
            : '';

          whatsappBookingInbox.push({
            id: crypto.randomUUID(),
            whatsappMessageId: message.id,
            from: message.from || '',
            name: contact.profile?.name || 'WhatsApp ग्राहक',
            messageType: message.type || 'unknown',
            message: textBody,
            receivedAt: new Date(
              Number(message.timestamp || Math.floor(Date.now() / 1000)) * 1000
            ).toISOString(),
            status: 'pending-review',
            note: textBody
              ? 'ग्राहक का संदेश प्राप्त हुआ; स्टॉक और तारीख जाँचकर बुकिंग की पुष्टि करें।'
              : 'गैर-टेक्स्ट संदेश मिला; मैन्युअल समीक्षा आवश्यक।'
          });
        }
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('WhatsApp webhook processing error:', error.message);
    return res.sendStatus(500);
  }
});

// --------------------------------------------------
// WHATSAPP INBOX
// --------------------------------------------------

app.get('/api/whatsapp/inbox', authAdmin, (_req, res) => {
  return res.json({
    requests: whatsappBookingInbox.slice(-200).reverse()
  });
});

app.post('/api/whatsapp/inbox/:id/status', authAdmin, (req, res) => {
  const item = whatsappBookingInbox.find(
    entry => entry.id === req.params.id
  );

  if (!item) {
    return res.status(404).json({
      error: 'WhatsApp booking request not found.'
    });
  }

  const parsed = z.object({
    status: z.enum(['pending-review', 'approved', 'rejected']),
    note: z.string().max(500).optional()
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Valid status is required.'
    });
  }

  item.status = parsed.data.status;

  if (parsed.data.note !== undefined) {
    item.note = parsed.data.note;
  }

  item.updatedAt = new Date().toISOString();

  return res.json({ ok: true, request: item });
});

app.post('/api/whatsapp/send', authAdmin, async (req, res) => {
  const parsed = z.object({
    to: phoneSchema,
    message: z.string().min(1).max(4000)
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Valid recipient and message are required.'
    });
  }

  try {
    const provider = await sendWhatsAppText(
      parsed.data.to,
      parsed.data.message
    );

    return res.json({ ok: true, provider });
  } catch (error) {
    return res.status(502).json({
      error: error.message || 'WhatsApp message failed.'
    });
  }
});

// --------------------------------------------------
// AI CHAT API
// --------------------------------------------------

app.post('/api/ai/chat', authAdmin, async (req, res) => {
  const parsed = z.object({
    messages: z.array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1).max(12000)
      })
    ).min(1).max(30)
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid chat messages.'
    });
  }

  if (!process.env.AI_API_KEY) {
    return res.status(503).json({
      error: 'AI_API_KEY is not configured on the server.'
    });
  }

  const base = (
    process.env.AI_BASE_URL || 'https://api.openai.com/v1'
  ).replace(/\/$/, '');

  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'gpt-4.1-mini',
        messages: parsed.data.messages,
        temperature: 0.2
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(502).json({
        error: data?.error?.message || 'AI provider error'
      });
    }

    return res.json({
      reply: data?.choices?.[0]?.message?.content || ''
    });
  } catch {
    return res.status(502).json({
      error: 'AI provider is unreachable.'
    });
  }
});

// --------------------------------------------------
// PAYMENT RECORDING
// --------------------------------------------------

app.post('/api/payments/record-utr', (req, res) => {
  const parsed = z.object({
    bookingId: z.string().min(1).max(100),
    amount: moneySchema,
    utr: z.string().min(6).max(80),
    method: z.enum(['upi', 'online', 'cash']).default('upi'),
    phone: phoneSchema.optional()
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Booking ID, amount and UTR are required.'
    });
  }

  const payment = {
    id: crypto.randomUUID(),
    ...parsed.data,
    status: 'pending-verification',
    createdAt: new Date().toISOString()
  };

  paymentLedger.push(payment);

  return res.status(201).json({
    ok: true,
    payment,
    message:
      'Payment entry saved for manual/provider verification. ' +
      'UTR alone is not proof of settlement.'
  });
});

app.get('/api/payments/pending', authAdmin, (_req, res) => {
  return res.json({
    payments: paymentLedger.filter(
      payment => payment.status === 'pending-verification'
    )
  });
});

app.post('/api/payments/:id/verify', authAdmin, (req, res) => {
  const payment = paymentLedger.find(
    entry => entry.id === req.params.id
  );

  if (!payment) {
    return res.status(404).json({
      error: 'Payment not found'
    });
  }

  const parsed = z.object({
    verified: z.boolean(),
    note: z.string().max(300).optional()
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'verified boolean required'
    });
  }

  payment.status = parsed.data.verified ? 'verified' : 'rejected';
  payment.note = parsed.data.note || '';
  payment.verifiedAt = new Date().toISOString();

  return res.json({ ok: true, payment });
});

// --------------------------------------------------
// ERROR HANDLER AND SERVER EXPORT
// --------------------------------------------------

app.use((err, _req, res, _next) => {
  console.error(err.message);

  return res.status(
    err.message === 'Origin not allowed' ? 403 : 500
  ).json({
    error: isProd
      ? 'Request failed. Check server configuration.'
      : err.message
  });
});

// Local development server.
// On Vercel, export the Express app for the platform runtime.
if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`ERP API listening on :${port}`);
  });
}

export default app;
