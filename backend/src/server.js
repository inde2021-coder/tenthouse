import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import crypto from 'node:crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const app = express();
const port = Number(process.env.PORT || 8080);
const isProd = process.env.NODE_ENV === 'production';
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = (process.env.PUBLIC_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin(origin, cb) { if (!origin || allowedOrigins.includes(origin)) return cb(null, true); return cb(new Error('Origin not allowed')); }, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','X-Admin-Token'] }));
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
const memoryStore = new Map();
let adminDb = null;
try {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  // Support both a single JSON credential and the split variables already used
  // by the existing Vercel production project. Never log or expose credential data.
  const serviceAccount = serviceAccountJson
    ? JSON.parse(serviceAccountJson)
    : (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY
      ? {
          project_id: process.env.FIREBASE_PROJECT_ID,
          client_email: process.env.FIREBASE_CLIENT_EMAIL,
          private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        }
      : null);
  if (serviceAccount && databaseURL) {
    const adminApp = getApps().length ? getApps()[0] : initializeApp({ credential: cert(serviceAccount), databaseURL });
    adminDb = getDatabase(adminApp);
  }
} catch (error) {
  console.error('Firebase Admin initialization failed:', error.message);
}
const phoneKey = value => crypto.createHash('sha256').update(String(value)).digest('hex');
async function storeGet(path) {
  if (adminDb) { const snapshot = await adminDb.ref(path).get(); return snapshot.exists() ? snapshot.val() : null; }
  if (isProd) throw new Error('Persistent Firebase database is not configured.');
  return memoryStore.has(path) ? memoryStore.get(path) : null;
}
async function storeSet(path, value) {
  if (adminDb) { await adminDb.ref(path).set(value); return value; }
  if (isProd) throw new Error('Persistent Firebase database is not configured.');
  memoryStore.set(path, value); return value;
}
async function storeDelete(path) {
  if (adminDb) { await adminDb.ref(path).remove(); return; }
  if (isProd) throw new Error('Persistent Firebase database is not configured.');
  memoryStore.delete(path);
}
async function storeList(path) {
  const value = await storeGet(path);
  if (value && typeof value === 'object') return Object.values(value);
  // The in-memory development adapter stores full paths as flat keys, unlike RTDB.
  if (!adminDb && !isProd) {
    const prefix = String(path).replace(/\/+$/, '') + '/';
    return [...memoryStore.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, record]) => record);
  }
  return [];
}
async function storeCreateIfAbsent(path, value) {
  if (adminDb) {
    const result = await adminDb.ref(path).transaction(current => current === null ? value : undefined);
    return result.committed;
  }
  if (isProd) throw new Error('Persistent Firebase database is not configured.');
  if (memoryStore.has(path)) return false;
  memoryStore.set(path, value); return true;
}
const requireDurableStore = (_req, res, next) => {
  if (!adminDb && isProd) return res.status(503).json({ error: 'Production database is not configured. Set FIREBASE_DATABASE_URL and either FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY before using data APIs.' });
  next();
};
const otpLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, message: { error: 'बहुत अधिक OTP अनुरोध; कुछ देर बाद प्रयास करें।' } });
const otpVerifyLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, message: { verified: false, error: 'बहुत अधिक OTP सत्यापन प्रयास; कुछ देर बाद नया OTP लें।' } });
const aiLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'AI अनुरोध सीमा पूरी हुई; एक मिनट बाद प्रयास करें।' } });
const whatsappSendLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'WhatsApp संदेश सीमा पूरी हुई; एक मिनट बाद प्रयास करें।' } });
const phoneSchema = z.string().regex(/^\+?[1-9]\d{9,14}$/);
const moneySchema = z.number().finite().positive().max(10_000_000);
const authAdmin = (req, res, next) => {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected || expected.length < 32) return res.status(503).json({ error: 'Server admin token is not configured securely.' });
  const got = String(req.header('x-admin-token') || '').trim();
  // Require an exact length before constant-time comparison; never accept padded/truncated tokens.
  if (got.length !== expected.length) return res.status(401).json({ error: 'Unauthorized' });
  if (!crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) return res.status(401).json({ error: 'Unauthorized' });
  next();
};
app.get('/health', (_req, res) => res.json({ ok: true, service: 'rk-tent-house-erp-api', time: new Date().toISOString() }));
app.get('/ready', (_req, res) => {
  const persistentDatabaseReady = !!adminDb;
  const ready = !isProd || persistentDatabaseReady;
  res.status(ready ? 200 : 503).set('Cache-Control', 'no-store').json({
    ok: ready,
    service: 'rk-tent-house-erp-api',
    persistentDatabaseReady,
    environment: isProd ? 'production' : 'development'
  });
});
// Reports presence/configuration only; never returns secret values.
app.get('/api/diagnostics/providers', authAdmin, (_req, res) => {
  const provider = (process.env.OTP_PROVIDER || 'none').toLowerCase();
  const aiProvider = (process.env.AI_PROVIDER || ((process.env.AI_BASE_URL || '').includes('generativelanguage.googleapis.com') ? 'gemini' : 'openai')).toLowerCase();
  const secretOk = (process.env.OTP_HMAC_SECRET || '').length >= 32 && !/replace_with|unsafe-dev/i.test(process.env.OTP_HMAC_SECRET || '');
  const otpReady = provider === 'twilio'
    ? !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER && secretOk)
    : provider === 'msg91'
      ? !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID && secretOk)
      : provider === 'demo' ? !isProd : false;
  res.json({ ok: true, environment: isProd ? 'production' : 'development', checks: {
    adminToken: (process.env.ADMIN_API_TOKEN || '').length >= 32,
    otpHmacSecret: secretOk,
    otpProvider: provider,
    smsOtpReady: otpReady,
    whatsappSendReady: !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    whatsappWebhookReady: !!(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && process.env.WHATSAPP_APP_SECRET),
    aiProvider,
    aiReady: !!(process.env.AI_API_KEY && (aiProvider === 'gemini' || process.env.AI_BASE_URL || aiProvider === 'openai' || aiProvider === 'claude')),
    publicOriginConfigured: allowedOrigins.length > 0,
    persistentDatabaseReady: !!adminDb
  }});
});

