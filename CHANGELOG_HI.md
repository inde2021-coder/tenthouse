# संशोधन रिपोर्ट — 21 अक्टूबर 2026

## इस संशोधित पैकेज में किए गए बदलाव
- सभी मुख्य वेब प्रतियों (`index.html`, `public/index.html`, Android WebView asset) को एक जैसा अपडेट किया गया।
- बटनों के लिए responsive आकार/spacing नियम, इनपुट/ड्रॉपडाउन की max-width, checkbox sizing और छोटे स्क्रीन के लिए single-column forms जोड़े गए।
- Admin menu के लिए toggle बटन और mobile पर tab चुनने के बाद menu collapse जोड़ा गया।
- डिजिटल घड़ी की तारीख को English locale (DD-MMM-YYYY) में बदला और clock रंगों को बेहतर contrast दिया।
- Print CSS में print area को अलग करने, टेबल और रंगों को print-friendly बनाने तथा barcode modal को print में visible करने के नियम जोड़े गए।
- बिल प्रिंटिंग के लिए invoice preview को printable area में ले जाने वाला helper जोड़ा गया।
- Settings में Terms & Conditions field जोड़ी और invoice/dispatch/return print output में इसे शामिल किया।
- Dispatch page पर single-rate checkbox जोड़ा: चुने जाने पर `singleRent`, अन्यथा `setRent` इस्तेमाल होता है।
- बिल में discount और other charges fields जोड़े; booking record पर इन adjustments को save करने और total rent में शामिल करने का logic जोड़ा।
- पेमेंट एंट्री में negative amounts, पुराने भुगतान के mismatch और outstanding से अधिक नए payment को reject करने वाली validation मजबूत की।
- Booking submit पर तारीख की validation जोड़ी: dispatch date आज/भविष्य की होनी चाहिए, return date dispatch date से पहले नहीं हो सकती, advance नकारात्मक नहीं हो सकता।
- Date-bound सेटिंग में गलत element ID (`portalDate`) को सही booking field (`portalEventDate`) से ठीक किया; पहले वाला mismatch तारीख प्रतिबंध को लागू होने से रोक सकता था।
- Rental days की गणना को local date parsing पर बदला ताकि timezone के कारण एक दिन का अंतर न आए और उलटी/अमान्य तारीखों पर NaN न बने।
- Backup restore में फ़ाइल आकार, ऐप पहचान, डेटा प्रकार और allowlisted keys की जाँच जोड़ी; arbitrary localStorage keys restore नहीं होंगे। Master Ledger backup/restore/reset allowlist से बाहर ही रखा गया है।
- Invoice preview में ग्राहक/इवेंट/आइटम के टेक्स्ट को HTML-escape किया ताकि ग्राहक द्वारा दिए गए टेक्स्ट को HTML markup की तरह render होने से रोका जा सके।
- Dispatch/return stamp को शीर्षक से हटाकर हस्ताक्षर/स्टाम्प क्षेत्र में दिखाने का प्रयास किया।

## जाँच
- Inline JavaScript पर `node --check` सफल (नए तारीख/backup बदलावों के बाद दोबारा जाँचा)।
- Backend `server.js` पर `node --check` सफल।
- यह syntax/static validation है; browser interaction, Firebase credentials/rules, real printer output, Android APK build और third-party API calls का end-to-end test नहीं है।

