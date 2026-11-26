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

async function runReturn(mode) {
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
    activeReturnBookingId: 42, Math, Number, String, Array, Date, isValidCalendarDate: value => { const parts=String(value||'').split('-').map(Number); if(parts.length!==3||String(value||'').length!==10)return false; const [y,mo,d]=parts,dt=new Date(y,mo-1,d); return dt.getFullYear()===y&&dt.getMonth()===mo-1&&dt.getDate()===d; },
    prompt: () => answers.shift(),
    document,
    safeGetStorage: key => store[key],
    safeSetStorage: (key, value) => { store[key] = value; return true; },
    localStorage: mockStorageForBatch(store), syncToCloud: () => {}, console,
    showActionMessage: () => {}, loadAllFirebaseData: () => {}, renderMissingItems: () => {}
  };
  const code = sourceBetween('async function completeManualReturnProcess()', '        window.onload = function()');
  vm.runInNewContext(`${storageBatchSource()}\n${code}\nresult = completeManualReturnProcess();`, context);
  await context.result;
  return { booking: store.softwareBookings[0], missing: store.missingItemsDatabase, stock: store.realStockDatabase[0] };
}

test('partial return keeps unreturned items pending, not missing', async () => {
  const result = await runReturn('PARTIAL');
  assert.equal(result.booking.status, 'Partially Returned');
  assert.equal(result.booking.items[0].returnedQty, 2);
  assert.equal(result.booking.items[0].missingQty || 0, 0);
  assert.equal(result.missing.length, 0);
  assert.equal(result.stock.qty, 2);
});

test('final return records only the unreturned balance as missing quantity', async () => {
  const result = await runReturn('FINAL');
  assert.equal(result.booking.status, 'Returned');
  assert.equal(result.booking.items[0].returnedQty, 2);
  assert.equal(result.booking.items[0].missingQty, 3);
  assert.equal(result.missing[0].qty, 3);
  assert.equal(result.missing[0].penalty, 0);
  assert.equal(result.stock.qty, 2);
});

test('return and missing recovery fail when the source stock row is absent', () => {
  const code = sourceBetween('async function completeManualReturnProcess()', 'window.onload = function()');
  assert.ok(code.includes('if(!row){showActionMessage(\'Return stock record नहीं मिला: \'+item.name'));
  assert.ok(html.includes("if(!row){showActionMessage('संबंधित स्टॉक रिकॉर्ड नहीं मिला"));
  assert.ok(code.includes("safeSetStorageBatch([['softwareBookings',bookings],['realStockDatabase',stock],['thirdPartyDatabase',thirdParty],['missingItemsDatabase',missing]])"));
  assert.ok(html.includes("safeSetStorageBatch([['softwareBookings',bookings],['missingItemsDatabase',missing],[stockKey,stock]])"));
  assert.ok(html.includes('m.penalty=0;'));
  assert.ok(!html.includes('m.qty*Math.max(0,Number(it.missingCharge'));
});

