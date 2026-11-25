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
  const context = { booking, calculateRentalDays: () => 2, getEffectiveMissingCharge: item => Math.max(0, Number(item?.missingCharge ?? item?.missingUnitPrice) || 0), Math, Number, Array, result: null };
  vm.runInNewContext(`${code}\nresult = ${functionName}(booking);`, context);
  return context.result;
}

test('missing quantity is charged once at the saved per-unit missing rate', () => {
  const total = runRentFunction('calculateBookingTotalRent', {
    date: '2026-11-01', returnDate: '2026-11-03',
    items: [{ name: 'Chair', qty: 2, rentPrice: 100, missingQty: 2, missingCharge: 9999 }]
  });
  assert.equal(total, 20398);
});

test('booking total adds missing charge, other charges and discount exactly once', () => {
  const total = runRentFunction('calculateBookingTotalRent', {
    date: '2026-11-01', returnDate: '2026-11-03',
    items: [{ name: 'Chair', qty: 2, rentPrice: 100, missingQty: 2, missingCharge: 9999 }],
    otherCharges: 50, discountAmount: 25
  });
  assert.equal(total, 20423);
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
  vm.runInNewContext(`${code}\ncompleteManualReturnProcess();`, context);
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


test('customer can submit a booking with no selected items', () => {
  const backend = fs.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'src', 'server.js'), 'utf8');
  assert.ok(backend.includes("items: z.array("));
  assert.ok(backend.includes(")).max(100).default([])"));
  const code = sourceBetween('async function saveCustomerBooking(event)', 'function loadBookingsListTable()');
  assert.ok(!code.includes('कम-से-कम एक सामान चुनें'));
  assert.ok(code.includes('items:customerCart.map'));
});

test('customer online advance requires UTR and QR uses configured UPI ID plus exact amount', () => {
  const code = sourceBetween('function updateDynamicPaymentQR()', 'function addItemToPendingBookingDispatch()');
  assert.ok(code.includes('settings.upiId'));
  assert.ok(code.includes('amount.toFixed(2)'));
  assert.ok(code.includes('portalQrHint'));
  assert.ok(!code.includes('8120727987@upi'));
  const booking = sourceBetween('async function saveCustomerBooking(event)', 'function loadBookingsListTable()');
  assert.ok(booking.includes('utrNumber.length<6'));
});

test('admin booking list displays UTR and payment verification controls', () => {
  assert.ok(html.includes('UTR नंबर'));
  assert.ok(html.includes('verifyCustomerAdvance'));
  assert.ok(html.includes('advancePaymentVerified'));
  assert.ok(html.includes('/advance'));
});

test('missing charge appears separately in invoice and total', () => {
  assert.ok(html.includes('मिसिंग सामान चार्ज'));
  assert.ok(html.includes('missingChargeTotal'));
  assert.ok(html.includes('getEffectiveMissingCharge(item)'));
});

test('admin edits for customer portal bookings are sent to backend', () => {
  assert.ok(html.includes("method:'PUT'"));
  assert.ok(html.includes('/api/customer/bookings/'));
});


test('customer advances are only counted after admin verification', () => {
  const code = sourceBetween('function getBookingPaidAmount(b)', 'function getEffectiveMissingCharge(item)');
  assert.ok(code.includes("b.source === 'customer-portal'"));
  assert.ok(code.includes("b.advancePaymentVerified === true"));
});

test('vendor payable rent uses vendor cost rate and actual dispatch rental days', () => {
  assert.ok(html.includes('vendorRentRate'));
  assert.ok(html.includes('const vendorCost=vendorEntries.reduce'));
  assert.ok(html.includes('const customerRent=vendorEntries.reduce'));
  assert.ok(html.includes('वास्तविक Dispatch × दिन'));
});

test('customer status lookup is private and checks booking ID plus registered mobile', () => {
  const backend = fs.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'src', 'server.js'), 'utf8');
  assert.ok(backend.includes("app.get('/api/customer/bookings/:id/status'"));
  assert.ok(backend.includes("!==mobile"));
  assert.ok(html.includes('id="customerStatusMobile"'));
  assert.ok(html.includes('/status?mobile='));
});

test('customer item selection uses configured stock rent, not a hardcoded rate', () => {
  assert.ok(html.includes('Number(stock.setRent)>0?Number(stock.setRent)'));
  assert.ok(html.includes('missingCharge:Math.max(0,Number(stock.missingCharge)||0)'));
  assert.ok(!html.includes('rentPrice: 500 });'));
});

test('dispatch slip identifies admin versus vendor stock and print is professional', () => {
  assert.ok(html.includes('स्रोत / वेंडर'));
  assert.ok(html.includes('@page { size: A4; margin: 10mm; }'));
  assert.ok(html.includes('display:table-header-group'));
});

test('admin status transitions wait for backend and cancelled bookings are not re-imported', () => {
  assert.ok(html.includes("if(remote.status==='Cancelled')"));
  assert.ok(html.includes("!await updateRemoteCustomerBookingStatus(id,'Confirmed')"));
  assert.ok(html.includes("!await updateRemoteCustomerBookingStatus(id,'Rejected')"));
});

test('all inline frontend JavaScript blocks parse without syntax errors', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]))
    .map(match => match[2])
    .filter(source => source.trim());
  assert.ok(scripts.length > 0);
  scripts.forEach((source,index) => {
    try { new Function(source); }
    catch (error) { throw new Error('Inline script ' + (index + 1) + ': ' + error.message); }
  });
});

test('root and public app copies are kept in sync', () => {
  const root = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  const pub = fs.readFileSync(require('node:path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.equal(root, pub);
});

test('customer booking portal submits to the persistent public backend endpoint', () => {
  const code = sourceBetween('async function saveCustomerBooking(event)', 'function loadBookingsListTable()');
  assert.match(code, /\/api\/customer\/bookings/);
  assert.match(code, /DEFAULT_BACKEND_API_URL/);
  assert.match(html, /async function syncCustomerBookingsFromBackend/);
  assert.match(html, /updateRemoteCustomerBookingStatus\(id,'Confirmed'\)/);
});

test('OCR uses a real OCR engine and does not fill fake stock values', () => {
  assert.match(html, /Tesseract\.recognize\(file,'eng\+hin'/);
  assert.doesNotMatch(html, /Scanned Tent Item/);
  assert.match(html, /stockOcrTextPreview/);
});

test('camera barcode scanning is wired to both dispatch and return fields', () => {
  assert.match(html, /startBarcodeCameraScan\('dispatchSearchId'\)/);
  assert.match(html, /startBarcodeCameraScan\('returnBarcodeInput'\)/);
  assert.match(html, /BarcodeDetector\.getSupportedFormats/);
});
