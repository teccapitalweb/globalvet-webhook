# GlobalVet Club — Webhook Server

Servidor Node.js para activar membresías en Firebase.

> **Nota:** La integración con MercadoPago fue desconectada. La función `activarMiembro()`
> se conserva porque es genérica (solo escribe en Firestore) y será reutilizada cuando
> se conecte el nuevo procesador de pago.

## Variables de entorno requeridas en Railway:
- `FIREBASE_SERVICE_ACCOUNT` — JSON de cuenta de servicio de Firebase (base64)
- `PORT` — opcional, default 3000

## Endpoints activos:
- `GET /` — health check
