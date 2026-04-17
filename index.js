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

// ─────────────────────────────────────────────────────────────
// MODIFICADO: desconectado MercadoPago.
// Aquí vivían tres endpoints:
//   GET  /pagar        → creaba preferencia MP y redirigía a init_point
//   POST /crear-pago   → mismo flujo server-side
//   POST /webhook      → recibía notificación de MP y llamaba activarMiembro()
// También vivían las constantes MP_ACCESS_TOKEN, MP_BASE y RAILWAY_URL.
// Todo eliminado. La función activarMiembro() se conserva porque es genérica
// (solo toca Firestore) y será reutilizada por el nuevo procesador de pago.
// ─────────────────────────────────────────────────────────────

// ─── Activar miembro (genérico — reutilizable) ────────────────
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
