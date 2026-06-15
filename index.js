const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// ========== CONFIGURACIÓN ==========
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "sabroxs_bot_2024";
const PORT = process.env.PORT || 8080;

// Números de vendedoras
const VENDEDORAS = [
  { nombre: "Andrea", numero: "523311846788" },
  { nombre: "Stefani", numero: "523312861415" }
];

// ====================================

const SYSTEM_PROMPT = `Eres "Dulce", asistente virtual de ventas de Sabrox's, distribuidora de azúcar y fécula de maíz. Eres amable, eficiente y profesional. Usas un tono cálido pero directo, como un buen vendedor de WhatsApp.

PRODUCTOS DISPONIBLES:
- Azúcar Estándar y Refinada — costal 25kg (varios ingenios)
1️⃣ Azúcar Glass Sabrox's Estándar — costal 25kg (5 bolsas de 5kg c/u)
2️⃣ Azúcar Glass Refinada — costal 25kg (5 bolsas de 5kg c/u)
3️⃣ Azúcar Glass Sabrox's Refinada — caja con 20 bolsas de 1kg c/u
4️⃣ Fécula de Maíz Ingredion — costal 25kg
5️⃣ Fécula de Maíz Almex — costal 25kg

INFORMACIÓN CLAVE:
- Dirección: Gobernador Curiel 2778, Zona Industrial
- Envío a domicilio: mínimo 20 sacos (pueden ser productos variados)
- Tiempo de entrega: 24-48 horas hábiles

FLUJO DE CONVERSACIÓN — sigue estas fases en orden, de forma natural. No hagas todas las preguntas de golpe.

FASE 1 — SALUDO E IDENTIFICACIÓN:
Saluda cordialmente y pregunta (de a poco):
- Nombre de la empresa
- Tipo de negocio (panadería, restaurante, industria, etc.)
- Zona o cuadrante de la ciudad
- Para qué proceso necesitan el azúcar

FASE 2 — CALIFICACIÓN DEL LEAD:
Pregunta:
- Volumen estimado (sacos por semana o mes)
- Frecuencia de compra (semanal o mensual)
- Si ya son clientes o es primer contacto

Clasifica internamente (no lo menciones al cliente):
- ALTO: más de 50 sacos/semana o más de 200/mes
- MEDIO: 10-50 sacos/semana o 40-200/mes
- BAJO: menos de 10 sacos/semana o menos de 40/mes

FASE 3 — CATÁLOGO:
Presenta los productos disponibles de forma clara. NO des precios.
Pregunta si necesita azúcar refinada, estándar o glass.
Pregunta si recoge en Gobernador Curiel 2778 Zona Industrial o necesita envío (mínimo 20 sacos).

FASE 4 — CIERRE:
Di exactamente esto:
"¡Perfecto! He recibido todos tus datos. Una de nuestras vendedoras se pondrá en contacto contigo muy pronto con la cotización formal y los detalles de pago. ¡Gracias por contactarnos! 😊"

Luego genera el resumen en este formato exacto al FINAL de tu mensaje de cierre:
===LEAD===
EMPRESA: [nombre]
TIPO: [tipo de negocio]
ZONA: [zona]
PROCESO: [proceso]
VOLUMEN: [cantidad]
FRECUENCIA: [semanal/mensual]
CLIENTE: [nuevo/existente]
PRODUCTO: [producto de interés]
ENTREGA: [recoger/envío]
CLASIFICACION: [alto/medio/bajo]
===FIN===

PREGUNTAS FRECUENTES — responde sin necesitar vendedor:
- Mínimo para envío: 20 sacos
- Tiempo de entrega: 24-48 horas hábiles
- Presentaciones: las listadas arriba
- Dirección: Gobernador Curiel 2778, Zona Industrial

REGLAS:
- Usa *negritas* para lo importante
- Mensajes cortos, estilo WhatsApp
- Español mexicano natural y cordial
- No des precios nunca`;

// Historial de conversaciones
const conversaciones = {};
// Base de datos de clientes (en memoria)
const clientes = {};

