require('dotenv').config();
const express = require('express');
const path = require('path');

const { ensureSchema } = require('./db');
const { adminAuth } = require('./middleware/auth');
const publicRoutes = require('./routes/public');
const { stripeWebhookHandler, formRouter } = require('./routes/webhooks');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// El webhook de Stripe necesita el body crudo para verificar la firma,
// por eso se monta ANTES del parser JSON global y usa express.raw() en vez
// de express.json().
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', publicRoutes);
app.use('/api/webhook', formRouter); // expone /api/webhook/form
app.use('/admin', adminAuth, adminRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

// Manejador de errores global — cualquier error que llegue vía next(err)
// (rutas admin envueltas con wrap(), o cualquier otra) termina aquí en vez
// de tumbar el proceso. Sin esto, un error de base de datos en producción
// dejaría el sitio completo caído hasta el próximo restart.
app.use((err, req, res, next) => {
  console.error('Error no manejado en una ruta:', err);
  if (res.headersSent) return next(err);
  res.status(500).send(
    'Ocurrió un error procesando esta solicitud. Si esto persiste, revisa que ' +
    'DATABASE_URL esté bien configurada.'
  );
});

// Red de seguridad final: si algo se escapa igual (promesa sin catch en
// código fuera de las rutas), lo logueamos pero NO tumbamos el proceso.
// Preferible a que el sitio entero quede caído por un solo error transitorio.
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️  Uncaught Exception:', err);
});

async function start() {
  try {
    await ensureSchema();
  } catch (err) {
    console.error('❌ No se pudo verificar/crear el esquema de base de datos:', err.message);
    console.error('   El servidor sigue arrancando, pero las rutas que usan la base de datos fallarán hasta que DATABASE_URL esté correctamente configurada.');
  }
  app.listen(PORT, () => {
    console.log(`🚀 Fondo de Becas Venezuela corriendo en el puerto ${PORT}`);
  });
}

start();
