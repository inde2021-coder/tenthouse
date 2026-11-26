const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');

let child;
let baseUrl;
const adminToken = 'test-admin-token-0123456789-abcdefghijkl';
const otpSecret = 'test-otp-hmac-secret-0123456789-abcdefghijkl';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function request(route, options = {}) {
  return fetch(baseUrl + route, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
}

before(async () => {
  const port = await reservePort();
  baseUrl = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, [path.join(__dirname, '..', 'backend', 'src', 'server.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      API_RATE_LIMIT_MAX: '500',
      PORT: String(port),
      ADMIN_API_TOKEN: adminToken,
      OTP_HMAC_SECRET: otpSecret,
      OTP_PROVIDER: 'demo',
      OTP_DEMO_DELAY_MS: '100',
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-webhook-verify-token',
      WHATSAPP_APP_SECRET: 'test-whatsapp-app-secret',
      PUBLIC_ORIGIN: 'https://erp.example.test'
    },
    stdio: 'ignore'
  });

  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Backend server exited before becoming ready.');
    try {
      const response = await fetch(baseUrl + '/health');
      if (response.ok) {
        const data = await response.json();
        assert.equal(data.ok, true);
        ready = true;
        break;
      }
    } catch (_) {}
    await delay(50);
  }
  assert.equal(ready, true, 'Backend did not become ready within five seconds.');
});

after(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    delay(2000)
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
});

test('production readiness fails closed when Firebase credentials are absent', async () => {
  const port = await reservePort();
  const productionServer = spawn(process.execPath, [path.join(__dirname, '..', 'backend', 'src', 'server.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      FIREBASE_SERVICE_ACCOUNT_JSON: '',
      FIREBASE_DATABASE_URL: '',
      ADMIN_API_TOKEN: adminToken,
      OTP_HMAC_SECRET: otpSecret
    },
    stdio: 'ignore'
  });
  try {
    let response = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (productionServer.exitCode !== null) throw new Error('Production backend exited before readiness check.');
      try {
        response = await fetch('http://127.0.0.1:' + port + '/ready');
        break;
      } catch (_) {
        await delay(50);
      }
    }
    assert.ok(response, 'Production backend did not respond to readiness check.');
    assert.equal(response.status, 503);
    const data = await response.json();
    assert.equal(data.ok, false);
    assert.equal(data.environment, 'production');
    assert.equal(data.persistentDatabaseReady, false);
  } finally {
    if (productionServer.exitCode === null) {
      productionServer.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve => productionServer.once('exit', resolve)),
        delay(2000)
      ]);
      if (productionServer.exitCode === null) productionServer.kill('SIGKILL');
    }
  }
});

test('readiness endpoint reports database configuration without exposing secrets', async () => {
  const response = await request('/ready');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.environment, 'development');
  assert.equal(data.persistentDatabaseReady, false);
  assert.equal(Object.hasOwn(data, 'serviceAccount'), false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('public customer stock endpoint returns a safe catalog array', async () => {
  const response = await request('/api/customer/stock');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(Array.isArray(data.items));
  for (const item of data.items) {
    assert.deepEqual(Object.keys(item).sort(), ['name', 'qty', 'setRent', 'singleRent'].sort());
  }
});

test('public customer booking requires at least one stock item and status lookup validates the mobile', async () => {
  const payload = {
    name: 'Test Customer',
    mob: '+919876543210',
    address: 'Test Address',
    eventType: 'Wedding',
    guestCount: 100,
    date: '2027-01-01',
    returnDate: '2027-01-02',
    advanceAmount: 0,
    payMode: 'Cash',
    items: []
  };
  const created = await request('/api/customer/bookings', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(created.status, 400);
  assert.match((await created.json()).error, /बुकिंग विवरण सही भरें/);

  const invalidMobile = await request('/api/customer/bookings/123456789012/status?mobile=123');
  assert.equal(invalidMobile.status, 400);
  const missingBooking = await request('/api/customer/bookings/123456789012/status?mobile=9876543210');
  assert.equal(missingBooking.status, 404);

  // Invalid and missing lookups count too; repeated ID/mobile guessing must be throttled.
  for (let i = 0; i < 28; i++) {
    await request('/api/customer/bookings/123456789012/status?mobile=9876543210');
  }
  const limited = await request('/api/customer/bookings/123456789012/status?mobile=9876543210');
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /15 मिनट/);
});

test('customer item bookings fail closed when the server stock catalog is unavailable', async () => {
  const response = await request('/api/customer/bookings', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Price Tamper Test',
      mob: '9876543212',
      address: 'Test Address',
      eventType: 'Wedding',
      guestCount: 50,
      date: '2026-12-01',
      returnDate: '2026-12-02',
      advanceAmount: 0,
      payMode: 'Cash',
      items: [{ name: 'Chair', qty: 1, rentPrice: 0, source: 'admin' }]
    })
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /stock catalog/);
});

