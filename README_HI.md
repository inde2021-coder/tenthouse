# राधा कृष्णा टेंट हाउस ERP — Advanced project package

यह पैकेज पुराने HTML ERP का विस्तारित प्रोजेक्ट ढाँचा है: `index.html`, PWA shell, Express backend API और Android WebView APK source। यह production-ready/fully verified ERP या compiled APK नहीं है; hosting credentials, Firebase rules, provider accounts, database, business testing और Android build अभी आवश्यक हैं।

## Folder structure
- `index.html` — मुख्य HTML फाइल; hosting QR, digital clock/date, date bounds, payment split/UPI QR और UTR entry UI जोड़े गए हैं।
- `public/` — hosting में डालने योग्य web files (`index.html`, `sw.js`, `manifest.webmanifest`).
- `backend/` — Node.js/Express API: health, OTP send/verify, WhatsApp Cloud API, AI proxy, UTR entry and admin verification endpoints.
- `android-shell/` — Android Studio Gradle project source; APK बनाने के लिए।

## 1. वेबसाइट host करना
1. `public/` की सभी फाइलें HTTPS static hosting (जैसे आपके चुने hosting provider) पर अपलोड करें। सिर्फ `index.html` नहीं; `sw.js` और `manifest.webmanifest` भी चाहिए।
2. Settings → Hosting URL में पूरा HTTPS URL डालें → QR बनाएं → Share/Print करें।
3. HTML बदलने पर hosted web app refresh/reopen करने पर नया HTML fetch होगा। Browser cache/service worker के कारण कभी-कभी hard refresh या cache version update करना पड़ सकता है। Native Android code अपने-आप update नहीं होगा।

## 2. Backend API चलाना
1. Node.js 20+ इंस्टॉल करें।
2. `backend/.env.example` को `backend/.env` नाम से copy करें और secrets भरें। `AI_API_KEY`, WhatsApp token, SMS provider secrets **सिर्फ server .env/secret manager में रखें**।
3. `backend/` में `npm install` फिर `npm start` चलाएँ। `GET /health` से जाँचें।
4. `PUBLIC_ORIGIN` में अपनी exact HTTPS frontend origin दें। Production में `NODE_ENV=production`, strong random `ADMIN_API_TOKEN`, unique `OTP_HMAC_SECRET`, HTTPS और provider credentials जरूरी हैं।
5. WhatsApp Cloud API के लिए Meta Business/WhatsApp app, verified phone-number ID, access token और messaging policies/templates की सेटअप जरूरत पड़ सकती है। Meta App Dashboard में Webhooks के `messages` field को subscribe करें और callback URL `https://आपका-backend-domain/webhooks/whatsapp` रखें। `.env` में `WHATSAPP_WEBHOOK_VERIFY_TOKEN` और Meta App Secret (`WHATSAPP_APP_SECRET`) सही भरें। सर्वर पर वैध HTTPS होना चाहिए।
6. OTP के लिए `OTP_PROVIDER=twilio` या `msg91` और सही credentials/approved templates भरें; WhatsApp OTP के लिए WhatsApp templates/provider rules का पालन करें। `demo` OTP केवल local development के लिए है, production में demo OTP नहीं लौटेगा।
7. वर्तमान sample API में OTP store और payment ledger memory में हैं, इसलिए restart पर खो जाते हैं और multi-instance hosting के लिए उपयुक्त नहीं। Production से पहले PostgreSQL/Firestore/Redis जैसे durable database, cleanup jobs, monitoring, backups और proper user/session authorization जोड़ना जरूरी है।

