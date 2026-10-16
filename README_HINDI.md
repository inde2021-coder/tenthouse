# Radhe Krishn Tent House Manager — श्रद्धा Voice Agent

यह पैकेज मौजूदा HTML सॉफ्टवेयर और OpenAI Responses API आधारित सीमित voice-agent backend को साथ रखता है। UI में अलग चैट पैनल हटाकर केवल माइक बटन रखा गया है; status screen-reader-only है।

## इस build में शामिल
- ग्राहक पोर्टल, Admin/Vendor UI और मौजूदा HTML modules को आधार बनाकर अपडेटेड `index.html`
- हिंदी voice input (सपोर्टेड Android Chrome/HTTPS पर) और हिंदी में speech output
- Firebase ID token verification और server-side OpenAI key
- Read-only business-data queries (backend allowlist के अंतर्गत)
- Confirmation-gated writes: stock quantity adjustment, income/expense entry, booking status update, basic booking create, vendor record add
- `jarvisAudit` में समर्थित कार्रवाई का audit log

## स्पष्ट सीमाएँ — इसे पूर्ण production प्रमाणित न मानें
- इस build में dispatch/return workflow, bill/print, WhatsApp, payment gateway/UTR, OCR, barcode, vendor stock settlement, customer self-service और vendor-role permissions को श्रद्धा के backend tools से end-to-end integrate और live-test नहीं किया गया है। UI में माइक दिखना इन क्षमताओं के पूरा होने का प्रमाण नहीं है।
- Google/Firebase login, browser microphone, Firebase rules/schema, live API calls, print layouts और deployed Vercel environment का परीक्षण इस वातावरण में नहीं हुआ।
- शून्य बग की गारंटी नहीं दी जा सकती; नीचे दिए परीक्षण करें और पहले Firebase backup लें।

## Vercel environment variables
- `OPENAI_API_KEY` — OpenAI secret key
- `FIREBASE_SERVICE_ACCOUNT` — Firebase service-account JSON (single-line JSON string)
- `FIREBASE_DATABASE_URL` — `https://radhe-krishna-online-booking-default-rtdb.firebaseio.com`
- `JARVIS_ADMIN_EMAILS` — अधिकृत admin email(s), comma-separated
- `OPENAI_MODEL` — optional; default `gpt-4.1-mini`

Secrets को HTML या GitHub के public code में न रखें। `api/jarvis.js` अभी केवल admin-authorized Firebase token स्वीकार करता है; Customer/Vendor को इस API पर access नहीं मिलता।

## Deploy सावधानियाँ
1. GitHub branch का backup लें।
2. `index.html`, `api/jarvis.js`, `package.json` और `vercel.json` merge करें। Existing `api/send.js`, `api/health.js`, `api/webhook.js` और OTP routes को delete न करें।
3. Vercel environment variables जाँचें और redeploy करें।
4. पहले read-only सवाल टेस्ट करें। Write command से पहले Firebase backup लें।
5. `हाँ, पुष्टि` और `रद्द` दोनों voice commands टेस्ट करें।

## Local static checks
- Inline JavaScript syntax checks और `node --check api/jarvis.js` चलाएँ। ये syntax की जाँच हैं, live integration या zero-bug प्रमाण नहीं।