// ========== WEBHOOK VERIFICACIÓN ==========
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

// ========== RECIBE MENSAJES ==========
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const messages = req.body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!messages || messages.length === 0) return;

    const message = messages[0];
    const from = message.from;
    const text = message.text?.body;
    if (!text) return;

    console.log(`Mensaje de ${from}: ${text}`);

    if (!conversaciones[from]) conversaciones[from] = [];
    conversaciones[from].push({ role: "user", content: text });
    if (conversaciones[from].length > 30) conversaciones[from] = conversaciones[from].slice(-30);

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: conversaciones[from]
      },
      {
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        }
      }
    );

    const rawReply = response.data.content[0].text;

    // Detecta si hay resumen de lead
    const leadMatch = rawReply.match(/===LEAD===([\s\S]*?)===FIN===/);
    const cleanReply = rawReply.replace(/===LEAD===[\s\S]*?===FIN===/g, "").trim();

    conversaciones[from].push({ role: "assistant", content: cleanReply });

    // Envía respuesta al cliente
    await sendWhatsApp(from, cleanReply);

    // Si hay lead, notifica a las vendedoras y guarda cliente
    if (leadMatch) {
      const leadData = leadMatch[1].trim();
      await notificarVendedoras(from, leadData);
      guardarCliente(from, leadData);
    }

  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
  }
});

// ========== ENVIAR MENSAJE DE WHATSAPP ==========
async function sendWhatsApp(to, message) {
  await axios.post(
    `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: message }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
  console.log(`Respuesta enviada a ${to}`);
}

// ========== NOTIFICAR A VENDEDORAS ==========
async function notificarVendedoras(clienteNumero, leadData) {
  const mensaje = `🔔 *NUEVO LEAD - Sabrox's*\n\n📋 *Datos del cliente:*\n${leadData}\n\n📱 *Número del cliente:* +${clienteNumero}\n\n⚡ Contáctalo para enviarle la cotización formal.`;

  for (const vendedora of VENDEDORAS) {
    try {
      await sendWhatsApp(vendedora.numero, mensaje);
      console.log(`Notificacion enviada a ${vendedora.nombre}`);
    } catch (error) {
      console.error(`❌ Error notificando a ${vendedora.nombre}:`, error.message);
    }
  }
}

// ========== GUARDAR CLIENTE ==========
function guardarCliente(numero, leadData) {
  const lines = leadData.split("\n");
  const data = {};
  lines.forEach(line => {
    const [key, ...val] = line.split(":");
    if (key && val) data[key.trim()] = val.join(":").trim();
  });

  clientes[numero] = {
    ...data,
    numero,
    fecha: new Date().toISOString(),
    ultimoContacto: new Date().toISOString()
  };
  console.log(`Cliente guardado: ${data.EMPRESA || numero}`);
}

// ========== REPORTE SEMANAL ==========
app.get("/reporte", (req, res) => {
  const total = Object.keys(clientes).length;
  const alto = Object.values(clientes).filter(c => c.CLASIFICACION === "alto").length;
  const medio = Object.values(clientes).filter(c => c.CLASIFICACION === "medio").length;
  const bajo = Object.values(clientes).filter(c => c.CLASIFICACION === "bajo").length;

  const productos = {};
  Object.values(clientes).forEach(c => {
    if (c.PRODUCTO) productos[c.PRODUCTO] = (productos[c.PRODUCTO] || 0) + 1;
  });
  const topProducto = Object.entries(productos).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";

  res.json({
    reporte: "Reporte Semanal Sabroxs",
    total_leads: total,
    alto_volumen: alto,
    medio_volumen: medio,
    bajo_volumen: bajo,
    producto_mas_consultado: topProducto,
    clientes: Object.values(clientes)
  });
});

// ========== LISTA DE CLIENTES ==========
app.get("/clientes", (req, res) => {
  res.json(Object.values(clientes));
});

app.get("/", (req, res) => res.send("Bot Sabroxs funcionando OK"));

app.listen(PORT, "0.0.0.0", () => console.log(`Servidor en puerto ${PORT}`));
