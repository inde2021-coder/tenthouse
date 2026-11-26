# Radhe Krishn Tent House Manager — प्रारंभिक कोड ऑडिट

## इस पैकेज में किए गए सुधार
- कम-स्टॉक/थर्ड-पार्टी सामान की shortage table को केवल Dashboard के markup में रखा गया है; मुख्य वेबसाइट, `public/` और Android WebView asset की HTML फाइलें समान हैं।
- बैकएंड में Gemini provider support, OTP secret validation, `both` चैनल पर आंशिक सफलता की रिपोर्टिंग और protected provider diagnostics शामिल किए गए हैं।
- Admin token comparison को सख्त किया: अब token की लंबाई बिल्कुल समान होना जरूरी है, उसके बाद constant-time comparison होता है।

## जाँचें जो इस पैकेज पर की गईं
- `backend/src/server.js` पर `node --check` पास।
- Root और backend `package.json` JSON parsing पास।
- तीनों HTML फाइलों में 4 inline script blocks मिले; सभी पर `node --check` पास।
- तीनों HTML फाइलों में duplicate `id` नहीं मिले।
- तीनों HTML फाइलों का SHA-256 समान है।
- ZIP archive integrity check पास।

## अभी भी महत्वपूर्ण सीमाएँ / आगे का काम
- OTP records, payment ledger, WhatsApp inbox और webhook de-duplication अभी process memory में हैं। Vercel serverless/multi-instance deployment में ये durable नहीं हैं; production के लिए Firebase/Firestore, Redis या अन्य persistent database में migrate करना आवश्यक है।
- UTR entry को backend स्वयं वास्तविक बैंक settlement का प्रमाण नहीं मानता; payment verification अभी manual/provider integration पर निर्भर है।
- SMS/WhatsApp/Gemini के वास्तविक अनुरोध सफल हुए हैं, ऐसा दावा नहीं किया जा रहा: इसके लिए Vercel deployment, वैध provider credentials और बाहरी नेटवर्क के साथ end-to-end परीक्षण चाहिए।
- स्थानीय browser/Android device पर UI flows, print, camera/barcode, Firebase rules और सभी business calculations का पूर्ण end-to-end परीक्षण इस रन में नहीं हुआ।

## अगली प्राथमिकता
1. सभी business data के लिए durable database + migration.
2. Booking/dispatch/return/stock/billing/payment calculations के automated tests.
3. OTP/WhatsApp/Gemini की live provider tests और failure/retry checks.
4. Mobile UI, printing/barcode और Android APK build/device verification.


## Customer Portal / Hero अपडेट (25 नवंबर 2026)
- Customer booking panel के मौजूदा form IDs, OTP callbacks, stock/cart flow, UPI/advance inputs और submit handler को untouched रखा गया; केवल visual landing hero और CSS polish जोड़े गए।
- Admin-editable customer hero image `softwareSettings.customerHeroImage` में रखी जाती है। Upload को image MIME type से validate, resize और JPEG में compress किया जाता है; remove action केवल इस setting को हटाता है और बाकी settings सुरक्षित रखता है।
- तीनों deployable HTML copies byte-for-byte synchronized हैं; उपलब्ध uploaded Radhe Krishn artwork को customer hero में और branded SVG icon को root/public/backend public copies में लगाया गया है।
- Automated CI: `node --check backend/src/server.js`, business regression suite, package/manifest JSON validation — सफल।
- `lia_reference.mov` repository के recursive Git tree में नहीं मिला; इसलिए उस वीडियो का visual review इस audit में संभव नहीं हुआ। इस काम में उपलब्ध customer portal structure और existing brand assets के अनुरूप design बनाया गया।
- Vercel preview deployment API ने free daily deployment quota (100/day) की सीमा बताई; इस कारण नवीनतम commit का नया live preview deployment नहीं बन सका। Production deployment को बिना preview/device verification के force नहीं किया गया।


