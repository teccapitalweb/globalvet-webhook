const express = require('express');
const cors    = require('cors');
const admin   = require('firebase-admin');

const app  = express();
app.use(cors());
app.use(express.json());

// ─── Firebase Admin ──────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// ─── MercadoPago config ───────────────────────────────────────
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_BASE = 'https://api.mercadopago.com';

async function getMPPayment(id) {
  const res = await fetch(`${MP_BASE}/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
  });
  return res.json();
}

async function getMPSubscription(id) {
  const res = await fetch(`${MP_BASE}/preapproval/${id}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
  });
  return res.json();
}

// ─── Activar miembro en Firebase ─────────────────────────────
async function activarMiembro(email, plan, meses) {
  try {
    // Buscar usuario por email en Firebase Auth
    const userRecord = await admin.auth().getUserByEmail(email);
    const uid = userRecord.uid;

    // Calcular fecha de vencimiento
    const vence = new Date();
    vence.setMonth(vence.getMonth() + meses);

    await db.collection('usuarios').doc(uid).set({
      membresiaActiva: true,
      estado: 'activo',
      plan,
      planLabel: plan === 'anual' ? 'Plan Anual' : 'Plan Mensual',
      vencimiento: vence.toISOString(),
      ultimoPago: new Date().toISOString()
    }, { merge: true });

    console.log(`✅ Miembro activado: ${email} | Plan: ${plan} | Vence: ${vence.toDateString()}`);
    return true;
  } catch(e) {
    console.error(`❌ Error activando ${email}:`, e.message);
    return false;
  }
}

// ─── Crear preferencia de pago ────────────────────────────────
app.post('/crear-pago', async (req, res) => {
  const { email, nombre, plan } = req.body;
  if (!email || !plan) return res.status(400).json({ error: 'Faltan datos' });

  const esMensual = plan === 'mensual';
  const monto     = esMensual ? 199 : 1788;
  const titulo    = esMensual ? 'Club GlobalVet México — Plan Mensual' : 'Club GlobalVet México — Plan Anual';

  try {
    const body = {
      items: [{
        title: titulo,
        quantity: 1,
        unit_price: monto,
        currency_id: 'MXN'
      }],
      payer: { email, name: nombre || '' },
      back_urls: {
        success: 'https://www.globalvetmexico.com/pages/club-dashboard.html',
        failure: 'https://www.globalvetmexico.com/pages/club-registro.html?error=pago',
        pending: 'https://www.globalvetmexico.com/pages/club-registro.html?pendiente=1'
      },
      auto_return: 'approved',
      notification_url: `${process.env.RAILWAY_URL}/webhook`,
      external_reference: `${email}|${plan}`,
      metadata: { email, plan }
    };

    const response = await fetch(`${MP_BASE}/checkout/preferences`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.id) {
      res.json({ url: data.init_point, id: data.id });
    } else {
      console.error('MP error:', data);
      res.status(500).json({ error: 'Error creando preferencia', detail: data });
    }
  } catch(e) {
    console.error('Error crear-pago:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Webhook de MercadoPago ───────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Responder rápido a MP

  const { type, data } = req.body;
  console.log('📩 Webhook recibido:', type, data?.id);

  if (type === 'payment' && data?.id) {
    try {
      const pago = await getMPPayment(data.id);
      console.log('💳 Pago:', pago.status, pago.external_reference);

      if (pago.status === 'approved') {
        const [email, plan] = (pago.external_reference || '').split('|');
        const meses = plan === 'anual' ? 12 : 1;
        if (email) await activarMiembro(email, plan || 'mensual', meses);
      }
    } catch(e) {
      console.error('Error procesando webhook pago:', e);
    }
  }

  // Suscripciones recurrentes
  if (type === 'subscription_preapproval' && data?.id) {
    try {
      const sub = await getMPSubscription(data.id);
      console.log('🔄 Suscripción:', sub.status, sub.payer_email);
      if (sub.status === 'authorized') {
        await activarMiembro(sub.payer_email, 'mensual', 1);
      }
    } catch(e) {
      console.error('Error procesando webhook suscripción:', e);
    }
  }
});

// ─── Health check ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: '✅ GlobalVet Webhook activo', ts: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