test('dispatch decrements admin stock by the actual dispatched quantity', async () => {
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
    isValidCalendarDate: value => { const parts=String(value||'').split('-').map(Number); if(parts.length!==3||String(value||'').length!==10)return false; const [y,mo,d]=parts,dt=new Date(y,mo-1,d); return dt.getFullYear()===y&&dt.getMonth()===mo-1&&dt.getDate()===d; },
    prompt: () => answers.shift(),
    safeGetStorage: key => store[key],
    safeSetStorage: (key, value) => { store[key] = value; return true; },
    localStorage: mockStorageForBatch(store), syncToCloud: () => {}, console,
    showActionMessage: () => {},
    loadAllFirebaseData: () => {},
    sendWhatsAppMessage: () => {},
    syncCustomerBookingWorkflow: () => {}
  };
  const code = sourceBetween('async function completeDispatch(id)', 'function printDispatchSlip');
  vm.runInNewContext(storageBatchSource() + '\n' + code + '\nresult = completeDispatch(42);', context);
  await context.result;
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

test('AI provider receives aggregate business counts, never raw customer or payment records', () => {
  const start = html.indexOf('const aiBusinessSummary = {');
  const end = html.indexOf('const snapshotText = JSON.stringify(aiBusinessSummary);', start);
  assert.ok(start >= 0 && end > start, 'privacy-safe summary must be built before sending the AI request');
  const summary = html.slice(start, end);
  for (const store of ["softwareBookings", "realStockDatabase", "incomeExpenseDatabase", "thirdPartyDatabase", "thirdPartyPayments"]) {
    assert.ok(summary.includes("countRecords(safeGetStorage('" + store + "', []))"), 'aggregate count missing for ' + store);
  }
  assert.ok(!summary.includes('bookings: safeGetStorage'));
  assert.ok(!summary.includes('JSON.stringify(aiBusinessSnapshot)'));
  assert.ok(summary.includes('vendorPaymentRecordCount'));
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


test('premium design loads after legacy styles and final admin controls override it safely', () => {
  const start = html.indexOf('<style id="rk-premium-enterprise-visual-system">');
  const end = html.indexOf('</style>', start);
  const adminStart = html.indexOf('<style id="rk-admin-dark-controls-final">');
  const adminEnd = html.indexOf('</style>', adminStart);
  assert.ok(start > html.lastIndexOf('</style>', start - 1), 'premium layer is not duplicated');
  assert.ok(adminStart > end, 'final admin controls must load after the premium design layer');
  assert.equal(adminEnd, html.lastIndexOf('</style>'), 'admin control override must be the final stylesheet');
  assert.ok(start > html.lastIndexOf('</script>', start), 'premium layer must load after legacy scripts and styles');
});

test('admin login is hidden behind supported desktop and mobile secret-entry gestures and server token verification', () => {
  assert.ok(html.includes('e.ctrlKey&&e.shiftKey'));
  assert.ok(html.includes('e.ctrlKey&&e.altKey&&e.shiftKey'));
  assert.ok(html.includes('setTimeout(show,1200)'));
  assert.ok(html.includes('clickCount>=3'));
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

test('dispatch, return and missing recovery await customer backend workflow sync and roll back local changes on failure', () => {
  assert.match(html, /async function completeDispatch\(id\)/);
  assert.match(html, /const remoteSaved=await syncCustomerBookingWorkflow\(b,false\)/);
  assert.match(html, /async function completeManualReturnProcess\(\)/);
  assert.match(html, /async function recoverMissingItem\(recordId,rowIndex\)/);
  assert.match(html, /previousState\.bookings/);
  assert.match(html, /previousState\.missing/);
  assert.match(html, /previousState\.adminStock/);
  assert.match(html, /previousState\.vendorStock/);
  assert.ok(html.includes('if (previous === null) localStorage.removeItem(key)'));
  assert.match(html, /syncToCloud\(key, previous === null \? null : JSON\.parse\(previous\)\)/);
});

test('dispatch and return reject impossible calendar dates before changing stock', () => {
  assert.match(html, /function isValidCalendarDate\(value\)/);
  const dispatch = sourceBetween('async function completeDispatch(id)', 'function printDispatchSlip(id)');
  assert.ok(dispatch.includes('!isValidCalendarDate(dispatchDate)'));
  const ret = sourceBetween('async function completeManualReturnProcess()', 'let currentDocumentItems');
  assert.ok(ret.includes('!isValidCalendarDate(returnDate)'));
  assert.ok(ret.includes('const firstDispatchDate='), 'return date should compare with the first relevant dispatch, not the latest batch');
  assert.ok(ret.includes('returnDate<firstDispatchDate'));
});

test('calendar date validation rejects impossible dates and accepts leap days', () => {
  const start=html.indexOf('function isValidCalendarDate(value)');
  const end=html.indexOf('function calculateRentalDays',start);
  assert.ok(start>=0&&end>start);
  const context={Date,String,Number,result:null};
  vm.runInNewContext(html.slice(start,end)+`\nresult=['2026-02-28','2026-02-30','2024-02-29','2025-02-29','2026-13-01'].map(isValidCalendarDate);`,context);
  assert.deepEqual(Array.from(context.result),[true,false,true,false,false]);
});

test('backend rejects dispatch and return workflow quantities that cannot reconcile to the booking', () => {
  const start=backend.indexOf('function isValidIsoDate(');
  const isoEnd=backend.indexOf('function getReservedAdminStockByItem(',start);
  const helperStart=backend.indexOf('function validateBookingWorkflowConsistency(');
  const helperEnd=backend.indexOf("app.put('/api/customer/bookings/:id/workflow'",helperStart);
  assert.ok(start>=0&&isoEnd>start&&helperStart>isoEnd&&helperEnd>helperStart);
  const context={Date,Number,String,Array,Math};
  vm.runInNewContext(backend.slice(start,isoEnd)+'\n'+backend.slice(helperStart,helperEnd)+`
    result = {
      valid: validateBookingWorkflowConsistency(
        {date:'2027-01-01',returnDate:'2027-01-03',items:[{name:'Chair',qty:5,source:'admin'}]},
        {status:'Partially Returned',lastDispatchDate:'2027-01-01',items:[{name:'Chair',qty:5,source:'admin',returnedQty:2,missingQty:0}],dispatchEntries:[{itemIndex:0,itemName:'Chair',qty:5,date:'2027-01-01',source:'admin'}],returnEntries:[{date:'2027-01-02',mode:'PARTIAL',items:[{itemIndex:0,qty:2}]}]}
      ),
      excessDispatch: validateBookingWorkflowConsistency(
        {date:'2027-01-01',returnDate:'2027-01-03',items:[{name:'Chair',qty:5,source:'admin'}]},
        {items:[{name:'Chair',qty:5,source:'admin'}],dispatchEntries:[{itemIndex:0,itemName:'Chair',qty:6,date:'2027-01-01',source:'admin'}]}
      ),
      excessReturn: validateBookingWorkflowConsistency(
        {date:'2027-01-01',returnDate:'2027-01-03',items:[{name:'Chair',qty:5,source:'admin'}]},
        {lastDispatchDate:'2027-01-01',items:[{name:'Chair',qty:5,source:'admin',returnedQty:6}],dispatchEntries:[{itemIndex:0,itemName:'Chair',qty:5,date:'2027-01-01',source:'admin'}],returnEntries:[{date:'2027-01-02',mode:'FINAL',items:[{itemIndex:0,qty:6}]}]}
      ),
      incompleteFinal: validateBookingWorkflowConsistency(
        {date:'2027-01-01',returnDate:'2027-01-03',items:[{name:'Chair',qty:5,source:'admin'}]},
        {status:'Returned',fullyReturnedAt:'2027-01-03T10:00:00.000Z',lastDispatchDate:'2027-01-01',items:[{name:'Chair',qty:5,source:'admin',returnedQty:2,missingQty:1}],dispatchEntries:[{itemIndex:0,itemName:'Chair',qty:5,date:'2027-01-01',source:'admin'}],returnEntries:[{date:'2027-01-02',mode:'FINAL',items:[{itemIndex:0,qty:2}]}]}
      ),
      recoveredMissing: validateBookingWorkflowConsistency(
        {date:'2027-01-01',returnDate:'2027-01-03',items:[{name:'Chair',qty:5,source:'admin'}]},
        {status:'Returned',fullyReturnedAt:'2027-01-03T10:00:00.000Z',lastDispatchDate:'2027-01-01',items:[{name:'Chair',qty:5,source:'admin',returnedQty:3,missingQty:2}],dispatchEntries:[{itemIndex:0,itemName:'Chair',qty:5,date:'2027-01-01',source:'admin'}],returnEntries:[{date:'2027-01-02',mode:'FINAL',items:[{itemIndex:0,qty:2}]}]}
      ),
      historicalReturnThenNewDispatch: validateBookingWorkflowConsistency(
        {date:'2027-01-01',returnDate:'2027-01-06',items:[{name:'Chair',qty:5,source:'admin'}]},
        {status:'Partially Returned',lastDispatchDate:'2027-01-04',items:[{name:'Chair',qty:5,source:'admin',returnedQty:1,missingQty:0}],dispatchEntries:[{itemIndex:0,itemName:'Chair',qty:2,date:'2027-01-01',source:'admin'},{itemIndex:0,itemName:'Chair',qty:3,date:'2027-01-04',source:'admin'}],returnEntries:[{date:'2027-01-02',mode:'PARTIAL',items:[{itemIndex:0,qty:1}]}]}
      ),
      returnCannotUseFutureDispatch: validateBookingWorkflowConsistency(
        {date:'2027-01-01',returnDate:'2027-01-06',items:[{name:'Chair',qty:5,source:'admin'}]},
        {status:'Partially Returned',lastDispatchDate:'2027-01-04',items:[{name:'Chair',qty:5,source:'admin',returnedQty:4,missingQty:0}],dispatchEntries:[{itemIndex:0,itemName:'Chair',qty:2,date:'2027-01-01',source:'admin'},{itemIndex:0,itemName:'Chair',qty:3,date:'2027-01-04',source:'admin'}],returnEntries:[{date:'2027-01-02',mode:'PARTIAL',items:[{itemIndex:0,qty:4}]}]}
      )
    };
  `,context);
  assert.equal(context.result.valid,null);
  assert.match(context.result.excessDispatch,/Dispatch मात्रा/);
  assert.match(context.result.excessReturn,/Dispatch मात्रा/);
  assert.match(context.result.incompleteFinal,/Final Return/);
  assert.equal(context.result.recoveredMissing,null);
  assert.equal(context.result.historicalReturnThenNewDispatch,null);
  assert.match(context.result.returnCannotUseFutureDispatch,/उस तारीख तक Dispatch हुई मात्रा/);
});

test('customer workflow failures are queued and retried after reconnect or admin login', () => {
  assert.ok(html.includes('function savePendingCustomerWorkflow(booking,remove=false)'));
  assert.ok(html.includes("localStorage.setItem('rkPendingCustomerWorkflowSync',JSON.stringify(queue))"));
  assert.ok(html.includes('async function flushPendingCustomerWorkflowSync()'));
  assert.ok(html.includes("window.addEventListener('online', () => { flushPendingCloudSync(); flushPendingCustomerWorkflowSync(); })"));
  assert.ok(html.includes('await flushPendingCustomerWorkflowSync();await syncCustomerBookingsFromBackend();'));
  const dispatch=sourceBetween('async function completeDispatch(id)','function printDispatchSlip(id)');
  const ret=sourceBetween('async function completeManualReturnProcess()','let currentDocumentItems');
  const recover=sourceBetween('async function recoverMissingItem(recordId,rowIndex)','let currentDocumentItems');
  assert.ok(dispatch.includes('syncCustomerBookingWorkflow(b,false)'));
  assert.ok(ret.includes('syncCustomerBookingWorkflow(b,false)'));
  assert.ok(recover.includes('syncCustomerBookingWorkflow(b,false)'));
});
test('customer payment and installment changes await backend sync and retain retry state', () => {
  assert.ok(html.includes("if(b.source==='customer-portal'){const remoteSaved=await syncCustomerBookingWorkflow(b,true)"));
  assert.ok(html.includes('async function savePaymentEntry()'));
  assert.ok(html.includes('async function verifyLedgerPayment(recordId,verified)'));
  assert.ok(html.includes('async function saveInstallment(id)'));
  assert.ok(html.includes('async function applyInvoiceAdjustments(quiet=false)'));
});

test('customer booking stock reservation lock serializes concurrent requests and releases safely', async () => {
  const start=backend.indexOf('async function acquireBookingReservationLock(');
  const end=backend.indexOf("app.post('/api/customer/bookings'",start);
  assert.ok(start>=0&&end>start);
  let current=null,sequence=0;
  const fakeDb={ref:path=>({transaction:async updater=>{assert.equal(path,'erpPrivate/bookingReservationLock');const next=updater(current);if(next===undefined)return {committed:false};current=next;return {committed:true};}})};
  const context={Date,fakeDb,crypto:{randomUUID:()=>String(++sequence)}};
  vm.runInNewContext(backend.slice(start,end)+`
    (async()=>{
      const releaseOne=await acquireBookingReservationLock(fakeDb);
      const second=await acquireBookingReservationLock(fakeDb);
      await releaseOne();
      const third=await acquireBookingReservationLock(fakeDb);
      result={first:typeof releaseOne,second,third:typeof third};
      await third();
    })();
  `,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(context.result.first,'function');
  assert.equal(context.result.second,null);
  assert.equal(context.result.third,'function');
  assert.equal(current,null);
});


test('customer front page remains a booking-only portal with no admin controls exposed inside it', () => {
  const portal = sourceBetween('<!-- Customer Portal -->', '<!-- Admin Panel -->');
  assert.ok(portal.includes('onsubmit="saveCustomerBooking(event)"'));
  assert.ok(portal.includes('id="portalStockSelect"'));
  assert.ok(portal.includes('id="portalCustName"'));
  assert.ok(portal.includes('id="portalEventDate"'));
  assert.ok(portal.includes('id="portalReturnDate"'));
  assert.ok(portal.includes('id="portalAdvanceAmount"'));
  assert.ok(!portal.includes('switchTab('), 'customer portal must not expose admin module navigation');
  assert.ok(!portal.includes('adminPanel'), 'customer portal must remain separate from the admin panel');
});
test('premium customer and ERP visual system is scoped and mobile responsive', () => {
  assert.ok(html.includes('id="rk-enterprise-customer-and-erp-design"'));
  assert.ok(html.includes('#customerFirstPortal .rk-customer-brand'));
  assert.ok(html.includes('#customerFirstPortal .rk-customer-section'));
  assert.ok(html.includes('#customerFirstPortal .rk-customer-submit'));
  assert.ok(html.includes('inset 5px 5px 12px'), 'input fields should use inset depth');
  assert.ok(html.includes('prefers-reduced-motion:reduce'));
  assert.ok(html.includes('@media(max-width:700px)'), 'customer layout must include a mobile breakpoint');
});


test('customer hero is responsive, admin-editable, and safely persisted with existing settings', () => {
  assert.ok(html.includes('id="settingCustomerHeroFile"'));
  assert.ok(html.includes("handleImageUpload(event, 'customerHeroImage')"));
  assert.ok(html.includes('function applyCustomerHeroSettings()'));
  assert.ok(html.includes("hero.style.setProperty('--rk-hero-bg'"));
  assert.ok(html.includes('function removeCustomerHeroImage()'));
  assert.ok(html.includes("delete settings.customerHeroImage"));
  assert.ok(html.includes("canvas.toDataURL('image/jpeg', 0.78)"));
  assert.ok(html.includes("settings[fieldName] = dataUrl"));
  assert.ok(html.includes("applyCustomerHeroSettings();"));
  assert.ok(html.includes('.rk-customer-hero.has-custom-image::after'));
  assert.ok(html.includes('@media(max-width:720px)'));
  assert.ok(html.includes("document.getElementById('portalCustName').scrollIntoView"));
  assert.ok(html.includes('onsubmit="saveCustomerBooking(event)"'));
});


test('branded app icon is referenced by the public shell', () => {
  assert.ok(html.includes('<link rel="icon" href="./icon.svg" type="image/svg+xml">'));
  for (const path of ['icon.svg', 'public/icon.svg', 'backend/public/icon.svg']) {
    const icon = fs.readFileSync(require('node:path').join(__dirname, '..', path), 'utf8');
    assert.ok(icon.includes('Radhe Krishn'));
    assert.ok(icon.includes('TENT HOUSE'));
  }
});


test('supplied hero artwork is shipped with all three app shells', () => {
  assert.ok(html.includes('src="./customer-hero.svg"'));
  for (const path of ['customer-hero.svg', 'public/customer-hero.svg', 'backend/public/customer-hero.svg']) {
    const asset = fs.readFileSync(require('node:path').join(__dirname, '..', path), 'utf8');
    assert.ok(asset.includes('data:image/webp;base64,'));
    assert.ok(asset.includes('Radhe Krishn'));
  }
});


test('secret admin gate is reachable from shop-name action and hidden keyboard/mobile gestures', () => {
  const opener = sourceBetween('function openCustomerLogin(event)', 'function closeWelcomeOverlay()');
  assert.match(opener, /return revealAdminGate\(\)/);
  const secret = sourceBetween('<script id="rk-secret-admin-entry">', '</script>');
  assert.match(secret, /e\.ctrlKey&&e\.shiftKey/);
  assert.match(secret, /\.rk-customer-brand/);
  assert.match(secret, /clickCount>=3/);
  assert.match(secret, /setTimeout\(show,1200\)/);
  assert.ok(!opener.includes('व्यवस्थापक प्रवेश लॉक है'));
});

test('admin login explains backend configuration, invalid token, missing route and network errors', () => {
  const login = sourceBetween('async function handleDirectAdminLogin(event)', 'function returnToCustomerPortal()');
  assert.ok(login.includes("api.replace(/\\/+$/,''"));
  for (const marker of ['response.status===401','response.status===404','response.status===429','response.status===503','Backend से संपर्क नहीं हो पाया']) {
    assert.ok(login.includes(marker), 'missing actionable login diagnostic: '+marker);
  }
});

test('admin text fields override legacy light-theme and browser autofill styles', () => {
  assert.ok(html.includes('id="rk-admin-dark-controls-final"'));
  assert.ok(html.includes('#adminPanel input:not([type="checkbox"])'));
  assert.ok(html.includes('-webkit-text-fill-color:#edf5ff!important'));
  assert.ok(html.includes('background:linear-gradient(145deg,#0b1523 0%,#14243a 100%)!important'));
});

test('the primary HTML document is explicitly closed after the final style overrides', () => {
  assert.match(html, /<style id="rk-admin-dark-controls-final">[\s\S]*?<\/style>\s*<\/body>\s*<\/html>\s*$/);
});


test('Google login failure clears the verified admin token and reports failure to the caller', () => {
  const login = html.slice(html.indexOf('async function loginWithGoogle(adminToken)'), html.indexOf('// Keep local writes immediate', html.indexOf('async function loginWithGoogle(adminToken)')));
  assert.ok(login.includes("window.__rkVerifiedAdminToken=''"));
  assert.ok(login.includes('return true'));
  assert.ok(login.includes('return false'));
  const admin = sourceBetween('async function handleDirectAdminLogin(event)', 'function returnToCustomerPortal()');
  assert.ok(admin.includes('const googleLoginOk=await loginWithGoogle(token)'));
});


test('WhatsApp webhook verification secret is never published in setup documentation', () => {
  const guide = fs.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'SETUP_CREDENTIALS_HI.md'), 'utf8');
  const secretLines = guide.split(/\r?\n/).filter(line => /WHATSAPP_WEBHOOK_VERIFY_TOKEN|hub\.verify_token=/i.test(line));
  assert.ok(secretLines.length >= 2);
  assert.doesNotMatch(secretLines.join('\n'), /\b\d{10,}\b/);
  assert.match(guide, /पुरानी Git history/);
  assert.match(guide, /नया random/);
});


test('dashboard stock shortage counts only active un-dispatched reservations and separates vendor stock', () => {
  const start=html.indexOf('function calculateDashboardStockShortages(');
  const end=html.indexOf('function renderStockShortages()',start);
  assert.ok(start>=0&&end>start,'dashboard stock shortage calculator must exist');
  const context={Map,Set,String,Number,Math,Array,JSON};
  vm.runInNewContext(html.slice(start,end)+`
    result=calculateDashboardStockShortages([
      {id:1,name:'A',status:'Confirmed',items:[{name:'Chair',qty:6,source:'admin'}]},
      {id:2,name:'B',status:'Pending Approval',items:[{name:'chair',qty:5,source:'admin'}]},
      {id:3,name:'C',status:'Dispatched',items:[{name:'Chair',qty:100,source:'admin'}]},
      {id:4,name:'D',status:'Partially Returned',items:[{name:'Chair',qty:100,source:'admin'}]},
      {id:5,name:'E',status:'Returned',items:[{name:'Chair',qty:100,source:'admin'}]},
      {id:6,name:'F',status:'Cancelled',items:[{name:'Chair',qty:100,source:'admin'}]},
      {id:7,name:'Vendor One',status:'Confirmed',items:[{name:'Light',qty:8,source:'third-party',partyName:'Vendor One'}]},
      {id:8,name:'Vendor Two',status:'Confirmed',items:[{name:'Light',qty:3,source:'third-party',partyName:'Vendor Two'}]}
    ],[
      {name:'Chair',qty:4}
    ],[
      {item:'Light',partyName:'Vendor One',qty:10},
      {item:'Light',partyName:'Vendor Two',qty:1}
    ]);
  `,context);
  const rows=JSON.parse(JSON.stringify(context.result));
  assert.equal(rows.length,2);
  const admin=rows.find(row=>row.source==='admin');
  assert.equal(admin.qty,11);
  assert.equal(admin.available,4);
  assert.equal(admin.shortage,7);
  assert.deepEqual(admin.bookingIds,[1,2]);
  const vendor=rows.find(row=>row.source==='third-party');
  assert.equal(vendor.partyName,'Vendor Two');
  assert.equal(vendor.qty,3);
  assert.equal(vendor.available,1);
  assert.equal(vendor.shortage,2);
});

test('dashboard shortage calculation ignores zero, negative, fractional and malformed booking quantities', () => {
  const start=html.indexOf('function calculateDashboardStockShortages(');
  const end=html.indexOf('function renderStockShortages()',start);
  const context={Map,Set,String,Number,Math,Array,JSON};
  vm.runInNewContext(html.slice(start,end)+`
    result=calculateDashboardStockShortages([
      {id:1,status:'Confirmed',items:[
        {name:'Chair',qty:0},{name:'Chair',qty:-2},{name:'Chair',qty:1.5},
        {name:'Chair',qty:'bad'},{name:'Chair',qty:'2'}
      ]}
    ],[{name:'Chair',qty:1}],[]);
  `,context);
  const rows=JSON.parse(JSON.stringify(context.result));
  assert.equal(rows.length,1);
  assert.equal(rows[0].qty,2);
  assert.equal(rows[0].shortage,1);
});

test('dashboard renderer uses source-aware active reservation calculator', () => {
  const code=sourceBetween('function renderStockShortages()', 'function addShortageToParty');
  assert.ok(code.includes('calculateDashboardStockShortages(bookings,adminStock,vendorStock)'));
  assert.ok(code.includes('x.bookingIds.join'));
  assert.ok(code.includes('वेंडर: '));
});


test('master ledger counts only verified UPI payments as received', () => {
  const start=html.indexOf('function getMasterLedgerOnlinePaymentDisplay(');
  const end=html.indexOf('function loadMasterLedgerData()',start);
  assert.ok(start>=0&&end>start,'online payment display helper must exist');
  const context={Math,Number,String};
  vm.runInNewContext(html.slice(start,end)+`
    result=[
      getMasterLedgerOnlinePaymentDisplay({online:500,onlineStatus:'pending-verification'}),
      getMasterLedgerOnlinePaymentDisplay({online:500,onlineStatus:'verified'}),
      getMasterLedgerOnlinePaymentDisplay({online:500,onlineStatus:'rejected'}),
      getMasterLedgerOnlinePaymentDisplay({online:500})
    ];
  `,context);
  const rows=JSON.parse(JSON.stringify(context.result));
  assert.deepEqual(rows.map(x=>x.received),[0,500,0,0]);
  assert.deepEqual(rows.map(x=>x.status),[
    'UTR सत्यापन लंबित','UTR सत्यापित','UTR अस्वीकृत',
    'पुराना रिकॉर्ड: सत्यापन स्थिति उपलब्ध नहीं'
  ]);
  assert.ok(rows.every(x=>x.amount===500));
});

test('master ledger online transaction row uses verified amount and explicit UTR status', () => {
  const code=sourceBetween('function loadMasterLedgerData()', 'function exportLedgerToExcel()');
  assert.ok(code.includes('getMasterLedgerOnlinePaymentDisplay(p)'));
  assert.ok(code.includes('₹${display.received.toFixed(2)}'));
  assert.ok(code.includes('UTR सत्यापन लंबित')===false,'status is supplied by the payment-state helper, not hard-coded as received');
  assert.ok(code.includes('display.status'));
});


test('admin stock entry rejects fractional and invalid quantities without saving', () => {
  const code=sourceBetween('function saveStockItemReal(event)', 'function mergeDuplicateStockRows');
  for(const qty of ['1.5','0','-2','abc','']) {
    let writes=0,reset=false;
    const values={stockItemName:'Chair',stockItemQty:qty,stockItemSetRent:'10',stockItemSingleRent:'5',stockItemMissing:'100'};
    const context={
      Number,Math,String,Array,Map,
      document:{getElementById:id=>({value:values[id]})},
      safeGetStorage:()=>[],
      safeSetStorage:()=>{writes++;return true;},
      showActionMessage:()=>{},
      confirm:()=>true,
      event:null
    };
    const event={preventDefault(){},target:{reset(){reset=true;}}};
    context.event=event;
    vm.runInNewContext(code+'\nresult=saveStockItemReal(event);',context);
    assert.equal(writes,0,'invalid admin stock quantity must not be saved');
    assert.equal(reset,false,'invalid form must retain entered values');
  }
});

test('vendor stock entry rejects fractional, negative and malformed quantities without saving', () => {
  const code=sourceBetween('function saveThirdPartyEntry(event)', 'function recordThirdPartyPayment');
  for(const qty of ['1.25','0','-4','bad','']) {
    let writes=0,reset=false;
    const values={tpPartyName:'Vendor A',tpItemName:'Chair',tpItemQty:qty,tpItemCost:'10',tpItemCharge:'20',tpVendorMissingCost:'5',tpMissingCharge:'30'};
    const context={
      Number,Math,String,Array,Date,
      document:{getElementById:id=>({value:values[id]})},
      safeGetStorage:()=>[],
      safeSetStorage:()=>{writes++;return true;},
      showActionMessage:()=>{},
      loadThirdPartyLedger:()=>{},loadThirdPartyDropdownsForDispatch:()=>{},
      event:null
    };
    const event={preventDefault(){},target:{reset(){reset=true;}}};
    context.event=event;
    vm.runInNewContext(code+'\nresult=saveThirdPartyEntry(event);',context);
    assert.equal(writes,0,'invalid vendor stock quantity must not be saved');
    assert.equal(reset,false,'invalid form must retain entered values');
  }
});

test('vendor stock entry rejects negative or non-numeric prices without saving', () => {
  const code=sourceBetween('function saveThirdPartyEntry(event)', 'function recordThirdPartyPayment');
  for(const field of ['tpItemCost','tpItemCharge','tpVendorMissingCost','tpMissingCharge']) {
    for(const value of ['-1','abc']) {
      let writes=0;
      const values={tpPartyName:'Vendor A',tpItemName:'Chair',tpItemQty:'3',tpItemCost:'10',tpItemCharge:'20',tpVendorMissingCost:'5',tpMissingCharge:'30'};
      values[field]=value;
      const context={Number,Math,String,Array,Date,document:{getElementById:id=>({value:values[id]})},safeGetStorage:()=>[],safeSetStorage:()=>{writes++;return true;},showActionMessage:()=>{},loadThirdPartyLedger:()=>{},loadThirdPartyDropdownsForDispatch:()=>{}};
      vm.runInNewContext(code+'\nresult=saveThirdPartyEntry({preventDefault(){},target:{reset(){}}});',context);
      assert.equal(writes,0,field+' must reject '+value);
    }
  }
});


test('income and expense totals ignore malformed, negative and unknown ledger rows', () => {
  const start=html.indexOf('function calculateIncomeExpenseTotals(rows)');
  const end=html.indexOf('function loadIncomeExpenseTable()',start);
  assert.ok(start>=0&&end>start,'income/expense totals calculator must exist');
  const context={Array,Number,String};
  vm.runInNewContext(html.slice(start,end)+`
    result=calculateIncomeExpenseTotals([
      {type:'Income',amount:1200},{type:'Expense',amount:450},
      {type:'income',amount:'300.50'},{type:'expense',amount:'bad'},
      {type:'Expense',amount:-50},{type:'Refund',amount:900},
      {type:'Income',amount:0}
    ]);
  `,context);
  const totals=JSON.parse(JSON.stringify(context.result));
  assert.equal(totals.income,1500.5);
  assert.equal(totals.expense,450);
  assert.equal(totals.net,1050.5);
  assert.equal(totals.validRows,4);
  assert.equal(totals.ignoredRows,3);
});

test('income and expense table summary uses the shared validated totals calculator', () => {
  const code=sourceBetween('function loadIncomeExpenseTable()', "window.addEventListener('resize'");
  assert.match(code,/calculateIncomeExpenseTotals\(list\)/);
  assert.match(code,/totalInc=totals\.income/);
  assert.match(code,/totalExp=totals\.expense/);
});


test('stock item edit rejects fractional quantities and preserves the original record', () => {
  const code=sourceBetween('function editStockItem(index)', 'function deleteStockItem');
  let writes=0;
  const row={name:'Chair',qty:10,singleRent:5,setRent:20,missingCharge:100};
  const answers=['Chair','2.5','5','20','100'];
  const context={Number,Math,String,prompt:()=>answers.shift(),safeGetStorage:()=>[row],safeSetStorage:()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{}};
  vm.runInNewContext(code+'\nresult=editStockItem(0);',context);
  assert.equal(writes,0);
  assert.equal(row.qty,10);
});

test('purchase entry rejects fractional quantities before changing purchase or stock ledgers', () => {
  const code=sourceBetween('function savePurchaseEntry(event)', 'function loadPurchaseTable()');
  const values={purItemName:'Chair',purItemQty:'1.5',purItemPrice:'100',purSingleRent:'5',purSetRent:'20',purMissingCharge:'100',purDate:'2026-11-26',purSupplier:'Supplier'};
  let writes=0;
  const context={Number,Math,String,Date,document:{getElementById:id=>({value:values[id]})},safeGetStorage:()=>[],safeSetStorage:()=>{writes++;return true;},showActionMessage:()=>{},mergeDuplicateStockRows:rows=>rows};
  vm.runInNewContext(code+'\nresult=savePurchaseEntry({preventDefault(){},target:{reset(){}}});',context);
  assert.equal(writes,0);
});

test('purchase edit rejects fractional quantities before changing purchase or stock ledgers', () => {
  const code=sourceBetween('function editPurchase(index)', 'function deletePurchase');
  const row={itemName:'Chair',qty:10,price:100};
  const answers=['Chair','2.5','100','Supplier'];
  let writes=0;
  const context={Number,Math,String,prompt:()=>answers.shift(),safeGetStorage:key=>key==='purchaseDatabase'?[row]:[{name:'Chair',qty:10}],safeSetStorage:()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{}};
  vm.runInNewContext(code+'\nresult=editPurchase(0);',context);
  assert.equal(writes,0);
  assert.equal(row.qty,10);
});

test('income and expense edit rejects impossible calendar dates', () => {
  const helperStart=html.indexOf('function isValidCalendarDate(value)');
  const helperEnd=html.indexOf('function calculateRentalDays',helperStart);
  const code=sourceBetween('function editIncomeExpense(index)', 'function deleteIncomeExpense');
  const row={date:'2026-02-28',desc:'Rent',type:'Expense',amount:100};
  const answers=['2026-02-30','Rent','Expense','100'];
  let writes=0;
  const context={Date,String,Number,prompt:()=>answers.shift(),safeGetStorage:()=>[row],safeSetStorage:()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{}};
  vm.runInNewContext(html.slice(helperStart,helperEnd)+'\n'+code+'\nresult=editIncomeExpense(0);',context);
  assert.equal(writes,0);
  assert.equal(row.date,'2026-02-28');
});


test('purchase edit applies only the quantity delta to stock for the same item', () => {
  const code=sourceBetween('function editPurchase(index)', 'function deletePurchase');
  const store={purchaseDatabase:[{itemName:'Chair',qty:5,price:500,supplier:'A'}],realStockDatabase:[{name:'Chair',qty:7}]};
  const answers=['Chair','4','400','A'];
  let writes=0;
  const context={Number,Math,String,Array,Map,Date,prompt:()=>answers.shift(),safeGetStorage:key=>store[key],mergeDuplicateStockRows:rows=>rows,safeSetStorageBatch:entries=>{writes++;entries.forEach(([key,value])=>store[key]=value);return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{}};
  vm.runInNewContext(code+'\nresult=editPurchase(0);',context);
  assert.equal(writes,1);
  assert.equal(store.realStockDatabase[0].qty,6);
  assert.equal(store.purchaseDatabase[0].qty,4);
});

test('purchase rename is blocked when old purchased stock has already been used', () => {
  const code=sourceBetween('function editPurchase(index)', 'function deletePurchase');
  const store={purchaseDatabase:[{itemName:'Chair',qty:5,price:500,supplier:'A'}],realStockDatabase:[{name:'Chair',qty:3}]};
  const answers=['Table','5','500','A'];
  let writes=0;
  const context={Number,Math,String,Array,Map,Date,prompt:()=>answers.shift(),safeGetStorage:key=>store[key],mergeDuplicateStockRows:rows=>rows,safeSetStorageBatch:()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{}};
  vm.runInNewContext(code+'\nresult=editPurchase(0);',context);
  assert.equal(writes,0);
  assert.equal(store.purchaseDatabase[0].itemName,'Chair');
  assert.equal(store.realStockDatabase[0].qty,3);
});

test('purchase deletion is blocked if the full purchased quantity is no longer in stock', () => {
  const code=sourceBetween('function deletePurchase(index)', 'function editIncomeExpense(index)');
  const store={purchaseDatabase:[{itemName:'Chair',qty:5}],realStockDatabase:[{name:'Chair',qty:2}]};
  let writes=0;
  const context={Number,Math,String,Array,Map,Date,confirm:()=>true,safeGetStorage:key=>store[key],mergeDuplicateStockRows:rows=>rows,safeSetStorageBatch:()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{}};
  vm.runInNewContext(code+'\nresult=deletePurchase(0);',context);
  assert.equal(writes,0);
  assert.equal(store.purchaseDatabase.length,1);
  assert.equal(store.realStockDatabase[0].qty,2);
});

test('purchase deletion atomically removes the record and its full available stock quantity', () => {
  const code=sourceBetween('function deletePurchase(index)', 'function editIncomeExpense(index)');
  const store={purchaseDatabase:[{itemName:'Chair',qty:5}],realStockDatabase:[{name:'Chair',qty:8}]};
  let writes=0;
  const context={Number,Math,String,Array,Map,Date,confirm:()=>true,safeGetStorage:key=>store[key],mergeDuplicateStockRows:rows=>rows,safeSetStorageBatch:entries=>{writes++;entries.forEach(([key,value])=>store[key]=value);return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{}};
  vm.runInNewContext(code+'\nresult=deletePurchase(0);',context);
  assert.equal(writes,1);
  assert.equal(store.purchaseDatabase.length,0);
  assert.equal(store.realStockDatabase[0].qty,3);
});


test('vendor dispatch decrements only the selected vendor stock and records vendor liability rates', async () => {
  const store={
    softwareBookings:[{id:88,status:'Confirmed',date:'2026-11-01',returnDate:'2026-11-05',items:[{name:'Chair',qty:3,rentPrice:100,source:'third-party',partyName:'Vendor A',vendorRentRate:10,vendorMissingCost:25}],dispatchEntries:[]}],
    realStockDatabase:[],
    thirdPartyDatabase:[{partyName:'Vendor A',item:'Chair',qty:5,costPrice:10,chargePrice:100,missingCharge:30}]
  };
  const answers=['2026-11-02','','3'];
  const context={
    Math,Number,String,Array,Date,JSON,
    isValidCalendarDate:value=>{const p=String(value||'').split('-').map(Number);if(p.length!==3)return false;const [y,m,d]=p,dt=new Date(y,m-1,d);return dt.getFullYear()===y&&dt.getMonth()===m-1&&dt.getDate()===d;},
    prompt:()=>answers.shift(),
    safeGetStorage:key=>store[key],
    safeSetStorage:(key,value)=>{store[key]=value;return true;},
    localStorage:mockStorageForBatch(store),syncToCloud:()=>{},console,
    showActionMessage:()=>{},loadAllFirebaseData:()=>{},sendWhatsAppMessage:()=>{},syncCustomerBookingWorkflow:()=>{}
  };
  const code=sourceBetween('async function completeDispatch(id)','function printDispatchSlip');
  vm.runInNewContext(storageBatchSource()+'\n'+code+'\nresult=completeDispatch(88);',context);
  await context.result;
  assert.equal(store.thirdPartyDatabase[0].qty,2);
  assert.equal(store.realStockDatabase.length,0);
  assert.equal(store.softwareBookings[0].dispatchEntries[0].source,'third-party');
  assert.equal(store.softwareBookings[0].dispatchEntries[0].partyName,'Vendor A');
  assert.equal(store.softwareBookings[0].dispatchEntries[0].vendorRentRate,10);
  assert.equal(store.softwareBookings[0].dispatchEntries[0].vendorMissingCost,25);
});

test('vendor partial return adds only received quantity back to the matching vendor stock', async () => {
  const bookings=[{id:89,status:'Dispatched',date:'2026-11-01',returnDate:'2026-11-05',lastDispatchDate:'2026-11-01',
    items:[{name:'Light',qty:5,returnedQty:0,source:'third-party',partyName:'Vendor B'}],
    dispatchEntries:[{itemIndex:0,itemName:'Light',qty:5,date:'2026-11-01',source:'third-party',partyName:'Vendor B',vendorRentRate:12}]}];
  const store={softwareBookings:bookings,missingItemsDatabase:[],realStockDatabase:[],thirdPartyDatabase:[{partyName:'Vendor B',item:'Light',qty:0}]};
  const input={dataset:{returnIndex:'0'},value:'2'},section={style:{display:'block'}};
  const document={querySelectorAll:()=>[input],getElementById:id=>id==='returnManualCountingSection'?section:null};
  const answers=['2026-11-03','PARTIAL'];
  const context={activeReturnBookingId:89,Math,Number,String,Array,Date,
    isValidCalendarDate:value=>{const p=String(value||'').split('-').map(Number);if(p.length!==3)return false;const [y,m,d]=p,dt=new Date(y,m-1,d);return dt.getFullYear()===y&&dt.getMonth()===m-1&&dt.getDate()===d;},
    prompt:()=>answers.shift(),document,safeGetStorage:key=>store[key],safeSetStorage:(key,value)=>{store[key]=value;return true;},
    localStorage:mockStorageForBatch(store),syncToCloud:()=>{},console,showActionMessage:()=>{},loadAllFirebaseData:()=>{},renderMissingItems:()=>{}};
  const code=sourceBetween('async function completeManualReturnProcess()','        window.onload = function()');
  vm.runInNewContext(storageBatchSource()+'\n'+code+'\nresult=completeManualReturnProcess();',context);
  await context.result;
  assert.equal(store.thirdPartyDatabase[0].qty,2);
  assert.equal(store.realStockDatabase.length,0);
  assert.equal(store.softwareBookings[0].items[0].returnedQty,2);
  assert.equal(store.softwareBookings[0].items[0].missingQty||0,0);
  assert.equal(store.softwareBookings[0].status,'Partially Returned');
});


test('barcode camera stops a stream that resolves after the user closes the scanner', async () => {
  const code=sourceBetween('async function startBarcodeCameraScan(targetInputId)', 'async function runOcrScan(event)');
  let resolveCamera,stopped=0;
  const permission=new Promise(resolve=>{resolveCamera=resolve;});
  const modal={style:{display:'none'}};
  const video={srcObject:null,readyState:0,play:async()=>{}};
  class MockBarcodeDetector { static async getSupportedFormats(){return ['code_128'];} constructor(){this.detect=async()=>[];} }
  const context={
    navigator:{mediaDevices:{getUserMedia:()=>permission}},
    window:{BarcodeDetector:MockBarcodeDetector},
    BarcodeDetector:MockBarcodeDetector,
    document:{getElementById:id=>id==='barcodeCameraModal'?modal:id==='barcodeCameraVideo'?video:null},
    barcodeCameraStream:null,barcodeCameraFrame:0,barcodeCameraActive:false,barcodeCameraTargetId:null,barcodeDetectorInstance:null,
    showActionMessage:()=>{},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},String,Array,Promise,Error,console
  };
  vm.runInNewContext(code+'\nresult=startBarcodeCameraScan("dispatchSearchId");',context);
  const starting=context.result;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(context.barcodeCameraActive,true);
  context.stopBarcodeCameraScan();
  resolveCamera({getTracks:()=>[{stop(){stopped++;}}]});
  await starting;
  assert.equal(stopped,1);
  assert.equal(context.barcodeCameraActive,false);
  assert.equal(context.barcodeCameraStream,null);
  assert.equal(video.srcObject,null);
  assert.equal(modal.style.display,'none');
});