async function sendWhatsAppText(to, body) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error('WhatsApp Cloud API credentials are not configured on the server.');
  const version = process.env.WHATSAPP_API_VERSION || 'v23.0';
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/\D/g,''), type: 'text', text: { preview_url: false, body } })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `WhatsApp provider returned ${response.status}`);
  return data;
}
async function sendOtpProvider(phone, otp, channel) {
  const provider = process.env.OTP_PROVIDER || 'none';
  const msg = `आपका Radha Krishna Tent House verification OTP ${otp} है। यह ${process.env.OTP_TTL_SECONDS || 300} सेकंड में समाप्त होगा। इसे किसी से साझा न करें।`;
  if (channel === 'whatsapp') return sendWhatsAppText(phone, msg);
  if (provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM_NUMBER;
    if (!sid || !token || !from) throw new Error('Twilio SMS credentials are not configured.');
    const form = new URLSearchParams({ To: phone, From: from, Body: msg });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method:'POST', headers:{ Authorization:'Basic '+Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type':'application/x-www-form-urlencoded' }, body:form });
    if (!r.ok) throw new Error('SMS provider rejected the request.'); return r.json();
  }
  if (provider === 'msg91') {
    // MSG91 template/flow setup varies by account; use the provider's approved OTP API template.
    const key = process.env.MSG91_AUTH_KEY, template = process.env.MSG91_TEMPLATE_ID;
    if (!key || !template) throw new Error('MSG91 Auth Key and approved template ID are required.');
    const r = await fetch('https://control.msg91.com/api/v5/otp', { method:'POST', headers:{ authkey:key, 'Content-Type':'application/json' }, body:JSON.stringify({ template_id:template, mobile:phone.replace('+',''), otp }) });
    if (!r.ok) throw new Error('MSG91 rejected the request.'); return r.json();
  }
  if (provider === 'demo' && !isProd) return { demo: true };
  throw new Error('OTP provider is not configured. Configure an approved SMS/WhatsApp provider in backend .env.');
}
app.post('/api/otp/send', otpLimiter, requireDurableStore, async (req, res) => {
  const parsed = z.object({ phone: phoneSchema, channel: z.enum(['sms','whatsapp','both']).default('sms') }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Valid international phone number and channel are required.' });
  const { phone, channel } = parsed.data; const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6,'0');
  const hmacSecret = process.env.OTP_HMAC_SECRET || '';
  if (hmacSecret.length < 32 || /replace_with|unsafe-dev/i.test(hmacSecret)) return res.status(503).json({ error: 'OTP_HMAC_SECRET सेट नहीं है या बहुत कमजोर है; कम-से-कम 32 अक्षरों का अलग secret सेट करें।' });
  const digest = crypto.createHmac('sha256', hmacSecret).update(`${phone}:${otp}`).digest('hex');
  try {
    const channels = channel === 'both' ? ['sms','whatsapp'] : [channel];
    const outcomes = await Promise.allSettled(channels.map(ch => sendOtpProvider(phone, otp, ch)));
    const sent = outcomes.map((o, i) => ({ channel: channels[i], ok: o.status === 'fulfilled', error: o.status === 'rejected' ? o.reason?.message : undefined }));
    if (!sent.some(x => x.ok)) throw new Error(sent.map(x => `${x.channel}: ${x.error || 'failed'}`).join('; '));
    await storeSet('erpPrivate/otp/' + phoneKey(phone), { digest, expires: Date.now() + Number(process.env.OTP_TTL_SECONDS || 300) * 1000, tries: 0 });
    const out = { ok: true, sent, message: sent.every(x => x.ok) ? 'OTP भेज दिया गया।' : 'OTP कम-से-कम एक चुने हुए चैनल से भेजा गया; आंशिक विफलता देखें।' };
    if (process.env.OTP_PROVIDER === 'demo' && !isProd) out.demoOtp = otp; // Never enabled in production.
    res.json(out);
  } catch (e) { res.status(503).json({ error: e.message }); }
});
app.post('/api/otp/verify', otpVerifyLimiter, requireDurableStore, async (req, res) => {
  const parsed = z.object({ phone: phoneSchema, otp: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'फोन और 6 अंकों का OTP आवश्यक है।' });
  const { phone, otp } = parsed.data;
  const path = 'erpPrivate/otp/' + phoneKey(phone);
  let rec;
  try { rec = await storeGet(path); } catch (error) { return res.status(503).json({ verified: false, error: error.message }); }
  if (!rec || rec.expires < Date.now() || rec.tries >= 5) { await storeDelete(path); return res.status(400).json({ verified: false, error: 'OTP समाप्त हो गया या उपलब्ध नहीं है।' }); }
  rec.tries++;
  await storeSet(path, rec);
  const hmacSecret = process.env.OTP_HMAC_SECRET || '';
  if (hmacSecret.length < 32 || /replace_with|unsafe-dev/i.test(hmacSecret)) return res.status(503).json({ verified: false, error: 'OTP_HMAC_SECRET सही तरह configured नहीं है।' });
  const got = crypto.createHmac('sha256', hmacSecret).update(`${phone}:${otp}`).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(got), Buffer.from(rec.digest))) return res.status(400).json({ verified: false, error: 'OTP गलत है।' });
  await storeDelete(path); res.json({ verified: true });
});
// Meta WhatsApp Cloud API webhook: configure this HTTPS URL in Meta App Dashboard.
app.get('/webhooks/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected && typeof challenge === 'string') return res.status(200).type('text/plain').send(challenge);
  return res.sendStatus(403);
});
app.post('/webhooks/whatsapp', requireDurableStore, async (req, res) => {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const signature = req.get('x-hub-signature-256') || '';
  if (!appSecret || !req.rawBody || !signature.startsWith('sha256=')) return res.sendStatus(401);
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);
  try {
    const payload = req.body;
    if (payload?.object !== 'whatsapp_business_account') return res.sendStatus(200);
    for (const entry of payload.entry || []) for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      const contacts = value.contacts || [];
      for (const status of value.statuses || []) {
        // Delivery/read status events are accepted and logged without exposing message contents.
        console.log('WhatsApp status update:', JSON.stringify({ id: status.id, status: status.status, timestamp: status.timestamp }));
      }
      for (const msg of value.messages || []) {
        if (!msg.id) continue;
        const messageKey = phoneKey(msg.id);
        const contact = contacts.find(c => c.wa_id === msg.from) || contacts[0] || {};
        const textBody = msg.type === 'text' ? (msg.text?.body || '') : '';
        const record = {
          id: 'wa-' + messageKey, whatsappMessageId: msg.id,
          from: msg.from || '', name: contact.profile?.name || 'WhatsApp ग्राहक',
          messageType: msg.type || 'unknown', message: textBody,
          receivedAt: new Date(Number(msg.timestamp || Math.floor(Date.now()/1000))*1000).toISOString(),
          status: 'pending-review',
          note: textBody ? 'ग्राहक का संदेश प्राप्त हुआ; स्टॉक/तारीख जाँचकर बुकिंग की पुष्टि करें।' : 'गैर-टेक्स्ट संदेश मिला; मैन्युअल समीक्षा आवश्यक।'
        };
        const inserted = await storeCreateIfAbsent('erpData/whatsappInbox/' + record.id, record);
        if (!inserted) continue;
      }
    }
    return res.sendStatus(200);
  } catch (err) {
    console.error('WhatsApp webhook processing error:', err.message);
    return res.sendStatus(500);
  }
});
app.get('/api/whatsapp/inbox', authAdmin, requireDurableStore, async (_req, res) => {
  try {
    const requests = (await storeList('erpData/whatsappInbox')).sort((a,b) => String(b.receivedAt||'').localeCompare(String(a.receivedAt||''))).slice(0,200);
    res.json({ requests });
  } catch (error) { res.status(503).json({ error: error.message }); }
});
app.post('/api/whatsapp/inbox/:id/status', authAdmin, requireDurableStore, async (req, res) => {
  const parsed = z.object({ status: z.enum(['pending-review','approved','rejected']), note: z.string().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Valid status is required.' });
  try {
    const path = 'erpData/whatsappInbox/' + req.params.id;
    const item = await storeGet(path);
    if (!item) return res.status(404).json({ error: 'WhatsApp booking request not found.' });
    item.status = parsed.data.status;
    if (parsed.data.note !== undefined) item.note = parsed.data.note;
    item.updatedAt = new Date().toISOString();
    await storeSet(path, item);
    res.json({ ok: true, request: item });
  } catch (error) { res.status(503).json({ error: error.message }); }
});

const bookingLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function getReservedAdminStockByItem(bookings, date, returnDate) {
  const reserved = new Map();
  const activeStatuses = new Set(['Pending Approval', 'Confirmed']);
  for (const booking of bookings || []) {
    if (!booking || !activeStatuses.has(String(booking.status || ''))) continue;
    const start = String(booking.date || ''), end = String(booking.returnDate || start);
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(start) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(end)) continue;
    if (start > returnDate || end < date) continue;
    for (const item of booking.items || []) {
      if (item?.source === 'third-party') continue;
      const key = String(item?.name || '').trim().toLowerCase();
      const qty = Math.max(0, Math.floor(Number(item?.qty) || 0));
      if (key && qty) reserved.set(key, (reserved.get(key) || 0) + qty);
    }
  }
  return reserved;
}

const customerBookingSchema = z.object({
  name: z.string().trim().min(2).max(120),
  mob: phoneSchema,
  address: z.string().trim().min(2).max(500),
  eventType: z.string().trim().min(1).max(80),
  guestCount: z.number().int().min(1).max(100000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  advanceAmount: z.number().finite().min(0).max(10000000),
  payMode: z.string().trim().min(1).max(40),
  utrNumber: z.string().max(80).optional().default(''),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    qty: z.number().int().positive().max(100000),
    rentPrice: z.number().finite().min(0).max(1000000).default(500),
    missingCharge: z.number().finite().min(0).max(1000000).optional().default(0),
    vendorRentRate: z.number().finite().min(0).max(1000000).optional().default(0),
    source: z.enum(['admin','third-party']).optional().default('admin'),
    partyName: z.string().max(120).optional().default('')
  })).max(100).default([])
}).refine(data => data.returnDate >= data.date, { message: 'Return date must not be before booking date.', path: ['returnDate'] })
  .refine(data => isValidIsoDate(data.date) && isValidIsoDate(data.returnDate), { message: 'बुकिंग और वापसी की तारीख वास्तविक कैलेंडर तारीख होनी चाहिए।', path: ['date'] })
  .refine(data => data.payMode !== 'UPI' || data.advanceAmount === 0 || String(data.utrNumber || '').trim().length >= 6, { message: 'UTR is required for online advance payment.', path: ['utrNumber'] });
