const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const files = [
  path.join(root, 'index.html'),
  path.join(root, 'public', 'index.html'),
  path.join(root, 'backend', 'public', 'index.html')
];

test('premium responsive Settings refresh is present in every deployable HTML copy', () => {
  const htmlCopies = files.map(file => fs.readFileSync(file, 'utf8'));
  for (const html of htmlCopies) {
    assert.match(html, /<style id="rk-settings-premium-refresh-2026-11">/);
    assert.match(html, /#setting>form\.glass-card-blue/);
    assert.match(html, /#setting \.form-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(html, /#setting \.settings-section/);
    assert.match(html, /@media\(max-width:700px\)/);
    assert.match(html, /#setting button\[type=submit\]/);
    assert.ok(html.indexOf('rk-settings-premium-refresh-2026-11') < html.indexOf('</head>'));
  }
  // The root, public, and backend HTML shells are intentionally maintained
  // independently; verify the settings refresh exists in each without requiring
  // unrelated page markup and business logic to be byte-identical.
});


const cssFiles = [
  path.join(root, 'rk-reference-theme.css'),
  path.join(root, 'public', 'rk-reference-theme.css'),
  path.join(root, 'backend', 'public', 'rk-reference-theme.css')
];

test('five reference CSS is synchronized across all deployable locations', () => {
  const cssCopies = cssFiles.map(file => fs.readFileSync(file, 'utf8'));
  assert.equal(new Set(cssCopies).size, 1, 'all deployed CSS copies must be identical');
  const css = cssCopies[0];
  assert.match(css, /AUTHORITATIVE FIVE-REFERENCE COMPOSITIONS/);
  for (const ref of ['ref1', 'ref2', 'ref3', 'ref4', 'ref5']) {
    assert.match(css, new RegExp('html\\.rk-' + ref + ' #customerFirstPortal'));
  }
  assert.match(css, /@media\(max-width:720px\)/);
});

test('all HTML entry points load the cache-busted reference stylesheet', () => {
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /rk-reference-theme\.css\?v=12/);
    assert.equal((html.match(/data-rk-theme="ref[1-5]"/g) || []).length, 5);
  }
});


test('five reference theme choices are persistent and restore without changing booking handlers', () => {
  const htmlCopies = files.map(file => fs.readFileSync(file, 'utf8'));
  for (const html of htmlCopies) {
    assert.match(html, /const themes=\['ref1','ref2','ref3','ref4','ref5'\]/);
    assert.match(html, /localStorage\.setItem\('rkDesignPreset',selected\)/);
    assert.match(html, /localStorage\.getItem\('rkDesignPreset'\)/);
    assert.match(html, /document\.documentElement\.classList\.toggle\('rk-'\+theme/);
    assert.match(html, /window\.applyRkDesign=\(name\)=>apply\(name,true\)/);
    assert.match(html, /function restore\(\)\{apply\(readSaved\(\),false\);\}/);
    assert.match(html, /id="rkDesignStatus"/);
    assert.match(html, /class="rk-customer-form" onsubmit="saveCustomerBooking\(event\)"/);
    assert.match(html, /id="portalCartTableBody"/);
    assert.match(html, /id="portalAdvanceAmount"/);
    assert.match(html, /id="rkTrackBookingId"/);
    assert.equal((html.match(/data-rk-theme="ref[1-5]"/g) || []).length, 5);
  }
});


test('reference compositions target the shipped portal artwork and real layout nodes', () => {
  const html = fs.readFileSync(files[0], 'utf8');
  const css = fs.readFileSync(cssFiles[0], 'utf8');
  assert.match(html, /src="\.\/customer-hero\.svg"/);
  assert.match(html, /class="rk-customer-form" onsubmit="saveCustomerBooking\(event\)"/);
  assert.match(html, /class="[^"]*rk-booking-tracker/);
  assert.match(html, /class="rk-reference-nav"/);
  assert.match(css, /url\('\.\/customer-hero\.svg'\)/);
  assert.doesNotMatch(css, /bartan-hero\.svg/);
  assert.match(css, /html\.rk-ref2 #customerFirstPortal \.rk-customer-shell\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
});

test('customer task navigation isolates Home, Booking and Tracking and auto-hides its menu', () => {
  for (const file of ['index.html', 'public/index.html', 'backend/public/index.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(html, /rk-customer-task-layout-fixes-2026-11/);
    assert.match(html, /rk-view-home/);
    assert.match(html, /rk-view-booking/);
    assert.match(html, /rk-view-track/);
    assert.match(html, /rk-nav-hidden/);
    assert.match(html, /setView\('booking'\)/);
  }
});

test('Dispatch controls and quotation tables are constrained to mobile scroll containers', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'backend/public/index.html'), 'utf8');
  assert.match(html, /#dispatch #adminStockDispatchSection \.form-grid/);
  assert.match(html, /#dispatch \.table-responsive\{display:block!important;width:100%/);
  assert.match(html, /#documents \.table-responsive table\{width:max-content!important;min-width:720px/);
  assert.match(html, /#documents #businessDocumentPreview\{overflow-x:auto/);
});

test('first three Settings groups are converted to accessible collapsible details', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'backend/public/index.html'), 'utf8');
  assert.match(html, /makeSettingsGroupsCollapsible/);
  assert.match(html, /rk-settings-collapsible/);
  assert.match(html, /aria-expanded/);
});
