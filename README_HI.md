# राधा कृष्णा टेंट हाउस ERP — Advanced project package

यह पैकेज पुराने HTML ERP का विस्तारित प्रोजेक्ट ढाँचा है: `index.html`, PWA shell, Express backend API; वर्तमान Git tree में Android WebView APK source मौजूद नहीं है। यह production-ready/fully verified ERP या compiled APK नहीं है; hosting credentials, Firebase rules, provider accounts, database, business testing और Android build अभी आवश्यक हैं।

## Folder structure
- `index.html` — मुख्य HTML फाइल; hosting QR, digital clock/date, date bounds, payment split/UPI QR और UTR entry UI जोड़े गए हैं।
- `public/` — hosting में डालने योग्य web files (`index.html`, `sw.js`, `manifest.webmanifest`).
- `backend/` — Node.js/Express API: health, OTP send/verify, WhatsApp Cloud API, AI proxy, UTR entry and admin verification endpoints.
- Android APK source: वर्तमान Repository में `android-shell/` folder उपलब्ध नहीं है; इसलिए इस checkout से APK build नहीं हो सकता।

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
7. Backend अब Firebase Admin SDK के जरिए OTP, UTR/payment ledger, WhatsApp inbox और customer booking requests को Realtime Database में persist कर सकता है। इसके लिए `FIREBASE_SERVICE_ACCOUNT_JSON` और `FIREBASE_DATABASE_URL` दोनों server environment में सेट करना अनिवार्य है। Production में database configuration न होने पर ये data APIs 503 लौटाती हैं; वे चुपचाप memory में data नहीं खोतीं। Backups, restore drill, retention/cleanup और per-user authorization फिर भी जरूरी हैं।

## 3. API endpoints
- `GET /api/customer/stock` — ग्राहक पैनल के लिए केवल उपलब्ध Admin stock, मात्रा और किराया दरों का सुरक्षित public catalog।
- `GET /health`
- `POST /api/otp/send` body: `{ "phone": "+919876543210", "channel": "sms|whatsapp|both" }`
- `POST /api/otp/verify` body: `{ "phone": "+919876543210", "otp": "123456" }`
- `POST /api/customer/bookings` — ग्राहक बिना Admin Login के Booking Request भेज सकता है; backend database में `Pending Approval` बनती है।
  - चुने गए सामान का किराया server-side Firebase stock catalog से लिया जाता है; client के भेजे rentPrice पर भरोसा नहीं होता। Catalog unavailable या stock कम होने पर item booking fail closed होती है।
- `GET /api/customer/bookings` — `X-Admin-Token` से Admin नई ग्राहक बुकिंग देखता है।
- `PATCH /api/customer/bookings/:id/status` — Admin `Confirmed`, `Rejected` या `Cancelled` status सेट करता है।
- `POST /api/whatsapp/send` — `X-Admin-Token` आवश्यक; body `{ "to": "+919876543210", "message": "..." }`
- `GET /webhooks/whatsapp` और `POST /webhooks/whatsapp` — Meta Cloud API webhook verification और incoming messages receive करता है; `WHATSAPP_WEBHOOK_VERIFY_TOKEN` तथा `WHATSAPP_APP_SECRET` सेट करें।
- `GET /api/whatsapp/inbox` — `X-Admin-Token` के साथ आने वाले WhatsApp संदेश/बुकिंग अनुरोध देखें।
- `POST /api/whatsapp/inbox/:id/status` — अनुरोध को `pending-review`, `approved` या `rejected` सेट करें।
- `POST /api/ai/chat` — `X-Admin-Token` आवश्यक; body `{ "messages": [{"role":"user","content":"..."}] }`
- `POST /api/payments/record-utr` — UTR को pending verification के रूप में रिकॉर्ड करता है। UTR अपने-आप payment confirmation नहीं है।
- `GET /api/payments/pending` and `POST /api/payments/:id/verify` — admin token आवश्यक।

## 4. Android APK build — वर्तमान Repository स्थिति

वर्तमान Git tree में `android-shell/` directory, Gradle files, Android manifest या `MainActivity` source नहीं मिले। इसलिए इस branch से APK build करने का दावा नहीं किया जा सकता। यदि आपके पास पहले से बना Android Studio source/ZIP है, उसे Repository में वापस जोड़ना होगा; उसके बाद package ID, permissions, WebView URL, signing और device tests किए जा सकते हैं।

`version.json` में अभी APK URL placeholder है। इसे वास्तविक signed APK URL से बदले बिना in-app APK update काम नहीं करेगा।

## 5. APK अपडेट सिस्टम (नया)
- `public/version.json` को वेबसाइट की root directory पर deploy करें ताकि `https://आपका-domain/version.json` खुले। इसमें `versionCode`, `versionName`, `apkUrl`, `releaseNotes` हैं।
- `apkUrl` को उस HTTPS URL से बदलें जहाँ नई signed APK रखी है, जैसे `https://आपका-domain/downloads/rk-tent-house-erp.apk`। APK फाइल भी उसी hosting/storage पर upload करें।
- Android source `MainActivity` launch पर `version.json` चेक करता है। यदि `versionCode` installed APK से बड़ा है, तो “Update Now” prompt आएगा, APK डाउनलोड होगी और Android का installer खुलेगा। Android सुरक्षा के कारण user को install की पुष्टि करनी होती है; बिना user consent APK को चुपचाप install नहीं किया जा सकता।
- हर native APK release के लिए `android-shell/app/build.gradle` में `versionCode` बढ़ाएँ और `versionName` बदलें, signed APK उसी keystore से build करें, APK को `apkUrl` पर upload करें, फिर `public/version.json` में वही नया `versionCode`/`versionName` डालकर deploy करें। पहले से जारी APK के signing key को सुरक्षित रखें; अलग key से बनी APK update के रूप में install नहीं होगी।
- केवल `index.html`/CSS/JS बदलने पर hosted WebView ऐप अगली बार ऑनलाइन होने पर नया web content दिखा सकता है; native APK update prompt केवल `version.json` में versionCode बढ़ाने पर आता है।
- प्रारंभिक `version.json` में versionCode `1` है, जो initial APK version 1.0.0 के साथ मेल खाता है। Release करने से पहले placeholder URL बदलें।