app.post('/api/customer/bookings', bookingLimiter, requireDurableStore, async (req,res) => {
  const parsed=customerBookingSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'बुकिंग विवरण सही भरें।',details:parsed.error.flatten()});
  if(parsed.data.date < new Date().toISOString().slice(0,10))return res.status(400).json({error:'बुकिंग तारीख आज या भविष्य की होनी चाहिए।'});
  try{
    let customerItems=parsed.data.items;
    if(customerItems.length){
      if(!adminDb)return res.status(503).json({error:'सामान और सही किराया सत्यापित करने के लिए Firebase stock catalog उपलब्ध नहीं है।'});
      const stockValue=await storeGet('tent_erp_data/stock');
      const stockRows=Array.isArray(stockValue)?stockValue:Object.values(stockValue||{});
      // Reserve un-dispatched bookings for overlapping rental dates so two customers
      // cannot both book the same physical stock before dispatch updates inventory.
      const [portalBookings, adminBookings] = await Promise.all([
        storeList('erpData/customerBookings'),
        storeList('tent_erp_data/bookings')
      ]);
      const allBookings = new Map();
      for (const booking of [...adminBookings, ...portalBookings]) {
        if (booking && booking.id != null) allBookings.set(String(booking.id), booking);
      }
      const reservedByName = getReservedAdminStockByItem([...allBookings.values()], parsed.data.date, parsed.data.returnDate);
      const requestedByName=new Map();
      for(const item of customerItems){
        if(item.source==='third-party')return res.status(400).json({error:'Customer portal से केवल Admin stock चुना जा सकता है।'});
        const key=String(item.name||'').trim().toLowerCase();
        requestedByName.set(key,(requestedByName.get(key)||0)+item.qty);
      }
      for(const [key,qty] of requestedByName){
        const stockItem=stockRows.find(row=>String(row.name||row.item||'').trim().toLowerCase()===key);
        if(!stockItem)return res.status(409).json({error:'चुना गया सामान अब stock catalog में उपलब्ध नहीं है: '+key});
        const physicalAvailable=Math.max(0,Number(stockItem.qty)||0);
        const alreadyReserved=reservedByName.get(key)||0;
        if(qty+alreadyReserved>physicalAvailable)return res.status(409).json({error:'चुनी गई तारीखों में सामान उपलब्ध नहीं है: '+key+' (स्टॉक '+physicalAvailable+', पहले से बुक '+alreadyReserved+')'});
      }
      customerItems=customerItems.map(item=>{
        const stockItem=stockRows.find(row=>String(row.name||row.item||'').trim().toLowerCase()===String(item.name||'').trim().toLowerCase());
        const setRent=Number(stockItem.setRent)||0,singleRent=Number(stockItem.singleRent)||0;
        const rentPrice=setRent>0?setRent:singleRent;
        if(!Number.isFinite(rentPrice)||rentPrice<0)throw new Error('Stock catalog में किराया दर सही नहीं है: '+item.name);
        return {...item,rentPrice,missingCharge:0,source:'admin',partyName:''};
      });
    }
    let id=Date.now();
    while(await storeGet('erpData/customerBookings/'+String(id)))id++;
    const booking={id,...parsed.data,items:customerItems,status:'Pending Approval',partPayments:[],advancePaymentVerified:false,
      advancePaymentStatus:parsed.data.advanceAmount>0?(parsed.data.payMode==='UPI'?'pending-verification':'pending-admin-confirmation'):'not-applicable',
      createdAt:new Date().toISOString(),source:'customer-portal'};
    let utrKey=null;
    if(parsed.data.payMode==='UPI'&&parsed.data.advanceAmount>0){
      utrKey=phoneKey(parsed.data.utrNumber.trim().toLowerCase());
      const unique=await storeCreateIfAbsent('erpPrivate/utrIndex/'+utrKey,{bookingId:String(id),createdAt:new Date().toISOString()});
      if(!unique)return res.status(409).json({error:'यह UTR पहले किसी भुगतान में दर्ज हो चुका है।'});
    }
    const saved=await storeCreateIfAbsent('erpData/customerBookings/'+String(id),booking);
    if(!saved){if(utrKey)await storeDelete('erpPrivate/utrIndex/'+utrKey).catch(()=>{});return res.status(409).json({error:'बुकिंग ID दोबारा बन गई; कृपया फिर प्रयास करें।'});}
    if(utrKey){
      try{await storeSet('erpData/payments/advance-'+id,{id:'advance-'+id,bookingId:String(id),amount:parsed.data.advanceAmount,utr:parsed.data.utrNumber.trim(),method:'upi',phone:parsed.data.mob,status:'pending-verification',createdAt:booking.createdAt});}
      catch(error){await storeDelete('erpData/customerBookings/'+String(id)).catch(()=>{});await storeDelete('erpPrivate/utrIndex/'+utrKey).catch(()=>{});throw error;}
    }
    res.status(201).json({ok:true,booking,message:'बुकिंग Admin Panel में approval के लिए भेज दी गई। Advance payment UTR सत्यापन के लिए Pending है।'});
  }catch(error){res.status(503).json({error:error.message});}
});
app.get('/api/customer/stock', requireDurableStore, async (_req,res) => {
  try {
    const value=await storeGet('tent_erp_data/stock');
    const rows=Array.isArray(value)?value:Object.values(value||{});
    const items=rows.filter(row=>row&&typeof row==='object'&&String(row.name||row.item||'').trim()&&Math.max(0,Number(row.qty)||0)>0)
      .map(row=>({
        name:String(row.name||row.item).trim(),
        qty:Math.max(0,Number(row.qty)||0),
        singleRent:Math.max(0,Number(row.singleRent)||0),
        setRent:Math.max(0,Number(row.setRent)||0)
      }));
    res.set('Cache-Control','no-store');
    res.json({items});
  } catch(error) { res.status(503).json({error:error.message}); }
});
app.get('/api/customer/bookings', authAdmin, requireDurableStore, async (_req,res) => {
  try{
    const bookings=(await storeList('erpData/customerBookings')).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    res.json({bookings});
  }catch(error){res.status(503).json({error:error.message});}
});
app.patch('/api/customer/bookings/:id/advance', authAdmin, requireDurableStore, async (req,res) => {
  if(!/^\d{10,16}$/.test(req.params.id))return res.status(400).json({error:'Invalid booking ID.'});
  const parsed=z.object({verified:z.boolean(),note:z.string().max(300).optional()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'verified boolean required.'});
  try{
    const path='erpData/customerBookings/'+req.params.id,booking=await storeGet(path);
    if(!booking)return res.status(404).json({error:'Customer booking not found.'});
    if(!(Number(booking.advanceAmount)>0))return res.status(400).json({error:'No advance payment was submitted.'});
    booking.advancePaymentVerified=parsed.data.verified;
    booking.advancePaymentStatus=parsed.data.verified?'verified':'rejected';
    booking.advancePaymentNote=parsed.data.note||'';
    booking.updatedAt=new Date().toISOString();
    await storeSet(path,booking);
    const paymentPath='erpData/payments/advance-'+req.params.id,payment=await storeGet(paymentPath);
    if(payment){payment.status=parsed.data.verified?'verified':'rejected';payment.note=booking.advancePaymentNote;payment.verifiedAt=booking.updatedAt;await storeSet(paymentPath,payment);}
    res.json({ok:true,booking});
  }catch(error){res.status(503).json({error:error.message});}
});