test('admin-only booking list rejects missing token and accepts the configured token', async () => {
  const denied = await request('/api/customer/bookings');
  assert.equal(denied.status, 401);

  const allowed = await request('/api/customer/bookings', {
    headers: { 'x-admin-token': adminToken }
  });
  assert.equal(allowed.status, 200);
  const data = await allowed.json();
  assert.ok(Array.isArray(data.bookings));
  assert.ok(data.bookings.every(booking => booking && typeof booking.id !== 'undefined'));
});

test('concurrent OTP sends for one phone are serialized and cannot invalidate a delivered code', async () => {
  const send = () => request('/api/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone: '9876543213', channel: 'sms' })
  });
  const responses = await Promise.all([send(), send()]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const delivered = responses.find(response => response.status === 200);
  assert.match((await delivered.json()).demoOtp, /^\d{6}$/);
});

test('demo OTP is delivered only in development and verifies once', async () => {
  const sent = await request('/api/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone: '9876543210', channel: 'sms' })
  });
  assert.equal(sent.status, 200);
  const sentData = await sent.json();
  assert.match(sentData.demoOtp, /^\d{6}$/);

  const verified = await request('/api/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ phone: '9876543210', otp: sentData.demoOtp })
  });
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).verified, true);

  const replay = await request('/api/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ phone: '9876543210', otp: sentData.demoOtp })
  });
  assert.equal(replay.status, 400);
});

test('concurrent OTP verification can succeed only once', async () => {
  const sent = await request('/api/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone: '9876543211', channel: 'sms' })
  });
  assert.equal(sent.status, 200);
  const { demoOtp } = await sent.json();
  const attempts = await Promise.all([
    request('/api/otp/verify', { method: 'POST', body: JSON.stringify({ phone: '9876543211', otp: demoOtp }) }),
    request('/api/otp/verify', { method: 'POST', body: JSON.stringify({ phone: '9876543211', otp: demoOtp }) })
  ]);
  const statuses = attempts.map(response => response.status).sort();
  assert.deepEqual(statuses, [200, 400]);
  const results = await Promise.all(attempts.map(response => response.json()));
  assert.equal(results.filter(result => result.verified === true).length, 1);
});

test('OTP locks after five invalid attempts and rejects the correct code afterward', async () => {
  const sent = await request('/api/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone: '9876543212', channel: 'sms' })
  });
  assert.equal(sent.status, 200);
  const { demoOtp } = await sent.json();
  for (let attempt = 0; attempt < 5; attempt++) {
    const invalid = await request('/api/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543212', otp: '000000' === demoOtp ? '000001' : '000000' })
    });
    assert.equal(invalid.status, 400);
  }
  const locked = await request('/api/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ phone: '9876543212', otp: demoOtp })
  });
  assert.equal(locked.status, 400);
});

test('WhatsApp webhook verifies challenge and authenticates signed, idempotent events', async () => {
  const challenge = 'test-challenge-123';
  const verified = await request('/api/webhook?hub.mode=subscribe&hub.verify_token=test-webhook-verify-token&hub.challenge=' + challenge);
  assert.equal(verified.status, 200);
  assert.equal(await verified.text(), challenge);

  const denied = await request('/api/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=' + challenge);
  assert.equal(denied.status, 403);

  const payload = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      contacts: [{ wa_id: '919876543210', profile: { name: 'Test Customer' } }],
      messages: [{ id: 'wamid.test-message-001', from: '919876543210', type: 'text', text: { body: 'Booking enquiry' }, timestamp: '1795651200' }]
    } }] }]
  });
  const signature = 'sha256=' + crypto.createHmac('sha256', 'test-whatsapp-app-secret').update(Buffer.from(payload)).digest('hex');
  const send = () => request('/api/webhook', { method: 'POST', headers: { 'x-hub-signature-256': signature }, body: payload });
  assert.equal((await request('/api/webhook', { method: 'POST', body: payload })).status, 401);
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);

  const inbox = await request('/api/whatsapp/inbox', { headers: { 'x-admin-token': adminToken } });
  assert.equal(inbox.status, 200);
  const data = await inbox.json();
  assert.equal(data.requests.filter(item => item.whatsappMessageId === 'wamid.test-message-001').length, 1);
});

test('payment UTR is admin-authenticated and duplicate UTRs are rejected', async () => {
  const payload = {
    bookingId: '1234567890123',
    amount: 250,
    utr: 'TESTUTR123456',
    method: 'upi',
    phone: '9876543210'
  };
  const denied = await request('/api/payments/record-utr', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(denied.status, 401);

  const saved = await request('/api/payments/record-utr', {
    method: 'POST',
    headers: { 'x-admin-token': adminToken },
    body: JSON.stringify(payload)
  });
  assert.equal(saved.status, 201);
  const savedData = await saved.json();
  assert.equal(savedData.payment.status, 'pending-verification');

  const duplicate = await request('/api/payments/record-utr', {
    method: 'POST',
    headers: { 'x-admin-token': adminToken },
    body: JSON.stringify(payload)
  });
  assert.equal(duplicate.status, 409);

  const payment = savedData.payment;
  const verified = await request('/api/payments/' + payment.id + '/verify', {
    method: 'POST',
    headers: { 'x-admin-token': adminToken },
    body: JSON.stringify({ verified: true, note: 'Bank statement matched' })
  });
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).payment.status, 'verified');

  const replay = await request('/api/payments/' + payment.id + '/verify', {
    method: 'POST',
    headers: { 'x-admin-token': adminToken },
    body: JSON.stringify({ verified: false, note: 'Attempted status change' })
  });
  assert.equal(replay.status, 409);
  assert.match((await replay.json()).error, /already been reviewed/);

  const pending = await request('/api/payments/pending', {
    headers: { 'x-admin-token': adminToken }
  });
  assert.equal(pending.status, 200);
  assert.equal((await pending.json()).payments.some(item => item.id === payment.id), false);
});

