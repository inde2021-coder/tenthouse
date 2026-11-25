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


## Deep branch audit और सुरक्षित सुधार (26 नवंबर 2026)
जाँची गई Git branches:
- `main`
- `audit/deep-audit-fixes-2026-11`
- `audit/tenthouse-ai-chat-2026-11`
- `render-preview-bartan`
- `render-preview-isolated`
- `render-preview-test`

Branch तुलना:
- `render-preview-isolated`, `audit/deep-audit-fixes-2026-11` से 41 commits आगे है और `audit/tenthouse-ai-chat-2026-11` से 32 commits आगे है; AI chat काम इसमें शामिल है।
- `render-preview-bartan` में isolated branch से अलग 3 commits हैं: bartan hero SVG/cache और customer lookup API का वैकल्पिक implementation। इन्हें बिना route/data compatibility जाँचे blind merge नहीं करना है।
- `render-preview-test` isolated branch से 22 commits पीछे है।
- `main` और audit/preview branches का इतिहास diverged है; इसलिए अभी direct merge सुरक्षित नहीं है।

इस branch में मिले UI defects:
- Shop-name click handler admin gate खोलने के बजाय स्पष्ट रूप से “व्यवस्थापक प्रवेश लॉक है” कहकर रोकता था।
- Mobile secret-entry listener पाँच taps माँगता था; shop-name triple-click handler gate से जुड़ा नहीं था।
- Customer form और lookup controls पर legacy light-theme CSS सफेद textbox force कर रही थी, जबकि बाकी shell dark था।
- Admin login UI backend 401/503/404 और network errors को एक ही generic संदेश में छिपा रही थी।

इस commit में किए गए सुधार:
- Shop-name trigger अब protected admin gate खोलता है; hidden brand entry तीन taps या 1.2-second long-press से खुलती है।
- Backend token/configuration, route और network failure के लिए अलग actionable error messages।
- Customer form, customer lookup, admin panel और dialogs के सभी text fields के लिए एक अंतिम dark recessed style; print styles सफेद paper पर ही रहती हैं।
- इन व्यवहारों के लिए regression tests और bartan preview branch के लिए CI trigger जोड़ा गया।

Production `main` और Vercel को इस branch audit/fix में नहीं बदला गया। Live Firebase/Google OAuth, SMS/WhatsApp provider, payment settlement और real-device visual tests को credentials/device access के बिना pass घोषित नहीं किया गया है।


## Customer booking tracker security fix
- Customer portal में tracker section का markup मौजूद नहीं था; केवल JavaScript functions थे। अब actual Booking Number + Registered Mobile fields और result area जोड़े गए हैं।
- पहले mobile-only search पर एक ही फोन की कई bookings लौट सकती थीं। अब backend exact booking ID को सीधे lookup करता है और उसी record के registered mobile से match करता है; एक request में अधिकतम एक booking लौटती है।
- Name-only और mobile-history search हटाए गए। यह customer privacy के लिए जानबूझकर stricter रखा गया है।
- Customer form textbox text-fill color भी dark field background के साथ readable किया गया।


## BARTAN brand/PWA correction
- Main branch का supplied hero/icon SVG decorated wedding tent और mandap दिखाता था, जो इस bartan-rental product identity से मेल नहीं खाता। Preview branch का customer hero utensil illustration ही रखा गया।
- App icon को stainless-steel plates, serving handi और utensils वाले navy/gold emblem से बदला।
- Root, public और backend/public में icon, manifest और service-worker shell synchronized; cache version v4 में icon precache।
- `/favicon.ico` को उसी SVG icon पर route किया, ताकि browser favicon request पर 404 न आए।


## Latest verified state — 26 नवंबर 2026
- Isolated branch CI: **103/103 tests pass**, 0 failures।
- CI `npm audit`: **0 vulnerabilities** after Firebase Admin 14.5.1 and Zod 4.6.7 upgrade.
- Node engine is `>=22`; Render build used Node 26.13.1.
- Render preview deployment `dep-dc3j3b4ipgvc738q28eg` is **live**; configured `/health` health check passed.
- Render preview environment is explicitly `NODE_ENV=development`, `PREVIEW_MODE=true`, and its own `PUBLIC_ORIGIN`; it uses demo/in-memory data only.
- Seven inline JavaScript blocks were syntax-parsed after the print-document string repair.
- Root, public and backend/public HTML copies remain synchronized.

## Remaining production gates (not falsely marked passed)
- Production Firebase Admin credentials and `/ready` on Vercel have not been independently verified; hosting secret values are not readable through this audit.
- Real Meta webhook delivery, WhatsApp outbound/inbound, OTP provider delivery, and UPI/bank settlement require provider credentials and live test events.
- Desktop/mobile visual and print-device checks still require a real browser/device session.
- The old main-branch setup guide contains a previously used webhook verification token in clear text. The integration copy replaces it with placeholders; rotate that token in Meta because deleting a file does not erase Git history.
- A Firebase service-account private key was previously exposed in chat; rotate/revoke it in Google Cloud before production use, then set the replacement only in hosting secrets.

Main remains untouched and is not merged yet. Branches will be integrated only after the remaining production gates are explicitly verified.