## 3. API endpoints
- `GET /health`
- `POST /api/otp/send` body: `{ "phone": "+919876543210", "channel": "sms|whatsapp|both" }`
- `POST /api/otp/verify` body: `{ "phone": "+919876543210", "otp": "123456" }`
- `POST /api/whatsapp/send` — `X-Admin-Token` आवश्यक; body `{ "to": "+919876543210", "message": "..." }`
- `GET /webhooks/whatsapp` और `POST /webhooks/whatsapp` — Meta Cloud API webhook verification और incoming messages receive करता है; `WHATSAPP_WEBHOOK_VERIFY_TOKEN` तथा `WHATSAPP_APP_SECRET` सेट करें।
- `GET /api/whatsapp/inbox` — `X-Admin-Token` के साथ आने वाले WhatsApp संदेश/बुकिंग अनुरोध देखें।
- `POST /api/whatsapp/inbox/:id/status` — अनुरोध को `pending-review`, `approved` या `rejected` सेट करें।
- `POST /api/ai/chat` — `X-Admin-Token` आवश्यक; body `{ "messages": [{"role":"user","content":"..."}] }`
- `POST /api/payments/record-utr` — UTR को pending verification के रूप में रिकॉर्ड करता है। UTR अपने-आप payment confirmation नहीं है।
- `GET /api/payments/pending` and `POST /api/payments/:id/verify` — admin token आवश्यक।

## 4. Android APK build
1. Android Studio और JDK/SDK इंस्टॉल करें।
2. `android-shell/app/build.gradle` में `HOSTED_APP_URL` को अपनी deployed HTTPS `index.html` URL से बदलें।
3. Android Studio में `android-shell/` खोलें, Gradle sync करें, फिर **Build → Build APK(s)** चुनें। APK आम तौर पर `android-shell/app/build/outputs/apk/debug/app-debug.apk` में बनेगा।
4. रिलीज़ के लिए signed release keystore बनाकर सुरक्षित रखें और Release APK/AAB build करें। इस source package में APK binary अभी compile नहीं की गई है।
5. यह shell hosted URL लोड करता है, इसलिए web content refresh/reopen पर update हो सकता है। APK की Kotlin/permissions/native code बदलने पर नया signed APK install/update करना पड़ेगा। URL placeholder रहने पर local asset fallback खुलेगा, पर offline data sync की पूर्ण व्यवस्था इससे अपने-आप नहीं बनती।

## 5. APK अपडेट सिस्टम (नया)
- `public/version.json` को वेबसाइट की root directory पर deploy करें ताकि `https://आपका-domain/version.json` खुले। इसमें `versionCode`, `versionName`, `apkUrl`, `releaseNotes` हैं।
- `apkUrl` को उस HTTPS URL से बदलें जहाँ नई signed APK रखी है, जैसे `https://आपका-domain/downloads/rk-tent-house-erp.apk`। APK फाइल भी उसी hosting/storage पर upload करें।
- Android source `MainActivity` launch पर `version.json` चेक करता है। यदि `versionCode` installed APK से बड़ा है, तो “Update Now” prompt आएगा, APK डाउनलोड होगी और Android का installer खुलेगा। Android सुरक्षा के कारण user को install की पुष्टि करनी होती है; बिना user consent APK को चुपचाप install नहीं किया जा सकता।
- हर native APK release के लिए `android-shell/app/build.gradle` में `versionCode` बढ़ाएँ और `versionName` बदलें, signed APK उसी keystore से build करें, APK को `apkUrl` पर upload करें, फिर `public/version.json` में वही नया `versionCode`/`versionName` डालकर deploy करें। पहले से जारी APK के signing key को सुरक्षित रखें; अलग key से बनी APK update के रूप में install नहीं होगी।
- केवल `index.html`/CSS/JS बदलने पर hosted WebView ऐप अगली बार ऑनलाइन होने पर नया web content दिखा सकता है; native APK update prompt केवल `version.json` में versionCode बढ़ाने पर आता है।
- प्रारंभिक `version.json` में versionCode `1` है, जो initial APK version 1.0.0 के साथ मेल खाता है। Release करने से पहले placeholder URL बदलें।