## 6. महत्वपूर्ण सुरक्षा/गुणवत्ता सीमाएँ

- Customer Booking Requests अब public backend endpoint से durable database में जाती हैं; Admin Login के बाद backend से नई bookings merge होती हैं। Backend URL default `https://tenthouse.vercel.app` है; यदि hosting बदलती है तो Settings में सही URL रखें।
- Admin का Google Login अभी Firebase client auth है। Shared Firebase business data का listener login के बाद ही जुड़ता है; guest users को सीधे पूरे ERP database का read/write access नहीं दिया गया है।
- Firebase Realtime Database security rules इस Repository में शामिल नहीं हैं। उन्हें अलग से configure और test करना होगा; Admin SDK backend rules bypass करता है और केवल server secret से चलता है।
- OCR अब Tesseract.js (English + Hindi) से text extract करता है; पहचान/मात्रा का अनुमान user को सेव करने से पहले सत्यापित करना है। पहली बार OCR चलाने पर CDN और language data डाउनलोड होंगे।
- Camera Barcode Scanner browser के native `BarcodeDetector` API पर निर्भर है। HTTPS, camera permission और समर्थित Android Chrome/browser जरूरी हैं; हर browser/device पर support की गारंटी नहीं।
- Dispatch/Return/Stock और invoice में कुछ प्रमुख logic सुधारा गया है, लेकिन सभी vendor accounting, tax/GST, refunds, thermal printer, physical print, Firebase merge conflicts और device flows अभी end-to-end प्रमाणित नहीं हैं।
- UPI QR केवल भुगतान अनुरोध बनाता है; यह पैसा आने की पुष्टि नहीं करता। UTR backend में pending verification रहता है; bank/provider settlement confirmation अभी अलग manual/provider प्रक्रिया है।
- `ADMIN_API_TOKEN` अभी shared-token scaffold है और browser localStorage में रखा जाता है। Public production launch से पहले Firebase ID token/JWT verification, per-user roles, audit logs और least-privilege access लागू करें।
- PWA manifest में SVG brand icon मौजूद है; native Android launcher PNGs और APK source इस Repository में मौजूद नहीं हैं।

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
- Inbox अब Firebase Realtime Database में persist होता है, बशर्ते Firebase Admin credentials configured हों। Production में credentials न होने पर webhook 503 लौटाता है ताकि Meta retry कर सके। Webhook request की Meta signature verify की जाती है; app secret server `.env` में ही रखें।


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

## API/OTP की जाँच (नया)
- `GET /api/diagnostics/providers` — `X-Admin-Token: <ADMIN_API_TOKEN>` के साथ provider readiness का सुरक्षित सारांश देता है; किसी secret की वास्तविक value नहीं लौटाता।
- Gemini के लिए `AI_PROVIDER=gemini`, `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta`, और अपने खाते में उपलब्ध `AI_MODEL` रखें। Gemini key केवल Vercel server environment में रखें।
- SMS OTP के लिए `OTP_PROVIDER=twilio` और `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`; या `OTP_PROVIDER=msg91` और `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` configure करें। MSG91 पर approved OTP template जरूरी है।
- `OTP_HMAC_SECRET` अलग random secret, कम-से-कम 32 अक्षर होना चाहिए। सही secret के बिना OTP endpoint fail-closed रहता है।
- WhatsApp message send के लिए `WHATSAPP_ACCESS_TOKEN` और `WHATSAPP_PHONE_NUMBER_ID`; webhook के लिए इनके अलावा `WHATSAPP_WEBHOOK_VERIFY_TOKEN` और `WHATSAPP_APP_SECRET` भी जरूरी हैं। WhatsApp business messaging policy/template/opt-in नियम लागू रहते हैं।
- `channel=both` में अब endpoint प्रत्येक चैनल की सफलता/विफलता लौटाता है और कम-से-कम एक चैनल सफल होने पर ही OTP verify-store करता है।
- OTP records और WhatsApp inbox अभी process memory में हैं; server restart या multiple Vercel instances पर state साझा नहीं होती। Production में Redis/DB जोड़ना जरूरी है, वरना OTP verification intermittent हो सकता है।


## 9. Business Card, Quotation और Tax Invoice

- Business Card: दुकान का नाम, मालिक, संपर्क, पता, ईमेल, GSTIN और UPI विवरण संपादित, preview और print किए जा सकते हैं।
- Quotation: सामान, मात्रा, दर, discount, अन्य शुल्क और validity date के साथ सेव/प्रिंट।
- Tax Invoice: editable GST दर तथा CGST+SGST या IGST विभाजन; सेव करने से पहले Business Card में सही 15-अक्षर GSTIN आवश्यक है।
- Print dialog में “Save as PDF” चुनकर PDF बनाई जा सकती है।
- वर्तमान Tax Invoice पूरे दस्तावेज़ पर एक GST दर लगाता है; HSN/SAC और प्रति-item अलग GST दर अभी business-specific configuration के लिए बाकी हैं।
