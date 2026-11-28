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
    assert.match(html, /id="customerBookingForm"/);
    assert.match(html, /id="bookingItems"/);
    assert.match(html, /id="bookingAdvance"/);
    assert.match(html, /id="bookingTrackingForm"/);
    assert.equal((html.match(/data-rk-theme="ref[1-5]"/g) || []).length, 5);
  }
});