## 6. महत्वपूर्ण सुरक्षा/गुणवत्ता सीमाएँ
- HTML/localStorage को अकेले multi-device database न मानें। Admin/customer roles, Firebase Authentication, strict database rules और server-side authorization चाहिए।
- मौजूदा HTML के पुराने modules का पूरा runtime/business-logic audit अभी पूरा नहीं है। Inventory dispatch decrement/return reconciliation, customer OTP flow integration, full vendor accounting, camera/barcode scanner integration, true cloud sync/merge, invoice tax/GST fields, thermal printer-specific layouts, payment gateway webhooks/settlement verification और automated sharing अभी production-tested नहीं हैं।
- UPI QR केवल भुगतान अनुरोध बनाता है; यह payment gateway नहीं और पैसा आने की पुष्टि नहीं करता। UTR को provider/bank से verify करना जरूरी है।
- `ADMIN_API_TOKEN` प्रारंभिक scaffold auth है; end-user app में इसे hardcode न करें। Production में Firebase ID token/JWT verification, per-user roles and audit logs लगाएँ।
- `manifest.webmanifest` में icons placeholder खाली हैं; branded icons जोड़ना बाकी है।

## 7. Deploy से पहले checklist
- [ ] `.env` secrets set; `.env` कभी public repository में upload न करें।
- [ ] Firebase Authentication providers और Realtime Database/Firestore security rules validate करें।
- [ ] Production database + migrations + backups + restore drill।
- [ ] OTP delivery, expiry, attempt limits, duplicate booking prevention and rate limits test।
- [ ] Cash/online split, due, refund, vendor bill and payment settlement test।
- [ ] Dispatch stock decrement, return count, missing penalty and stock reconciliation test।
- [ ] A4 and thermal printers on real devices test; paper size/margins/signatures test।
- [ ] Android signing, permissions, offline launch and hosted update test।
- [ ] Customer privacy/consent and applicable tax/invoice rules review।


## 8. WhatsApp से आने वाली बुकिंग — महत्वपूर्ण सीमा
- Incoming WhatsApp संदेश अब webhook endpoint पर प्राप्त होकर API inbox में `pending-review` अनुरोध के रूप में रखे जाते हैं। Admin API token से `/api/whatsapp/inbox` देख सकते हैं और status बदल सकते हैं।
- यह scaffold संदेश के टेक्स्ट से अभी अपने-आप तारीख/सामान/मात्रा निकालकर final booking नहीं बनाता, न स्टॉक रिज़र्व करता है और न ग्राहक को automatic confirmation भेजता है। पहले वास्तविक database, booking parser/AI validation, date/stock/rate checks, duplicate protection और customer confirmation workflow जोड़ना होगा।
- Inbox अभी memory में है; server restart होने पर requests खो सकती हैं। Production से पहले durable database लगाएँ। Webhook request की Meta signature verify की जाती है; app secret server `.env` में ही रखें।


## AI Assistant / आवाज़ सेटअप (ज़रूरी)

AI असिस्टेंट के लिए केवल HTML या APK पर्याप्त नहीं है। असली AI उत्तर देने हेतु Backend चालू और AI provider key configured होना ज़रूरी है।

1. `backend/.env.example` को देखकर अपने Node hosting provider के Environment Variables में `PUBLIC_ORIGIN`, `ADMIN_API_TOKEN`, `AI_API_KEY`, `AI_MODEL` और `AI_BASE_URL` सेट करें। असली `.env` फ़ाइल GitHub में upload न करें।
2. `ADMIN_API_TOKEN` कम-से-कम 32 अक्षरों का random secret हो। वही token ऐप में Settings → भुगतान / OTP / Backend → AI Access Token में डालना पड़ता है। यह token ब्राउज़र के local storage में रहता है; साझा/पब्लिक डिवाइस पर इस्तेमाल न करें। बेहतर production setup में per-user Firebase-authenticated backend authorization लागू करें।
3. ऐप की Settings में Backend API URL में `https://` वाला backend base URL डालें, जैसे `https://api.example.com` (अंत में `/api` न जोड़ें)।
4. Backend के `/health` endpoint पर `ok: true` देखकर सर्वर चालू होने की पुष्टि करें। इसके बाद AI पेज पर टेक्स्ट सवाल भेजें।
5. वेब पर Voice Recognition आमतौर पर HTTPS और समर्थित ब्राउज़र मांगता है। APK में Android Speech Recognizer इस्तेमाल होता है; पहली बार Microphone अनुमति स्वीकार करें। जवाब Android Text-to-Speech से बोला जाएगा, यदि डिवाइस में भाषा/वॉइस उपलब्ध है।
6. Android APK के लिए `android-shell/app/build.gradle` में `HOSTED_APP_URL` को अपनी असली HTTPS साइट से बदलें। फिर Android Studio/Gradle से APK build करें। अभी कोई APK binary इस ZIP में शामिल नहीं है।

