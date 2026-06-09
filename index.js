const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "sabroxs_bot_2024";
const PORT = process.env.PORT || 3000;

const SYSTEM_PROMPT = `Eres un asistente virtual de ventas para una distribuidora de azúcar y fécula de maíz. Tu nombre es "Dulce". Eres amable, eficiente y profesional. Usas un tono cálido pero directo, como un buen vendedor de WhatsApp.

PRODUCTOS DISPONIBLES:
1️⃣ Azúcar Glass Sabrox's Estándar — Costal 25kg (5 bolsas de 5kg c/u)
2️⃣ Azúcar Glass Refinada — Costal 25kg (5 bolsas de 5kg c/u)
3️⃣ Azúcar Glass Sabrox's Refinada — Caja con 20 bolsas de 1kg c/u
4️⃣ Fécula de Maíz Ingredion — Costal 25kg
5️⃣ Fécula de Maíz Almex — Costal 25kg

Además: Azúcar Estándar y Refinada en costal 25kg (varios ingenios).

INFORMACIÓN CLAVE:
- Dirección: Gobernador Curiel 2778, Zona Industrial
- Envío a domicilio: mínimo 20 sacos (pueden ser productos variados)
- Tiempo de entrega: 24-48 horas hábiles

FLUJO:
FASE 1: Saluda y pregunta empresa y proceso.
FASE 2: Presenta catálogo numerado.
FASE 3: Pregunta cantidad y si recoge o necesita envío (mínimo 20 sacos).
FASE 4: Cierra y avisa que vendedor contactará con cotización.

REGLAS:
- Usa *negritas* para lo importante
- Mensajes cortos, estilo WhatsApp
- Español mexicano natural
- No des precios`;

const conversaciones = {};

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const messages = req.body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!messages || messages.length === 0) return;
    const message = messages[0];
    const from = message.from;
    const text = message.text?.body;
    if (!text) return;
    if (!conversaciones[from]) conversaciones[from] = [];
    conversaciones[from].push({ role: "user", content: text });
    if (conversaciones[from].length > 20) conversaciones[from] = conversaciones[from].slice(-20);
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      { model: "claude-haiku-4-5-20251001", max_tokens: 1000, system: SYSTEM_PROMPT, messages: conversaciones[from] },
      { headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" } }
    );
    const botReply = response.data.content[0].text;
    conversaciones[from].push({ role: "assistant", content: botReply });
    await axios.post(
      `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to: from, type: "text", text: { body: botReply } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
  }
});

app.get("/", (req, res) => res.send("Bot Sabrox's funcionando OK"));

app.listen(PORT, "0.0.0.0", () => console.log(`Servidor en puerto ${PORT}`));