## Final branch-by-branch audit — 26 नवंबर 2026
जाँची गई सभी उपलब्ध branches:
- `main` — production baseline; latest observed head `31a636dca7f60d95658949c998e4104df65e4ca8`
- `audit/deep-audit-fixes-2026-11` — main से 341 commits ahead और 15 behind
- `audit/tenthouse-ai-chat-2026-11` — main से 350 ahead और 15 behind; PR #2 इसी branch पर है और अभी unmerged है
- `render-preview-bartan` — main से 368 ahead और 15 behind; BARTAN hero/icon और वैकल्पिक customer lookup changes हैं
- `render-preview-isolated` — main से 400 ahead और 15 behind; इसमें BARTAN-specific branding/hero और अतिरिक्त preview-only बदलाव हैं
- `render-preview-test` — main से 360 ahead और 15 behind

सभी audit/preview branches का common merge base `a6d508fdd67e2b975edac90697d238ecd981262c` है; Main इस base से आगे बढ़ चुका है। इसलिए किसी भी पुरानी branch को सीधे Main में merge करना सुरक्षित नहीं है। PR #2 का base भी पुरानी audit branch है; उसे rebase/retarget और complete regression verification के बिना merge नहीं करना है।

Main पर मिले root causes:
1. `openCustomerLogin()` स्पष्ट रूप से Admin gate खोलने के बजाय “व्यवस्थापक प्रवेश लॉक है” दिखाकर रुकता था; shop-name click/triple-click का रास्ता इसलिए dead-end था।
2. Secret-entry listener केवल developer footer पर 3.2-second long-press और Ctrl+Alt+Shift+K सुनता था; shop brand triple-tap, छोटा long-press और Ctrl+Shift+K समर्थित नहीं थे।
3. पुराने global light-theme input rules और बाद के dark-theme overrides के बीच specificity/order conflicts थे; सभी Admin/dialog controls पर एक अंतिम dark control layer नहीं थी।
4. Admin login ने 401/404/429/503 और network/CORS failures को generic error में समेट दिया था, जिससे वास्तविक configuration समस्या पता नहीं चलती थी।

नई सुरक्षित branch `audit/final-hardening-2026-11` को नवीनतम Main से बनाया गया। इसमें केवल Tent House brand और customer booking workflow को सुरक्षित रखते हुए:
- shop-name action को सुरक्षित Admin gate से जोड़ा;
- Ctrl+Shift+K, Ctrl+Alt+Shift+K, brand triple-tap और 1.2-second long-press जोड़े;
- Admin login के HTTP/configuration/network errors के लिए अलग संदेश जोड़े;
- Admin panel और dialogs के fields पर final dark recessed/autofill-safe style जोड़ी;
- तीनों deployable HTML copies को byte-identical रखा और document closing tags जोड़े;
- इन fixes के लिए regression tests जोड़े।

सुरक्षा/प्रोडक्शन सीमा:
- Production Main को बदला या merge नहीं किया गया।
- कोई secret/API key इस branch में नहीं जोड़ी गई।
- Vercel preview quota के कारण live deployment की पुष्टि उपलब्ध नहीं थी; Firebase/Google OAuth, real WhatsApp/OTP, payment settlement, barcode/print और real-device visual tests अभी अलग production gates हैं।


## Customer lookup और preview सुरक्षा समीक्षा
- Production Main में `GET /api/customer/bookings/:id/status` Booking ID और उसी रिकॉर्ड के Registered Mobile दोनों माँगता है; केवल मोबाइल नंबर से पूरी booking history नहीं लौटाता।
- `render-preview-bartan` का `POST /api/customer/lookup` query + mobile के आधार पर अधिकतम 10 bookings लौटाता है, जिनमें items और payment-related fields शामिल हैं। यह अनावश्यक रूप से व्यापक customer-data exposure है; इसे Tent House में port/merge नहीं करना है।
- `render-preview-isolated` का वैकल्पिक tracker exact Booking Number + Registered Mobile मिलाता है और केवल एक customer-portal booking लौटाता है; lookup logic अपेक्षाकृत सुरक्षित है। लेकिन उसी branch में BARTAN hero/branding और Preview-mode demo access भी हैं, इसलिए पूरी branch merge नहीं करनी है।
- Preview branches में `PREVIEW_MODE` / demo token व्यवहार केवल isolated non-production preview तक सीमित रहना चाहिए; इसे Production Main में कभी enable नहीं करना है।

