const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const backend = fs.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'src', 'server.js'), 'utf8');

test('Vercel backend serves the synced frontend and PWA assets from its project root', () => {
  const path = require('node:path');
  const publicDir = path.join(__dirname, '..', 'backend', 'public');
  assert.ok(backend.includes("express.static(path.resolve(backendDir, '../public')"));
  assert.ok(backend.includes("app.get('/api/health', healthCheck)"));
  assert.ok(backend.includes("app.get('/api/ready', readinessCheck)"));
  assert.equal(fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8'), html);
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'), html);
  assert.ok(html.includes("window.location.origin"), 'backend API should default to the current deployment origin');
  assert.ok(html.includes('appassets.androidplatform.net'), 'Android WebView should retain the configured remote backend default');
  for (const asset of ['icon.svg', 'manifest.webmanifest', 'sw.js']) {
    assert.ok(fs.existsSync(path.join(publicDir, asset)), `missing backend public asset: ${asset}`);
  }
});

function sourceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return html.slice(start, end);
}

function storageBatchSource() {
  return sourceBetween('function safeSetStorageBatch(entries)', 'function showActionMessage(');
}

function mockStorageForBatch(store) {
  return {
    getItem: key => Object.prototype.hasOwnProperty.call(store, key) ? JSON.stringify(store[key]) : null,
    setItem: (key, value) => { store[key] = JSON.parse(value); },
    removeItem: key => { delete store[key]; }
  };
}

function runRentFunction(functionName, booking) {
  const start = html.indexOf(`function ${functionName}(`);
  const next = functionName === 'calculateBookingTotalRent'
    ? html.indexOf('        function loadAllFirebaseData()', start)
    : html.indexOf('        function searchBillingCustomer()', start);
  assert.notEqual(start, -1);
  assert.notEqual(next, -1);
  const helperStart = html.indexOf('function getDispatchEntryRentalSlices(b)');
  const helperEnd = html.indexOf('        function calculateBookingTotalRent(b)', helperStart);
  const sharedHelpers = helperStart >= 0 && helperEnd >= 0 ? html.slice(helperStart, helperEnd) : '';
  const code = html.slice(start, next);
  const context = { booking, calculateRentalDays: () => 2, getEffectiveMissingCharge: item => Math.max(0, Number(item?.missingCharge ?? item?.missingUnitPrice) || 0), Math, Number, Array, Date, result: null };
  vm.runInNewContext(`${sharedHelpers}\n${code}\nresult = ${functionName}(booking);`, context);
  return context.result;
}

test('missing quantity is recorded but excluded from customer rent total', () => {
  const total = runRentFunction('calculateBookingTotalRent', {
    date: '2026-11-01', returnDate: '2026-11-03',
    items: [{ name: 'Chair', qty: 2, rentPrice: 100, missingQty: 2, missingCharge: 9999 }]
  });
  assert.equal(total, 400);
});

