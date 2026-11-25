# सुरक्षित Environment Setup — Radhe Krishn Bartan ERP

## जरूरी Runtime
- Node.js **22 या नया**।
- Backend root directory: `backend`
- Install: `npm install`
- Start: `npm start`
- Process check: `/health`
- Persistent database readiness: `/ready`

## Production Environment Variables
इन variables को केवल Render/Vercel के Environment Variables / Secret UI में रखें:

| Variable | उपयोग |
|---|---|
| `NODE_ENV` | Production में `production` |
| `PREVIEW_MODE` | Production में unset या `false` |
| `PUBLIC_ORIGIN` | Comma-separated allowed website origins; scheme सहित, trailing slash के बिना |
| `FIREBASE_DATABASE_URL` | Firebase Realtime Database URL |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service account का पूरा JSON, एक environment value में |
| `FIREBASE_PROJECT_ID` | वैकल्पिक split credential |
| `FIREBASE_CLIENT_EMAIL` | वैकल्पिक split credential |
| `FIREBASE_PRIVATE_KEY` | वैकल्पिक split credential; newline को `\\n` रखें |
| `ADMIN_API_TOKEN` | कम-से-कम 32 अक्षरों का अलग random admin secret |
| `OTP_HMAC_SECRET` | कम-से-कम 32 अक्षरों का अलग random HMAC secret |
| `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp Cloud API token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA ID |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Meta webhook verification token; Meta dashboard से exact match |
| `META_APP_SECRET` | Webhook signature validation |
| `AI_API_KEY` | वैकल्पिक AI provider key |
| `AI_BASE_URL` | वैकल्पिक AI provider base URL |
| `AI_MODEL` | वैकल्पिक AI model name |

Firebase credentials के लिए `FIREBASE_SERVICE_ACCOUNT_JSON` **या** तीनों split fields में से एक तरीका चुनें। दोनों तरीकों के private credentials कभी GitHub, frontend HTML, screenshots, logs या chat में paste न करें।

## Isolated Render Preview
Preview service के लिए ही:
- `NODE_ENV=development`
- `PREVIEW_MODE=true`
- `PUBLIC_ORIGIN=https://tenthouse-feature-preview-kvt3.onrender.com`

यह mode in-memory demo data उपयोग करता है। Preview में की गई booking/stock/payment entries persistent production records नहीं हैं। Production Firebase या live customer data preview mode में न डालें।

## Production चालू करने से पहले
1. Render/Vercel में production secrets configure करें; `.env.example` के खाली fields को Git में भरकर commit न करें।
2. Firebase Admin credentials और database URL set करें।
3. `ADMIN_API_TOKEN` और `OTP_HMAC_SECRET` अलग-अलग strong random values रखें।
4. `PUBLIC_ORIGIN` में सिर्फ trusted origins रखें।
5. `/ready` healthy और Firebase persistence उपलब्ध होने की पुष्टि करें।
6. Meta webhook verify token और app secret को Meta dashboard से मिलाएँ।
7. UPI QR/UTR को payment proof समझें; bank/gateway confirmation के बिना payment को auto-settled न मानें।

## Credential Rotation
यदि कोई Firebase private key, Meta token, webhook verify token, admin token या OTP secret कभी chat, Git commit या public log में आ चुका हो, तो केवल file हटाना पर्याप्त नहीं है। संबंधित provider में पुराना credential revoke/rotate करें और नया value केवल hosting provider के secret settings में रखें। Git history में पुरानी commit मौजूद रह सकती है।
