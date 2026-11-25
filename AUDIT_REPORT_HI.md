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
