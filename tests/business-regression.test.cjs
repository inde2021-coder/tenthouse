const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const backend = fs.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'src', 'server.js'), 'utf8');

test('customer booking workflow accepts missing-item recovery mode used by the UI', () => {
  const workflowStart = backend.indexOf("app.put('/api/customer/bookings/:id/workflow'");
  assert.notEqual(workflowStart, -1);
  const workflowRoute = backend.slice(workflowStart, backend.indexOf("app.get('/api/customer/bookings/:id/status'", workflowStart));
  assert.match(workflowRoute, /mode:z\.enum\(\['FINAL','PARTIAL','MISSING_RECOVERY'\]\)/);
  assert.match(html, /mode:'MISSING_RECOVERY',items:\[\{itemIndex,qty\}\]/);
});

test('Firebase settings sync strips admin tokens, API keys, and payment gateway secrets', () => {
  const code=sourceBetween('function sanitizeCloudSettings(settings)', '        // Keep local writes immediate');
  const context={Object,Array};
  const result=vm.runInNewContext(code+';sanitizeCloudSettings({businessName:"RK Tent House",backendApiUrl:"https://api.example",aiAccessToken:"admin-secret",payGatewayKey:"gateway-secret",publicApiKey:"public-but-sensitive",termsConditions:"Terms",otpChannel:"off"})',context);
  assert.deepEqual({...result},{businessName:"RK Tent House",backendApiUrl:"https://api.example",termsConditions:"Terms",otpChannel:"off"});
});
test('Firebase sync, pending queue, and initial sync sanitize software settings', () => {
  const sync=sourceBetween('function sanitizeCloudSettings(settings)', "        window.addEventListener('online'");
  assert.match(sync,/sanitizeCloudValue\(cloudKey, value\)/);
  assert.match(html,/sanitizeCloudValue\(cloudKey, JSON.parse\(raw\)\)/);
  assert.match(sync,/JSON\.stringify\(latest\[cloudKey\]\)===JSON\.stringify\(value\)/);
  assert.match(sync,/delete latest\[cloudKey\]/);
  assert.match(html,/Firebase secret cleanup failed/);
  assert.match(html,/existingLocal\[secretKey\]/);
  assert.match(html,/JSON\.stringify\(cloudSafeSettings\) !== JSON\.stringify\(cloudData\[cloudKey\]\)/);
  assert.match(html,/dbRef\.child\(cloudKey\)\.set\(cloudSafeSettings\)/);
});

test('Firebase rules allow an authenticated admin to read only their own UID grant', () => {
  const rules = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '..', 'database.rules.json'), 'utf8')).rules;
  assert.equal(rules['.read'], false);
  assert.equal(rules['.write'], false);
  assert.equal(rules.tent_erp_data['.read'], "auth != null && root.child('erp_admins').child(auth.uid).val() === true");
  assert.equal(rules.tent_erp_data['.write'], "auth != null && root.child('erp_admins').child(auth.uid).val() === true");
  assert.equal(rules.erp_admins['$uid']['.read'], 'auth != null && auth.uid === $uid');
  assert.equal(rules.erp_admins['$uid']['.write'], false);
});
test('Google admin login verifies the Firebase ID token and server UID grant before revealing admin data', () => {
  const completion = sourceBetween('async function completeGoogleAdminLogin(signedInUser)', 'async function loginWithGoogle()');
  assert.ok(completion.includes("'/api/admin/session'"));
  assert.ok(completion.includes("Authorization:'Bearer '+idToken"));
  assert.ok(completion.indexOf('if(!response.ok)') >= 0 && completion.indexOf('if(!response.ok)') < completion.indexOf("const panel=document.getElementById('adminPanel')"));
  assert.ok(completion.includes('response.status===403'));
});

test('full backups and restores exclude private settings credentials', () => {
  const backup=html.slice(html.indexOf('function exportFullBackup()'),html.indexOf('function restoreFullBackup(event)'));
  const restore=html.slice(html.indexOf('function restoreFullBackup(event)'),html.indexOf('function resetAllSoftwareData()'));
  assert.match(backup,/sanitizeCloudSettings\(safeGetStorage\(k,\{\}\)\)/);
  assert.match(restore,/map\(\(\[k,v\]\)=>\[k,k==='softwareSettings'\?sanitizeCloudSettings\(v\):v\]\)/);
  assert.match(html,/Backup में API Token, Gateway Key और अन्य secrets शामिल नहीं होंगे/);
});

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

