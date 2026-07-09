// -----------------------------------------------------------------------
// Alertas por email — avisa al equipo cuando pasa algo nuevo: donación,
// postulación o donación de equipos.
//
// Usa SMTP genérico (funciona con Gmail, SendGrid, Mailgun, etc. — lo que
// tengas a mano). Si no configuras las variables SMTP_*, esta función no
// hace nada (solo un warning en logs) — nunca rompe el flujo principal
// (el sitio sigue funcionando aunque el email falle).
//
// Variables de entorno necesarias:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, ALERT_EMAIL_TO
//
// Ejemplo rápido con Gmail:
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=465
//   SMTP_USER=tu-cuenta@gmail.com
//   SMTP_PASS=una-contraseña-de-aplicación (no la contraseña normal)
//   SMTP_FROM="Fondo de Becas 4Geeks <tu-cuenta@gmail.com>"
//   ALERT_EMAIL_TO=latam@4geeksacademy.com
// -----------------------------------------------------------------------

let transporter = null;
let triedInit = false;

function getTransporter() {
  if (triedInit) return transporter;
  triedInit = true;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('ℹ️  Alertas por email desactivadas (faltan variables SMTP_* en el entorno).');
    return null;
  }

  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT, 10) || 587,
      secure: (parseInt(SMTP_PORT, 10) || 587) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
  } catch (err) {
    console.error('No se pudo inicializar el transporte de email:', err.message);
    transporter = null;
  }
  return transporter;
}

// Nunca debe tumbar el flujo que la llama — por eso atrapa cualquier error
// internamente y solo loguea.
async function sendAlert(subject, text) {
  const to = process.env.ALERT_EMAIL_TO;
  if (!to) return;

  const t = getTransporter();
  if (!t) return;

  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `[Fondo de Becas VE] ${subject}`,
      text
    });
    console.log(`📧 Alerta enviada: ${subject}`);
  } catch (err) {
    console.error('⚠️  No se pudo enviar la alerta por email:', err.message);
  }
}

module.exports = { sendAlert };
