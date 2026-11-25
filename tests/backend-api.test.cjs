const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
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
      PORT: String(port),
      ADMIN_API_TOKEN: adminToken,
      OTP_HMAC_SECRET: otpSecret,
      OTP_PROVIDER: 'demo',
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-webhook-verify-token',
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
  assert.equal((await saved.json()).payment.status, 'pending-verification');

  const duplicate = await request('/api/payments/record-utr', {
    method: 'POST',
    headers: { 'x-admin-token': adminToken },
    body: JSON.stringify(payload)
  });
  assert.equal(duplicate.status, 409);
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

test('preview customer booking search returns safe slips and bill data only after identity verification', async () => {
  const port = await reservePort();
  const previewUrl = 'http://127.0.0.1:' + port;
  const previewServer = spawn(process.execPath, [path.join(__dirname, '..', 'backend', 'src', 'server.js')], {
    env: { ...process.env, NODE_ENV: 'development', PREVIEW_MODE: 'true', PORT: String(port), ADMIN_API_TOKEN: '', OTP_HMAC_SECRET: '' },
    stdio: 'ignore'
  });
  const call = (route, options = {}) => fetch(previewUrl + route, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { const response = await fetch(previewUrl + '/health'); if (response.ok) { ready = true; break; } } catch (_) {}
      if (previewServer.exitCode !== null) throw new Error('Preview test server exited unexpectedly.');
      await delay(50);
    }
    assert.equal(ready, true);
    const createdResponse = await call('/api/customer/bookings', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Demo Customer', mob: '9876543210', address: 'Private Demo Address',
        eventType: 'Wedding', guestCount: 120, date: '2027-01-01', returnDate: '2027-01-03',
        advanceAmount: 100, payMode: 'Cash',
        items: [{ name: 'Plastic Chair', qty: 2, rentPrice: 999, source: 'admin' }]
      })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    const id = String(created.booking.id);

    const byPhone = await call('/api/customer/bookings/search', {
      method: 'POST', body: JSON.stringify({ lookup: '9876543210' })
    });
    assert.equal(byPhone.status, 200);
    const phoneResult = await byPhone.json();
    assert.equal(phoneResult.bookings.length, 1);
    assert.equal(phoneResult.bookings[0].name, 'Demo Customer');
    assert.equal(phoneResult.bookings[0].maskedMobile, '******3210');
    assert.equal(phoneResult.bookings[0].totalAmount, 40);
    assert.equal(Object.hasOwn(phoneResult.bookings[0], 'address'), false);
    assert.equal(Object.hasOwn(phoneResult.bookings[0], 'utrNumber'), false);

    const nameWithoutMobile = await call('/api/customer/bookings/search', {
      method: 'POST', body: JSON.stringify({ lookup: 'Demo Customer' })
    });
    assert.equal(nameWithoutMobile.status, 400);
    const byName = await call('/api/customer/bookings/search', {
      method: 'POST', body: JSON.stringify({ lookup: 'Demo Customer', mobile: '9876543210' })
    });
    assert.equal((await byName.json()).bookings.length, 1);
    const wrongMobile = await call('/api/customer/bookings/search', {
      method: 'POST', body: JSON.stringify({ lookup: id, mobile: '9876543211' })
    });
    assert.equal((await wrongMobile.json()).bookings.length, 0);
    const byBooking = await call('/api/customer/bookings/search', {
      method: 'POST', body: JSON.stringify({ lookup: id, mobile: '9876543210' })
    });
    assert.equal((await byBooking.json()).bookings[0].id, id);
  } finally {
    if (previewServer.exitCode === null) {
      previewServer.kill('SIGTERM');
      await Promise.race([new Promise(resolve => previewServer.once('exit', resolve)), delay(2000)]);
      if (previewServer.exitCode === null) previewServer.kill('SIGKILL');
    }
  }
});
