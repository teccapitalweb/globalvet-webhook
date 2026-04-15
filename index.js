const express = require('express');
const cors    = require('cors');
const admin   = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Firebase Admin ──────────────────────────────────────────
let serviceAccount;
try {
  const raw = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8');
  serviceAccount = JSON.parse(raw);
} catch(e) {
  console.error('FATAL: FIREBASE_SERVICE_ACCOUNT invalido:', e.message);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const RAILWAY_URL     = process.env.RAILWAY_URL || 'https://web-production-09f0d.up.railway.app';
const MP_BASE         = 'https://api.mercadopago.com';

// ─── GET /pagar — redirige a MercadoPago (usado desde browser) ─
app.get('/pagar', async (req, res) => {
  const { email, nombre, plan } = req.query;
  if (!email || !plan) return res.status(400).send('Faltan datos');

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

    console.log('MP response:', JSON.stringify(data).substring(0, 200));

    if (data.init_point) {
      res.redirect(data.init_point);
    } else {
      console.error('MP error:', JSON.stringify(data));
      res.redirect('https://www.globalvetmexico.com/pages/club-registro.html?error=pago');
    }
  } catch(e) {
    console.error('Error /pagar:', e.message);
    res.redirect('https://www.globalvetmexico.com/pages/club-registro.html?error=pago');
  }
});

// ─── POST /crear-pago — para llamadas server-side ─────────────
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

// ─── Webhook MercadoPago ──────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const { type, data } = req.body;
  console.log('Webhook:', type, data?.id);
  if (type === 'payment' && data?.id) {
    try {
      const r = await fetch(`${MP_BASE}/v1/payments/${data.id}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
      });
      const pago = await r.json();
      if (pago.status === 'approved') {
        const [email, plan] = (pago.external_reference || '').split('|');
        if (email) await activarMiembro(email, plan || 'mensual', plan === 'anual' ? 12 : 1);
      }
    } catch(e) { console.error('Error webhook:', e); }
  }
});

async function activarMiembro(email, plan, meses) {
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    const vence = new Date();
    vence.setMonth(vence.getMonth() + meses);
    await db.collection('usuarios').doc(userRecord.uid).set({
      membresiaActiva: true,
      estado: 'activo',
      plan,
      planLabel: plan === 'anual' ? 'Plan Anual' : 'Plan Mensual',
      vencimiento: vence.toISOString(),
      ultimoPago: new Date().toISOString()
    }, { merge: true });
    console.log(`✅ Miembro activado: ${email} | Plan: ${plan}`);
  } catch(e) {
    console.error(`❌ Error activando ${email}:`, e.message);
  }
}

// ─── Health ───────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'GlobalVet Webhook activo', ts: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