## नई verification PR
- Draft PR #3: `https://github.com/inde2021-coder/tenthouse-/pull/3`
- Head: `0413011e5a1044e0d096e05e6f6c16bc1c8dcdcb`
- PR अभी Draft है, merge नहीं हुआ; Production Main unchanged है।
- Root/public/backend-public HTML copies का content hash समान verify किया गया।
- GitHub status में Vercel preview quota failure दिखा; इस turn में GitHub Actions test-run result उपलब्ध नहीं हुआ। इसलिए regression tests को pass घोषित नहीं किया जा रहा।


## अतिरिक्त backend सुरक्षा hardening
- Main के public customer booking-status endpoint पर पहले lookup rate limit नहीं था, जबकि यह endpoint Booking ID + Registered Mobile से customer/booking details लौटाता है।
- नई audit branch में `customerLookupLimiter` जोड़ा: 30 प्रयास / 15 मिनट; गलत और missing lookup भी limit में गिने जाते हैं।
- Backend API regression test में 31वें प्रयास पर HTTP 429 और स्पष्ट Hindi error message की जाँच जोड़ी।

## CI feedback और वर्तमान स्थिति
- GitHub Actions run `45689626553` पर backend syntax check सफल हुआ।
- उस run में 91 business tests में 89 पास और 2 पुराने UI expectations fail हुए: (a) premium stylesheet को अंतिम stylesheet मानने वाला assertion, जबकि नया Admin-only override जानबूझकर उसके बाद आता है; (b) पुराना 3.2-second long-press assertion, जबकि नया trigger 1.2-second है।
- दोनों assertions को नए intended behavior के अनुसार अपडेट किया गया; इसके बाद Google login failure cleanup और customer lookup rate-limit tests भी जोड़े गए।
- नवीनतम head `fee9b71b9966019d594866cb42ee332ced9d725d` के लिए fresh GitHub Actions result अभी उपलब्ध नहीं है। इसलिए अंतिम CI pass अभी घोषित नहीं है।


## AI Chat branch privacy finding
- `audit/tenthouse-ai-chat-2026-11` / PR #2 हर AI request पर local `softwareBookings`, stock, expenses, vendor stock और vendor payments का पूरा snapshot Gemini/backend को भेजता है; केवल 8,500 characters पर text truncation है।
- Booking records में customer name, mobile, address और payment details हो सकते हैं। System prompt में “निजी डेटा अनावश्यक रूप से न दोहराएं” लिखना data minimization का विकल्प नहीं है—PII पहले ही provider को भेजा जा चुका होता है।
- PR #2 को अभी merge नहीं करना है। AI Chat को port करने से पहले snapshot को aggregate/minimize करना, customer identifiers हटाना और जरूरत पड़ने पर user-confirmed per-query context भेजना आवश्यक है।


## Successful CI verification after fixes
- GitHub Actions run `45689900171` completed successfully on code head `ed3724a42e46687879d1820a46a255a393df0516`.
- Backend syntax check: PASS.
- Business + backend API test suite: **91/91 PASS**, 0 failures.
- Root/backend package JSON and PWA manifest JSON validation: PASS.
- The subsequent commit only adds this audit note; no application code changed after the passing run.
- Vercel preview remains blocked by the account's daily deployment API quota, so live browser/Firebase/Google OAuth/provider/device checks are still not claimed as passed.


## Final security-doc scan and latest CI
- Main की `backend/SETUP_CREDENTIALS_HI.md` में WhatsApp webhook verification token का वास्तविक मान मिला था। नई audit branch की guide से वह मान हटाकर placeholder रखा गया और Git history में पुराने मान के मौजूद होने की चेतावनी जोड़ी गई।
- Regression test अब सुनिश्चित करता है कि webhook token documentation lines में कोई 10+ digit secret न हो।
- Production webhook token को Hosting और Meta दोनों में rotate करना अभी user-side production action है; Git history में पुराने commit को केवल file edit से मिटाया नहीं जा सकता।
- Latest CI run `45690158490` on code head `9cbabf68a90f040d9cc41f5d2dfa7ba54d0226f5`: backend syntax PASS, **92/92 tests PASS**, package/manifest JSON validation PASS.


## Firebase credential rotation

पहले की बातचीत में Firebase service-account private key साझा हुई थी। Production से पहले उस पुरानी key को Google Cloud IAM में revoke/rotate करें और नई key केवल Hosting Environment Variables (`FIREBASE_SERVICE_ACCOUNT_JSON`) में रखें। इसे GitHub, frontend या ZIP में कभी commit न करें।