## अभी production-ready मानने से पहले बाकी काम
यह पैकेज पूर्णतः audited/production-certified ERP नहीं है। मूल परियोजना के कुछ हिस्सों के लिए वास्तविक provider credentials, Firebase rules, persistent database और device testing जरूरी हैं:
- Firebase multi-user security/rules तथा सभी modules का authoritative cloud sync/merge test।
- पूरे सिस्टम में सभी tables के edit/delete workflows; अभी हर table पर universal CRUD उपलब्ध होने की पुष्टि नहीं है।
- Booking reject/delete, purchase/inventory reconciliation, dispatch/return quantity ledger और master-ledger integrity की पूर्ण business audit।
- Invoice tax/GST fields, tax calculations, refund, installment/repayment ledger तथा vendor/customer profitability की पूर्ण accounting audit।
- Demo mode का पूर्ण isolation: वर्तमान patch में अलग demo database/profile लागू नहीं किया गया है। वास्तविक डेटा के साथ demo परीक्षण न करें।
- AI agent के लिए tool-calling/action execution, persistent memory, visual lens/camera, screen reading/writing, Android accessibility/task automation, drawing generation और calling provider पूर्ण रूप से implement/test नहीं हैं। केवल API key जोड़ना इन क्षमताओं को अपने-आप सक्षम नहीं करता।
- WhatsApp/SMS/call integration provider account, server environment secrets, template approval और delivery webhooks पर निर्भर है।
- A4/thermal printer, Hindi PDF font embedding, WhatsApp PDF/image sharing और stamp placement का physical device test बाकी है।
- Google login के लिए Firebase authorized domains, Google provider configuration और वास्तविक deployed domain पर test जरूरी है।

**सुरक्षा:** पहले Firebase/database का अलग backup लें। इस ZIP को पहले staging/test deployment पर जाँचें; production data पर reset या demo testing न करें।

## अतिरिक्त UI / टेबल सुधार (21 अक्टूबर 2026)
- Settings में Hosting QR, Payment/OTP/Backend और Backup/Data Safety को अलग-अलग collapsible sections में रखा।
- पूरे पेज को enable/disable करने वाला “पेज दिखाएँ/छिपाएँ” सेटिंग सेक्शन हटाया; backup/restore में भी pageVisibility को शामिल नहीं किया।
- Dispatch booking search को Dispatch सेक्शन के सबसे ऊपर रखा और मोबाइल पर बेहतर responsive layout दिया।
- Buttons, inputs, selects, textareas, table action buttons के लिए एक समान sizing/spacing की CSS normalization जोड़ी।
- Booking table में Confirm, Reject, Update और Delete actions जोड़े। Update अभी सुरक्षित सीमित prompt-based edit है (नाम, मोबाइल, dispatch/return dates), पूर्ण form-based editor नहीं।
- Stock table में Update/Delete actions जोड़े; purchase और income/expense tables में भी Update/Delete actions जोड़े। Purchase deletion/edit के समय stock quantity adjustment का basic logic जोड़ा; इसे real records पर validate करना बाकी है।
- Dispatch और Return slip में CODE128 barcode SVG generate करने की व्यवस्था जोड़ी। वास्तविक प्रिंटर और browser print output की जाँच अभी बाकी है।
- Syntax check सभी inline script blocks पर पास हुई। यह end-to-end/browser/Firebase/printing test का विकल्प नहीं है।
- अभी भी बाकी: सभी टेबल में पूर्ण CRUD, booking edit का dedicated form, GST/rounding और installment/advance accounting का end-to-end audit, medical-invoice जैसी अंतिम print fidelity, secret/admin login की वास्तविक flow जाँच, और Firebase cloud sync validation।

## AI Assistant / Voice fixes (2026-10-21)
- Replaced the old local-only AI stub (which replied with generic text and never called the AI service) with a real `/api/ai/chat` backend request.
- Added conversation context, visible loading/error states, Enter-to-send, and Hindi/English speech output via Web Speech or Android Text-to-Speech.
- Added clearer speech-recognition handling for unsupported browser, permission denied, no speech, unavailable microphone, and network failures.
- Added Android native Speech Recognizer bridge, runtime microphone permission request, and TextToSpeech support in `MainActivity.java`; added RECORD_AUDIO permission to manifest.
- Added backend AI configuration template and setup/security notes in README_HI.md.
- AI endpoint currently uses backend `ADMIN_API_TOKEN`; app token is stored in browser local storage. This is not ideal for public production use; implement Firebase-authenticated per-user backend authorization before exposing widely.
- Syntax checked all inline JavaScript blocks and backend JavaScript. Android APK build was not run because Gradle/Android SDK is not installed in this environment. Real microphone, provider, hosting/CORS and API responses still need device testing.
