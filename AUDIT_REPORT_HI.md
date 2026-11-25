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
- तीनों deployable HTML copies byte-for-byte synchronized हैं; branded SVG icon भी root/public/backend public copies में समान है।
- Automated CI: `node --check backend/src/server.js`, business regression suite, package/manifest JSON validation — सफल।
- `lia_reference.mov` repository के recursive Git tree में नहीं मिला; इसलिए उस वीडियो का visual review इस audit में संभव नहीं हुआ। इस काम में उपलब्ध customer portal structure और existing brand assets के अनुरूप design बनाया गया।
- Vercel preview deployment API ने free daily deployment quota (100/day) की सीमा बताई; इस कारण नवीनतम commit का नया live preview deployment नहीं बन सका। Production deployment को बिना preview/device verification के force नहीं किया गया।