app.put('/api/customer/bookings/:id', authAdmin, requireDurableStore, async (req,res) => {
  if(!/^\d{10,16}$/.test(req.params.id))return res.status(400).json({error:'Invalid booking ID.'});
  const parsed=z.object({
    name:z.string().trim().min(2).max(120).optional(),
    mob:phoneSchema.optional(),
    address:z.string().trim().min(2).max(500).optional(),
    eventType:z.string().trim().min(1).max(80).optional(),
    guestCount:z.number().int().min(1).max(100000).optional(),
    date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    returnDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    items:z.array(z.object({name:z.string().trim().min(1).max(120),qty:z.number().int().positive().max(100000),rentPrice:z.number().finite().min(0).max(1000000),source:z.enum(['admin','third-party']).optional(),partyName:z.string().max(120).optional()})).max(100).optional()
  }).strict().safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Invalid booking edits.',details:parsed.error.flatten()});
  if([parsed.data.date,parsed.data.returnDate].filter(Boolean).some(date=>!isValidIsoDate(date)))return res.status(400).json({error:'बुकिंग और वापसी की तारीख वास्तविक कैलेंडर तारीख होनी चाहिए।'});
  try{
    const path='erpData/customerBookings/'+req.params.id,booking=await storeGet(path);
    if(!booking)return res.status(404).json({error:'Customer booking not found.'});
    const next={...booking,...parsed.data,updatedAt:new Date().toISOString()};
    if(next.returnDate<next.date)return res.status(400).json({error:'Return date must not be before dispatch date.'});
    await storeSet(path,next);res.json({ok:true,booking:next});
  }catch(error){res.status(503).json({error:error.message});}
});

