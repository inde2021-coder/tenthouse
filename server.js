const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(express.json());

// मेटा व्हाट्सएप क्रेडेंशियल्स एनवायरनमेंट वेरिएबल्स से लिए जाएंगे
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

// 1. Meta Webhook Setup - GET Request
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
            return res.status(200).send(challenge);
        } else {
            return res.sendStatus(403);
        }
    }
    return res.sendStatus(400);
});

// 2. Incoming WhatsApp Messages - POST Request
app.post('/webhook', (req, res) => {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
        body.entry.forEach(entry => {
            entry.changes.forEach(change => {
                const value = change.value;
                if (value && value.messages && value.messages[0]) {
                    const senderPhone = value.messages[0].from;
                    const messageText = value.messages[0].text ? value.messages[0].text.body : '';
                    console.log(`Incoming WhatsApp Message -> From: ${senderPhone}, Text: ${messageText}`);
                }
            });
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// 3. Automated WhatsApp Template Sender Function
async function sendWhatsAppTemplate(toMobile, templateName, languageCode, parameters) {
    try {
        const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
        const formattedParameters = parameters.map(param => ({
            type: "text",
            text: String(param)
        }));

        const data = {
            messaging_product: "whatsapp",
            to: toMobile,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: languageCode
                },
                components: [
                    {
                        type: "body",
                        parameters: formattedParameters
                    }
                ]
            }
        };

        const response = await axios.post(url, data, {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log("WhatsApp Message Sent Successfully:", response.data);
        return { success: true, data: response.data };
    } catch (error) {
        console.error("Error sending WhatsApp message:", error.response ? error.response.data : error.message);
        return { success: false, error: error.message };
    }
}

// API endpoint to trigger automated messages from frontend/ERP
app.post('/api/send-slip', async (req, res) => {
    const { mobile, templateName, lang, params } = req.body;
    const result = await sendWhatsAppTemplate(mobile, templateName, lang || 'hi', params || []);
    res.json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Tent House ERP Server is running on port ${PORT}`);
});