test('production readiness requires a successful bounded Firebase RTDB read', async () => {
  const start = backend.indexOf('const readinessCheck =');
  const end = backend.indexOf("app.get('/ready'", start);
  assert.notEqual(start, -1, 'missing readiness handler in backend source');
  assert.notEqual(end, -1, 'missing readiness route in backend source');
  const code = backend.slice(start, end);
  const makeResponse = () => ({
    code: null, headers: {}, body: null,
    status(value) { this.code=value; return this; },
    set(key,value) { this.headers[key]=value; return this; },
    json(value) { this.body=value; return this; }
  });
  let probePath = '';
  const makeHandler = (adminDb, firebaseRead) => vm.runInNewContext(code + '; readinessCheck', {
    adminDb, firebaseRestGet: firebaseRead, isProd:true,
    deploymentEnvironment:'production', console,
    Promise, Error, setTimeout, clearTimeout
  });
  const successResponse = makeResponse();
  const successHandler = makeHandler({}, async path => { probePath=path; return []; });
  await successHandler({}, successResponse);
  assert.equal(probePath,'tent_erp_data/stock');
  assert.equal(successResponse.code,200);
  assert.equal(successResponse.body.databaseProbe,'passed');
  const failedResponse = makeResponse();
  const failedHandler = makeHandler({}, async () => { throw new Error('permission denied'); });
  await failedHandler({}, failedResponse);
  assert.equal(failedResponse.code,503);
  assert.equal(failedResponse.body.persistentDatabaseReady,false);
  assert.equal(failedResponse.body.databaseProbe,'failed');
  const missingResponse = makeResponse();
  await makeHandler(null)({}, missingResponse);
  assert.equal(missingResponse.code,503);
  assert.equal(missingResponse.body.databaseProbe,'not_configured');
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

function runRentFunction(functionName, booking, missingRows = []) {
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
  const context = { booking, safeGetStorage: key => key === 'missingItemsDatabase' ? missingRows : [], getMissingChargeTotal: b => missingRows.filter(row => String(row.bookingId) === String(b.id) && !row.resolved && (Number(row.qty)||0)>0).reduce((sum,row)=>sum+Math.max(0,Number(row.penalty)||((Number(row.qty)||0)*Math.max(0,Number(row.unitCharge)||0))),0), calculateRentalDays: () => 2, getEffectiveMissingCharge: item => Math.max(0, Number(item?.missingCharge ?? item?.missingUnitPrice) || 0), Math, Number, Array, Date, result: null };
  vm.runInNewContext(`${sharedHelpers}\n${code}\nresult = ${functionName}(booking);`, context);
  return context.result;
}

test('manual vendor dispatch preserves replacement cost from either supported vendor field', () => {
  const start=html.indexOf('async function addThirdPartyItemToDispatch()');
  const end=html.indexOf('function ',start+20);
  const code=html.slice(start,end);
  assert.ok(code.includes('vendorRow.missingCost??vendorRow.vendorMissingCost'));
  assert.ok(code.includes('vendorMissingCost:Math.max(0,Number(vendorRow.missingCost??vendorRow.vendorMissingCost)||0)'));
});

test('customer cart recalculates bulk tier when the same item is added in separate steps', () => {
  const start=html.indexOf('function addSelectedItemToCart()');
  const end=html.indexOf('function renderCustomerCart()',start);
  assert.ok(start>=0&&end>start,'customer cart add function should exist');
  const code=html.slice(start,end);
  const cart=[{name:'Chair',qty:2,rentPrice:100,rateMode:'single',source:'admin'}];
  const stock=[{name:'Chair',singleRent:100,setRent:60,missingCharge:500}];
  const elements={
    portalStockSelect:{value:'Chair'},
    portalItemQty:{value:'1'}
  };
  const context={
    customerCart:cart,publicCustomerStockCatalog:stock,
    safeGetStorage:()=>stock,getItemRentRate:(row,qty)=>qty>=3&&Number(row.setRent)>0?Number(row.setRent):Number(row.singleRent),
    document:{getElementById:id=>elements[id]},
    showActionMessage:()=>{},renderCustomerCart:()=>{},
    Number,String,Math,Array
  };
  vm.runInNewContext(code+';addSelectedItemToCart()',context);
  assert.equal(cart.length,1);
  assert.equal(cart[0].qty,3);
  assert.equal(cart[0].rentPrice,60);
  assert.equal(cart[0].rateMode,'set');
  assert.equal(elements.portalItemQty.value,'');
});

test('invoice rental detail rows follow actual partial-return and recovery dates', () => {
  const code=sourceBetween('function searchBillingCustomer()', 'function currentPaymentBooking()');
  assert.match(code,/getDispatchEntryRentalSlices\(b\)/);
  assert.match(code,/invoiceRentRows\.map/);
  assert.match(code,/calculateRentalDays\(e\.date,e\.endDate\)/);
});

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

test('missing-item charge is automatic from stock rate without an approval flag', () => {
  const booking={id:77,date:'2026-11-01',returnDate:'2026-11-03',items:[{name:'Chair',qty:2,rentPrice:100,missingQty:1,missingCharge:500}],otherCharges:50,discountAmount:25};
  const missing=runRentFunction('calculateBookingTotalRent',booking,[{bookingId:77,qty:1,unitCharge:500,penalty:500,chargeApproved:false,resolved:false}]);
  const recovered=runRentFunction('calculateBookingTotalRent',booking,[{bookingId:77,qty:0,unitCharge:500,penalty:0,chargeApproved:false,resolved:true}]);
  assert.equal(missing,925);
  assert.equal(recovered,425);
});

test('invoice shows automatic missing charge breakdown without admin approval controls', () => {
  const invoice=sourceBetween('function searchBillingCustomer()', 'function currentPaymentBooking()');
  assert.match(invoice,/missingChargeRows/);
  assert.match(invoice,/Missing सामान का लागू शुल्क/);
  assert.match(invoice,/getMissingChargeTotal\(b\)/);
  assert.doesNotMatch(invoice,/शुल्क स्वीकृत करें/);
});

test('invoice exposes automatically applied missing charge rows without approval gating', () => {
  const invoice=sourceBetween('function searchBillingCustomer()', 'function currentPaymentBooking()');
  assert.match(invoice,/missingChargeRows/);
  assert.match(invoice,/Missing सामान का लागू शुल्क/);
  assert.match(invoice,/getMissingChargeTotal\(b\)/);
  assert.doesNotMatch(invoice,/स्वीकृत Missing Charge|शुल्क स्वीकृत करें|getApprovedMissingChargeTotal/);
});

test('rent uses actual dispatch quantities and their saved unit rate', () => {
  const total = runRentFunction('calculateBookingTotalRent', {
    date: '2026-11-01', returnDate: '2026-11-03',
    items: [{ name: 'Chair', qty: 10, rentPrice: 100 }],
    dispatchEntries: [{ itemIndex: 0, itemName: 'Chair', qty: 3, unitRent: 120, date: '2026-11-01' }]
  });
  assert.equal(total, 720);
});

test('rental slices stop separately on partial return and later missing-item recovery', () => {
  const helperStart=html.indexOf('function getDispatchEntryRentalSlices(b)');
  const helperEnd=html.indexOf('        function calculateBookingTotalRent(b)',helperStart);
  assert.notEqual(helperStart,-1);assert.notEqual(helperEnd,-1);
  const helper=html.slice(helperStart,helperEnd);
  const booking={
    date:'2026-11-01',returnDate:'2026-11-05',status:'Returned',fullyReturnedAt:'2026-11-04T12:00:00Z',actualReturnDate:'2026-11-04',
    items:[{name:'Chair',qty:5,returnedQty:3,missingQty:2}],
    dispatchEntries:[{itemIndex:0,qty:5,date:'2026-11-01',unitRent:100}],
    returnEntries:[
      {date:'2026-11-03',mode:'PARTIAL',items:[{itemIndex:0,qty:2}]},
      {date:'2026-11-04',mode:'MISSING_RECOVERY',items:[{itemIndex:0,qty:1}]}
    ]
  };
  const context={booking,Math,Number,String,Array,Date};
  const slices=vm.runInNewContext(helper+';getDispatchEntryRentalSlices(booking)',context);
  assert.deepEqual(Array.from(slices.slice(0,2),x=>({qty:x.qty,endDate:x.endDate})),[
    {qty:2,endDate:'2026-11-03'},
    {qty:1,endDate:'2026-11-04'}
  ]);
  assert.equal(slices.reduce((n,x)=>n+x.qty,0),5);
});
test('rental slices allocate multiple dispatch batches oldest-first without duplicating returned quantity', () => {
  const helperStart=html.indexOf('function getDispatchEntryRentalSlices(b)');
  const helperEnd=html.indexOf('        function calculateBookingTotalRent(b)',helperStart);
  const helper=html.slice(helperStart,helperEnd);
  const booking={date:'2026-11-01',returnDate:'2026-11-05',items:[{name:'Light',qty:6}],dispatchEntries:[
    {itemIndex:0,qty:3,date:'2026-11-01'},{itemIndex:0,qty:3,date:'2026-11-02'}
  ],returnEntries:[{date:'2026-11-03',items:[{itemIndex:0,qty:4}]}]};
  const slices=vm.runInNewContext(helper+';getDispatchEntryRentalSlices(booking)',{booking,Math,Number,String,Array,Date});
  assert.deepEqual(Array.from(slices.slice(0,2),x=>({qty:x.qty,endDate:x.endDate})),[
    {qty:3,endDate:'2026-11-03'},{qty:1,endDate:'2026-11-03'}
  ]);
  assert.equal(slices.reduce((n,x)=>n+x.qty,0),6);
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
    getEffectiveMissingCharge: item => Math.max(0,Number(item?.missingCharge??item?.missingUnitPrice)||0),
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
  assert.ok(code.includes("persistInventoryBatch([['softwareBookings',bookings],['realStockDatabase',stock],['thirdPartyDatabase',thirdParty],['missingItemsDatabase',missing]])"));
  assert.ok(html.includes("persistInventoryBatch([['softwareBookings',bookings],['missingItemsDatabase',missing],[stockKey,stock]])"));
  assert.ok(html.includes('m.penalty=0;'));
  assert.ok(!html.includes('m.qty*Math.max(0,Number(it.missingCharge'));
});

test('dispatch order additions report success only after booking storage succeeds', () => {
  const admin=html.slice(html.indexOf('async function addItemToPendingBookingDispatch()'),html.indexOf('async function addThirdPartyItemToDispatch()'));
  const vendor=html.slice(html.indexOf('async function addThirdPartyItemToDispatch()'),html.indexOf('function searchDispatchBooking()'));
  assert.ok(admin.includes("if(!await safeSetStorageBatchAndConfirmCloud([['softwareBookings', bookings]]))"),'admin dispatch add must check storage result');
  assert.ok(vendor.includes("if(!await safeSetStorageBatchAndConfirmCloud([['softwareBookings', bookings]]))"),'vendor dispatch add must check storage result');
  assert.ok(!admin.includes("safeSetStorage('softwareBookings', bookings);\n                loadDispatchTable();"),'admin add must not announce success after unchecked save');
  assert.ok(!vendor.includes("safeSetStorage('softwareBookings', bookings);\n                loadDispatchTable();"),'vendor add must not announce success after unchecked save');
});

test('payment entry and UTR verification prevent duplicate concurrent submissions', () => {
  const save=sourceBetween('async function savePaymentEntry()', 'async function verifyLedgerPayment');
  const verify=sourceBetween('async function verifyLedgerPayment', 'function printReturnSlip');
  assert.ok(save.includes('if(globalThis.__rkPaymentInProgress)'), 'payment submit lock missing');
  assert.ok(save.includes('finally { globalThis.__rkPaymentInProgress=false; }'), 'payment submit lock must release');
  assert.ok(verify.includes('if(globalThis.__rkPaymentVerifyInProgress)'), 'UTR verify lock missing');
  assert.ok(verify.includes('finally { globalThis.__rkPaymentVerifyInProgress=false; }'), 'UTR verify lock must release');
});

test('payment recording and UTR verification save ledger and booking totals atomically', () => {
  const save=html.slice(html.indexOf('async function savePaymentEntry()'),html.indexOf('async function verifyLedgerPayment('));
  const verify=html.slice(html.indexOf('async function verifyLedgerPayment('),html.indexOf('function printReturnSlip('));
  assert.ok(save.includes("await safeSetStorageBatchAndConfirmCloud([[key,ledger],['softwareBookings',rows]])"),'payment ledger and booking must commit together');
  assert.ok(!save.includes("safeSetStorage(key,ledger)"),'payment must not save ledger separately');
  assert.ok(verify.includes("paymentWrites=[['rkPaymentLedger',ledger]]"),'verification must stage ledger');
  assert.ok(verify.includes("paymentWrites.push(['softwareBookings',rows])"),'verification must stage booking');
  assert.ok(verify.includes('await safeSetStorageBatchAndConfirmCloud(paymentWrites)'), 'verification must commit atomically');
});

test('dispatch aggregates duplicate stock-row requirements before checking and deducting availability', () => {
  const dispatch=html.slice(html.indexOf('async function completeDispatch(id)'),html.indexOf('function printDispatchSlip(id)'));
  assert.ok(dispatch.includes('const requirementMap=new Map()'));
  assert.ok(dispatch.includes('if(previous)previous.qty+=x.qty'));
  assert.ok(dispatch.includes('if(available<requirement.qty)'));
  assert.ok(dispatch.includes('requirements.forEach(x=>x.row.qty=Number(x.row.qty)-x.qty)'));
  assert.ok(html.includes("· बाकी '+Math.max(0,planned-sent)"));
});

test('dispatch and return handlers reject duplicate submissions and always release their locks', () => {
  const dispatch=html.slice(html.indexOf('async function completeDispatch(id)'),html.indexOf('function printDispatchSlip(id)'));
  const ret=html.slice(html.indexOf('async function completeManualReturnProcess()'),html.indexOf('let currentDocumentItems = []'));
  for (const [name,fn,flag] of [['dispatch',dispatch,'__rkDispatchInProgress'],['return',ret,'__rkReturnInProgress']]) {
    assert.ok(fn.includes('if(globalThis.'+flag+')'),name+' duplicate guard missing');
    assert.ok(fn.includes('globalThis.'+flag+'=true'),name+' lock acquisition missing');
    assert.ok(fn.includes('finally { globalThis.'+flag+'=false; }'),name+' lock release missing');
  }
});

test('missing recovery preserves prior recovery history and blocks duplicate submissions', () => {
  const recovery=html.slice(html.indexOf('async function recoverMissingItem(recordId,rowIndex)'),html.indexOf('async function completeManualReturnProcess()'));
  assert.ok(recovery.includes('globalThis.__rkMissingRecoveryInProgress'));
  assert.ok(recovery.includes('finally { globalThis.__rkMissingRecoveryInProgress=false; }'));
  assert.ok(html.includes('recoveryEntries:Array.isArray(existing?.recoveryEntries)?existing.recoveryEntries:[]'));
  assert.ok(recovery.includes('m.recoveryEntries.push({qty,date:recoveryDate,createdAt:recoveredAt})'));
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

test('dispatch slip refuses to print planned quantities when legacy dispatch history is absent', () => {
  const code = sourceBetween('function printDispatchSlip(id) {', 'function sendWhatsAppMessage');
  assert.match(code, /if\(!entries\.length\)/);
  assert.match(code, /वास्तविक Dispatch इतिहास उपलब्ध नहीं है/);
  assert.match(code, /Number\.isSafeInteger\(qty\)&&qty>0/);
  assert.doesNotMatch(code, /:\s*\(b\.items\|\|\[\]\)\.map/);
});

test('stock table escapes imported barcode values before rendering', () => {
  const start = html.indexOf('function loadRealStockList()');
  const end = html.indexOf('function printSingleBarcode', start);
  const code = html.slice(start, end);
  assert.match(code, /<code>\$\{escapeHtml\(s\.barcode\)\}<\/code>/);
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
  assert.ok(html.includes('async function saveBusinessDocument()'));
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
  const code = sourceBetween('function updateDynamicPaymentQR()', 'async function addItemToPendingBookingDispatch()');
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

test('missing items are automatically charged from the stock entry rate', () => {
  assert.ok(html.includes('मिसिंग सामान शुल्क विवरण (स्वतः लागू)'));
  assert.ok(html.includes('मिसिंग सामान शुल्क विवरण (स्वतः लागू)'));
  assert.ok(html.includes('getMissingChargeTotal(b)'));
  assert.ok(html.includes('chargeAppliedAt'));
  assert.ok(!html.includes('शुल्क स्वीकृत करें'));
  assert.ok(!html.includes('approveMissingCharge('));
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
  assert.ok(html.includes('Missing सामान का स्वचालित ग्राहक शुल्क Booking Total में शामिल'));
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
  assert.ok(portal.includes('aria-label="व्यवस्थापक Gmail लॉगिन खोलें"'), 'Admin entry remains hidden behind the brand mark, not a visible login button');
  const backend = fs.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'src', 'server.js'), 'utf8');
  assert.ok(backend.includes("app.get('/api/customer/bookings/:id/status'"));
  assert.ok(backend.includes("!==mobile"), 'private booking status endpoint remains mobile-verified');
});

test('customer item selection uses configured stock rent and safely renders item names', () => {
  assert.ok(html.includes('function getItemRentRate(stock, quantity)'));
  assert.ok(html.includes('getItemRentRate(stock,combinedQty)'));
  assert.ok(html.includes('qty>=3 && bulk>0 ? bulk : (single>0 ? single : bulk)'));
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

test('dispatch, return, and missing recovery require confirmed Firebase persistence', () => {
  assert.match(html, /async function safeSetStorageBatchAndConfirmCloud\(entries\)/);
  assert.match(html, /const results = await Promise\.all\(entries\.map\(\(\[key, value\]\) => syncToCloud\(key, value\)\)\)/);
  assert.match(html, /if \(results\.every\(Boolean\)\) return true/);
  assert.match(html, /Critical inventory rollback failed/);
  assert.equal((html.match(/await persistInventoryBatch\(/g) || []).length, 3);
  assert.match(html, /await persistInventoryBatch\(\[\['softwareBookings',bookings\],\['realStockDatabase',stock\],\['thirdPartyDatabase',thirdParty\]\]\)/);
  assert.match(html, /await persistInventoryBatch\(\[\['softwareBookings',bookings\],\['realStockDatabase',stock\],\['thirdPartyDatabase',thirdParty\],\['missingItemsDatabase',missing\]\]\)/);
  assert.match(html, /await persistInventoryBatch\(\[\['softwareBookings',bookings\],\['missingItemsDatabase',missing\],\[stockKey,stock\]\]\)/);
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

test('root and public app shells retain their own deployable markup', () => {
  const root = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  const pub = fs.readFileSync(require('node:path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(root.includes('<html'));
  assert.ok(pub.includes('<html'));
  assert.ok(root.includes('rk-settings-premium-refresh-2026-11'));
  assert.ok(pub.includes('rk-settings-premium-refresh-2026-11'));
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
  assert.ok(code.includes("await safeSetStorageBatchAndConfirmCloud([['realStockDatabase',stock]])"));
});

test('CSV stock import rejects invalid quantities and rates instead of inventing defaults', () => {
  const code = sourceBetween('function importStockFromCSV(event)', 'async function savePurchaseEntry(event)');
  assert.ok(code.includes('Number.isInteger(qty)'));
  assert.ok(code.includes('skipped++'));
  assert.ok(!code.includes('Number(cols[1]) || 10'));
  assert.ok(!code.includes('Number(cols[2]) || 500'));
});

test('purchase entry saves purchase and stock together through rollback-capable batch storage', () => {
  const code = sourceBetween('async function savePurchaseEntry(event)', 'function loadPurchaseTable()');
  assert.ok(code.includes("if(!await safeSetStorageBatchAndConfirmCloud([['purchaseDatabase',pur],['realStockDatabase',nextStock]]))return"));
  const batch = sourceBetween('function safeSetStorageBatch(entries)', 'function showActionMessage(');
  assert.ok(batch.includes('const snapshots = new Map()'));
  assert.ok(batch.includes('for (const [key, previous] of snapshots)'));
});

test('daily expense form does not clear or claim success when local persistence fails', () => {
  const code = sourceBetween('async function saveDailyExpense(event)', 'function renderDashboardLineGraph()');
  assert.ok(code.includes("if(!await safeSetStorageBatchAndConfirmCloud([['incomeExpenseDatabase', list]]))return"));
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
  assert.ok(save.includes("await safeSetStorageBatchAndConfirmCloud([[key,ledger],['softwareBookings',rows]])"));
  assert.ok(save.includes("sendWhatsAppMessage(b.id,'payment')"));
  const verify=sourceBetween('async function verifyLedgerPayment', 'function printReturnSlip');
  assert.ok(verify.includes("verified?'payment-verified':'payment-rejected'"));
  assert.ok(verify.includes('alertBooking?.mob'));
});


test('date-only daily and purchase records use the device local calendar date, not UTC date', () => {
  assert.ok(!html.includes("new Date().toISOString().slice(0,10)"));
  assert.ok(html.includes("new Date().toLocaleDateString('en-CA')"));
  const expense=sourceBetween('async function saveDailyExpense(event)', 'function renderDashboardLineGraph()');
  assert.ok(expense.includes("date: localISODate()"));
});


test('OTP verification has a dedicated brute-force rate limit', () => {
  assert.match(backend, /const otpVerifyLimiter = rateLimit\(\{ windowMs: 15 \* 60_000, limit: 10/);
  assert.match(backend, /app\.post\('\/api\/otp\/verify', otpVerifyLimiter, requireDurableStore/);
});

test('AI provider receives aggregate counts and only allow-listed action IDs/statuses, never raw customer or payment details', () => {
  const start = html.indexOf('const aiBusinessSummary={');
  const end = html.indexOf('const aiUserMessage=', start);
  assert.ok(start >= 0 && end > start, 'privacy-safe summary must be built before sending the AI request');
  const summary = html.slice(start, end);
  assert.ok(summary.includes('bookingRecordCount:countRecords(allBookings)'));
  for (const store of ["realStockDatabase", "incomeExpenseDatabase", "thirdPartyDatabase", "thirdPartyPayments"]) {
    assert.ok(summary.includes("countRecords(safeGetStorage('" + store + "',[]))"), 'aggregate count missing for ' + store);
  }
  assert.match(summary,/pendingBookings:allBookings\.filter\(b=>b&&b\.status==='Pending Approval'/);
  assert.match(summary,/pendingPayments:paymentRows\.filter\(p=>p&&p\.onlineStatus==='pending-verification'&&p\.backendPaymentId/);
  assert.match(summary,/id:String\(b\.id\),status:b\.status/);
  assert.match(summary,/bookingId:String\(p\.bookingId\),amount:Math\.max/);
  assert.doesNotMatch(summary,/\.map\(b=>\(\{[^}]*name:|\.map\(p=>\(\{[^}]*utr:|mob:/);
  assert.ok(!summary.includes('JSON.stringify(allBookings)'));
  assert.ok(!summary.includes('JSON.stringify(paymentRows)'));
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
  assert.match(html, /await persistInventoryBatch\(\[\['softwareBookings',bookings\],\['realStockDatabase',stock\],\['thirdPartyDatabase',thirdParty\]\]\)/);
  assert.match(html, /await persistInventoryBatch\(\[\['softwareBookings',bookings\],\['realStockDatabase',stock\],\['thirdPartyDatabase',thirdParty\],\['missingItemsDatabase',missing\]\]\)/);
  assert.match(html, /await persistInventoryBatch\(\[\['softwareBookings',bookings\],\['missingItemsDatabase',missing\],\[stockKey,stock\]\]\)/);
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

test('admin login stays hidden and uses Firebase Google popup authentication', () => {
  assert.ok(html.includes('e.ctrlKey&&e.shiftKey'));
  assert.ok(html.includes('e.ctrlKey&&e.altKey&&e.shiftKey'));
  assert.ok(html.includes('setTimeout(show,1200)'));
  assert.ok(html.includes('clickCount>=3'));
  assert.ok(html.includes('/api/admin/session'));
  assert.ok(html.includes('async function loginWithGoogle()'));
  assert.ok(html.includes('signInWithPopup(provider)'));
  assert.ok(!html.includes("'x-admin-token':token"));
  assert.ok(!html.includes('firebase.auth().signInWithRedirect('));
  assert.ok(!html.includes('firebase.auth().getRedirectResult('));
  assert.ok(!html.includes("pass === '8120727987'"));
  assert.ok(!html.includes("pass === 'admin'"));
});

test('backend admin session validation is rate-limited and never returns the configured secret', () => {
  assert.match(backend, /const adminLoginLimiter = rateLimit\(\{ windowMs: 10 \* 60_000, limit: 20/);
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

test('Google login reports Firebase and backend errors without exposing credentials', () => {
  const login = sourceBetween('async function handleGoogleAdminLogin(event)', 'function returnToCustomerPortal()');
  assert.ok(login.includes('loginWithGoogle()'));
  assert.ok(login.includes("showActionMessage('लॉगिन विफल'+"));
  assert.ok(login.includes('error.code'));
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


test('Google login uses popup only and propagates errors without redirect state handling', () => {
  const login = sourceBetween('async function loginWithGoogle()', '// Never send credentials');
  assert.ok(login.includes('signInWithPopup(provider)'));
  assert.ok(login.includes('throw error'));
  assert.ok(!login.includes('firebase.auth().setPersistence('));
  assert.ok(!login.includes('firebase.auth().signInWithRedirect('));
  assert.ok(!login.includes('firebase.auth().getRedirectResult('));
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
  const code=sourceBetween('async function saveStockItemReal(event)', 'function mergeDuplicateStockRows');
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
  const code=sourceBetween('async function saveThirdPartyEntry(event)', 'async function recordThirdPartyPayment');
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
  const code=sourceBetween('async function saveThirdPartyEntry(event)', 'async function recordThirdPartyPayment');
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
  const code=sourceBetween('async function editStockItem(index)', 'async function deleteStockItem');
  let writes=0;
  const row={name:'Chair',qty:10,singleRent:5,setRent:20,missingCharge:100};
  const answers=['Chair','2.5','5','20','100'];
  const context={Number,Math,String,prompt:()=>answers.shift(),safeGetStorage:()=>[row],safeSetStorage:()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{}};
  vm.runInNewContext(code+'\nresult=editStockItem(0);',context);
  assert.equal(writes,0);
  assert.equal(row.qty,10);
});

test('purchase entry rejects fractional quantities before changing purchase or stock ledgers', () => {
  const code=sourceBetween('async function savePurchaseEntry(event)', 'function loadPurchaseTable()');
  const values={purItemName:'Chair',purItemQty:'1.5',purItemPrice:'100',purSingleRent:'5',purSetRent:'20',purMissingCharge:'100',purDate:'2026-11-26',purSupplier:'Supplier'};
  let writes=0;
  const context={Number,Math,String,Date,document:{getElementById:id=>({value:values[id]})},safeGetStorage:()=>[],safeSetStorage:()=>{writes++;return true;},showActionMessage:()=>{},mergeDuplicateStockRows:rows=>rows};
  vm.runInNewContext(code+'\nresult=savePurchaseEntry({preventDefault(){},target:{reset(){}}});',context);
  assert.equal(writes,0);
});

test('purchase edit rejects fractional quantities before changing purchase or stock ledgers', () => {
  const code=sourceBetween('function purchaseHasDispatchReference(', 'async function editIncomeExpense(index)');
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
  const code=sourceBetween('async function editIncomeExpense(index)', 'async function deleteIncomeExpense');
  const row={date:'2026-02-28',desc:'Rent',type:'Expense',amount:100};
  const answers=['2026-02-30','Rent','Expense','100'];
  let writes=0;
  const context={Date,String,Number,prompt:()=>answers.shift(),safeGetStorage:()=>[row],safeSetStorage:()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{}};
  vm.runInNewContext(html.slice(helperStart,helperEnd)+'\n'+code+'\nresult=editIncomeExpense(0);',context);
  assert.equal(writes,0);
  assert.equal(row.date,'2026-02-28');
});


test('purchase edit applies only the quantity delta to stock for the same item', () => {
  const code=sourceBetween('function purchaseHasDispatchReference(', 'async function editIncomeExpense(index)');
  const store={purchaseDatabase:[{itemName:'Chair',qty:5,price:500,supplier:'A'}],realStockDatabase:[{name:'Chair',qty:7}]};
  const answers=['Chair','4','400','A'];
  let writes=0;
  const context={Number,Math,String,Array,Map,Date,prompt:()=>answers.shift(),safeGetStorage:key=>store[key],mergeDuplicateStockRows:rows=>rows,safeSetStorageBatch:entries=>{writes++;entries.forEach(([key,value])=>store[key]=value);return true;},safeSetStorageBatchAndConfirmCloud:async entries=>{writes++;entries.forEach(([key,value])=>store[key]=value);return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{}};
  vm.runInNewContext(code+'\nresult=editPurchase(0);',context);
  assert.equal(writes,1);
  assert.equal(store.realStockDatabase[0].qty,6);
  assert.equal(store.purchaseDatabase[0].qty,4);
});

test('purchase rename is blocked when old purchased stock has already been used', () => {
  const code=sourceBetween('function purchaseHasDispatchReference(', 'async function editIncomeExpense(index)');
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
  const code=sourceBetween('function purchaseHasDispatchReference(', 'async function editIncomeExpense(index)');
  const store={purchaseDatabase:[{itemName:'Chair',qty:5}],realStockDatabase:[{name:'Chair',qty:2}]};
  let writes=0;
  const context={Number,Math,String,Array,Map,Date,confirm:()=>true,safeGetStorage:key=>store[key],mergeDuplicateStockRows:rows=>rows,safeSetStorageBatch:()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{}};
  vm.runInNewContext(code+'\nresult=deletePurchase(0);',context);
  assert.equal(writes,0);
  assert.equal(store.purchaseDatabase.length,1);
  assert.equal(store.realStockDatabase[0].qty,2);
});

test('purchase deletion atomically removes the record and its full available stock quantity', () => {
  const code=sourceBetween('function purchaseHasDispatchReference(', 'async function editIncomeExpense(index)');
  const store={purchaseDatabase:[{itemName:'Chair',qty:5}],realStockDatabase:[{name:'Chair',qty:8}]};
  let writes=0;
  const context={Number,Math,String,Array,Map,Date,confirm:()=>true,safeGetStorage:key=>store[key],mergeDuplicateStockRows:rows=>rows,safeSetStorageBatch:entries=>{writes++;entries.forEach(([key,value])=>store[key]=value);return true;},safeSetStorageBatchAndConfirmCloud:async entries=>{writes++;entries.forEach(([key,value])=>store[key]=value);return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{}};
  vm.runInNewContext(code+'\nresult=deletePurchase(0);',context);
  assert.equal(writes,1);
  assert.equal(store.purchaseDatabase.length,0);
  assert.equal(store.realStockDatabase[0].qty,3);
});


test('daily income entry confirms income and expense totals ignore invalid ledger rows', () => {
  const code=sourceBetween('function calculateIncomeExpenseTotals(rows) {','function loadIncomeExpenseTable()');
  const context={Array,Number,String};
  const result=vm.runInNewContext(code+';calculateIncomeExpenseTotals([{type:"Income",amount:100},{type:"Expense",amount:25},{type:"income",amount:10},{type:"Expense",amount:-5},{type:"Other",amount:500},{type:"Income",amount:"bad"}])',context);
  assert.equal(result.income,110);
  assert.equal(result.expense,25);
  assert.equal(result.net,85);
  assert.equal(result.validRows,3);
  assert.equal(result.ignoredRows,3);
  const save=sourceBetween('function saveDailyExpense(event) {','function renderDashboardLineGraph()');
  assert.match(save,/type==='Income'\?'आमदनी Firebase में सुरक्षित हुई':'खर्च Firebase में सुरक्षित हुआ'/);
});

test('daily income and expense form records the selected ledger type', () => {
  assert.match(html, /id="expenseType" required/);
  assert.match(html, /option value="Income">आमदनी/);
  assert.match(html, /option value="Expense">खर्च/);
  const code = sourceBetween('function saveDailyExpense(event) {', 'function renderDashboardLineGraph()');
  assert.match(code, /const type = document\.getElementById\('expenseType'\)\?\.value \|\| 'Expense'/);
  assert.match(code, /\['Income','Expense'\]\.includes\(type\)/);
  assert.match(code, /type, amount/);
});

test('vendor ledger shows advance credit when vendor payments exceed recorded liability', () => {
  const start = html.indexOf('function loadThirdPartyLedger()');
  const end = html.indexOf('// Removed an orphaned speech-recognition fragment', start);
  const code = html.slice(start, end);
  assert.match(code, /vendorAdvance=Math\.max\(0,paid-vendorCost\)/);
  assert.match(code, /बाकी देय:/);
  assert.match(code, /वेंडर के पास एडवांस क्रेडिट:/);
  assert.match(html, /const due=Math\.max\(0,vendorCost-paid\),vendorAdvance=Math\.max\(0,paid-vendorCost\)/);
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

test('missing item recovery restores stock and reduces missing liability exactly once', async () => {
  const store={
    missingItemsDatabase:[{id:'b-0',bookingId:88,itemIndex:0,item:'Chair',source:'third-party',partyName:'Vendor A',qty:3,resolved:false}],
    softwareBookings:[{id:88,status:'Returned',items:[{name:'Chair',qty:5,returnedQty:2,missingQty:3,source:'third-party',partyName:'Vendor A'}],returnEntries:[]}],
    realStockDatabase:[],thirdPartyDatabase:[{partyName:'Vendor A',item:'Chair',qty:1}]
  };
  const messages=[];
  const context={Math,Number,String,Array,Date,JSON,console,prompt:()=> '2',safeGetStorage:key=>store[key],safeSetStorageBatch:entries=>{for(const [key,value] of entries)store[key]=value;return true;},safeSetStorageBatchAndConfirmCloud:async entries=>{for(const [key,value] of entries)store[key]=value;return true;},loadAllFirebaseData:()=>{},renderMissingItems:()=>{},showActionMessage:(m)=>messages.push(m)};
  const code=sourceBetween('async function resolveMissingItem(missingId)', 'function exportFullBackup()');
  vm.runInNewContext(storageBatchSource()+'\n'+code+'\nresult=resolveMissingItem("b-0");',context);
  await context.result;
  assert.equal(store.thirdPartyDatabase[0].qty,3);
  assert.equal(store.softwareBookings[0].items[0].returnedQty,4);
  assert.equal(store.softwareBookings[0].items[0].missingQty,1);
  assert.equal(store.missingItemsDatabase[0].qty,1);
  assert.equal(store.missingItemsDatabase[0].resolved,false);
  assert.equal(store.softwareBookings[0].returnEntries[0].mode,'MISSING_RECOVERY');
});
test('missing recovery uses the exact item index and records the real recovery date for rental accounting', async () => {
  const store={
    missingItemsDatabase:[{id:'m-1',bookingId:92,itemIndex:1,item:'Chair',source:'admin',qty:2,resolved:false}],
    softwareBookings:[{id:92,source:'admin',items:[
      {name:'Chair',qty:2,returnedQty:2,missingQty:0,source:'admin'},
      {name:'Chair',qty:2,returnedQty:0,missingQty:2,source:'admin'}
    ],returnEntries:[]}],
    realStockDatabase:[{name:'Chair',qty:5}],thirdPartyDatabase:[]
  };
  const input={value:'1'};
  const context={
    Math,Number,String,Array,Date,JSON,console,activeReturnBookingId:92,
    document:{getElementById:id=>id==='recoverMissingQty_0'?input:{value:'92'}},
    safeGetStorage:key=>store[key],
    safeSetStorageBatch:entries=>{for(const [key,value] of entries)store[key]=value;return true;},
    loadAllFirebaseData:()=>{},loadReturnBookingForCounting:()=>{},showActionMessage:()=>{}
  };
  const code=sourceBetween('async function recoverMissingItem(recordId,rowIndex)', 'async function completeManualReturnProcess');
  assert.match(code,/const itemIndex=hasItemIndex\?Number\(m\.itemIndex\):matches\[0\]\.index/);
  assert.match(code,/String\(it\.name\)!==String\(m\.item\)/);
  assert.match(code,/m\.recoveryEntries\.push\(\{qty,date:recoveryDate,createdAt:recoveredAt\}\)/);
  assert.match(code,/mode:'MISSING_RECOVERY',items:\[\{itemIndex,qty\}\]/);
  assert.match(code,/row\.qty=currentStockQty\+qty/);
  assert.match(code,/syncCustomerBookingWorkflow\(b,false\)/);
});

test('legacy missing recovery refuses ambiguous duplicate item identities', async () => {
  const store={missingItemsDatabase:[{id:'old',bookingId:90,item:'Chair',source:'admin',qty:1}],softwareBookings:[{id:90,items:[{name:'Chair',qty:1,returnedQty:0,missingQty:1,source:'admin'},{name:'Chair',qty:1,returnedQty:0,missingQty:1,source:'admin'}]}],realStockDatabase:[{name:'Chair',qty:0}],thirdPartyDatabase:[]};
  let writes=0;const context={Math,Number,String,Array,Date,JSON,console,prompt:()=> '1',safeGetStorage:key=>store[key],safeSetStorageBatch:()=>{writes++;return true;},safeSetStorageBatchAndConfirmCloud:async()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{},renderMissingItems:()=>{}};
  const code=sourceBetween('async function resolveMissingItem(missingId)', 'function exportFullBackup()');
  vm.runInNewContext(code+'\nresult=resolveMissingItem("old");',context);
  await context.result;
  assert.equal(writes,0);assert.equal(store.realStockDatabase[0].qty,0);
});
test('missing recovery rejects a stale item index that points to a different item', async () => {
  const store={missingItemsDatabase:[{id:'stale',bookingId:91,itemIndex:0,item:'Chair',source:'admin',qty:1}],softwareBookings:[{id:91,items:[{name:'Table',qty:1,returnedQty:0,missingQty:0,source:'admin'}]}],realStockDatabase:[{name:'Chair',qty:0}],thirdPartyDatabase:[]};
  let writes=0;const context={Math,Number,String,Array,Date,JSON,console,prompt:()=> '1',safeGetStorage:key=>store[key],safeSetStorageBatch:()=>{writes++;return true;},safeSetStorageBatchAndConfirmCloud:async()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{},renderMissingItems:()=>{}};
  const code=sourceBetween('async function resolveMissingItem(missingId)', 'function exportFullBackup()');
  vm.runInNewContext(code+'\nresult=resolveMissingItem("stale");',context);
  await context.result;
  assert.equal(writes,0);assert.equal(store.realStockDatabase[0].qty,0);
});
test('customer portal missing recovery rolls local stock and ledgers back when cloud sync fails', async () => {
  const store={missingItemsDatabase:[{id:'b-0',bookingId:88,itemIndex:0,item:'Chair',source:'admin',qty:1,resolved:false}],softwareBookings:[{id:88,source:'customer-portal',items:[{name:'Chair',qty:2,returnedQty:1,missingQty:1,source:'admin'}]}],realStockDatabase:[{name:'Chair',qty:4}],thirdPartyDatabase:[]};
  let reloads=0;const context={Math,Number,String,Array,Date,JSON,console,prompt:()=> '1',safeGetStorage:key=>store[key],localStorage:mockStorageForBatch(store),safeSetStorage:(key,value)=>{localStorage.setItem(key,JSON.stringify(value));return true;},safeSetStorageBatch:entries=>{for(const [key,value] of entries)store[key]=value;return true;},safeSetStorageBatchAndConfirmCloud:async entries=>{for(const [key,value] of entries)store[key]=value;return true;},syncCustomerBookingWorkflow:async()=>false,loadAllFirebaseData:()=>{reloads++},renderMissingItems:()=>{},showActionMessage:()=>{}};
  const code=sourceBetween('async function resolveMissingItem(missingId)', 'function exportFullBackup()');
  vm.runInNewContext(code+'\nresult=resolveMissingItem("b-0");',context);
  await context.result;
  assert.equal(store.realStockDatabase[0].qty,4);
  assert.equal(store.softwareBookings[0].items[0].returnedQty,1);
  assert.equal(store.softwareBookings[0].items[0].missingQty,1);
  assert.equal(store.missingItemsDatabase[0].qty,1);
  assert.equal(reloads,1);
});
test('missing item recovery refuses to write if the source stock row is missing', async () => {
  const store={missingItemsDatabase:[{id:'b-0',bookingId:88,itemIndex:0,item:'Chair',source:'admin',qty:1}],softwareBookings:[{id:88,items:[{name:'Chair',qty:2,returnedQty:1,missingQty:1,source:'admin'}]}],realStockDatabase:[],thirdPartyDatabase:[]};
  let writes=0;const context={Math,Number,String,Array,Date,JSON,console,prompt:()=> '1',safeGetStorage:key=>store[key],safeSetStorageBatch:()=>{writes++;return true;},loadAllFirebaseData:()=>{},renderMissingItems:()=>{},showActionMessage:()=>{}};
  const code=sourceBetween('async function resolveMissingItem(missingId)', 'function exportFullBackup()');
  vm.runInNewContext(storageBatchSource()+'\n'+code+'\nresult=resolveMissingItem("b-0");',context);
  await context.result;
  assert.equal(writes,0);assert.equal(store.missingItemsDatabase[0].resolved,undefined);
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

test('purchase entry rejects invalid quantities and amounts before writing', () => {
  const code=sourceBetween('async function savePurchaseEntry(event)', 'function loadPurchaseTable()');
  for(const [field,values] of Object.entries({purItemQty:['1.5','0','-2','abc',''],purItemPrice:['','-1','abc'],purSingleRent:['-1','abc'],purSetRent:['-1','abc'],purMissingCharge:['-1','abc']})) {
    for(const value of values) {
      let writes=0,reset=false;
      const fields={purItemName:'Chair',purItemQty:'3',purItemPrice:'100',purSingleRent:'10',purSetRent:'20',purMissingCharge:'50',purDate:'2026-11-26',purSupplier:'Vendor'};
      fields[field]=value;
      const context={Number,Math,String,Array,Date,document:{getElementById:id=>({value:fields[id]})},safeGetStorage:()=>[],safeSetStorageBatch:()=>{writes++;return true;},showActionMessage:()=>{},event:null};
      const event={preventDefault(){},target:{reset(){reset=true;}}};context.event=event;
      vm.runInNewContext(code+'\nresult=savePurchaseEntry(event);',context);
      assert.equal(writes,0,field+' must reject '+value);assert.equal(reset,false);
    }
  }
});
test('purchase and stock are persisted through one rollback-capable batch', () => {
  const code=sourceBetween('async function savePurchaseEntry(event)', 'function loadPurchaseTable()');
  assert.ok(code.includes("await safeSetStorageBatchAndConfirmCloud([['purchaseDatabase',pur],['realStockDatabase',nextStock]])"));
});
test('daily expense edit and delete stop when storage persistence fails', () => {
  const code=sourceBetween('async function editIncomeExpense(index)', 'function loadCustomerList()');
  assert.equal((code.match(/if\(!await safeSetStorageBatchAndConfirmCloud\(\[\['incomeExpenseDatabase',rows\]\]\)\)return/g)||[]).length,2);
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


test('business document print keeps the print target visible until afterprint cleanup', () => {
  const code=sourceBetween('function printBusinessDocument()', 'window.onload = function()');
  assert.ok(code.includes('printWithStampImages()'));
  assert.ok(!code.includes('window.print()'));
  assert.ok(!code.includes("area.style.display='none'"));
  const preview={innerHTML:'<p>Quotation</p>'};
  const area={dataset:{},innerHTML:'',style:{display:'none'},classList:{add(){}}};
  let printCalls=0;
  const context={document:{getElementById:id=>id==='businessDocumentPreview'?preview:area},printWithStampImages:()=>{printCalls++;},showActionMessage:()=>{}};
  vm.runInNewContext(code+'\nresult=printBusinessDocument();',context);
  assert.equal(printCalls,1);
  assert.equal(area.dataset.printRestore,'document');
  assert.equal(area.style.display,'block');
  assert.equal(area.innerHTML,'<p>Quotation</p>');
});

test('business card printing waits for images and cleans the shared print target after afterprint', () => {
  const card=sourceBetween('async function printBusinessCard()', 'function businessDocumentTotals()');
  assert.ok(card.includes("area.dataset.printRestore='card'"));
  assert.ok(card.includes('await printWithStampImages()'));
  assert.ok(!card.includes("area.style.display='none'"));
  assert.ok(html.includes("['invoice','return','dispatch','document','card'].includes(area.dataset.printRestore)"));
});


test('Firebase Realtime Database rules fail closed and allow only explicitly allowlisted admin UIDs', () => {
  const rules=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'..','database.rules.json'),'utf8')).rules;
  assert.equal(rules['.read'],false);
  assert.equal(rules['.write'],false);
  assert.equal(rules.tent_erp_data['.read'],rules.tent_erp_data['.write']);
  assert.ok(rules.tent_erp_data['.read'].includes('auth != null'));
  assert.ok(rules.tent_erp_data['.read'].includes("root.child('erp_admins').child(auth.uid).val() === true"));
  assert.equal(rules.erp_admins['$uid']['.read'],'auth != null && auth.uid === $uid');
  assert.equal(rules.erp_admins['$uid']['.write'],false);
});


test('all inline JavaScript in the deployable HTML parses successfully', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const executable = scripts.filter(([, attrs]) => {
    if (/\bsrc\s*=/.test(attrs)) return false;
    const type = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) || [,''])[1].toLowerCase();
    return !type || ['text/javascript','application/javascript','module'].includes(type);
  });
  assert.ok(executable.length > 0, 'expected inline application scripts');
  for (const [index, match] of executable.entries()) {
    assert.doesNotThrow(() => new vm.Script(match[2], { filename: 'inline-script-' + index }), 'inline script ' + index + ' must parse');
  }
});


test('royal print theme is synchronized and covers customer-facing business documents', () => {
  const path = require('node:path');
  const cssFiles = [
    path.join(__dirname, '..', 'rk-reference-theme.css'),
    path.join(__dirname, '..', 'public', 'rk-reference-theme.css'),
    path.join(__dirname, '..', 'backend', 'public', 'rk-reference-theme.css')
  ];
  const styles = cssFiles.map(file => fs.readFileSync(file, 'utf8'));
  assert.equal(styles[0], styles[1]);
  assert.equal(styles[0], styles[2]);
  assert.match(styles[0], /Royal white-paper print system/);
  assert.match(styles[0], /#printableSlipArea \.rk-slip th/);
  assert.match(styles[0], /#printableSlipArea \.rk-slip td/);
  const dispatch = sourceBetween('function printDispatchSlip(id)', 'function printReturnSlip');
  assert.doesNotMatch(dispatch, /remark/i, 'Dispatch Slip must not contain a Remark field');
  assert.ok(html.includes('<th>मिसिंग मात्रा</th>'), 'Return Slip must retain the Missing Quantity column');
});


test('Royal admin dashboard KPIs are read-only, data-backed and quick actions reuse existing tabs', () => {
  for (const id of ['rkKpiBookings','rkKpiPending','rkKpiDispatch','rkKpiReturns','rkKpiStock','rkKpiVendor']) {
    assert.ok(html.includes('id="' + id + '"'));
  }
  const metrics=sourceBetween('function renderRoyalDashboardMetrics()', 'function renderDashboardLineGraph()');
  assert.match(metrics,/safeGetStorage\('softwareBookings'/);
  assert.match(metrics,/safeGetStorage\('realStockDatabase'/);
  assert.match(metrics,/safeGetStorage\('thirdPartyDatabase'/);
  assert.doesNotMatch(metrics,/safeSetStorage|safeSetStorageBatch|\.set\(/);
  assert.ok(html.includes("window.rkQuickNav=function(tabId)"));
  assert.ok(html.includes("switchTab(tabId,menu||null)"));
  assert.ok(html.includes("if(tabId==='dashboard' && typeof renderRoyalDashboardMetrics==='function')"));
  const path=require('node:path');
  const css=fs.readFileSync(path.join(__dirname,'..','rk-reference-theme.css'),'utf8');
  assert.match(css,/\.rk-admin-kpi-grid/);
  assert.match(css,/\.rk-admin-quick-actions/);
});


test('exactly five ZIP reference themes are selectable and persist across reloads', () => {
  for (const name of ['ref1','ref2','ref3','ref4','ref5']) {
    assert.ok(html.includes('data-rk-theme="'+name+'"'), 'Missing ZIP reference theme: '+name);
  }
  assert.equal((html.match(/data-rk-theme="ref[1-5]"/g)||[]).length,5);
  assert.match(html,/const themes=\['ref1','ref2','ref3','ref4','ref5'\]/);
  assert.match(html,/localStorage\.setItem\('rkDesignPreset',selected\)/);
  assert.match(html,/localStorage\.getItem\('rkDesignPreset'\)/);
  assert.match(html,/window\.applyRkDesign=\(name\)=>apply\(name,true\)/);
  const css=fs.readFileSync(require('node:path').join(__dirname,'..','rk-reference-theme.css'),'utf8');
  // The theme manager remains visible on screen; hiding it for print is intentional.
  assert.match(css,/.rk-design-manager\{display:flex!important/);
  assert.match(css,/html\.rk-ref1/);
  assert.match(css,/html\.rk-ref5/);
  assert.match(css,/#customerFirstPortal \.rk-customer-form/);
  assert.match(css,/#customerFirstPortal \.rk-booking-tracker/);
});



test('quantity-based item rent uses Single Rent for 1-2 pieces and Set/Bulk Rent for 3+ pieces', () => {
  assert.match(html,/function getItemRentRate\(stock, quantity\)/);
  assert.match(html,/qty>=3 && bulk>0 \? bulk : \(single>0 \? single : bulk\)/);
  assert.match(html,/getItemRentRate\(stock,combinedQty\)/);
  assert.match(backend,/qty>=3&&setRent>0\?setRent:\(singleRent>0\?singleRent:setRent\)/);
  assert.match(html,/rateMode:qty>=3\?'set':'single'/);
  assert.match(html,/getItemRentRate\(row,qty\)/);
  assert.match(html,/getItemRentRate\(row,items\[itemIndex\]\.qty\)/);
});


test('vendor ledger separates customer rent, vendor rent cost, missing liability, and payments', () => {
  const code=sourceBetween('function getVendorLedgerRate(', '        // Removed an orphaned speech-recognition fragment');
  const entry={itemIndex:0,itemName:'Chair',qty:3,date:'2026-11-01',unitRent:40,vendorRentRate:20,source:'third-party',partyName:'Vendor A'};
  const booking={id:7,date:'2026-11-01',items:[{name:'Chair',qty:3,missingQty:2,vendorMissingCost:25,source:'third-party',partyName:'Vendor A'}],dispatchEntries:[entry]};
  const elements={partyWiseTablesContainer:{innerHTML:''},thirdPartyPaymentBody:{innerHTML:''},tpPaymentParty:{value:''}};
  const context={
    safeGetStorage:key=>({
      thirdPartyDatabase:[{partyName:'Vendor A',item:'Chair',qty:4,purchasedQty:6,costPrice:20,chargePrice:40}],
      thirdPartyPayments:[{id:'p1',partyName:'Vendor A',amount:30,date:'2026-11-03',method:'Cash'}],
      softwareBookings:[booking]
    })[key]||[],
    getDispatchEntryRentalSlices:()=>[{entry,qty:3,endDate:'2026-11-03'}],
    calculateRentalDays:()=>2,escapeHtml:String,
    document:{getElementById:id=>elements[id]||null},
    Number,String,Math,Array,Set,Date
  };
  vm.runInNewContext(code+'\nloadThirdPartyLedger()',context);
  const html=elements.partyWiseTablesContainer.innerHTML;
  assert.ok(elements.thirdPartyPaymentBody.innerHTML.includes('Cash'),'vendor payment history should render separately');
  for(const amount of ['₹120.00','₹50.00','₹170.00','₹240.00','₹70.00','₹30.00','₹140.00']) {
    assert.ok(html.includes(amount),'vendor ledger should display '+amount);
  }
});

test('customer booking tracker looks up status through the mobile-verified public backend endpoint', () => {
  for (const id of ['rkTrackBookingId','rkTrackMobile','rkBookingTrackResult']) {
    assert.ok(html.includes('id="'+id+'"'));
  }
  const tracker=sourceBetween('async function lookupCustomerBookingStatus()', 'async function saveCustomerBooking(event)');
  assert.match(tracker,/async function lookupCustomerBookingStatus\(\)\s*\{\s*const id=/);
  assert.match(tracker,/\n\s*const mobile=/);
  assert.match(tracker,/api\/customer\/bookings\//);
  assert.match(tracker,/status\?mobile=/);
  assert.match(tracker,/escapeHtml\(b\.id\)/);
  assert.match(tracker,/escapeHtml\(item\.name/);
  assert.match(tracker,/escapeHtml\(advanceLabel\)/);
  assert.match(tracker,/cache:'no-store'/);
  assert.match(tracker,/b\.dispatchEntryCount/);
  assert.match(tracker,/b\.returnEntryCount/);
  assert.match(fs.readFileSync(require('node:path').join(__dirname,'..','rk-reference-theme.css'),'utf8'),/rk-booking-tracker/);
});


test('customer cart combines repeated item additions before choosing single or bulk rent', () => {
  const start=html.indexOf('function getItemRentRate(stock, quantity)');
  const rateEnd=html.indexOf('function addSelectedItemToCart()',start);
  const cartStart=rateEnd;
  const cartEnd=html.indexOf('function renderCustomerCart()',cartStart);
  assert.ok(start>=0&&rateEnd>start&&cartEnd>cartStart);
  const helper=html.slice(start,rateEnd);
  const fn=html.slice(cartStart,cartEnd);
  const stock={name:'Chair',qty:20,singleRent:10,setRent:7,missingCharge:50};
  const cart=[{name:'Chair',qty:1,rentPrice:10,rateMode:'single',source:'admin'}];
  const qtyInput={value:'2'};
  const select={value:'Chair'};
  const context={
    Math,Number,String,Array,
    publicCustomerStockCatalog:[stock],customerCart:cart,
    document:{getElementById:id=>id==='portalStockSelect'?select:id==='portalItemQty'?qtyInput:null},
    showActionMessage:()=>{},renderCustomerCart:()=>{}
  };
  vm.runInNewContext(helper+'\n'+fn+'\naddSelectedItemToCart();',context);
  assert.equal(cart.length,1);
  assert.equal(cart[0].qty,3);
  assert.equal(cart[0].rentPrice,7);
  assert.equal(cart[0].rateMode,'set');
  assert.equal(qtyInput.value,'');
});



test('missing recovery validates the outstanding balance and updates stock plus the rent timeline atomically', () => {
  const code = sourceBetween('async function recoverMissingItem(', 'async function completeManualReturnProcess()');
  assert.match(code, /qty<1\|\|qty>remaining/);
  assert.match(code, /String\(it\.name\)!==String\(m\.item\)/);
  assert.match(code, /it\.missingQty=Math\.max\(0,\(Number\(it\.missingQty\)\|\|0\)-qty\)/);
  assert.match(code, /it\.returnedQty=\(Number\(it\.returnedQty\)\|\|0\)\+qty/);
  assert.match(code, /m\.recoveryEntries\.push\(\{qty,date:recoveryDate/);
  assert.match(code, /mode:'MISSING_RECOVERY',items:\[\{itemIndex,qty\}\]/);
  assert.match(code, /row\.qty=currentStockQty\+qty/);
  assert.match(code, /persistInventoryBatch\(\[\['softwareBookings',bookings\],\['missingItemsDatabase',missing\],\[stockKey,stock\]\]\)/);
});



test('dispatch refuses fractional existing stock without saving', async () => {
  const store={softwareBookings:[{id:401,status:'Confirmed',date:'2026-11-01',returnDate:'2026-11-05',items:[{name:'Chair',qty:1,rentPrice:100,source:'admin'}],dispatchEntries:[]}],realStockDatabase:[{name:'Chair',qty:1.5}],thirdPartyDatabase:[]};
  let writes=0;
  const context={Math,Number,String,Array,Date,JSON,prompt:message=>String(message).includes('नंबर चुनें')?'':'1',isValidCalendarDate:()=>true,safeGetStorage:key=>store[key],safeSetStorageBatch:()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{},sendWhatsAppMessage:()=>{},syncCustomerBookingWorkflow:()=>{}};
  const code=sourceBetween('async function completeDispatch(id)','function printDispatchSlip');
  vm.runInNewContext(code+'\nresult=completeDispatch(401);',context);await context.result;
  assert.equal(writes,0);assert.equal(store.softwareBookings[0].dispatchEntries.length,0);assert.equal(store.realStockDatabase[0].qty,1.5);
});

test('return refuses fractional existing stock without saving booking quantities', async () => {
  const store={softwareBookings:[{id:402,status:'Dispatched',date:'2026-11-01',returnDate:'2026-11-05',items:[{name:'Chair',qty:2,returnedQty:0,source:'admin'}],dispatchEntries:[{itemIndex:0,qty:2,date:'2026-11-01'}]}],missingItemsDatabase:[],realStockDatabase:[{name:'Chair',qty:1.5}],thirdPartyDatabase:[]};
  const input={dataset:{returnIndex:'0'},value:'1'};let writes=0;
  const context={activeReturnBookingId:402,Math,Number,String,Array,Date,JSON,prompt:(()=>{const a=['2026-11-03','PARTIAL'];return()=>a.shift();})(),document:{querySelectorAll:()=>[input],getElementById:()=>({style:{display:'block'}})},isValidCalendarDate:()=>true,safeGetStorage:key=>store[key],safeSetStorageBatch:()=>{writes++;return true;},safeSetStorageBatchAndConfirmCloud:async()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{},renderMissingItems:()=>{}};
  const code=sourceBetween('async function completeManualReturnProcess()','        let currentDocumentItems = []');
  vm.runInNewContext(code+'\nresult=completeManualReturnProcess();',context);await context.result;
  assert.equal(writes,0);assert.equal(store.softwareBookings[0].items[0].returnedQty,0);assert.equal(store.realStockDatabase[0].qty,1.5);
});

test('missing recovery refuses fractional existing stock without changing the missing ledger', async () => {
  const store={softwareBookings:[{id:403,items:[{name:'Chair',qty:2,returnedQty:0,missingQty:1,source:'admin'}]}],missingItemsDatabase:[{id:'m1',bookingId:403,item:'Chair',qty:1,source:'admin'}],realStockDatabase:[{name:'Chair',qty:1.5}],thirdPartyDatabase:[]};
  const context={activeReturnBookingId:403,Math,Number,String,Array,Date,JSON,document:{getElementById:()=>({value:'1'})},safeGetStorage:key=>store[key],safeSetStorageBatch:()=>{throw new Error('must not save');},showActionMessage:()=>{}};
  const code=sourceBetween('async function recoverMissingItem(recordId,rowIndex)','async function completeManualReturnProcess()');
  vm.runInNewContext(code+'\nresult=recoverMissingItem("m1",0);',context);await context.result;
  assert.equal(store.missingItemsDatabase[0].qty,1);assert.equal(store.realStockDatabase[0].qty,1.5);
});

test('return and missing recovery reject blank or malformed legacy stock quantities', async () => {
  for(const invalid of ['', 'bad', null]) {
    const store={softwareBookings:[{id:410,status:'Dispatched',date:'2026-11-01',returnDate:'2026-11-05',items:[{name:'Chair',qty:2,returnedQty:0,source:'admin',missingQty:1}],dispatchEntries:[{itemIndex:0,qty:2,date:'2026-11-01'}]}],missingItemsDatabase:[{id:'m2',bookingId:410,item:'Chair',qty:1,source:'admin'}],realStockDatabase:[{name:'Chair',qty:invalid}],thirdPartyDatabase:[]};
    const input={dataset:{returnIndex:'0'},value:'1'};let writes=0;
    const returnContext={activeReturnBookingId:410,Math,Number,String,Array,Date,JSON,prompt:(()=>{const a=['2026-11-03','PARTIAL'];return()=>a.shift();})(),document:{querySelectorAll:()=>[input],getElementById:()=>({style:{display:'block'}})},isValidCalendarDate:()=>true,safeGetStorage:key=>store[key],safeSetStorageBatch:()=>{writes++;return true;},safeSetStorageBatchAndConfirmCloud:async()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{},renderMissingItems:()=>{}};
    const returnCode=sourceBetween('async function completeManualReturnProcess()','        window.onload = function()');
    vm.runInNewContext(returnCode+'\nresult=completeManualReturnProcess();',returnContext);await returnContext.result;
    assert.equal(writes,0,'return must reject '+String(invalid));
    assert.equal(store.softwareBookings[0].items[0].returnedQty,0);
    const recoverContext={activeReturnBookingId:410,Math,Number,String,Array,Date,JSON,document:{getElementById:()=>({value:'1'})},safeGetStorage:key=>store[key],safeSetStorageBatch:()=>{writes++;return true;},showActionMessage:()=>{}};
    const recoverCode=sourceBetween('async function recoverMissingItem(recordId,rowIndex)','async function completeManualReturnProcess()');
    vm.runInNewContext(recoverCode+'\nresult=recoverMissingItem("m2",0);',recoverContext);await recoverContext.result;
    assert.equal(writes,0,'missing recovery must reject '+String(invalid));
    assert.equal(store.missingItemsDatabase[0].qty,1);
  }
});

test('dispatch aggregates duplicate booking item rows before checking shared stock', async () => {
  const store={softwareBookings:[{id:404,status:'Confirmed',date:'2026-11-01',returnDate:'2026-11-05',items:[{name:'Chair',qty:4,rentPrice:100,source:'admin'},{name:'Chair',qty:4,rentPrice:100,source:'admin'}],dispatchEntries:[]}],realStockDatabase:[{name:'Chair',qty:5}],thirdPartyDatabase:[]};
  let writes=0;const answers=['2026-11-02','','4','4'];
  const context={Math,Number,String,Array,Date,JSON,prompt:()=>answers.shift(),isValidCalendarDate:()=>true,safeGetStorage:key=>store[key],safeSetStorageBatch:()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{},sendWhatsAppMessage:()=>{},syncCustomerBookingWorkflow:()=>{}};
  const code=sourceBetween('async function completeDispatch(id)','function printDispatchSlip');
  vm.runInNewContext(code+'\nresult=completeDispatch(404);',context);await context.result;
  assert.equal(writes,0);assert.equal(store.realStockDatabase[0].qty,5);assert.equal(store.softwareBookings[0].dispatchEntries.length,0);
});

test('dispatch aggregates duplicate vendor booking rows against the same vendor stock', async () => {
  const store={softwareBookings:[{id:405,status:'Confirmed',date:'2026-11-01',returnDate:'2026-11-05',items:[{name:'Light',qty:3,rentPrice:100,source:'third-party',partyName:'Vendor A'},{name:'Light',qty:3,rentPrice:100,source:'third-party',partyName:'Vendor A'}],dispatchEntries:[]}],realStockDatabase:[],thirdPartyDatabase:[{partyName:'Vendor A',item:'Light',qty:4}]};
  let writes=0;const answers=['2026-11-02','','3','3'];
  const context={Math,Number,String,Array,Date,JSON,prompt:()=>answers.shift(),isValidCalendarDate:()=>true,safeGetStorage:key=>store[key],safeSetStorageBatch:()=>{writes++;return true;},showActionMessage:()=>{},loadAllFirebaseData:()=>{},sendWhatsAppMessage:()=>{},syncCustomerBookingWorkflow:()=>{}};
  const code=sourceBetween('async function completeDispatch(id)','function printDispatchSlip');
  vm.runInNewContext(code+'\nresult=completeDispatch(405);',context);await context.result;
  assert.equal(writes,0);assert.equal(store.thirdPartyDatabase[0].qty,4);assert.equal(store.softwareBookings[0].dispatchEntries.length,0);
});

test('legacy missing recovery refuses fractional or malformed source stock without changing ledgers', async () => {
  for (const invalid of [1.5, '', 'bad', null]) {
    const store={missingItemsDatabase:[{id:'legacy-'+String(invalid),bookingId:501,itemIndex:0,item:'Chair',source:'admin',qty:1,resolved:false}],softwareBookings:[{id:501,items:[{name:'Chair',qty:2,returnedQty:1,missingQty:1,source:'admin'}],returnEntries:[]}],realStockDatabase:[{name:'Chair',qty:invalid}],thirdPartyDatabase:[]};
    let writes=0;
    const context={Math,Number,String,Array,Date,JSON,console,prompt:()=> '1',safeGetStorage:key=>store[key],safeSetStorageBatch:()=>{writes++;return true;},loadAllFirebaseData:()=>{},renderMissingItems:()=>{},showActionMessage:()=>{}};
    const code=sourceBetween('async function resolveMissingItem(missingId)', 'function exportFullBackup()');
    vm.runInNewContext(storageBatchSource()+'\n'+code+'\nresult=resolveMissingItem("legacy-'+String(invalid)+'");',context);
    await context.result;
    assert.equal(writes,0,'legacy missing recovery must reject '+String(invalid));
    assert.equal(store.realStockDatabase[0].qty,invalid);
    assert.equal(store.missingItemsDatabase[0].qty,1);
    assert.equal(store.softwareBookings[0].items[0].returnedQty,1);
  }
});


test('server-side AI actions require an allow-listed proposal and exact explicit confirmation', () => {
  assert.match(backend,/app\.post\('\/api\/ai\/actions\/propose', aiLimiter, authAdmin, requireDurableStore/);
  assert.match(backend,/type: z\.literal\('customer_booking_status'\)/);
  assert.match(backend,/status: z\.enum\(\['Confirmed', 'Rejected'\]\)/);
  assert.match(backend,/confirmationText !== expectedConfirmation/);
  assert.match(backend,/type: z\.literal\('payment_verification'\)/);
  assert.match(backend,/Only pending payments can be verified or rejected/);
  assert.match(backend,/completeAiActionAtomically/);
  assert.match(backend,/adminDb\.ref\('erpData'\)\.transaction/);
  assert.match(backend,/Only a booking in Pending Approval/);
  assert.match(backend,/Action proposal is expired or already used/);
  assert.doesNotMatch(backend,/app\.post\('\/api\/ai\/actions\/execute'/);
});

test('server audit log is append-only and records booking and payment mutations', () => {
  assert.match(backend,/async function appendAuditEvent/);
  assert.match(backend,/storeCreateIfAbsent\('erpData\/auditLogs\/' \+ id, event\)/);
  assert.match(backend,/app\.get\('\/api\/audit-log', authAdmin, requireDurableStore/);
  assert.match(backend,/customer_booking_workflow_updated/);
  assert.match(backend,/customer_booking_status_changed/);
  assert.match(backend,/customer_advance_verification/);
  assert.match(backend,/payment_verification/);
});


test('all 19 Admin modules have a page section and their primary handlers', () => {
  const modules = {
    dashboard: ['renderRoyalDashboardMetrics', 'calculateDashboardStockShortages'],
    'master-ledger': ['loadMasterLedgerData', 'loadPaymentLedgerTable'],
    'ai-assistant': ['executeAiCommand'],
    'customer-list': ['loadCustomerList'],
    'booking-list': ['loadBookingsListTable', 'approveBooking'],
    dispatch: ['completeDispatch', 'printDispatchSlip'],
    return: ['completeManualReturnProcess', 'printReturnSlip'],
    'missing-item': ['renderMissingItems', 'getMissingChargeTotal'],
    stock: ['saveStockItemReal', 'importStockFromCSV'],
    'third-party': ['saveThirdPartyEntry', 'recordThirdPartyPayment'],
    purchase: ['savePurchaseEntry', 'editPurchase', 'deletePurchase'],
    'income-expense': ['saveDailyExpense', 'calculateIncomeExpenseTotals'],
    installments: ['loadInstallmentsTable'],
    'payment-ledger': ['savePaymentEntry', 'verifyLedgerPayment'],
    'calendar-view': ['loadCalendarGrid', 'changeCalendarMonth'],
    bill: ['searchBillingCustomer', 'updatePaymentTotals', 'printInvoice'],
    'business-card': ['saveBusinessCard', 'printBusinessCard'],
    documents: ['saveBusinessDocument', 'printBusinessDocument'],
    setting: ['saveSettings', 'saveAdvancedSettings']
  };
  assert.equal((html.match(/class=["'][^"']*\bpage-section\b[^"']*["']/g) || []).length, 19);
  for (const [moduleId, handlers] of Object.entries(modules)) {
    assert.ok(html.includes('id="' + moduleId + '"'), 'missing Admin module section: ' + moduleId);
    for (const handler of handlers) {
      assert.match(html, new RegExp('function\\s+' + handler + '\\s*\\('), moduleId + ' handler missing: ' + handler);
    }
  }
});


test('synthetic Customer Booking → Dispatch → Final Return → Missing Charge → Accounting E2E', async () => {
  const store = {
    softwareBookings: [{
      id: 42, source: 'customer-portal', status: 'Confirmed',
      date: '2026-11-01', returnDate: '2026-11-05', name: 'Test Customer',
      items: [{ name: 'Chair', qty: 5, rentPrice: 100, missingCharge: 50, source: 'admin', returnedQty: 0 }],
      dispatchEntries: [], returnEntries: [], partPayments: []
    }],
    realStockDatabase: [{ name: 'Chair', qty: 5, singleRent: 100, missingCharge: 50 }],
    thirdPartyDatabase: [],
    missingItemsDatabase: []
  };
  const syncCalls = [];
  const dispatchPrompts = ['2026-11-01', '', '5'];
  const dispatchContext = {
    Math, Number, String, Array, Date, JSON, console,
    prompt: () => dispatchPrompts.shift(),
    safeGetStorage: key => store[key],
    safeSetStorage: (key, value) => { store[key] = value; return true; },
    localStorage: mockStorageForBatch(store),
    syncToCloud: () => {},
    syncCustomerBookingWorkflow: async booking => { syncCalls.push({stage:'dispatch',status:booking.status}); return true; },
    showActionMessage: () => {}, loadAllFirebaseData: () => {}, sendWhatsAppMessage: () => {},
    isValidCalendarDate: value => { const parts=String(value||'').split('-').map(Number); if(parts.length!==3||String(value||'').length!==10)return false; const [y,mo,d]=parts,dt=new Date(y,mo-1,d); return dt.getFullYear()===y&&dt.getMonth()===mo-1&&dt.getDate()===d; }
  };
  const dispatchCode = sourceBetween('async function completeDispatch(id)', 'function printDispatchSlip');
  vm.runInNewContext(storageBatchSource() + '\n' + dispatchCode + '\nresult=completeDispatch(42);', dispatchContext);
  await dispatchContext.result;
  assert.equal(store.realStockDatabase[0].qty, 0);
  assert.equal(store.softwareBookings[0].status, 'Dispatched');
  assert.equal(store.softwareBookings[0].dispatchEntries[0].qty, 5);

  const returnInput = { dataset: { returnIndex: '0' }, value: '2' };
  const returnSection = { style: { display: 'block' } };
  const returnPrompts = ['2026-11-03', 'FINAL'];
  const returnContext = {
    activeReturnBookingId: 42, Math, Number, String, Array, Date, JSON, console,
    prompt: () => returnPrompts.shift(),
    document: { querySelectorAll: () => [returnInput], getElementById: id => id === 'returnManualCountingSection' ? returnSection : null },
    safeGetStorage: key => store[key],
    getEffectiveMissingCharge: item => Math.max(0, Number(item?.missingCharge ?? item?.missingUnitPrice) || 0),
    safeSetStorage: (key, value) => { store[key] = value; return true; },
    localStorage: mockStorageForBatch(store), syncToCloud: () => {},
    syncCustomerBookingWorkflow: async booking => { syncCalls.push({stage:'return',status:booking.status}); return true; },
    showActionMessage: () => {}, loadAllFirebaseData: () => {}, renderMissingItems: () => {},
    isValidCalendarDate: dispatchContext.isValidCalendarDate
  };
  const returnCode = sourceBetween('async function completeManualReturnProcess()', '        window.onload = function()');
  vm.runInNewContext(storageBatchSource() + '\n' + returnCode + '\nresult=completeManualReturnProcess();', returnContext);
  await returnContext.result;

  const booking = store.softwareBookings[0];
  const missing = store.missingItemsDatabase[0];
  assert.equal(booking.status, 'Returned');
  assert.equal(booking.items[0].returnedQty, 2);
  assert.equal(booking.items[0].missingQty, 3);
  assert.equal(store.realStockDatabase[0].qty, 2);
  assert.equal(missing.qty, 3);
  assert.equal(missing.unitCharge, 50);
  assert.equal(missing.penalty, 150);
  assert.equal(syncCalls.length, 2);

  booking.partPayments = [{ amount: 500, method: 'Cash', date: '2026-11-03' }];
  const total = runRentFunction('calculateBookingTotalRent', booking, store.missingItemsDatabase);
  const paidCode = sourceBetween('function getBookingPaidAmount(b)', 'function getEffectiveMissingCharge(item)');
  const paid = vm.runInNewContext(paidCode + '\ngetBookingPaidAmount(booking);', { booking, Math, Number, String, Array });
  assert.equal(total, 1150);
  assert.equal(paid, 500);
  assert.equal(total - paid, 650);
});


test('installments page lists only unpaid active bookings', () => {
  const code = sourceBetween('function loadInstallmentsTable()', 'function openDueInstallment(id)');
  const body = { innerHTML: '' };
  const bookings = [
    { id: 1, name: 'Due Customer', mob: '9999999999', status: 'Returned', total: 1000, paid: 400 },
    { id: 2, name: 'Paid Customer', mob: '8888888888', status: 'Returned', total: 500, paid: 500 },
    { id: 3, name: 'Cancelled Customer', mob: '7777777777', status: 'Cancelled', total: 700, paid: 0 }
  ];
  const context = {
    safeGetStorage: () => bookings,
    document: { getElementById: id => id === 'installmentsTableBody' ? body : null },
    calculateBookingTotalRent: b => b.total, getBookingPaidAmount: b => b.paid,
    phoneCallLink: value => String(value), escapeHtml: value => String(value),
    Math, Number, String, Array
  };
  vm.runInNewContext(code + '\nloadInstallmentsTable();', context);
  assert.ok(body.innerHTML.includes('Due Customer'));
  assert.ok(!body.innerHTML.includes('Paid Customer'));
  assert.ok(!body.innerHTML.includes('Cancelled Customer'));
  assert.ok(body.innerHTML.includes('Cash किस्त जमा करें'));
});

test('cash installments persist safely and update the booking due exactly once', async () => {
  const store = { softwareBookings: [{ id: 71, source: 'admin', status: 'Returned', totalPaid: 200, dueAmount: 800, partPayments: [] }] };
  const input = { value: '300', focus() {} };
  const messages = [];
  const code = sourceBetween('async function saveInstallment(id)', 'function printReturnSlip()');
  const context = {
    Math, Number, String, Array, Date, JSON, console,
    document: { getElementById: id => id === 'inst_amt_71' ? input : ({paymentLedgerTableBody:{innerHTML:''},totalCashSum:{textContent:''},totalOnlineSum:{textContent:''},totalOnlinePendingSum:{textContent:''},ledgerBookingTableBody:{innerHTML:''}}[id] || null), addEventListener: () => {} },
    safeGetStorage: key => JSON.parse(JSON.stringify(store[key] || [])),
    safeSetStorageBatch: entries => { for (const [key,value] of entries) store[key] = value; return true; },
    safeSetStorageBatchAndConfirmCloud: async entries => { for (const [key,value] of entries) store[key] = value; return true; },
    getBookingPaidAmount: b => Math.max(Number(b.totalPaid)||0,(b.partPayments||[]).reduce((n,p)=>n+(Number(p.amount)||0),0)),
    escapeHtml: value => String(value), phoneCallLink: value => String(value),
    calculateBookingTotalRent: b => 1000,
    syncCustomerBookingWorkflow: async () => true,
    loadCustomerList: () => {}, loadInstallmentsTable: () => {}, loadPaymentLedgerTable: () => {}, loadMasterLedgerData: () => {}, loadAllFirebaseData: () => {},
    showActionMessage: message => messages.push(message)
  };
  vm.runInNewContext(code + '\nresult=saveInstallment(71);', context);
  await context.result;
  assert.equal(store.softwareBookings[0].partPayments.length, 1);
  assert.equal(store.softwareBookings[0].partPayments[0].method, 'cash');
  assert.equal(store.softwareBookings[0].partPayments[0].amount, 300);
  assert.equal(store.softwareBookings[0].totalPaid, 500);
  assert.equal(store.softwareBookings[0].dueAmount, 500);
  assert.ok(messages.some(message => message.includes('किश्त जमा हो गई')));
});

test('failed installment persistence does not report success or mutate stored booking data', async () => {
  const original = { id: 72, source: 'admin', totalPaid: 100, dueAmount: 900, partPayments: [] };
  const store = { softwareBookings: [original] };
  const input = { value: '250', focus() {} };
  const messages = [];
  const code = sourceBetween('async function saveInstallment(id)', 'function printReturnSlip()');
  const context = {
    Math, Number, String, Array, Date, JSON, console,
    document: { getElementById: id => id === 'inst_amt_72' ? input : null, addEventListener: () => {} },
    safeGetStorage: key => JSON.parse(JSON.stringify(store[key] || [])),
    safeSetStorageBatch: () => false,
    safeSetStorageBatchAndConfirmCloud: async () => false,
    getBookingPaidAmount: b => Number(b.totalPaid)||0,
    calculateBookingTotalRent: () => 1000,
    syncCustomerBookingWorkflow: async () => true,
    loadCustomerList: () => {}, loadInstallmentsTable: () => {}, loadPaymentLedgerTable: () => {}, loadMasterLedgerData: () => {}, loadAllFirebaseData: () => {},
    showActionMessage: message => messages.push(message)
  };
  vm.runInNewContext(code + '\nresult=saveInstallment(72);', context);
  await context.result;
  assert.equal(store.softwareBookings[0].partPayments.length, 0);
  assert.equal(store.softwareBookings[0].totalPaid, 100);
  assert.ok(messages.some(message => message.includes('किस्त सेव नहीं हुई')));
  assert.ok(!messages.some(message => message.includes('किश्त जमा हो गई')));
});

test('payment and Master Ledgers include cash installments and do not misclassify legacy unknown methods', () => {
  const bookings = [{ id: 81, name: 'Ledger Customer', mob: '9999999999', total: 1000, paid: 300, partPayments: [
    { amount: 200, method: 'cash', date: '2026-11-20', source: 'installments-page' },
    { amount: 100, date: '2026-11-21', source: 'installments-page' }
  ] }];
  const ledgerBody = { innerHTML: '' }, cashTotal = { textContent: '' }, onlineTotal = { textContent: '' }, pendingTotal = { textContent: '' };
  const paymentCode = sourceBetween('function loadPaymentLedgerTable()', 'async function applyInvoiceAdjustments');
  const paymentContext = {
    safeGetStorage: key => key === 'softwareBookings' ? bookings : [],
    document: { getElementById: id => ({ paymentLedgerTableBody: ledgerBody, totalCashSum: cashTotal, totalOnlineSum: onlineTotal, totalOnlinePendingSum: pendingTotal }[id] || null) },
    escapeHtml: value => String(value), phoneCallLink: value => String(value),
    Math, Number, String, Array
  };
  vm.runInNewContext(paymentCode + '\nloadPaymentLedgerTable();', paymentContext);
  assert.equal(cashTotal.textContent, '₹200.00');
  assert.ok(ledgerBody.innerHTML.includes('Cash किस्त'));
  assert.ok(ledgerBody.innerHTML.includes('Manual किस्त · method दर्ज नहीं'));

  const masterBody = { innerHTML: '' };
  const masterCode = sourceBetween('function loadMasterLedgerData()', 'function exportLedgerToExcel()');
  const masterContext = {
    safeGetStorage: key => key === 'softwareBookings' ? bookings : [],
    document: { getElementById: id => id === 'ledgerBookingTableBody' ? masterBody : null },
    calculateBookingTotalRent: b => b.total, getBookingPaidAmount: b => b.paid,
    escapeHtml: value => String(value), phoneCallLink: value => String(value),
    Math, Number, String, Array
  };
  vm.runInNewContext(masterCode + '\nloadMasterLedgerData();', masterContext);
  assert.ok(masterBody.innerHTML.includes('Cash किस्त'));
  assert.ok(masterBody.innerHTML.includes('Manual किस्त (method दर्ज नहीं)'));
});


test('bill discount and other-charge changes stop when booking persistence fails', async () => {
  const original = { id: 91, source: 'admin', discountAmount: 0, otherCharges: 0 };
  const messages = [];
  const values = { billSearchInput: { value: '91' }, billDiscountInput: { value: '100' }, billOtherChargesInput: { value: '50' } };
  const code = sourceBetween('async function applyInvoiceAdjustments(quiet=false)', '// Bill adjustment fields recalculate');
  const context = {
    document: { getElementById: id => values[id] || null },
    safeGetStorage: key => key === 'softwareBookings' ? [JSON.parse(JSON.stringify(original))] : {},
    calculateBookingBaseRent: () => 1000,
    safeSetStorage: () => false,
    safeSetStorageBatchAndConfirmCloud: async () => false,
    syncCustomerBookingWorkflow: async () => true,
    searchBillingCustomer: () => { throw new Error('must not refresh invoice after failed save'); },
    showActionMessage: message => messages.push(message),
    Math, Number, String, Array
  };
  vm.runInNewContext(code + '\nresult=applyInvoiceAdjustments();', context);
  await context.result;
  assert.equal(original.discountAmount, 0);
  assert.equal(original.otherCharges, 0);
  assert.ok(messages.some(message => message.includes('बिल बदलाव सेव नहीं हुआ')));
  assert.ok(!messages.some(message => message.includes('बिल में लागू हुए')));
});


test('Shraddha AI renders a server proposal and requires an explicit Admin confirmation click', () => {
  const code = sourceBetween('async function submitAiActionProposal(api,action)', 'function startVoiceRecognition()');
  assert.match(code,/\/api\/ai\/actions\/propose/);
  assert.match(code,/addEventListener\('click'/);
  assert.match(code,/\/api\/ai\/actions\//);
  assert.match(code,/\/confirm/);
  assert.match(code,/confirmationText:data\.confirmationText/);
  assert.match(code,/pendingBookings:/);
  assert.match(code,/pendingPayments:/);
  assert.match(code,/केवल ऊपर दिए pending IDs का उपयोग करें/);
  assert.match(code,/Dispatch, Return, Stock/);
  assert.match(code,/card\.append\(detail,button\)/);
});


test('calendar excludes cancelled bookings, ends early returns on the actual date and escapes customer names', () => {
  const code = sourceBetween('function loadCalendarGrid()', 'window.customerOtpVerifiedPhone=null');
  const title = { textContent: '' }, grid = { innerHTML: '' };
  const bookings = [
    { id: 1, status: 'Confirmed', date: '2026-11-02', returnDate: '2026-11-05', name: '<img src=x onerror=alert(1)>' },
    { id: 2, status: 'Cancelled', date: '2026-11-02', returnDate: '2026-11-05', name: 'Cancelled Customer' },
    { id: 3, status: 'Returned', date: '2026-11-01', returnDate: '2026-11-05', actualReturnDate: '2026-11-02', name: 'Early Return' },
    { id: 4, status: 'Rejected', date: '2026-11-02', returnDate: '2026-11-05', name: 'Rejected Customer' }
  ];
  const context = {
    currentCalendarDate: new Date(2026, 10, 1),
    document: { getElementById: id => id === 'calendarMonthTitle' ? title : id === 'calendarDaysContainer' ? grid : null },
    safeGetStorage: () => bookings,
    escapeHtml: value => String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;"),
    Date, String, Array
  };
  vm.runInNewContext(code + '\nloadCalendarGrid();', context);
  assert.equal(title.textContent, 'नवंबर 2026');
  assert.ok(grid.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!grid.innerHTML.includes('<img src=x'));
  assert.ok(!grid.innerHTML.includes('Cancelled Customer'));
  assert.ok(!grid.innerHTML.includes('Rejected Customer'));
  const earlyReturnTagCount = (grid.innerHTML.match(/#3 Early Return/g)||[]).length;
  assert.equal(earlyReturnTagCount, 2, 'early return should occupy only Nov 1 and Nov 2');
  const day3 = grid.innerHTML.indexOf('<div class="calendar-day-number">3</div>');
  const day4 = grid.innerHTML.indexOf('<div class="calendar-day-number">4</div>', day3);
  assert.ok(day3 >= 0 && day4 > day3);
  assert.ok(!grid.innerHTML.slice(day3,day4).includes('#3 Early Return'));
});

test('dashboard and customer tracker derive dispatch and return counts from saved history arrays', () => {
  assert.ok(html.includes("Array.isArray(b.dispatchEntries)?b.dispatchEntries.length:(Number(b.dispatchEntryCount)||0)"));
  assert.ok(html.includes("Array.isArray(b.returnEntries)?b.returnEntries.length:(Number(b.returnEntryCount)||0)"));
  assert.ok(html.includes("Array.isArray(b.dispatchEntries)?b.dispatchEntries.length:Math.max(0,Number(b.dispatchEntryCount)||0)"));
});


test('stock deletion is blocked while admin or vendor dispatch quantities remain unreturned', () => {
  const helper=sourceBetween('function hasOpenStockReturnReference(', 'function deleteStockItem(index)');
  assert.match(helper,/entry\.itemIndex\)===index/);
  assert.match(helper,/dispatched>Math\.max\(0,Number\(item\.returnedQty\)\|\|0\)/);
  assert.match(helper,/openMissing/);
  const admin=sourceBetween('function deleteStockItem(index)', 'function loadDispatchTable()');
  assert.match(admin,/hasOpenStockReturnReference\('admin',item\.name\)/);
  const vendor=sourceBetween('function editThirdPartyEntry(', 'function deleteThirdPartyPayment(');
  assert.match(vendor,/hasOpenStockReturnReference\('third-party',itemName,partyName\)/);
});


test('Quotation and Tax Invoice document numbers are unique within their document series', () => {
  const code=sourceBetween('function isBusinessDocumentNumberTaken(', 'function businessDocumentTotals()');
  const context={String,Array,Date};
  const result=vm.runInNewContext(code+`
    ({
      taken:isBusinessDocumentNumberTaken('quotation','QTN-100',[{id:'a',documentNumber:'qtn-100'}],null),
      availableForEdit:isBusinessDocumentNumberTaken('quotation','QTN-100',[{id:'a',documentNumber:'QTN-100'}],'a'),
      generated:createUniqueBusinessDocumentNumber('quotation',[{id:'a',documentNumber:'QTN-'+new Date(123456789).toLocaleDateString('en-CA').replace(/-/g,'')+'-123456789'}],123456789)
    })`,context);
  assert.equal(result.taken,true);
  assert.equal(result.availableForEdit,false);
  assert.ok(result.generated.endsWith('-2'),'collision should receive a numeric suffix');
  assert.ok(result.generated.startsWith('QTN-'));
});
test('business document save rejects duplicate numbers and invalid stored item/tax values', () => {
  const save=sourceBetween('async function saveBusinessDocument()', 'function loadBusinessDocument(type,id)');
  assert.match(save,/isBusinessDocumentNumberTaken\(type,number,rows,editingBusinessDocumentId\)/);
  assert.match(save,/Number\.isSafeInteger\(Number\(item\.qty\)\)/);
  assert.match(save,/rawGst>28/);
  assert.match(save,/rawDiscount>subtotalCheck\+rawOther/);
  assert.match(save,/यह Document Number पहले से उपयोग में है/);
});
test('business document preview generates a collision-resistant full timestamp number', () => {
  const preview=sourceBetween('function renderBusinessDocumentPreview()', 'async function saveBusinessDocument()');
  assert.match(preview,/createUniqueBusinessDocumentNumber\(type,numberRows\)/);
  assert.doesNotMatch(preview,/String\(Date\.now\(\)\)\.slice\(-5\)/);
});


test('GSTR-1 working export uses saved tax invoices and their item GST rates, not bookings or a flat 18%', () => {
  const code=sourceBetween('function buildGstr1TaxInvoiceRows(', 'function exportGstr1Report()');
  const context={Array,Number,String,Math};
  const result=vm.runInNewContext(code+`
    buildGstr1TaxInvoiceRows([{
      id:'doc-1',date:'2026-11-27',documentNumber:'INV-1',customerName:'Buyer',customerGstin:'22ABCDE1234F1Z5',
      discount:100,otherCharges:100,taxType:'intra',gstRate:18,
      items:[{name:'Chair',qty:1,rate:1000,gstRate:5},{name:'Stage',qty:1,rate:1000,gstRate:18}]
    },{documentNumber:'INV-BAD',items:[],taxType:'intra'}])
  `,context);
  assert.equal(result.rows.length,1);
  assert.equal(result.skipped,1);
  assert.equal(result.rows[0].taxable,2000);
  assert.equal(result.rows[0].gst,230);
  assert.equal(result.rows[0].cgst,115);
  assert.equal(result.rows[0].sgst,115);
  assert.equal(result.rows[0].igst,0);
  assert.equal(result.rows[0].invoiceValue,2230);
});
test('GSTR-1 export escapes CSV formula injection and exports interstate IGST from saved invoices', () => {
  const code=sourceBetween('function buildGstr1TaxInvoiceRows(', 'function exportGstr1Report()');
  const context={Array,Number,String,Math};
  const result=vm.runInNewContext(code+`
    ({invoice:buildGstr1TaxInvoiceRows([{
      id:'doc-2',documentNumber:'=HYPERLINK("x")',customerName:'@Buyer',discount:0,otherCharges:0,taxType:'inter',gstRate:12,
      items:[{name:'Table',qty:2,rate:500,gstRate:null}]
    }]).rows[0],cell:csvSafeCell('=HYPERLINK("x")')})
  `,context);
  assert.equal(result.invoice.igst,120);
  assert.equal(result.invoice.cgst,0);
  assert.ok(result.cell.startsWith('"\'=HYPERLINK'));
  assert.ok(result.cell.includes('""x""'));
});
test('GSTR-1 CSV function no longer calculates GST from every booking at a flat 18 percent', () => {
  const exportCode=sourceBetween('function exportGstr1Report()', 'function loadInstallmentsTable()');
  assert.match(exportCode,/safeGetStorage\('taxInvoiceDatabase',\[\]\)/);
  assert.match(exportCode,/GSTR1_Tax_Invoice_Working_Register\.csv/);
  assert.doesNotMatch(exportCode,/safeGetStorage\('softwareBookings'/);
  assert.doesNotMatch(exportCode,/\*\s*18\s*\)\s*\/\s*100/);
});


test('GSTR-1 CSV includes a UTF-8 BOM and Windows-compatible row endings', () => {
  const exportCode=sourceBetween('function exportGstr1Report()', 'function loadInstallmentsTable()');
  assert.match(exportCode,/const csv='\\uFEFF'/);
  assert.match(exportCode,/join\('\\r\\n'\)/);
  assert.match(exportCode,/text\/csv;charset=utf-8/);
});


test('daily expense entries use timezone-local ISO dates and consistent positive rounded amounts', () => {
  const dateCode=sourceBetween('function localISODate(', 'async function saveDailyExpense(event)');
  const result=vm.runInNewContext(dateCode+`
    localISODate(new Date(2026,10,27,23,59,59))
  `,{Date,String});
  assert.equal(result,'2026-11-27');
  const save=sourceBetween('async function saveDailyExpense(event)', 'function renderRoyalDashboardMetrics()');
  assert.match(save,/date: localISODate\(\)/);
  assert.match(save,/Math\.round\(amount\*100\)\/100/);
  const edit=sourceBetween('async function editIncomeExpense(index)', 'async function deleteIncomeExpense(index)');
  assert.match(edit,/n<=0/);
  assert.match(edit,/Math\.round\(n\*100\)\/100/);
});


test('purchase history cannot be edited or deleted after related dispatch or unresolved missing records', () => {
  const helper=sourceBetween('function purchaseHasDispatchReference(', 'async function editPurchase(index)');
  assert.match(helper,/booking\.dispatchEntries/);
  assert.match(helper,/itemIndex\)===index/);
  assert.match(helper,/Partially Returned/);
  assert.match(helper,/missingItemsDatabase/);
  const edit=sourceBetween('async function editPurchase(index)', 'async function deletePurchase(index)');
  const del=sourceBetween('async function deletePurchase(index)', 'async function editIncomeExpense(index)');
  assert.match(edit,/purchaseHasDispatchReference\(p\.itemName\)/);
  assert.match(del,/purchaseHasDispatchReference\(p\.itemName\)/);
});


test('purchase dispatch guard blocks only matching admin stock references and unresolved missing rows', () => {
  const helper=sourceBetween('function purchaseHasDispatchReference(', 'async function editPurchase(index)');
  const context={String,Array,Number,safeGetStorage:(key)=>key==='softwareBookings'?[{
    status:'Partially Returned',items:[{name:'Chair',source:'admin'},{name:'Tent',source:'third-party'}],
    dispatchEntries:[{itemIndex:0,qty:4}]
  }]:key==='missingItemsDatabase'?[{item:'Table',qty:1,source:'admin',resolved:false}]:[]};
  const result=vm.runInNewContext(helper+`
    ({chair:purchaseHasDispatchReference('chair'),tent:purchaseHasDispatchReference('tent'),table:purchaseHasDispatchReference('table'),other:purchaseHasDispatchReference('Other')})
  `,context);
  assert.deepEqual({...result},{chair:true,tent:false,table:true,other:false});
});


test('vendor stock edit is blocked while dispatch or return is still open', () => {
  const edit=sourceBetween('async function editThirdPartyEntry(partyName,itemName)', 'async function deleteThirdPartyEntry(');
  assert.match(edit,/hasOpenStockReturnReference\('third-party',itemName,partyName\)/);
  assert.match(edit,/Dispatch\/Return अभी खुला है/);
});
test('adding vendor stock rejects invalid existing quantities and safe-integer overflow', () => {
  const save=sourceBetween('async function saveThirdPartyEntry(event)', 'async function recordThirdPartyPayment(event)');
  assert.match(save,/Number\.isSafeInteger\(currentQty\)/);
  assert.match(save,/Number\.isSafeInteger\(currentPurchased\)/);
  assert.match(save,/Number\.isSafeInteger\(currentQty\+qty\)/);
  assert.match(save,/Number\.isSafeInteger\(currentPurchased\+qty\)/);
  assert.match(save,/मौजूदा Vendor मात्रा सही नहीं है/);
});


test('adding vendor stock during open dispatch cannot rewrite historical vendor rates', () => {
  const save=sourceBetween('async function saveThirdPartyEntry(event)', 'async function recordThirdPartyPayment(event)');
  assert.match(save,/hasOpenStockReturnReference\('third-party',itemName,partyName\)/);
  assert.match(save,/const sameRates=/);
  assert.match(save,/नई खरीद जोड़ सकते हैं, लेकिन पुराने रिकॉर्ड की दरें बदल नहीं सकते/);
  assert.match(save,/existing\.costPrice=costPrice/);
  assert.match(save,/existing\.qty=currentQty\+qty/);
});


test('rental calculations construct ISO dates from local calendar fields, not locale formatting', () => {
  const slices=sourceBetween('function getDispatchEntryRentalSlices(b)', 'function calculateBookingTotalRent(b)');
  const total=sourceBetween('function calculateBookingTotalRent(b)', 'function loadAllFirebaseData()');
  assert.match(slices,/getFullYear\(\).*getMonth\(\).*getDate\(\)/s);
  assert.match(total,/getFullYear\(\).*getMonth\(\).*getDate\(\)/s);
  assert.doesNotMatch(slices,/toLocaleDateString\('en-CA'\)/);
  assert.doesNotMatch(total,/toLocaleDateString\('en-CA'\)/);
});


test('return stock prevalidation aggregates quantities by physical row before updating balances', () => {
  const code=sourceBetween('async function completeManualReturnProcess()', 'let currentDocumentItems = []');
  assert.match(code,/const returnRequirements=new Map\(\)/);
  assert.match(code,/previous\.qty\+=qty/);
  assert.match(code,/total=available\+requirement\.qty/);
  assert.match(code,/Number\.isSafeInteger\(total\)/);
  assert.ok(code.indexOf('for(const requirement of returnRequirements.values())')<code.indexOf('inputs.forEach(input=>'));
});


test('vendor ledger falls back to item and matching vendor rates for legacy zero snapshots', () => {
  const helper=sourceBetween('function getVendorLedgerRate(', 'function loadThirdPartyLedger()');
  const context={String,Array,Number};
  const result=vm.runInNewContext(helper+`
    ({
      rentFromItem:getVendorLedgerRate({vendorRentRate:0,itemName:'Chair',partyName:'Vendor A'},{name:'Chair',partyName:'Vendor A',vendorRentRate:12},[], 'rent'),
      rentFromVendor:getVendorLedgerRate({vendorRentRate:0,itemName:'Chair',partyName:'Vendor A'},{name:'Chair',partyName:'Vendor A',vendorRentRate:0},[{item:'Chair',partyName:'Vendor A',costPrice:15}],'rent'),
      missingFromVendor:getVendorLedgerRate(null,{name:'Chair',partyName:'Vendor A',vendorMissingCost:0},[{item:'Chair',partyName:'Vendor A',missingCost:700}],'missing'),
      noCrossVendor:getVendorLedgerRate(null,{name:'Chair',partyName:'Vendor A'},[{item:'Chair',partyName:'Vendor B',costPrice:99}],'rent')
    })
  `,context);
  assert.deepEqual({...result},{rentFromItem:12,rentFromVendor:15,missingFromVendor:700,noCrossVendor:0});
});
test('vendor ledger uses rate fallback for both rent expense and missing replacement liability', () => {
  const ledger=sourceBetween('function loadThirdPartyLedger()', '// Removed an orphaned speech-recognition fragment');
  assert.match(ledger,/getVendorLedgerRate\(e,item,tpList,'rent'\)/);
  assert.match(ledger,/getVendorLedgerRate\(null,item,tpList,'missing'\)/);
  assert.doesNotMatch(ledger,/Number\(item\.vendorMissingCost\)\|\|0/);
});


test('invoice base rent and customer booking tracker use stable local ISO dates', () => {
  const baseRent=sourceBetween('function calculateBookingBaseRent(b)', 'function searchBillingCustomer()');
  const trackerStart=html.indexOf('const days=(start,end)=>');
  const trackerEnd=html.indexOf('let rental=0;',trackerStart);
  const tracker=html.slice(trackerStart,trackerEnd);
  assert.match(baseRent,/getFullYear\(\).*getMonth\(\).*getDate\(\)/s);
  assert.doesNotMatch(baseRent,/toLocaleDateString\('en-CA'\)/);
  assert.match(tracker,/getFullYear\(\).*getMonth\(\).*getDate\(\)/s);
  assert.doesNotMatch(tracker,/toLocaleDateString\('en-CA'\)/);
});

test('critical stock, booking, expense and payment writes wait for Firebase confirmation', () => {
  const expense = sourceBetween('async function saveDailyExpense(event)', '        function renderRoyalDashboardMetrics()');
  const stock = sourceBetween('async function saveStockItemReal(event)', '        function mergeDuplicateStockRows');
  const booking = sourceBetween('async function approveBooking(id)', '        async function editBooking(id)');
  const payment = sourceBetween('async function savePaymentEntry()', '        async function verifyLedgerPayment');
  const verify = sourceBetween('async function verifyLedgerPayment', '        function ');
  assert.match(expense, /await safeSetStorageBatchAndConfirmCloud/);
  assert.match(html, /rkPaymentLedger:\s*'paymentLedger'/);
  assert.match(stock, /await safeSetStorageBatchAndConfirmCloud/);
  assert.match(booking, /await safeSetStorageBatchAndConfirmCloud/);
  assert.match(payment, /await safeSetStorageBatchAndConfirmCloud/);
  assert.match(verify, /await safeSetStorageBatchAndConfirmCloud/);
  assert.match(html, /async function editStockItem[\s\S]*?await safeSetStorageBatchAndConfirmCloud/);
  assert.match(html, /async function deleteStockItem[\s\S]*?await safeSetStorageBatchAndConfirmCloud/);
});
test('confirmed Firebase batch persistence restores local state when cloud confirmation fails', async () => {
  const code = sourceBetween('async function safeSetStorageBatchAndConfirmCloud(entries)', '        function safeSetStorageBatch(entries)');
  const store = { stock: [{ name: 'Chair', qty: 12 }] };
  const localStorage = {
    getItem: key => Object.prototype.hasOwnProperty.call(store, key) ? JSON.stringify(store[key]) : null,
    setItem: (key, value) => { store[key] = JSON.parse(value); },
    removeItem: key => { delete store[key]; }
  };
  const context = {
    Map, Promise, JSON, console, localStorage,
    safeSetStorageBatch: entries => { for (const [key, value] of entries) store[key] = value; return true; },
    syncToCloud: async () => false,
    showActionMessage: () => {}
  };
  const persist = vm.runInNewContext(code + ';safeSetStorageBatchAndConfirmCloud', context);
  const ok = await persist([['stock', [{ name: 'Chair', qty: 9 }]]]);
  assert.equal(ok, false);
  assert.deepEqual(store.stock, [{ name: 'Chair', qty: 12 }]);
});


test('purchase, vendor, income-expense, invoice and settings mutations require Firebase confirmation', () => {
  const checks = [
    ['async function savePurchaseEntry(event)', 'function loadPurchaseTable()', /await safeSetStorageBatchAndConfirmCloud/],
    ['async function editPurchase(index)', 'async function deletePurchase(index)', /await safeSetStorageBatchAndConfirmCloud/],
    ['async function deletePurchase(index)', 'async function editIncomeExpense(index)', /await safeSetStorageBatchAndConfirmCloud/],
    ['async function editIncomeExpense(index)', 'async function deleteIncomeExpense(index)', /await safeSetStorageBatchAndConfirmCloud/],
    ['async function deleteIncomeExpense(index)', 'function loadCustomerList()', /await safeSetStorageBatchAndConfirmCloud/],
    ['async function saveThirdPartyEntry(event)', 'function getVendorLedgerRate', /await safeSetStorageBatchAndConfirmCloud/],
    ['async function recordThirdPartyPayment(event)', 'function getVendorLedgerRate', /await safeSetStorageBatchAndConfirmCloud/],
    ['async function saveBusinessDocument()', 'function loadBusinessDocument', /await safeSetStorageBatchAndConfirmCloud/],
    ['async function saveBusinessCard()', 'async function printBusinessCard()', /await safeSetStorageBatchAndConfirmCloud/]
  ];
  for (const [start, end, pattern] of checks) {
    const code = sourceBetween(start, end);
    assert.match(code, pattern, start + ' must await Firebase confirmation');
  }
  assert.match(html, /async function editThirdPartyEntry[\s\S]*?await safeSetStorageBatchAndConfirmCloud/);
  assert.match(html, /async function deleteThirdPartyEntry[\s\S]*?await safeSetStorageBatchAndConfirmCloud/);
  assert.match(html, /async function deleteThirdPartyPayment[\s\S]*?await safeSetStorageBatchAndConfirmCloud/);
  assert.match(html, /async function saveSettings[\s\S]*?await safeSetStorageBatchAndConfirmCloud/);
});


test('barcode generation and CSV stock import require confirmed Firebase persistence', () => {
  const barcode = sourceBetween('async function loadRealStockList()', '        function printSingleBarcode');
  const csv = sourceBetween('function importStockFromCSV(event)', '        async function savePurchaseEntry');
  assert.match(barcode, /await safeSetStorageBatchAndConfirmCloud\(\[\['realStockDatabase',stock\]\]\)/);
  assert.match(barcode, /JSON\.stringify\(stock\)!==originalSnapshot/);
  assert.match(csv, /reader\.onload = async function/);
  assert.match(csv, /await safeSetStorageBatchAndConfirmCloud\(\[\['realStockDatabase',mergeDuplicateStockRows\(stock\)\]\]\)/);
});


test('backup restore and uploaded settings images wait for confirmed Firebase persistence', () => {
  const restore = sourceBetween('function restoreFullBackup(event)', '        function resetAllSoftwareData');
  const image = sourceBetween('async function handleImageUpload(event, fieldName)', '        // Browser print may start');
  assert.match(restore, /reader\.onload=async/);
  assert.match(restore, /await safeSetStorageBatchAndConfirmCloud\(entries\)/);
  assert.match(image, /img\.onload = async/);
  assert.match(image, /await safeSetStorageBatchAndConfirmCloud\(\[\['softwareSettings', settings\]\]\)/);
});


test('final-return missing records remain isolated by booking item index', () => {
  assert.ok(html.includes("m.itemIndex!==undefined&&m.itemIndex!==null&&Number(m.itemIndex)===idx"));
});

test('third-party payment entry is isolated to the vendor payment ledger', () => {
  const code = sourceBetween('function recordThirdPartyPayment(event)', 'function loadThirdPartyLedger()');
  assert.match(code, /safeSetStorageBatchAndConfirmCloud/);
  assert.match(code, /thirdPartyPayments/);
  assert.match(code, /vendor-payment/);
  assert.match(code, /tpPaymentParty/);
  assert.match(code, /tpPaymentAmount/);
  assert.doesNotMatch(code, /rkPaymentLedger/);
  assert.doesNotMatch(code, /softwareBookings/);
});

test('third-party ledger derives vendor costs, payment due and margin from actual dispatch data', () => {
  const ledgerStart = html.indexOf('function loadThirdPartyLedger()');
  const ledgerEnd = html.indexOf('// Removed an orphaned speech-recognition fragment', ledgerStart);
  assert.notEqual(ledgerStart, -1);
  assert.ok(ledgerEnd > ledgerStart);
  const code = html.slice(ledgerStart, ledgerEnd);
  assert.match(code, /getDispatchEntryRentalSlices\(booking\)/);
  assert.match(code, /getVendorLedgerRate\(e,item,tpList,'rent'\)/);
  assert.match(code, /getVendorLedgerRate\(null,item,tpList,'missing'\)/);
  assert.match(code, /const vendorCost=vendorRentCost\+vendorMissingLiability/);
  assert.match(code, /const due=Math\.max\(0,vendorCost-paid\)/);
  assert.match(code, /margin=customerRent-vendorCost/);
  assert.match(code, /वेंडर को कुल देय/);
  assert.match(code, /बाकी देय/);
  const vendorRentCost = 2 * 60 * 2;
  const vendorMissingLiability = 1 * 50;
  const vendorCost = vendorRentCost + vendorMissingLiability;
  const customerRent = 2 * 100 * 2;
  const paid = 100;
  assert.equal(vendorRentCost, 240);
  assert.equal(vendorMissingLiability, 50);
  assert.equal(vendorCost, 290);
  assert.equal(customerRent, 400);
  assert.equal(Math.max(0, vendorCost - paid), 190);
  assert.equal(customerRent - vendorCost, 110);
});

test('Android WebView uses the live production backend rather than the retired hostname', () => {
  assert.match(html, /const DEFAULT_BACKEND_API_URL = isHostedWebOrigin \? window\.location\.origin : 'https:\/\/tenthouse2026\.vercel\.app'/);
  assert.match(html, /configured === 'https:\/\/tenthouse2026\.vercel\.app' \? DEFAULT_BACKEND_API_URL : configured/);
  assert.doesNotMatch(html, /https:\/\/tenthouse\.vercel\.app/);
});

test('backend Node engine matches the Node version used by CI and Docker', () => {
  const packageJson = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'package.json'), 'utf8'));
  const docker = fs.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'Dockerfile'), 'utf8');
  const workflow = fs.readFileSync(require('node:path').join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.equal(packageJson.engines.node, '22.x');
  assert.match(docker, /FROM node:22-alpine/);
  assert.match(workflow, /node-version: 22/);
});

test('Shraddha AI is presented as a responsive chat interface with voice and quick prompts', () => {
  assert.ok(html.includes('class="rk-ai-shell"'));
  assert.ok(html.includes('id="aiAssistantResponse"'));
  assert.ok(html.includes('id="aiCommandInput"'));
  assert.ok(html.includes('id="aiVoiceButton"'));
  assert.ok(html.includes('function askAiSuggestion(question)'));
  assert.ok(html.includes('function clearAiChat()'));
  assert.ok(html.includes('rk-ai-suggestions'));
  assert.ok(html.includes('rk-ai-chat-styles'));
});

test('Shraddha AI chat preserves Firebase bearer authentication and backend chat/TTS routes', () => {
  assert.ok(html.includes("fetch(api+'/api/ai/chat'"));
  assert.ok(html.includes("fetch(api+'/api/ai/tts'"));
  assert.ok(html.includes("headers:await firebaseAdminHeaders"));
  assert.ok(!html.includes("headers:{'Content-Type':'application/json','x-admin-token':token}"));
});

test('Shraddha AI action proposals remain explicit and require Admin confirmation', () => {
  assert.ok(html.includes('function submitAiActionProposal(api,action)'));
  assert.ok(html.includes("fetch(api+'/api/ai/actions/propose'"));
  assert.ok(html.includes("'/confirm'"));
  assert.ok(html.includes('Admin पुष्टि करें'));
  assert.ok(html.includes('RK_ACTION'));
});

test('Shraddha AI chat keeps bounded multi-turn context and resets on new chat', () => {
  assert.ok(html.includes('let rkAiConversation=[];'));
  assert.ok(html.includes('...rkAiConversation.slice(-20)'));
  assert.ok(html.includes('rkAiConversation=[];'));
  assert.ok(html.includes('rkAiConversation.length>20'));
});

test('all deployable HTML shells remain byte-identical after the AI chat integration', () => {
  assert.equal(fs.readFileSync(require('node:path').join(__dirname, '..', 'public', 'index.html'), 'utf8'), html);
  assert.equal(fs.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'public', 'index.html'), 'utf8'), html);
  assert.ok(!html.includes('#7fac e738'), 'AI chat CSS must not contain the malformed hex color token.');
});

test('SMS settings expose only providers implemented by the backend and persist the selected OTP channel', () => {
  const settingsStart = html.indexOf('<section class="rk-settings-card rk-settings-sms">');
  const settingsEnd = html.indexOf('</section>', settingsStart);
  assert.notEqual(settingsStart, -1);
  const settings = html.slice(settingsStart, settingsEnd);
  assert.match(settings, /value="msg91"/);
  assert.match(settings, /value="twilio"/);
  assert.doesNotMatch(settings, /value="(?:2factor|fast2sms|custom)"/);
  assert.match(backend, /const hasSavedProvider = Object\.prototype\.hasOwnProperty\.call\(settings, 'smsGatewayProvider'\)/);
  assert.match(backend, /otpSettings\.smsGatewayEnabled !== true/);
  assert.match(backend, /storeGet\('tent_erp_data\/settings'\)/);
  assert.match(backend, /otpSettings\.otpChannel/);
  assert.match(backend, /settings\.smsTemplateId \|\| process\.env\.MSG91_TEMPLATE_ID/);
});
