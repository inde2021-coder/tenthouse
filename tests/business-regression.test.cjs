const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return html.slice(start, end);
}

function runRentFunction(functionName, booking) {
  const start = html.indexOf(`function ${functionName}(`);
  const next = functionName === 'calculateBookingTotalRent'
    ? html.indexOf('        function loadAllFirebaseData()', start)
    : html.indexOf('        function searchBillingCustomer()', start);
  assert.notEqual(start, -1);
  assert.notEqual(next, -1);
  const code = html.slice(start, next);
  const context = { calculateRentalDays: () => 2, Math, Number, Array, result: null };
  vm.runInNewContext(`${code}\\nresult = ${functionName}(booking);`, context);
  return context.result;
}

test('missing quantities and missing rates never increase booking total', () => {
  const total = runRentFunction('calculateBookingTotalRent', {
    date: '2026-11-01', returnDate: '2026-11-03',
    items: [{ name: 'Chair', qty: 2, rentPrice: 100, missingQty: 2, missingCharge: 9999 }]
  });
  assert.equal(total, 400);
});

test('booking total applies other charges and discount, not missing charges', () => {
  const total = runRentFunction('calculateBookingTotalRent', {
    date: '2026-11-01', returnDate: '2026-11-03',
    items: [{ name: 'Chair', qty: 2, rentPrice: 100, missingQty: 2, missingCharge: 9999 }],
    otherCharges: 50, discountAmount: 25
  });
  assert.equal(total, 425);
});

test('rent uses actual dispatch quantities and their saved unit rate', () => {
  const total = runRentFunction('calculateBookingTotalRent', {
    date: '2026-11-01', returnDate: '2026-11-03',
    items: [{ name: 'Chair', qty: 10, rentPrice: 100 }],
    dispatchEntries: [{ itemIndex: 0, itemName: 'Chair', qty: 3, unitRent: 120, date: '2026-11-01' }]
  });
  assert.equal(total, 720);
});

test('base rent excludes missing-item fees', () => {
  const total = runRentFunction('calculateBookingBaseRent', {
    date: '2026-11-01', returnDate: '2026-11-03',
    items: [{ name: 'Chair', qty: 2, rentPrice: 100, missingQty: 4, missingCharge: 5000 }]
  });
  assert.equal(total, 400);
});

function runReturn(mode) {
  const bookings = [{ id: 42, status: 'Dispatched', date: '2026-11-01', returnDate: '2026-11-05',
    lastDispatchDate: '2026-11-01', items: [{ name: 'Chair', qty: 5, returnedQty: 0, source: 'admin' }],
    dispatchEntries: [{ itemIndex: 0, itemName: 'Chair', qty: 5, date: '2026-11-01', unitRent: 100 }] }];
  const store = {
    softwareBookings: bookings,
    missingItemsDatabase: [],
    realStockDatabase: [{ name: 'Chair', qty: 0 }],
    thirdPartyDatabase: []
  };
  const input = { dataset: { returnIndex: '0' }, value: '2' };
  const section = { style: { display: 'block' } };
  const document = {
    querySelectorAll: () => [input],
    getElementById: id => id === 'returnManualCountingSection' ? section : null
  };
  const answers = ['2026-11-03', mode];
  const context = {
    activeReturnBookingId: 42, Math, Number, String, Array, Date,
    prompt: () => answers.shift(),
    document,
    safeGetStorage: key => store[key],
    safeSetStorage: (key, value) => { store[key] = value; return true; },
    showActionMessage: () => {}, loadAllFirebaseData: () => {}, renderMissingItems: () => {}
  };
  const code = sourceBetween('function completeManualReturnProcess()', '        window.onload = function()');
  vm.runInNewContext(`${code}\\ncompleteManualReturnProcess();`, context);
  return { booking: store.softwareBookings[0], missing: store.missingItemsDatabase, stock: store.realStockDatabase[0] };
}

test('partial return keeps unreturned items pending, not missing', () => {
  const result = runReturn('PARTIAL');
  assert.equal(result.booking.status, 'Partially Returned');
  assert.equal(result.booking.items[0].returnedQty, 2);
  assert.equal(result.booking.items[0].missingQty || 0, 0);
  assert.equal(result.missing.length, 0);
  assert.equal(result.stock.qty, 2);
});

test('final return records only the unreturned balance as missing quantity', () => {
  const result = runReturn('FINAL');
  assert.equal(result.booking.status, 'Returned');
  assert.equal(result.booking.items[0].returnedQty, 2);
  assert.equal(result.booking.items[0].missingQty, 3);
  assert.equal(result.missing[0].qty, 3);
  assert.equal(result.missing[0].penalty, 0);
  assert.equal(result.stock.qty, 2);
});

test('dispatch slip uses actual dispatch entries, not full booking quantities', () => {
  const code = sourceBetween('function printDispatchSlip(id) {', 'function sendWhatsAppMessage');
  assert.match(code, /b\.dispatchEntries/);
  assert.match(code, /वास्तविक भेजी मात्रा/);
});

test('WhatsApp send calls backend endpoint and does not claim success before response', () => {
  const code = sourceBetween('async function sendWhatsAppMessage', 'function loadStockDropdowns');
  assert.match(code, /\/api\/whatsapp\/send/);
  assert.match(code, /if\(!response\.ok\)throw/);
});

test('root and public app copies are kept in sync', () => {
  const root = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  const pub = fs.readFileSync(require('node:path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.equal(root, pub);
});
