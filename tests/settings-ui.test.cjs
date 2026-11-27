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