test('booking total adds rent, other charges and discount but excludes missing items', () => {
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
    localStorage: mockStorageForBatch(store), syncToCloud: () => {}, console,
    showActionMessage: () => {}, loadAllFirebaseData: () => {}, renderMissingItems: () => {}
  };
  const code = sourceBetween('function completeManualReturnProcess()', '        window.onload = function()');
  vm.runInNewContext(`${storageBatchSource()}\n${code}\ncompleteManualReturnProcess();`, context);
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

test('return and missing recovery fail when the source stock row is absent', () => {
  const code = sourceBetween('function completeManualReturnProcess()', 'window.onload = function()');
  assert.ok(code.includes('if(!row){showActionMessage(\'Return stock record नहीं मिला: \'+item.name'));
  assert.ok(html.includes("if(!row){showActionMessage('संबंधित स्टॉक रिकॉर्ड नहीं मिला"));
  assert.ok(code.includes("safeSetStorageBatch([['softwareBookings',bookings],['realStockDatabase',stock],['thirdPartyDatabase',thirdParty],['missingItemsDatabase',missing]])"));
  assert.ok(html.includes("safeSetStorageBatch([['softwareBookings',bookings],['missingItemsDatabase',missing],[stockKey,stock]])"));
  assert.ok(html.includes('m.penalty=0;'));
  assert.ok(!html.includes('m.qty*Math.max(0,Number(it.missingCharge'));
});

test('dispatch decrements admin stock by the actual dispatched quantity', () => {
  const store = {
    softwareBookings: [{
      id: 42, status: 'Confirmed', date: '2026-11-01', returnDate: '2026-11-05', mob: '',
      items: [{ name: 'Chair', qty: 5, rentPrice: 100, source: 'admin' }],
      dispatchEntries: []
    }],
    realStockDatabase: [{ name: 'Chair', qty: 5, singleRent: 100 }],
    thirdPartyDatabase: []
  };
  const answers = ['2026-11-02', '', '3'];
  const context = {
    Math, Number, String, Array, Date, JSON,
    prompt: () => answers.shift(),
    safeGetStorage: key => store[key],
    safeSetStorage: (key, value) => { store[key] = value; return true; },
    localStorage: mockStorageForBatch(store), syncToCloud: () => {}, console,
    showActionMessage: () => {},
    loadAllFirebaseData: () => {},
    sendWhatsAppMessage: () => {},
    syncCustomerBookingWorkflow: () => {}
  };
  const code = sourceBetween('function completeDispatch(id)', 'function printDispatchSlip');
  vm.runInNewContext(storageBatchSource() + '\n' + code + '\ncompleteDispatch(42);', context);
  assert.equal(store.realStockDatabase[0].qty, 2);
  assert.equal(store.softwareBookings[0].dispatchEntries[0].qty, 3);
  assert.equal(store.softwareBookings[0].status, 'Dispatched');
});

test('return slip prints missing quantities only and never a missing charge', () => {
  const start = html.indexOf('function printReturnSlip()');
  const end = html.indexOf('function ', start + 20);
  const code = html.slice(start, end);
  assert.ok(code.includes('मिसिंग मात्रा'));
  assert.ok(code.includes('मिसिंग सामान की अलग सूची (केवल गिनती)'));
  assert.ok(!code.includes('मिसिंग चार्ज'));
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


test('login error toast stays above the blurred welcome overlay', () => {
  const toast = html.match(/#actionToast\s*\{[^}]*\}/s);
  assert.ok(toast);
  assert.match(toast[0], /z-index:\s*2147483001\s*!important/);
  assert.ok(html.includes('#welcomeOverlay{z-index:2147483000!important'));
});

test('ERP menu contains 19 modules including Business Card and documents', () => {
  const menuCount = [...html.matchAll(/<li class="menu-item(?: active)?"/g)].length;
  assert.equal(menuCount, 19);
  assert.ok(html.includes('id="business-card"'));
  assert.ok(html.includes('id="documents"'));
  assert.ok(html.includes("quotationDatabase: 'quotations'"));
  assert.ok(html.includes("taxInvoiceDatabase: 'taxInvoices'"));
  assert.ok(html.includes('function saveBusinessCard()'));
  assert.ok(html.includes('function saveBusinessDocument()'));
  assert.ok(html.includes('function changeBusinessDocumentType()'));
  assert.ok(html.includes("if(number)number.value=''"));
  assert.ok(html.includes('function printBusinessDocument()'));
  assert.ok(html.includes('Tax Invoice से पहले Business Card में सही 15-अक्षर GSTIN सेव करें'));
  assert.ok(html.includes("numberInput.value=number"));
});

test('tax invoice calculates intra-state CGST/SGST from the editable GST rate', () => {
  const code = sourceBetween('function businessDocumentTotals()', 'function renderBusinessDocumentItems()');
  const values = { docDiscount: '10', docOtherCharges: '5', docType: 'tax-invoice', docGstRate: '18', docTaxType: 'intra' };
  const context = {
    currentDocumentItems: [{ name: 'Chair', qty: 2, rate: 100 }],
    document: { getElementById: id => ({ value: values[id] }) },
    Math, Number, result: null
  };
  vm.runInNewContext(code + '\nresult=businessDocumentTotals();', context);
  const result = JSON.parse(JSON.stringify(context.result));
  assert.equal(result.subtotal, 200);
  assert.equal(result.taxable, 195);
  assert.equal(result.cgst, 17.55);
  assert.equal(result.sgst, 17.55);
  assert.equal(result.igst, 0);
  assert.equal(result.total, 230.1);
});

test('intra-state GST split preserves the exact rounded GST paise total', () => {
  const code = sourceBetween('function businessDocumentTotals()', 'function renderBusinessDocumentItems()');
  const values = { docDiscount: '0', docOtherCharges: '0', docType: 'tax-invoice', docGstRate: '5', docTaxType: 'intra' };
  const context = { currentDocumentItems: [{ name: 'Item', qty: 1, rate: 0.2 }], document: { getElementById: id => ({ value: values[id] }) }, Math, Number, result: null };
  vm.runInNewContext(code + '\nresult=businessDocumentTotals();', context);
  const result = JSON.parse(JSON.stringify(context.result));
  assert.equal(result.gst, 0.01);
  assert.equal(result.cgst + result.sgst, result.gst);
});

test('tax invoice supports per-item HSN and different GST rates with proportional discount', () => {
  const code = sourceBetween('function businessDocumentTotals()', 'function renderBusinessDocumentItems()');
  const values = { docDiscount: '20', docOtherCharges: '10', docType: 'tax-invoice', docGstRate: '12', docTaxType: 'intra' };
  const context = {
    currentDocumentItems: [
      { name: 'Chair', hsn: '9401', qty: 1, rate: 100, gstRate: 5 },
      { name: 'Light', hsn: '9405', qty: 1, rate: 100, gstRate: 18 }
    ],
    document: { getElementById: id => ({ value: values[id] }) },
    Math, Number, result: null
  };
  vm.runInNewContext(code + '\nresult=businessDocumentTotals();', context);
  const result = JSON.parse(JSON.stringify(context.result));
  assert.equal(result.subtotal, 200);
  assert.equal(result.taxable, 190);
  assert.equal(result.gst, 21.85);
  assert.equal(result.cgst + result.sgst, result.gst);
  assert.equal(result.total, 211.85);
  assert.ok(html.includes('HSN/SAC'));
  assert.ok(html.includes('item.gstRate??rate'));
});

test('tax invoice uses IGST for inter-state supply and quotation does not add GST', () => {
  const code = sourceBetween('function businessDocumentTotals()', 'function renderBusinessDocumentItems()');
  const values = { docDiscount: '0', docOtherCharges: '0', docType: 'tax-invoice', docGstRate: '18', docTaxType: 'inter' };
  const context = { currentDocumentItems: [{ name: 'Chair', qty: 1, rate: 100 }], document: { getElementById: id => ({ value: values[id] }) }, Math, Number, result: null };
  vm.runInNewContext(code + '\nresult=businessDocumentTotals();', context);
  let result = JSON.parse(JSON.stringify(context.result));
  assert.equal(result.igst, 18);
  assert.equal(result.cgst, 0);
  assert.equal(result.sgst, 0);
  values.docType = 'quotation';
  vm.runInNewContext(code + '\nresult=businessDocumentTotals();', context);
  result = JSON.parse(JSON.stringify(context.result));
  assert.equal(result.rate, 0);
  assert.equal(result.gst, 0);
  assert.equal(result.total, 100);
});

test('public customer stock catalog is loaded from backend rather than relying on admin localStorage', () => {
  assert.ok(html.includes("fetch(api+'/api/customer/stock'"));
  assert.ok(html.includes('publicCustomerStockCatalog'));
  assert.ok(html.includes('let publicCustomerStockCatalog = null;'));
  assert.ok(html.includes("localStorage.setItem('publicCustomerStockCache'"));
  const backend = fs.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'src', 'server.js'), 'utf8');
  const start = backend.indexOf("app.get('/api/customer/stock'");
  const end = backend.indexOf("app.get('/api/customer/bookings'", start);
  const route = backend.slice(start, end);
  assert.ok(route.includes("storeGet('tent_erp_data/stock')"));
  assert.ok(route.includes('singleRent'));
  assert.ok(route.includes('setRent'));
  assert.ok(!route.includes('costPrice'));
});

test('customer booking rent and quantity are validated against server stock, not client values', () => {
  const backend = fs.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'src', 'server.js'), 'utf8');
  assert.ok(backend.includes("storeGet('tent_erp_data/stock')"));
  assert.ok(backend.includes('qty+alreadyReserved>physicalAvailable'));
  assert.ok(backend.includes("return {...item,rentPrice,missingCharge:0,source:'admin',partyName:''}"));
  assert.ok(backend.includes("if(!adminDb)return res.status(503)"));
});


