const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// Config pública — links y textos que se editan por variables de entorno,
// así no hace falta tocar código para actualizar el link de Stripe, del
// formulario, etc.
router.get('/config', (req, res) => {
  const typeformId = process.env.TYPEFORM_FORM_ID || '';
  res.json({
    stripeLink: process.env.STRIPE_PAYMENT_LINK_URL || '',
    applicationFormUrl: process.env.APPLICATION_FORM_URL ||
      (typeformId ? `https://form.typeform.com/to/${typeformId}` : ''),
    typeformId,
    contactEmail: process.env.CONTACT_EMAIL || 'latam@4geeksacademy.com',
    zelleQrPath: process.env.ZELLE_QR_PATH || '/images/zelle-qr.png'
  });
});

// Resumen público: fondo comprometido hasta ahora + lo recaudado por la
// comunidad + postulantes + personas ya beneficiadas + distribución del fondo.
// "fund_goal" se usa como "comprometido hasta ahora por 4Geeks", NO como techo:
// el total mostrado crece con cada donación de la comunidad.
router.get('/summary', async (req, res) => {
  try {
    const statsQ = pool.query('SELECT * FROM program_stats WHERE id = 1');
    const raisedQ = pool.query('SELECT COALESCE(SUM(amount),0) AS total FROM donations');
    const postulantesQ = pool.query('SELECT COUNT(*)::int AS total FROM applicants');
    const beneficiadosQ = pool.query(
      "SELECT COUNT(*)::int AS total FROM applicants WHERE status IN ('scholarship_awarded','equipment_given')"
    );

    const [stats, raised, postulantes, beneficiados] = await Promise.all([
      statsQ, raisedQ, postulantesQ, beneficiadosQ
    ]);

    const s = stats.rows[0] || {};
    const committedSoFar = Number(s.fund_goal || 0);
    const communityRaised = Number(raised.rows[0].total || 0);

    res.json({
      committedSoFar,
      communityRaised,
      totalSoFar: committedSoFar + communityRaised,
      becasOtorgadas: s.becas_otorgadas || 0,
      equiposEntregados: s.equipos_entregados || 0,
      empresasAliadas: s.empresas_aliadas || 0,
      postulantes: postulantes.rows[0].total,
      personasBeneficiadas: beneficiados.rows[0].total,
      breakdown: s.breakdown || []
    });
  } catch (err) {
    console.error('Error en /api/summary:', err);
    res.status(500).json({ error: 'No se pudo cargar el resumen.' });
  }
});

// Perfiles públicos — solo columnas no confidenciales, y solo is_public = true
router.get('/applicants', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, public_name, age, location, story, needs
       FROM applicants
       WHERE is_public = true
       ORDER BY created_at DESC
       LIMIT 24`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error en /api/applicants:', err);
    res.status(500).json({ error: 'No se pudo cargar la lista de postulantes.' });
  }
});

router.get('/dates', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT programa, modalidad, fecha, abierto FROM upcoming_dates ORDER BY sort_order ASC, id ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error en /api/dates:', err);
    res.status(500).json({ error: 'No se pudo cargar el calendario.' });
  }
});

module.exports = router;
