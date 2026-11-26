# Radhe Krishn Tent House Manager — सुरक्षित Credentials Setup (Hindi)

यह निर्देश केवल Audit Preview के लिए हैं। Production Vercel project या Meta Callback URL को अभी न बदलें।

## 1. Firebase Admin Service Account की नई key बनाएँ

पहले चैट में साझा हुई पुरानी Service Account private key को दोबारा इस्तेमाल न करें। Firebase Console में पुरानी key revoke/delete करके नई key बनाएँ।

1. https://console.firebase.google.com/ खोलें।
2. Project `radhe-krishna-online-booking` चुनें।
3. Project settings → Service accounts खोलें।
4. Firebase Admin SDK में Generate new private key चुनें।
5. डाउनलोड हुई JSON फाइल अपने फोन/कंप्यूटर पर सुरक्षित रखें। इसे चैट, GitHub, frontend या APK में न डालें।

## 2. Vercel Preview में Firebase key जोड़ें

1. Vercel → `tenthouse-audit-preview` project → Settings → Environment Variables खोलें।
2. नया variable बनाएँ:
   - Key: `FIREBASE_SERVICE_ACCOUNT_JSON`
   - Value: डाउनलोड की गई JSON फाइल का पूरा content
   - Target: Preview
   - Git Branch: `audit/deep-audit-fixes-2026-11`
3. पहले से मौजूद `FIREBASE_DATABASE_URL` को रहने दें। उसका मान Firebase Realtime Database URL होना चाहिए:
   `https://radhe-krishna-online-booking-default-rtdb.firebaseio.com`
4. Save करें। Secret को GitHub या ChatGPT में paste न करें।

## 2A. Backend Admin Token और OTP सुरक्षा

Preview में ये variables भी बनाना जरूरी है:

- `ADMIN_API_TOKEN` — कम-से-कम 32 अक्षरों का random secret। इसे Vercel में encrypted रखें।
- `OTP_HMAC_SECRET` — `ADMIN_API_TOKEN` से अलग कम-से-कम 32 अक्षरों का random secret।

Admin token को वेबसाइट में Settings → Backend / AI / OTP → “AI Access Token (ADMIN_API_TOKEN)” में भी दर्ज करें और Backend सेटिंग सेव करें। यह token उस मोबाइल के local storage में रहेगा; साझा मोबाइल पर सेव न करें।

`PUBLIC_ORIGIN` branch preview के लिए सेट किया गया है:
`https://tenthouse-audit-preview-git-audit-deep-audit-fixes-6872d4-inde3.vercel.app`
इसी स्थिर Preview लिंक से वेबसाइट खोलें, ताकि CORS origin मेल खाए।

वैकल्पिक तरीका: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, और `FIREBASE_PRIVATE_KEY` तीनों variables अलग-अलग दे सकते हैं। एक साथ JSON और split credentials देना आवश्यक नहीं है।

## 3. WhatsApp Cloud API के लिए बाकी secrets

इसी Preview target और इसी branch में ये दो encrypted variables जोड़ें:

- `WHATSAPP_ACCESS_TOKEN` — Meta WhatsApp Cloud API का valid access token
- `WHATSAPP_APP_SECRET` — Meta App Dashboard → App settings → Basic में App Secret

पहले से मौजूद variables:
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — Vercel/Render Environment Variables में नया random secret रखें; यही मान Meta Webhook configuration में डालें। इसे GitHub, README या frontend में कभी न लिखें।
- `WHATSAPP_PHONE_NUMBER_ID` — पहले से Preview में मौजूद है।

Meta App ID और WhatsApp Business Account ID जानकारी के लिए उपयोगी हैं, लेकिन वर्तमान webhook signature check और message-send code में इन दो secrets की जगह नहीं लेते।

## 3A. AI सहायक

यदि Preview में Shraddha AI चलाना है, तो Preview target में ये variables भी जोड़ें:

- `AI_PROVIDER=gemini`
- `AI_API_KEY` — अपनी Gemini API key
- `AI_MODEL=gemini-2.5-flash`
- `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta`

AI key केवल Vercel में रखें। Frontend/GitHub में न डालें।

## 4. Save के बाद जाँच

Environment Variables बदलने के बाद उसी Preview branch का नया deployment बनाएँ। फिर ये endpoints जाँचें:

- `/api/health` — API चल रही हो तो HTTP 200
- `/api/ready` — Firebase Admin जुड़ने पर HTTP 200 और `persistentDatabaseReady: true`
- `/api/webhook?hub.mode=subscribe&hub.verify_token=<configured-secret>&hub.challenge=TEST123` — response body `TEST123` (URL में वास्तविक secret कभी commit न करें)
- `/webhooks/whatsapp` — यही legacy route भी उपलब्ध है

Firebase credentials के बिना `/api/ready` का HTTP 503 देना जानबूझकर fail-safe व्यवहार है। इससे production-जैसे वातावरण में booking, OTP और payment data अस्थायी memory में save होने का जोखिम नहीं रहता।

## 5. सुरक्षा