## Repository identity correction — critical
- This repository `inde2021-coder/tenthouse-` is linked in Vercel as `tenthouse-audit-preview`, not the production project.
- Vercel Git deployment context shows production project `tenthouse2026` linked to `inde2021-coder/tenthouse` (without the trailing hyphen).
- The connected GitHub installation currently exposes six repositories and does not expose `inde2021-coder/tenthouse`; direct GitHub API lookup for that repository returns 404 from this connection.
- Therefore this branch and PR #3 are audit-preview-only working material. **Do not merge PR #3 as a production change.** Port the reviewed fixes only after the production repository is made accessible and its branches are audited.
- Production Vercel metadata currently points to `main` commit `91754c406d151c0ed3fb61e2cb31c8a0317873a6`; the latest observed production build succeeded. Build warnings include an open-ended Node engine range (`>=20`) and an unrecognized npm `cache-dir` setting.


## Production Vercel metadata review (read-only)
- Team `inde3` currently lists only two Tent House projects: `tenthouse2026` and `tenthouse-audit-preview`.
- `tenthouse2026` domains returned by Vercel are `tenthouse2026.vercel.app`, `tenthouse2026-inde3.vercel.app`, and its main-branch alias; `tenthouse.vercel.app` is not listed on this project.
- Latest production deployment `dpl_FeLVVHBKuZzgqZ48PkwUih3azJvn` is READY and was built from `main` commit `91754c406d151c0ed3fb61e2cb31c8a0317873a6` (2026-10-28). Build completed successfully.
- The production project's visible environment-variable names (values not decrypted/read) are `FIREBASE_DATABASE_URL`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_PROJECT_ID`, `AI_API_KEY`, and `ADMIN_API_TOKEN`. No WhatsApp, OTP-HMAC, or `PUBLIC_ORIGIN` variable names appeared in the returned production list. The actual application requirements cannot be confirmed until the production repo is accessible.
- Production build warnings: open-ended Node engine `>=20` and unsupported npm `cache-dir` configuration. Latest production build itself succeeded.
- A 30-minute production runtime-log query returned no matching error/warning entries; this is not proof of zero runtime errors, especially on the Hobby retention tier.


## Verification refresh — 26 नवंबर 2026, 02:50 UTC