test('concurrent UPI review requests allow exactly one terminal decision', async () => {
  const saved = await request('/api/payments/record-utr', {
    method: 'POST',
    headers: { 'x-admin-token': adminToken },
    body: JSON.stringify({
      bookingId: 'concurrent-payment-review',
      amount: 375,
      utr: 'RACEUTR123456',
      method: 'upi',
      phone: '9876543214'
    })
  });
  assert.equal(saved.status, 201);
  const payment = (await saved.json()).payment;
  const decisions = await Promise.all([
    request('/api/payments/' + payment.id + '/verify', {
      method: 'POST',
      headers: { 'x-admin-token': adminToken },
      body: JSON.stringify({ verified: true, note: 'Matched' })
    }),
    request('/api/payments/' + payment.id + '/verify', {
      method: 'POST',
      headers: { 'x-admin-token': adminToken },
      body: JSON.stringify({ verified: false, note: 'Rejected' })
    })
  ]);
  assert.deepEqual(decisions.map(response => response.status).sort(), [200, 409]);
  const final = await request('/api/payments/' + payment.id + '/verify', {
    method: 'POST',
    headers: { 'x-admin-token': adminToken },
    body: JSON.stringify({ verified: false })
  });
  assert.equal(final.status, 409);
});

test('customer booking rejects impossible calendar dates instead of accepting regex-shaped dates', async () => {
  const payload = {
    name: 'Invalid Date Test',
    mob: '+919876543211',
    address: 'Test Address',
    eventType: 'Wedding',
    guestCount: 50,
    date: '2026-02-30',
    returnDate: '2026-03-02',
    advanceAmount: 0,
    payMode: 'Cash',
    items: []
  };
  const response = await request('/api/customer/bookings', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /बुकिंग विवरण सही भरें/);
});




test('unlisted Origin does not turn a same-origin API request into a server error', async () => {
  const response = await request('/api/customer/bookings', {
    method: 'POST',
    headers: { Origin: baseUrl },
    body: JSON.stringify({ name: 'Origin Test', items: [] })
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('CORS preflight permits the admin CRUD methods used by the frontend', async () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(baseUrl + '/api/customer/bookings/123', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://erp.example.test',
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'content-type,x-admin-token'
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://erp.example.test');
    assert.match(response.headers.get('access-control-allow-methods') || '', new RegExp('\\b' + method + '\\b'));
  }
});


test('admin booking edits reject impossible calendar dates before attempting storage lookup', async () => {
  const edited = await request('/api/customer/bookings/123456789012', {
    method: 'PUT',
    headers: { 'x-admin-token': adminToken },
    body: JSON.stringify({ date: '2026-02-30' })
  });
  assert.equal(edited.status, 400);
  assert.match((await edited.json()).error, /वास्तविक कैलेंडर तारीख/);
});

test('frontend Content Security Policy permits only the required inline legacy UI and trusted Firebase/CDN origins', async () => {
  const response = await request('/');
  assert.equal(response.status, 200);
  const csp = response.headers.get('content-security-policy') || '';
  assert.match(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /script-src[^;]*https:\/\/cdnjs\.cloudflare\.com/);
  assert.match(csp, /script-src[^;]*https:\/\/www\.gstatic\.com/);
  assert.match(csp, /script-src-attr 'unsafe-inline'/);
  assert.match(csp, /connect-src[^;]*https:\/\/\*\.firebaseio\.com/);
  assert.match(csp, /connect-src[^;]*wss:\/\/\*\.firebaseio\.com/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
});


test('customer and admin royal theme assets are served from the production static root', async () => {
  const html = await request('/');
  assert.equal(html.status, 200);
  const markup = await html.text();
  assert.match(markup, /rk-reference-theme\.css\?v=5/);
  assert.match(markup, /applyRkDesign/);
  assert.match(markup, /rkDesignPreset/);

  const theme = await request('/rk-reference-theme.css?v=4');
  assert.equal(theme.status, 200);
  assert.match(theme.headers.get('content-type') || '', /text\/css/i);
  const css = await theme.text();
  assert.match(css, /#customerFirstPortal/);
  assert.match(css, /#adminPanel/);
  assert.match(css, /rk-theme-purple/);

  const hero = await request('/bartan-hero.svg');
  assert.equal(hero.status, 200);
  assert.match(hero.headers.get('content-type') || '', /image\/svg\+xml/i);
  assert.match(await hero.text(), /<svg[\s>]/i);
});