- Service Account JSON, private key, Meta App Secret और Access Token किसी को चैट में न भेजें।
- Secrets केवल Vercel Environment Variables में रखें।
- Preview ठीक होने और पूरे परीक्षण पास होने से पहले Production में secrets copy न करें और Meta Callback URL न बदलें।


## Webhook secret rotation — आवश्यक सुरक्षा कदम

इस repository की पुरानी Git history में पहले इस्तेमाल किया गया webhook verification token मौजूद हो सकता है। केवल इस documentation को बदलने से Git history साफ नहीं होती। Production में नया random `WHATSAPP_WEBHOOK_VERIFY_TOKEN` Hosting Environment Variables में सेट करें, Meta App Dashboard के Webhooks configuration में वही नया मान डालें, फिर backend redeploy करके webhook verify करें। पुराने मान को दोबारा उपयोग न करें।


## 6. Firebase Realtime Database Rules — Admin UID allowlist

Repository root में `database.rules.json` fail-closed rules template दिया है। यह `tent_erp_data` को केवल signed-in और explicitly allowlisted Firebase Auth UID को read/write करने देता है। सामान्य authenticated Google account को अपने-आप ERP data access नहीं मिलता।

Firebase Console में लागू करने के चरण:
1. Firebase Console → Realtime Database → Rules खोलें।
2. Repository की `database.rules.json` सामग्री Rules editor में paste करके Publish करें।
3. Authentication → Users में अपने verified admin Google account का Firebase UID देखें।
4. Realtime Database → Data में root पर `erp_admins` object बनाएँ और उसके अंदर key को उस exact UID से match करें, value Boolean `true` रखें। उदाहरण: `erp_admins/ADMIN_FIREBASE_UID = true`।
5. दूसरे किसी account को UID allowlist में न जोड़ें। `erp_admins` को client-side app से लिखने की अनुमति न दें; rules में उसका read/write बंद है। Admin SDK/server-side Firebase credentials ही allowlist provision/update करें।

महत्वपूर्ण: यह repository में सुरक्षित template है, Production Firebase Console पर अपने-आप लागू नहीं हुआ है। UID allowlist provision किए बिना ये rules सभी browser clients के लिए cloud read/write deny करेंगे। Production में apply करने के बाद admin Google login, cloud read, cloud write और cross-device sync को वास्तविक account से जाँचना आवश्यक है।


## 7. Settings audit preview — वर्तमान branch configuration (26 नवंबर 2026)

नया Settings UI इस branch पर deploy है:

- Git branch: `audit/settings-page-polish-2026-11`
- Preview URL: `https://tenthouse-audit-preview-rd2naim99-inde3.vercel.app`
- इस branch के लिए `PUBLIC_ORIGIN` अलग से सेट है; Production origin/variables को न बदलें।

इस preview की live readiness जाँच में:
- `GET /api/health` → HTTP 200 (backend process चल रहा है)।
- `GET /api/ready` → HTTP 503, `persistentDatabaseReady=false`। इसका अर्थ है कि इस branch के deployment में Firebase Admin credentials पूरी नहीं हैं; अभी customer booking/payment writes को live-ready न मानें।

Vercel → `tenthouse-audit-preview` → Settings → Environment Variables में **Preview** target और branch `audit/settings-page-polish-2026-11` चुनकर नीचे के values जोड़ें/verify करें:

- `FIREBASE_DATABASE_URL` — `https://radhe-krishna-online-booking-default-rtdb.firebaseio.com`
- `FIREBASE_PROJECT_ID` — Firebase project ID
- `FIREBASE_CLIENT_EMAIL` — Firebase Admin service-account client email
- `FIREBASE_PRIVATE_KEY` — उसी service account की नई rotated private key; केवल encrypted environment variable में
- वैकल्पिक: उपरोक्त तीन split credential variables की जगह `FIREBASE_SERVICE_ACCOUNT_JSON` का पूरा नया service-account JSON रखें
- `ADMIN_API_TOKEN` — अलग random secret, कम-से-कम 32 characters
- `OTP_HMAC_SECRET` — ADMIN token से अलग random secret, कम-से-कम 32 characters
- `WHATSAPP_ACCESS_TOKEN` और `WHATSAPP_APP_SECRET` — Meta Cloud API credentials (यदि WhatsApp live test करना है)
- `WHATSAPP_PHONE_NUMBER_ID` और `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — उसी branch के Preview target में verify करें
- `AI_API_KEY` — केवल AI endpoint का live test आवश्यक हो तभी; इसे GitHub/frontend में कभी न रखें

Save के बाद इसी branch का नया Preview deployment बनाएँ और पहले `/api/ready` पर HTTP 200 तथा `persistentDatabaseReady=true` verify करें। उसके बाद ही admin-authenticated booking, payment, OTP और WhatsApp integration tests करें। Firebase Rules publish तथा `erp_admins/<verified-admin-uid>=true` allowlist provisioning अलग Firebase Console कार्रवाई है; backend Admin SDK credentials का होना browser-side rules publish होने का प्रमाण नहीं है।

**सुरक्षा:** इस guide में कोई वास्तविक private key, token या provider secret न डालें। पहले साझा की गई Firebase key को revoke/rotate करने की आवश्यकता बनी हुई है।