app.put('/api/customer/bookings/:id/workflow', authAdmin, requireDurableStore, async (req,res) => {
  if(!/^\d{10,16}$/.test(req.params.id))return res.status(400).json({error:'Invalid booking ID.'});
  const itemSchema=z.object({
    name:z.string().trim().min(1).max(120),qty:z.number().int().positive().max(100000),
    rentPrice:z.number().finite().min(0).max(1000000),missingCharge:z.number().finite().min(0).max(1000000).optional().default(0),
    vendorRentRate:z.number().finite().min(0).max(1000000).optional().default(0),
    source:z.enum(['admin','third-party']).optional().default('admin'),partyName:z.string().max(120).optional().default(''),
    returnedQty:z.number().int().min(0).optional().default(0),missingQty:z.number().int().min(0).optional().default(0),
    lastReturnDate:z.string().optional()
  });
  const dispatchSchema=z.object({
    itemIndex:z.number().int().min(0),itemName:z.string().max(120),qty:z.number().int().positive().max(100000),
    date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),unitRent:z.number().finite().min(0),
    vendorRentRate:z.number().finite().min(0).optional().default(0),source:z.enum(['admin','third-party']).optional().default('admin'),
    partyName:z.string().max(120).optional().default(''),createdAt:z.string().optional()
  });
  const returnSchema=z.object({
    date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),mode:z.enum(['FINAL','PARTIAL']),
    items:z.array(z.object({itemIndex:z.number().int().min(0),qty:z.number().int().min(0)})).max(100),
    createdAt:z.string().optional()
  });
  const parsed=z.object({
    status:z.enum(['Pending Approval','Confirmed','Dispatched','Partially Returned','Returned','Rejected','Cancelled']).optional(),
    items:z.array(itemSchema).max(100).optional(),dispatchEntries:z.array(dispatchSchema).max(1000).optional(),
    returnEntries:z.array(returnSchema).max(1000).optional(),actualReturnDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    lastDispatchDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),lastReturnDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fullyReturnedAt:z.string().nullable().optional(),returnProcessedAt:z.string().nullable().optional(),
    otherCharges:z.number().finite().min(0).optional(),discountAmount:z.number().finite().min(0).optional(),
    partPayments:z.array(z.object({amount:z.number().finite().positive(),method:z.string().max(40).optional(),date:z.string().optional(),note:z.string().max(300).optional()})).max(500).optional(),
    totalPaid:z.number().finite().min(0).optional(),paidAmt:z.number().finite().min(0).optional(),dueAmount:z.number().finite().min(0).optional()
  }).strict().safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Invalid booking workflow update.',details:parsed.error.flatten()});
  const workflowDates=[parsed.data.actualReturnDate,parsed.data.lastDispatchDate,parsed.data.lastReturnDate,...(parsed.data.dispatchEntries||[]).map(entry=>entry.date),...(parsed.data.returnEntries||[]).map(entry=>entry.date),...(parsed.data.items||[]).map(item=>item.lastReturnDate)].filter(Boolean);
  if(workflowDates.some(date=>!isValidIsoDate(date)))return res.status(400).json({error:'Workflow में वास्तविक कैलेंडर तारीख दर्ज करें।'});
  try{
    const path='erpData/customerBookings/'+req.params.id,booking=await storeGet(path);
    if(!booking)return res.status(404).json({error:'Customer booking not found.'});
    Object.assign(booking,parsed.data,{updatedAt:new Date().toISOString()});
    await storeSet(path,booking);res.json({ok:true,booking});
  }catch(error){res.status(503).json({error:error.message});}
});

