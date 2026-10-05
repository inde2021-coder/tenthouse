export default function handler(req, res) {
  // 1. Meta Webhook Verification (GET Request)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
        console.log("WEBHOOK_VERIFIED");
        return res.status(200).send(challenge);
      } else {
        return res.status(403).json({ error: 'Verification failed: Token mismatch' });
      }
    }
    return res.status(400).json({ error: 'Missing parameters' });
  }

  // 2. Incoming WhatsApp Messages (POST Request)
  else if (req.method === 'POST') {
    const body = req.body;
    console.log('Incoming webhook:', JSON.stringify(body, null, 2));

    // WhatsApp से आने वाले मैसेज और बुकिंग डेटा को यहाँ प्रोसेस किया जाएगा
    if (body.object && body.entry) {
      body.entry.forEach(entry => {
        if (entry.changes) {
          entry.changes.forEach(change => {
            const value = change.value;
            if (value && value.messages && value.messages[0]) {
              const senderPhone = value.messages[0].from;
              const messageText = value.messages[0].text ? value.messages[0].text.body : '';
              console.log(`Received message from ${senderPhone}: ${messageText}`);
            }
          });
        }
      });
    }

    return res.status(200).send('EVENT_RECEIVED');
  }

  else {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
