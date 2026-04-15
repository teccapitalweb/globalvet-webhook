const express = require('express');
const cors    = require('cors');
const admin   = require('firebase-admin');

const app  = express();
app.use(cors());
app.use(express.json());

// ─── Firebase Admin ──────────────────────────────────────────
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('FATAL: Falta variable FIREBASE_SERVICE_ACCOUNT');
  process.exit(1);
}
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch(e) {
  console.error('FATAL: FIREBASE_SERVICE_ACCOUNT no es JSON valido:', e.message);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const RAILWAY_URL     = process.env.RAILWAY_URL || '';
const MP_BASE         = 'https://api.mercadopago.com';

async function getMPPayment(id) {
  const res = await fetch(`${MP_BASE}/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
  });
  return res.json();
}

async function activarMiembro(email, plan, meses) {
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    const uid = userRecord.uid;
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
    console.log(`✅ Miembro activado: ${email} | Plan: ${plan}`);
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
  const titulo    = esMensual
    ? 'Club GlobalVet Mexico - Plan Mensual'
    : 'Club GlobalVet Mexico - Plan Anual';
  try {
    const body = {
      items: [{ title: titulo, quantity: 1, unit_price: monto, currency_id: 'MXN' }],
      payer: { email, name: nombre || '' },
      back_urls: {
        success: 'https://www.globalvetmexico.com/pages/club-dashboard.html',
        failure: 'https://www.globalvetmexico.com/pages/club-registro.html?error=pago',
        pending: 'https://www.globalvetmexico.com/pages/club-registro.html?pendiente=1'
      },
      auto_return: 'approved',
      notification_url: `${RAILWAY_URL}/webhook`,
      external_reference: `${email}|${plan}`,
      metadata: { email, plan }
    };
    const response = await fetch(`${MP_BASE}/checkout/preferences`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (data.id) {
      res.json({ url: data.init_point, id: data.id });
    } else {
      res.status(500).json({ error: 'Error creando preferencia', detail: data });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Webhook ──────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const { type, data } = req.body;
  console.log('Webhook:', type, data?.id);
  if (type === 'payment' && data?.id) {
    try {
      const pago = await getMPPayment(data.id);
      if (pago.status === 'approved') {
        const [email, plan] = (pago.external_reference || '').split('|');
        if (email) await activarMiembro(email, plan || 'mensual', plan === 'anual' ? 12 : 1);
      }
    } catch(e) { console.error('Error webhook:', e); }
  }
});

// ─── Health ───────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'GlobalVet Webhook activo', ts: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