### सीमाएँ और सुरक्षा
- AI जवाब देना चालू किया गया है, लेकिन यह अपने-आप Firebase रिकॉर्ड बदलने, स्क्रीन को बिना अनुमति पढ़ने, दूसरे ऐप नियंत्रित करने, SMS भेजने या कॉल करने का दावा नहीं करता। इन कामों के लिए अलग-अलग सत्यापित tools, Android permissions और provider integration चाहिए।
- `ADMIN_API_TOKEN` को ब्राउज़र में रखना पूर्ण सुरक्षा नहीं है; यह ऐप के local storage में होता है। सार्वजनिक production उपयोग के लिए authenticated per-user backend authorization जोड़ना आवश्यक है।
- नेटवर्क, API billing/quota, CORS, microphone permission और Android speech service पर निर्भरता रहती है; किसी भी सिस्टम के लिए बिना वास्तविक डिवाइस/hosting पर परीक्षण के “शून्य गलती” की गारंटी नहीं दी जा सकती।


## संशोधित संस्करण — बिल/स्टॉक सुधार (2026-10-21)
- बिल प्रिंट के लिए A4 invoice template जोड़ा गया है; लंबा सामान नाम wrap होगा और टेबल fixed-layout में रहेगी ताकि बायाँ टेक्स्ट न कटे।
- Dispatch पर admin/third-party stock एक बार घटेगा; दोबारा dispatch रोकने के लिए booking marker जोड़ा गया है। अपर्याप्त/अनुपस्थित stock record पर dispatch रोका जाएगा।
- Return दोबारा process होने से रोका गया है; third-party stock में वापस आया सामान जोड़ा जाएगा। Missing item का charge स्वतः लागू नहीं होता और return slip पर पुष्टि आवश्यक दिखेगी।
- Advance/cash और installments को paid amount में शामिल करने की compatibility logic जोड़ी गई है। UPI advance को verified न होने पर paid नहीं माना जाएगा।
- यह संशोधन static checks से गुजरा है; production से पहले Firebase rules/data, real printer output, backend OTP/AI and Android build device-test जरूरी हैं। GST/tax calculation अपने-आप नहीं जोड़ी गई क्योंकि tax rate/registration data का सत्यापन आवश्यक है।


## AI Claude और WhatsApp Webhook अपडेट
- `AI_PROVIDER=openai` या `AI_PROVIDER=claude` चुनें; `AI_API_KEY` backend environment में ही रखें। Claude के लिए `AI_MODEL` को अपने खाते में उपलब्ध Claude model ID पर सेट करें।
- WhatsApp webhook setup के लिए `backend/WEBHOOK_SETUP_HI.md` पढ़ें। Endpoint `GET/POST /webhooks/whatsapp` है; अलग `webhook.js` जरूरी नहीं क्योंकि route `src/server.js` में है।
- PWA और Android launcher icon जोड़ा गया है (`icon.svg`, Android mipmap PNGs)।
- Android permissions/AI provider configuration जोड़ना अपने-आप screen reading, दूसरे ऐप नियंत्रण, SMS या कॉल को सक्षम नहीं करता; इनके लिए अलग Android services, explicit user grants, provider configuration और device testing जरूरी हैं। इस पैकेज में APK build/run परीक्षण का दावा नहीं है।