- PR #3 की वर्तमान head commit `e66a1ede7017bd27751b4a6da45156c1b65807e1` है; पुरानी रिपोर्ट में दिया गया PR head SHA अब ऐतिहासिक है।
- इसी head पर GitHub Actions run `45690822299` (run #611) सफल हुआ: backend syntax check, business regression tests, package/manifest JSON validation — सभी पास; PR विवरण में दर्ज test suite परिणाम 92/92 PASS है।
- PR #2 की वर्तमान head commit `e182d3b02398b4d249fb43f139a2ff30808ad3a6` पर push run `45744643609` (run #615) सफल हुआ। इसमें backend syntax, business regression suite और package/manifest JSON checks पास हुए।
- PR #2 में AI provider को भेजे जाने वाले business context को raw booking/stock/expense/vendor/payment records से बदलकर केवल aggregate record counts किया गया। Regression test इस बात की जाँच करता है कि customer identifiers और payment details AI request में serialize न हों।
- PR #2 अभी पुरानी audit branch को base करता है; PR #3 audit-preview repository का है। इनमें से कोई भी production deployment या production merge नहीं है।
- Repository rename/name change को audit, production repository access, credentials rotation और live acceptance checks पूरा होने तक स्थगित रखा गया है।


## नवीनतम verification refresh — 26 नवंबर 2026, 08:23 IST
- PR #3 वर्तमान head: `43ec8be8409b34589cbf4007b5f16cb78a178021`; PR अभी Draft और unmerged है।
- GitHub Actions run #617 (`45745058356`) इसी head पर सफल: dependency install, backend JS syntax, business regression tests, package/manifest JSON validation — सभी PASS।
- PR #2 वर्तमान head `e182d3b02398b4d249fb43f139a2ff30808ad3a6`; इसका run #615 सफल है।
- Production Vercel read-only recheck: latest deployment READY, commit `91754c406d151c0ed3fb61e2cb31c8a0317873a6`; production project `tenthouse2026` का source repository `inde2021-coder/tenthouse` है।
- Production repo GitHub connection से अभी भी 404 / unavailable है। Vercel deployment source-file tree भी उपलब्ध नहीं है; इसलिए deployed source की code-level समीक्षा इस access से संभव नहीं हुई।
- Production env inventory (values read नहीं किए): केवल `FIREBASE_DATABASE_URL`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_PROJECT_ID`, `AI_API_KEY`, `ADMIN_API_TOKEN` दिखे। WhatsApp/OTP-HMAC/`PUBLIC_ORIGIN` नाम नहीं दिखे; application requirements से मिलान production source access के बाद ही होगा।
- पिछले 30 मिनट के production runtime error/fatal log query में कोई matching entry नहीं मिली; इसे zero-error प्रमाण नहीं माना जाए।
- किसी PR को merge या production deploy नहीं किया गया। नाम बदलने का काम स्थगित है।


## Branch audit snapshot (26 नवंबर 2026)

मुख्य शाखा का निरीक्षित commit: `31a636dca7f60d95658949c998e4104df65e4ca8`। इस snapshot में GitHub की सभी उपलब्ध शाखाओं की तुलना `main` से की गई:

- `audit/final-hardening-2026-11`: `main` से 28 commits आगे, पीछे 0; नवीनतम उपलब्ध CI run #619 सफल।
- `audit/otp-delivery-order-2026-11`: `main` से 14 commits आगे, पीछे 0; PR #4 खुला है और CI run #662 सफल (90/90 tests)। इसमें OTP delivery ordering, per-phone concurrent-send lock, atomic single-use verification, पाँच गलत प्रयासों के बाद lockout, provider timeout और WhatsApp webhook verification/signature/deduplication tests शामिल हैं।
- `audit/tenthouse-ai-chat-2026-11`: `main` से 15 commits पीछे और history diverged; PR #2 अभी पुराने audit base पर है। इसे सीधे production में merge नहीं करना है; पहले सही base पर सुरक्षित rebase/review जरूरी है।
- `audit/deep-audit-fixes-2026-11`: `main` से 15 commits पीछे और history diverged; इसे production base नहीं मानना है।
- `render-preview-bartan`, `render-preview-isolated`, `render-preview-test`: तीनों शाखाएँ `main` से 15 commits पीछे और history diverged हैं। उपलब्ध पुराने CI परिणाम क्रमशः सफल, सफल और असफल (85/90 tests) हैं। इन preview branches को production में merge नहीं करना है; feature-by-feature पुनः समीक्षा जरूरी है।

## Merge और deployment रोक

- इस audit snapshot के दौरान किसी branch को `main` में merge नहीं किया गया।
- किसी Vercel deployment को trigger नहीं किया गया।
- `tenthouse-` और Vercel production project के Git source नाम में पहले से दर्ज अंतर अभी भी अंतिम production promotion से पहले resolve होना बाकी है।
- सभी अलग-अलग audit PRs को एक-दूसरे में स्वतः merge न करें; पहले base/history, file conflicts, CI और end-to-end dependencies की जाँच करें।


## AI गोपनीयता सुधार (26 नवंबर 2026)
- AI Assistant से भेजे जाने वाले raw booking, customer, stock, expense और vendor-payment records हटाए गए।
- अब provider को केवल aggregate record counts और last-cloud-sync timestamp भेजे जाते हैं; ग्राहक का नाम, मोबाइल, पता, UTR और payment rows नहीं भेजे जाते।
- तीनों served HTML shells में एक जैसा privacy boundary लागू किया गया।
- Regression test जोड़ा गया है जो सभी पाँच local data stores के aggregate count की जाँच करता है और raw snapshot serialization को अस्वीकार करता है।
- यह बदलाव अभी `audit/final-hardening-2026-11` PR #3 पर है; production में merge/deploy नहीं किया गया।


## नवीनतम OTP सुरक्षा सत्यापन (26 नवंबर 2026)
- OTP सत्यापन अब Firebase RTDB transaction के माध्यम से एक बार ही सफल होता है; गलत प्रयास transactionally गिने जाते हैं और पाँच गलत प्रयासों के बाद OTP lock हो जाता है।
- सफल OTP को उसी atomic transaction में consume किया जाता है, जिससे parallel requests में duplicate success नहीं मिलता।
- WhatsApp webhook GET challenge, constant-time verification-token comparison, invalid signature rejection और duplicate message ID handling के automated tests पास हुए।
- GitHub Actions run #662 सफल (90/90 tests); PR #4 अभी अलग खुला है और production `main` में merge नहीं हुआ है।

- OTP send concurrency test भी पास: एक ही मोबाइल के लिए समान समय पर दो send requests में एक ही request स्वीकार होती है; दूसरी को conflict मिलता है। Demo-provider delay केवल development test environment में enabled है।


## Merge एवं अंतिम CI स्थिति — 26 नवंबर 2026, 08:31 IST

यह section ऊपर के पुराने snapshot/status को supersede करता है:
- PR #4 (OTP delivery/verification hardening) सफलतापूर्वक `main` में merge हुआ: merge commit `e7633319bd0fadfe3a0d9749a714453ec833ed95`।
- PR #3 (admin gate, booking lookup rate-limit, AI aggregate-only privacy, UI shell sync और regression coverage) सफलतापूर्वक `main` में merge हुआ: merge commit `bd4fdf95ecde9d7ab9a9cc84169342da828b2753`।
- Merge के बाद combined CI में 97 में से 95 tests पास और 2 fail हुए। दोनों failures shared global API limiter के 60-request test budget से थे (HTTP 429), business validation failure नहीं।
- Test-only API budget override जोड़ा गया: backend default/production limit 60 ही रहता है; backend test harness में `API_RATE_LIMIT_MAX=500` रखा गया ताकि unrelated test cases एक-दूसरे का rate budget समाप्त न करें।
- इस सुधार के बाद GitHub Actions run `45749356603` सफल: **97/97 tests PASS, 0 FAIL**; backend syntax और package/manifest JSON validation भी PASS।
- कोई Vercel deployment नहीं किया गया। यह merge केवल `inde2021-coder/tenthouse-` repository की `main` शाखा में है; production Vercel project के source repo mismatch तथा live Firebase/WhatsApp/UPI/device/print checks अभी अलग से सत्यापित होने बाकी हैं।


## Dashboard Stock एवं Master Ledger सुधार — 26 नवंबर 2026, 09:09 IST

यह section इन modules के लिए पुराने audit snapshot को आगे बढ़ाता है:

### PR #5 — Dashboard Stock Shortage (merged)
- PR #5 merge commit: `252438eaadc09e73e2e0ae73d96ec549ada67780`।
- Dashboard shortage अब केवल `Pending Approval` और `Confirmed` bookings को future reservation मानता है। `Dispatched`, `Partially Returned`, `Returned`, `Rejected` और `Cancelled` को दोबारा reserve नहीं करता।
- Admin और vendor stock को अलग-अलग compare करता है; vendor की पहचान में party name भी शामिल है।
- Invalid/non-positive/fractional quantities shortage calculation में शामिल नहीं होतीं।
- तीनों HTML shells byte-identical हैं।
- Merge के बाद CI run `45749970327`: **100/100 tests PASS**।

### PR #6 — Pending UPI ledger (merged)
- PR #6 merge commit: `61847cab18193ebb38053d6503cee9a85db5c2d1`।
- Master Ledger में UPI amount तभी received column में आता है जब `onlineStatus=verified` हो।
- Pending UTR को pending label और ₹0 received दिखाता है; rejected को rejected और ₹0; पुराने records जिनकी verification state नहीं है उन्हें unknown label मिलता है।
- तीनों HTML shells byte-identical हैं।
- Merge के बाद CI run `45750189827`: **102/102 tests PASS**।

### वर्तमान मुख्य शाखा
- `main` head: `61847cab18193ebb38053d6503cee9a85db5c2d1`।
- PR #3, #4, #5 और #6 merged हैं।
- कोई Vercel deployment trigger नहीं किया गया।
- शेष वास्तविक device/provider verification: Firebase production sync/rules, WhatsApp delivery, UPI bank settlement, barcode camera on supported Android browser, PDF/print output on actual printers, and full booking→dispatch→partial/final return→missing recovery with persistent cloud data.