test('customer booking requires at least one selected stock item in both UI and API', () => {
  const backend = fs.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'src', 'server.js'), 'utf8');
  assert.ok(backend.includes("items: z.array("));
  assert.ok(backend.includes(")).min(1, 'कम-से-कम एक सामान चुनना आवश्यक है।').max(100)"));
  assert.ok(!backend.includes(")).max(100).default([])"));
  const code = sourceBetween('async function saveCustomerBooking(event)', 'function loadBookingsListTable()');
  assert.ok(code.includes('customerCart.length===0'));
  assert.ok(code.includes('कम-से-कम एक सामान चुनें'));
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

test('missing items are shown as quantity only and never added to the customer invoice', () => {
  assert.ok(html.includes('मिसिंग सामान की अलग सूची (केवल मात्रा)'));
  assert.ok(html.includes('मिसिंग सामान: केवल मात्रा की सूची (कोई शुल्क नहीं)'));
  assert.doesNotMatch(html, /मिसिंग सामान चार्ज:/);
  assert.doesNotMatch(html, /totalRent-\(Number\(b\.missingChargeTotal\)/);
  assert.doesNotMatch(html, /rentalTotal\+missingTotal/);
  assert.doesNotMatch(html, /rental\+missing\+/);
  assert.ok(html.includes('Customer status mirrors the invoice: missing items are quantity-only'));
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

test('payment ledger counts admin cash advances even when later payment entries exist', () => {
  const start = html.indexOf('function loadPaymentLedgerTable()');
  const end = html.indexOf('function ', start + 10);
  const code = html.slice(start, end);
  assert.ok(code.includes("b.source==='customer-portal'?b.advancePaymentVerified===true:(mode==='cash'||b.advancePaymentVerified===true)"));
  assert.ok(!code.includes('if(!ledger.some(p=>String(p.bookingId)===String(b.id))'));
});

test('vendor rent and missing replacement liability remain separate from customer charges', () => {
  assert.ok(html.includes('vendorRentRate'));
  assert.ok(html.includes('const vendorRentCost=vendorEntries.reduce'));
  assert.ok(html.includes('const vendorMissingLiability=bookings.reduce'));
  assert.ok(!html.includes('customerMissingRevenue'));
  assert.ok(html.includes('margin=customerRent-vendorCost'));
  assert.ok(html.includes('Missing सामान का ग्राहक से कोई शुल्क नहीं'));
  assert.ok(html.includes('Missing Vendor सामान की Replacement Liability'));
  assert.ok(html.includes('वास्तविक Dispatch × दिन'));
});

test('admin can add stock items to an itemless booking and append new items on repeat dispatch', () => {
  const code = sourceBetween('function completeDispatch(id)', 'function printDispatchSlip(id)');
  assert.ok(code.includes('ग्राहक ने सामान नहीं चुना'));
  assert.ok(code.includes('अतिरिक्त सामान जोड़ने'));
  assert.ok(code.includes('const catalog='));
  assert.ok(code.includes('b.items=items'));
  assert.ok(code.includes("source:'third-party'"));
});

test('booking edit validates ordinary Indian mobile numbers and ISO dates', () => {
  const code = sourceBetween('async function editBooking(id)', 'async function verifyCustomerAdvance');
  assert.ok(code.includes('/^\\+?[1-9]\\d{9,14}$/'));
  assert.ok(code.includes('/^\\d{4}-\\d{2}-\\d{2}$/'));
});

test('dispatch rent allocation stops returned quantities on each actual return date', () => {
  const start = html.indexOf('function getDispatchEntryRentalSlices(b)');
  const end = html.indexOf('        function calculateBookingTotalRent(b)', start);
  assert.ok(start >= 0 && end > start);
  const context = { Math, Number, Array, Date, result: null, booking: {
    date:'2026-11-01',returnDate:'2026-11-10',
    dispatchEntries:[{itemIndex:0,qty:3,date:'2026-11-01'},{itemIndex:0,qty:2,date:'2026-11-03'}],
    returnEntries:[{date:'2026-11-05',items:[{itemIndex:0,qty:4}]}]
  }};
  vm.runInNewContext(html.slice(start, end) + '\nresult=getDispatchEntryRentalSlices(booking);', context);
  assert.equal(context.result.reduce((sum,slice)=>sum+slice.qty,0),5);
  assert.equal(context.result.filter(slice=>slice.endDate==='2026-11-05').reduce((sum,slice)=>sum+slice.qty,0),4);
});

test('customer front page exposes booking only and keeps admin workspace separate', () => {
  const portal = html.slice(html.indexOf('<!-- Customer Portal -->'), html.indexOf('<!-- Admin Panel -->'));
  assert.ok(portal.includes('onsubmit="saveCustomerBooking(event)"'));
  assert.ok(portal.includes('id="portalCustName"'));
  assert.ok(portal.includes('id="portalEventDate"'));
  assert.ok(portal.includes('id="portalStockSelect"'));
  assert.ok(portal.includes('id="portalAdvanceAmount"'));
  assert.ok(!portal.includes('customerStatusQuery'));
  assert.ok(!portal.includes('checkCustomerBookingStatus'));
  assert.ok(!portal.includes('adminPanel'));
  assert.ok(portal.includes('class="rk-customer-brand"'));
  assert.ok(portal.includes('class="rk-customer-form"'));
  assert.ok(!portal.includes('onclick="openCustomerLogin(event)"'));
  const backend = fs.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'src', 'server.js'), 'utf8');
  assert.ok(backend.includes("app.get('/api/customer/bookings/:id/status'"));
  assert.ok(backend.includes("!==mobile"), 'private booking status endpoint remains mobile-verified');
});

test('customer item selection uses configured stock rent and safely renders item names', () => {
  assert.ok(html.includes('Number(stock.setRent)>0?Number(stock.setRent)'));
  assert.ok(html.includes('missingCharge:Math.max(0,Number(stock.missingCharge)||0)'));
  assert.ok(!html.includes('rentPrice: 500 });'));
  assert.ok(html.includes('escapeHtml(i.name)'));
  assert.ok(html.includes('Number(i.qty)||0'));
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

test('Firebase Realtime Database uses the approved radhe-krishna-online-booking project', () => {
  assert.match(html, /apiKey: "AIzaSyCH5pXri5I6Mo8ccCM9tsq2PupHIjxne_I"/);
  assert.match(html, /authDomain: "radhe-krishna-online-booking\.firebaseapp\.com"/);
  assert.match(html, /databaseURL: "https:\/\/radhe-krishna-online-booking-default-rtdb\.firebaseio\.com"/);
  assert.match(html, /projectId: "radhe-krishna-online-booking"/);
  assert.match(html, /appId: "1:1010400653483:web:fb2a78ec593b3c2888c7ee"/);
  assert.doesNotMatch(html, /if \(!firebaseConfig\.databaseURL\) \{ console\.warn/);
  assert.match(html, /if \(!firebaseConfig\.databaseURL \|\| !navigator\.onLine/);
});

test('root and public app copies are kept in sync', () => {
  const root = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  const pub = fs.readFileSync(require('node:path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.equal(root, pub);
});

test('customer booking portal submits to the persistent public backend endpoint', () => {
  const code = sourceBetween('async function saveCustomerBooking(event)', 'function loadBookingsListTable()');
  assert.match(code, /\/api\/customer\/bookings/);
  assert.match(code, /getBackendApiUrl\(otpSettings\)/);
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


test('closed barcode modal is excluded from unrelated invoice and slip print jobs', () => {
  assert.ok(html.includes('#barcodePrintModal, #barcodePrintModal * { visibility:hidden !important; }'));
  assert.ok(html.includes('#barcodePrintModal.barcode-print-active { position:absolute'));
  assert.ok(html.includes("modal.classList.add('barcode-print-active')"));
  assert.ok(html.includes("barcode.classList.remove('barcode-print-active')"));
});

test('barcode generation errors are shown instead of silently swallowed', () => {
  const code = sourceBetween('function printSingleBarcode(name, code)', 'function closeBarcodeModal()');
  assert.ok(code.includes("typeof JsBarcode!=='function'"));
  assert.ok(code.includes("showActionMessage('Barcode जनरेट नहीं हुआ: '"));
  assert.ok(code.includes("format:'CODE128'"));
});

test('existing stock rows receive unique persistent barcodes before table rendering', () => {
  const code = sourceBetween('function loadRealStockList()', 'function printSingleBarcode');
  assert.ok(code.includes('const usedBarcodes=new Set'));
  assert.ok(code.includes("item.barcode=code"));
  assert.ok(code.includes("safeSetStorage('realStockDatabase',stock)"));
});

test('CSV stock import rejects invalid quantities and rates instead of inventing defaults', () => {
  const code = sourceBetween('function importStockFromCSV(event)', 'function savePurchaseEntry(event)');
  assert.ok(code.includes('Number.isInteger(qty)'));
  assert.ok(code.includes('skipped++'));
  assert.ok(!code.includes('Number(cols[1]) || 10'));
  assert.ok(!code.includes('Number(cols[2]) || 500'));
});

test('purchase entry rolls back its purchase row when stock persistence fails', () => {
  const code = sourceBetween('function savePurchaseEntry(event)', 'function loadPurchaseTable()');
  assert.ok(code.includes("if(!safeSetStorage('purchaseDatabase',pur))return"));
  assert.ok(code.includes("if(!safeSetStorage('realStockDatabase',nextStock))"));
  assert.ok(code.includes("safeSetStorage('purchaseDatabase',previousPurchases)"));
});

test('daily expense form does not clear or claim success when local persistence fails', () => {
  const code = sourceBetween('function saveDailyExpense(event)', 'function renderDashboardLineGraph()');
  assert.ok(code.includes("if(!safeSetStorage('incomeExpenseDatabase', list))return"));
  assert.ok(code.includes('event.target.reset()'));
});


test('print CSS selects exactly one active print target', () => {
  assert.ok(html.includes('#printableSlipArea { display:none !important; }'));
  assert.ok(html.includes('#printableSlipArea.print-area-active {'));
  assert.ok(html.includes('#barcodePrintModal, #barcodePrintModal * { visibility:hidden !important; }'));
  assert.ok(html.includes('#barcodePrintModal.barcode-print-active, #barcodePrintModal.barcode-print-active * { visibility:visible !important; }'));
});

test('invoice, dispatch, return and business document mark their print area active', () => {
  assert.ok(html.includes("area.dataset.printRestore='invoice'"));
  assert.ok(html.includes("area.dataset.printRestore='dispatch'"));
  assert.ok(html.includes("area.dataset.printRestore='return'"));
  assert.ok(html.includes("area.dataset.printRestore='document'"));
  assert.ok(html.includes("area.classList.add('print-area-active')"));
});


test('payment receipt and verification alerts are sent only after payment state is saved', () => {
  const sender=sourceBetween('async function sendWhatsAppMessage(id, type)', 'function loadStockDropdowns');
  assert.ok(sender.includes("['payment','payment-verified','payment-rejected'].includes(type)"));
  assert.ok(sender.includes('UTR सत्यापन लंबित है'));
  const save=sourceBetween('async function savePaymentEntry()', 'async function verifyLedgerPayment');
  assert.ok(save.includes("if(!safeSetStorage(key,ledger))return"));
  assert.ok(save.includes("sendWhatsAppMessage(b.id,'payment')"));
  const verify=sourceBetween('async function verifyLedgerPayment', 'function printReturnSlip');
  assert.ok(verify.includes("verified?'payment-verified':'payment-rejected'"));
  assert.ok(verify.includes('alertBooking?.mob'));
});


test('date-only daily and purchase records use the device local calendar date, not UTC date', () => {
  assert.ok(!html.includes("new Date().toISOString().slice(0,10)"));
  assert.ok(html.includes("new Date().toLocaleDateString('en-CA')"));
  const expense=sourceBetween('function saveDailyExpense(event)', 'function renderDashboardLineGraph()');
  assert.ok(expense.includes("date: new Date().toLocaleDateString('en-CA')"));
});


test('OTP verification has a dedicated brute-force rate limit', () => {
  assert.match(backend, /const otpVerifyLimiter = rateLimit\(\{ windowMs: 15 \* 60_000, limit: 10/);
  assert.match(backend, /app\.post\('\/api\/otp\/verify', otpVerifyLimiter, requireDurableStore/);
});

test('AI chat and TTS endpoints have server-side cost-abuse rate limits', () => {
  assert.match(backend, /const aiLimiter = rateLimit\(\{ windowMs: 60_000, limit: 20/);
  assert.match(backend, /app\.post\('\/api\/ai\/chat', aiLimiter, authAdmin/);
  assert.match(backend, /app\.post\('\/api\/ai\/tts', aiLimiter, authAdmin/);
});

test('WhatsApp send endpoint has an explicit per-minute rate limit', () => {
  assert.match(backend, /const whatsappSendLimiter = rateLimit\(\{ windowMs: 60_000, limit: 20/);
  assert.match(backend, /app\.post\('\/api\/whatsapp\/send', whatsappSendLimiter, authAdmin/);
});


test('overlapping active bookings reserve stock while dispatched and returned bookings do not reserve twice', () => {
  const start = backend.indexOf('function getReservedAdminStockByItem(');
  const end = backend.indexOf('const customerBookingSchema', start);
  assert.ok(start >= 0 && end > start);
  const code = backend.slice(start, end);
  const context = { Map, Set, String, Number, Math };
  vm.runInNewContext(code + `
    result = getReservedAdminStockByItem([
      {id:1,status:'Confirmed',date:'2026-12-01',returnDate:'2026-12-03',items:[{name:'Chair',qty:20,source:'admin'}]},
      {id:2,status:'Pending Approval',date:'2026-12-03',returnDate:'2026-12-05',items:[{name:'Chair',qty:10,source:'admin'}]},
      {id:3,status:'Dispatched',date:'2026-12-02',returnDate:'2026-12-04',items:[{name:'Chair',qty:50,source:'admin'}]},
      {id:4,status:'Returned',date:'2026-12-01',returnDate:'2026-12-02',items:[{name:'Chair',qty:40,source:'admin'}]},
      {id:5,status:'Confirmed',date:'2026-12-01',returnDate:'2026-12-03',items:[{name:'Tent',qty:7,source:'third-party'}]}
    ],'2026-12-03','2026-12-04');
  `, context);
  assert.equal(context.result.get('chair'),30);
  assert.equal(context.result.has('tent'),false);
});

test('customer booking stock validation includes admin and portal reservations without colliding independent IDs', () => {
  assert.match(backend, /storeList\('erpData\/customerBookings'\)/);
  assert.match(backend, /storeList\('tent_erp_data\/bookings'\)/);
  assert.match(backend, /const allBookings = \[\.\.\.adminBookings, \.\.\.portalBookings\]/);
  assert.match(backend, /qty\+alreadyReserved>physicalAvailable/);
});


test('dispatch, return and missing recovery use rollback-capable multi-key persistence', () => {
  assert.match(html, /function safeSetStorageBatch\(entries\)/);
  assert.match(html, /safeSetStorageBatch\(\[\['softwareBookings',bookings\],\['realStockDatabase',stock\],\['thirdPartyDatabase',thirdParty\]\]\)/);
  assert.match(html, /safeSetStorageBatch\(\[\['softwareBookings',bookings\],\['realStockDatabase',stock\],\['thirdPartyDatabase',thirdParty\],\['missingItemsDatabase',missing\]\]\)/);
  assert.match(html, /safeSetStorageBatch\(\[\['softwareBookings',bookings\],\['missingItemsDatabase',missing\],\[stockKey,stock\]\]\)/);
  assert.match(html, /Storage rollback failed/);
});

test('premium dark glass enterprise UI system is present and all served frontend copies stay in sync', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = html;
  assert.ok(root.includes('id="rk-premium-enterprise-visual-system"'));
  assert.ok(root.includes('--rk-bg:#090d16'));
  assert.ok(root.includes('inset 5px 5px 12px'));
  assert.ok(root.includes('inset 0 1px 0 rgba(255,255,255,.48)'));
  assert.ok(root.includes("font-family:'Manrope','DM Sans',sans-serif"));
  assert.ok(root.includes('prefers-reduced-motion:reduce'));
  assert.ok(root.includes('@media print'));
  for (const file of ['public/index.html','backend/public/index.html']) {
    assert.equal(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), root, file + ' must match root frontend');
  }
});


test('premium design layer loads after legacy styles so the new theme wins the cascade', () => {
  const start = html.indexOf('<style id="rk-premium-enterprise-visual-system">');
  const end = html.indexOf('</style>', start);
  assert.ok(start > html.lastIndexOf('</style>', start - 1), 'premium layer is not duplicated');
  assert.equal(end, html.lastIndexOf('</style>'), 'premium layer must be the final stylesheet in the document');
  assert.ok(start > html.lastIndexOf('</script>', start), 'premium layer must load after legacy scripts and styles');
});

test('admin login is hidden behind a deliberate secret entry and server token verification', () => {
  assert.ok(html.includes('e.ctrlKey&&e.altKey&&e.shiftKey'));
  assert.ok(html.includes('setTimeout(show,3200)'));
  assert.ok(html.includes('setTimeout(show,3200)'));
  assert.ok(html.includes('/api/admin/session'));
  assert.ok(html.includes("'x-admin-token':token"));
  assert.ok(html.includes('window.__rkVerifiedAdminToken'));
  assert.ok(!html.includes("pass === '8120727987'"));
  assert.ok(!html.includes("pass === 'admin'"));
  assert.ok(!html.includes('onclick="loginWithGoogle()"'));
  assert.ok(html.includes('async function loginWithGoogle(adminToken)'));
});
test('backend admin session validation is rate-limited and never returns the configured secret', () => {
  assert.match(backend, /const adminLoginLimiter = rateLimit\(\{ windowMs: 15 \* 60_000, limit: 5/);
  assert.match(backend, /app\.get\('\/api\/admin\/session', adminLoginLimiter, authAdmin/);
  assert.match(backend, /json\(\{ ok: true, scope: 'admin' \}\)/);
});
test('enterprise table and developer footer styling is applied in the final premium layer', () => {
  assert.ok(html.includes('.table-responsive thead{position:sticky'));
  assert.ok(html.includes('.table-responsive tbody tr:nth-child(even) td'));
  assert.ok(html.includes('.table-responsive td.table-actions'));
  assert.ok(html.includes('.table-search-toolbar'));
  assert.ok(html.includes('.table-search-count'));
  assert.ok(html.includes('इस टेबल में खोजें'));
  assert.ok(html.includes("count.textContent=q?visible+' / '+rows.length+' दिख रहे':'कुल '+rows.length"));
  assert.ok(html.includes('.rk-developer-footer{position:relative'));
  assert.ok(html.includes('.rk-admin-gate-card'));
});

test('premium customer booking page uses a responsive two-column desktop layout and single-column mobile layout', () => {
  const start = html.indexOf('<style id="rk-premium-enterprise-visual-system">');
  const end = html.indexOf('</style>', start);
  const css = html.slice(start, end);
  assert.ok(css.includes('.rk-customer-form{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))'));
  assert.ok(css.includes('@media(max-width:760px){.customer-scroll-wrap'));
  assert.ok(css.includes('grid-template-columns:minmax(0,1fr)!important'));
  assert.ok(css.includes('.rk-customer-submit{grid-column:1/-1'));
  assert.ok(css.includes('.rk-customer-brand{'));
});