app.get('/api/customer/bookings/:id/status', requireDurableStore, async (req,res) => {
  if(!/^\d{10,16}$/.test(req.params.id))return res.status(400).json({error:'Invalid booking ID.'});
  const mobile=String(req.query.mobile||'').replace(/\D/g,'').slice(-10);
  if(!/^\d{10}$/.test(mobile))return res.status(400).json({error:'बुकिंग मोबाइल नंबर दर्ज करें।'});
  try{
    const booking=await storeGet('erpData/customerBookings/'+req.params.id);
    if(!booking||String(booking.mob||'').replace(/\D/g,'').slice(-10)!==mobile)return res.status(404).json({error:'बुकिंग ID और मोबाइल नंबर का मिलान नहीं हुआ।'});
    const safeBooking={
      id:booking.id,name:booking.name,mob:booking.mob,date:booking.date,returnDate:booking.returnDate,eventType:booking.eventType,
      guestCount:booking.guestCount,status:booking.status,items:booking.items||[],dispatchEntries:booking.dispatchEntries||[],
      returnEntries:booking.returnEntries||[],actualReturnDate:booking.actualReturnDate||null,fullyReturnedAt:booking.fullyReturnedAt||null,lastDispatchDate:booking.lastDispatchDate||null,lastReturnDate:booking.lastReturnDate||null,advanceAmount:booking.advanceAmount||0,
      advancePaymentStatus:booking.advancePaymentStatus||'not-applicable',advancePaymentVerified:booking.advancePaymentVerified===true,
      payMode:booking.payMode||'',otherCharges:booking.otherCharges||0,discountAmount:booking.discountAmount||0,
      partPayments:booking.partPayments||[],updatedAt:booking.updatedAt||booking.createdAt
    };
    res.set('Cache-Control','no-store');
    res.json({ok:true,booking:safeBooking});
  }catch(error){res.status(503).json({error:error.message});}
});

