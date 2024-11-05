import express from "express";
import axios from "axios";
import 'dotenv/config';
import openAiService from "./openaiservice.js";

const app = express();
app.use(express.json());

const { WEBHOOK_VERIFY_TOKEN, API_TOKEN, BUSINESS_PHONE, API_VERSION, PORT } = process.env;

// Map para almacenar IDs de mensajes procesados
const processedMessages = new Map();
// Tiempo de expiración para los IDs de mensajes (en millisegundos)
const MESSAGE_EXPIRATION_TIME = 60 * 1000; // 1 minuto

function cleanupProcessedMessages() {
    const now = Date.now();
    for (const [messageId, timestamp] of processedMessages.entries()) {
        if (now - timestamp > MESSAGE_EXPIRATION_TIME) {
            processedMessages.delete(messageId);
        }
    }
}

// Ejecutar limpieza cada minuto
setInterval(cleanupProcessedMessages, 60 * 1000);

app.post("/webhook", async (req, res) => {
    console.log("Incoming webhook message:", JSON.stringify(req.body, null, 2));

    // Primero verificamos si es una notificación de estado
    if (req.body.entry?.[0]?.changes?.[0]?.value?.statuses) {
        console.log("Received status update - ignoring");
        return res.sendStatus(200);
    }

    const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];

    if (!message) {
        return res.sendStatus(200);
    }

    // Verificar si el mensaje ya fue procesado
    if (processedMessages.has(message.id)) {
        console.log(`Mensaje duplicado detectado: ${message.id}`);
        return res.sendStatus(200);
    }

    // Agregar el ID del mensaje al Map con timestamp
    processedMessages.set(message.id, Date.now());

    if (message?.type === "text") {
        try {
            // Llama a OpenAI para generar la respuesta
            const chatResponse = await openAiService(message.text.body);

            // Envía la respuesta de ChatGPT al usuario en WhatsApp
            await axios({
                method: "POST",
                url: `https://graph.facebook.com/${API_VERSION}/${BUSINESS_PHONE}/messages`,
                headers: {
                    Authorization: `Bearer ${API_TOKEN}`,
                },
                data: {
                    messaging_product: "whatsapp",
                    to: message.from,
                    text: { body: chatResponse },
                    context: {
                        message_id: message.id,
                    },
                },
            });
        } catch (error) {
            console.error("Error processing the message:", error);
        }
    }

    res.sendStatus(200);
});

// accepts GET requests at the /webhook endpoint
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
        res.status(200).send(challenge);
        console.log("Webhook verified successfully!");
    } else {
        res.sendStatus(403);
    }
});

app.get("/", (req, res) => {
    res.send(`<pre>Nothing to see here.
Checkout README.md to start.</pre>`);
});

app.listen(PORT, () => {
    console.log(`Server is listening on port: ${PORT}`);
});