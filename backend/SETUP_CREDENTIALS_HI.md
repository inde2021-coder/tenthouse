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

वैकल्पिक तरीका: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, और `FIREBASE_PRIVATE_KEY` तीनों variables अलग-अलग दे सकते हैं। एक साथ JSON और split credentials देना आवश्यक नहीं है।

## 3. WhatsApp Cloud API के लिए बाकी secrets

इसी Preview target और इसी branch में ये दो encrypted variables जोड़ें:

- `WHATSAPP_ACCESS_TOKEN` — Meta WhatsApp Cloud API का valid access token
- `WHATSAPP_APP_SECRET` — Meta App Dashboard → App settings → Basic में App Secret

पहले से मौजूद variables:
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — इसका मान `8120727987` है; इसे न बदलें।
- `WHATSAPP_PHONE_NUMBER_ID` — पहले से Preview में मौजूद है।

Meta App ID और WhatsApp Business Account ID जानकारी के लिए उपयोगी हैं, लेकिन वर्तमान webhook signature check और message-send code में इन दो secrets की जगह नहीं लेते।

## 4. Save के बाद जाँच

Environment Variables बदलने के बाद उसी Preview branch का नया deployment बनाएँ। फिर ये endpoints जाँचें:

- `/api/health` — API चल रही हो तो HTTP 200
- `/api/ready` — Firebase Admin जुड़ने पर HTTP 200 और `persistentDatabaseReady: true`
- `/api/webhook?hub.mode=subscribe&hub.verify_token=8120727987&hub.challenge=TEST123` — response body `TEST123`
- `/webhooks/whatsapp` — यही legacy route भी उपलब्ध है

Firebase credentials के बिना `/api/ready` का HTTP 503 देना जानबूझकर fail-safe व्यवहार है। इससे production-जैसे वातावरण में booking, OTP और payment data अस्थायी memory में save होने का जोखिम नहीं रहता।

## 5. सुरक्षा

- Service Account JSON, private key, Meta App Secret और Access Token किसी को चैट में न भेजें।
- Secrets केवल Vercel Environment Variables में रखें।
- Preview ठीक होने और पूरे परीक्षण पास होने से पहले Production में secrets copy न करें और Meta Callback URL न बदलें।