app.patch('/api/customer/bookings/:id/status', authAdmin, requireDurableStore, async (req,res) => {
  if(!/^\d{10,16}$/.test(req.params.id))return res.status(400).json({error:'Invalid booking ID.'});
  const parsed=z.object({status:z.enum(['Confirmed','Rejected','Cancelled'])}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Invalid booking status.'});
  try{
    const path='erpData/customerBookings/'+req.params.id,booking=await storeGet(path);
    if(!booking)return res.status(404).json({error:'Customer booking not found.'});
    booking.status=parsed.data.status;booking.updatedAt=new Date().toISOString();
    if(booking.status==='Confirmed')booking.confirmedAt=booking.updatedAt;
    await storeSet(path,booking);res.json({ok:true,booking});
  }catch(error){res.status(503).json({error:error.message});}
});

app.post('/api/whatsapp/send', whatsappSendLimiter, authAdmin, async (req,res) => {
  const parsed = z.object({ to: phoneSchema, message: z.string().min(1).max(4000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Valid to and message are required.' });
  try { res.json({ ok: true, provider: await sendWhatsAppText(parsed.data.to, parsed.data.message) }); }
  catch(e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/ai/chat', aiLimiter, authAdmin, async (req,res) => {
  const parsed = z.object({ messages: z.array(z.object({ role:z.enum(['system','user','assistant']), content:z.string().min(1).max(12000) })).min(1).max(30) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid chat messages.' });
  if (!process.env.AI_API_KEY) return res.status(503).json({ error: 'AI_API_KEY is not configured on the server.' });
  const provider = (process.env.AI_PROVIDER || ((process.env.AI_BASE_URL || '').includes('generativelanguage.googleapis.com') ? 'gemini' : 'openai')).toLowerCase();
  try {
    if (provider === 'gemini' || provider === 'google' || (process.env.AI_BASE_URL || '').includes('generativelanguage.googleapis.com')) {
      const model = process.env.AI_MODEL || 'gemini-2.5-flash';
      const system = parsed.data.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
      const contents = parsed.data.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const base = (process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
      const r = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.AI_API_KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents, generationConfig: { temperature: 0.2, maxOutputTokens: Number(process.env.AI_MAX_TOKENS || 1200) } }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(502).json({ error: data?.error?.message || `Gemini API error (${r.status})` });
      return res.json({ reply: (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n') });
    }
    if (provider === 'claude' || provider === 'anthropic') {
      const system = parsed.data.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
      const messages = parsed.data.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
      const r = await fetch('https://api.anthropic.com/v1/messages', { method:'POST', headers:{ 'x-api-key':process.env.AI_API_KEY, 'anthropic-version':process.env.ANTHROPIC_VERSION || '2023-06-01', 'content-type':'application/json' }, body:JSON.stringify({ model:process.env.AI_MODEL || 'claude-3-5-haiku-latest', max_tokens:Number(process.env.AI_MAX_TOKENS || 1200), ...(system ? {system} : {}), messages, temperature:0.2 }) });
      const data = await r.json().catch(()=>({}));
      if(!r.ok) return res.status(502).json({ error:data?.error?.message || 'Claude API error' });
      return res.json({ reply:(data?.content || []).filter(c=>c.type==='text').map(c=>c.text).join('\n') });
    }
    const base = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/,'');
    const r = await fetch(`${base}/chat/completions`, { method:'POST', headers:{ Authorization:`Bearer ${process.env.AI_API_KEY}`, 'Content-Type':'application/json' }, body:JSON.stringify({ model:process.env.AI_MODEL || 'gpt-4.1-mini', messages:parsed.data.messages, temperature:0.2 }) });
    const data = await r.json().catch(()=>({})); if(!r.ok) return res.status(502).json({ error:data?.error?.message || 'AI provider error' });
    return res.json({ reply:data?.choices?.[0]?.message?.content || '' });
  } catch { return res.status(502).json({ error: 'AI provider is unreachable.' }); }
});
// Gemini TTS: API key remains on the server; returns generated WAV audio.
app.post('/api/ai/tts', aiLimiter, authAdmin, async (req, res) => {
  const parsed = z.object({ text: z.string().trim().min(1).max(4000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Speech text is required (max 4000 characters).' });
  if (!process.env.AI_API_KEY) return res.status(503).json({ error: 'AI_API_KEY is not configured on the server.' });
  const provider = (process.env.AI_PROVIDER || ((process.env.AI_BASE_URL || '').includes('generativelanguage.googleapis.com') ? 'gemini' : 'openai')).toLowerCase();
  if (!['gemini','google'].includes(provider) && !(process.env.AI_BASE_URL || '').includes('generativelanguage.googleapis.com')) return res.status(501).json({ error: 'Gemini voice requires AI_PROVIDER=gemini.' });
  try {
    const base = (process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const model = process.env.TTS_MODEL || 'gemini-2.5-flash-preview-tts';
    const r = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.AI_API_KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: `Speak naturally in Hindi or Hinglish. Warm, friendly, clear female assistant voice named Shraddha. Conversational pace, gentle and confident. Read only the following response, without adding words:\n${parsed.data.text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.TTS_VOICE || 'Aoede' } } } } })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || `Gemini TTS error (${r.status})` });
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const audio = parts.find(p => p?.inlineData?.data && /^audio\//i.test(p.inlineData.mimeType || ''))?.inlineData;
    if (!audio) return res.status(502).json({ error: 'Gemini TTS returned no audio. Check TTS model/API access.' });
    return res.json({ audioBase64: audio.data, mimeType: audio.mimeType || 'audio/wav', voice: process.env.TTS_VOICE || 'Aoede' });
  } catch (e) { return res.status(502).json({ error: 'Gemini TTS service is unreachable.' }); }
});

app.post('/api/payments/record-utr', authAdmin, requireDurableStore, async (req,res) => {
  const parsed = z.object({ bookingId:z.string().min(1).max(100), amount:moneySchema, utr:z.string().min(6).max(80), method:z.enum(['upi','online','cash']).default('upi'), phone:phoneSchema.optional() }).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({ error:'Booking ID, amount and UTR are required.' });
  try {
    const id=crypto.randomUUID(), utrKey=phoneKey(parsed.data.utr.trim().toLowerCase());
    const unique=await storeCreateIfAbsent('erpPrivate/utrIndex/'+utrKey,{id,createdAt:new Date().toISOString()});
    if(!unique)return res.status(409).json({error:'This UTR has already been submitted.'});
    const record={id,...parsed.data,status:'pending-verification',createdAt:new Date().toISOString()};
    try { await storeSet('erpData/payments/'+id,record); }
    catch(error) { await storeDelete('erpPrivate/utrIndex/'+utrKey).catch(()=>{}); throw error; }
    res.status(201).json({ok:true,payment:record,message:'Payment entry saved for manual/provider verification. UTR is not proof of settlement by itself.'});
  } catch(error) { res.status(503).json({error:error.message}); }
});
app.get('/api/payments/pending', authAdmin, requireDurableStore, async (_req,res) => {
  try { res.json({payments:(await storeList('erpData/payments')).filter(p=>p.status==='pending-verification')}); }
  catch(error) { res.status(503).json({error:error.message}); }
});
app.post('/api/payments/:id/verify', authAdmin, requireDurableStore, async (req,res) => {
  const parsed=z.object({verified:z.boolean(),note:z.string().max(300).optional()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'verified boolean required'});
  try {
    const path='erpData/payments/'+req.params.id,p=await storeGet(path);
    if(!p)return res.status(404).json({error:'Payment not found'});
    p.status=parsed.data.verified?'verified':'rejected';p.note=parsed.data.note||'';p.verifiedAt=new Date().toISOString();
    await storeSet(path,p);res.json({ok:true,payment:p});
  } catch(error) { res.status(503).json({error:error.message}); }
});
app.use((err,_req,res,_next) => { console.error(err.message); res.status(500).json({ error: isProd ? 'Internal server error' : err.message }); });
app.listen(port, () => console.log(`ERP API listening on :${port}`));
