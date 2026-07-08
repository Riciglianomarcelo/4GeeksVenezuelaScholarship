const express = require('express');
const { pool } = require('../db');

const router = express.Router();

const NEED_OPTIONS = ['beca', 'laptop', 'internet'];
const STATUS_OPTIONS = ['pending', 'approved', 'scholarship_awarded', 'equipment_given', 'rejected'];

// Express 4 no atrapa rechazos de promesas en handlers async — sin este
// wrapper, un error de base de datos (ej. Postgres caído) tumba TODO el
// proceso con un unhandled rejection. Con esto, el error queda contenido
// en la request y el resto del sitio sigue funcionando.
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// -------- Dashboard --------
router.get('/', wrap(async (req, res) => {
  const applicantsQ = pool.query('SELECT * FROM applicants ORDER BY created_at DESC LIMIT 100');
  const statsQ = pool.query('SELECT * FROM program_stats WHERE id = 1');
  const donationsQ = pool.query(
    `SELECT d.*, a.public_name FROM donations d
     LEFT JOIN applicants a ON a.id = d.applicant_id
     ORDER BY d.created_at DESC LIMIT 30`
  );
  const datesQ = pool.query('SELECT * FROM upcoming_dates ORDER BY sort_order ASC, id ASC');

  const [applicants, stats, donations, dates] = await Promise.all([
    applicantsQ, statsQ, donationsQ, datesQ
  ]);

  res.render('dashboard', {
    applicants: applicants.rows,
    stats: stats.rows[0],
    donations: donations.rows,
    dates: dates.rows
  });
}));

// -------- Postulantes --------
router.get('/applicants/new', (req, res) => {
  res.render('applicant-form', { applicant: {}, NEED_OPTIONS, STATUS_OPTIONS, isNew: true });
});

router.post('/applicants/new', wrap(async (req, res) => {
  await upsertApplicant(null, req.body);
  res.redirect('/admin');
}));

router.get('/applicants/:id/edit', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM applicants WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).send('Postulante no encontrado.');
  res.render('applicant-form', { applicant: rows[0], NEED_OPTIONS, STATUS_OPTIONS, isNew: false });
}));

router.post('/applicants/:id/edit', wrap(async (req, res) => {
  await upsertApplicant(req.params.id, req.body);
  res.redirect('/admin');
}));

router.post('/applicants/:id/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM applicants WHERE id = $1', [req.params.id]);
  res.redirect('/admin');
}));

async function upsertApplicant(id, body) {
  const needs = NEED_OPTIONS.filter((n) => body.needs && [].concat(body.needs).includes(n));
  const isPublic = body.is_public === 'on';
  const fields = [
    body.full_name || null,
    body.email || null,
    body.phone || null,
    body.location || null,
    body.age ? parseInt(body.age, 10) : null,
    body.public_name || 'Postulante',
    body.story || null,
    needs,
    isPublic,
    body.status || 'pending',
    body.private_notes || null
  ];

  if (id) {
    await pool.query(
      `UPDATE applicants SET
        full_name=$1, email=$2, phone=$3, location=$4, age=$5,
        public_name=$6, story=$7, needs=$8, is_public=$9, status=$10,
        private_notes=$11, updated_at=now()
       WHERE id=$12`,
      [...fields, id]
    );
  } else {
    await pool.query(
      `INSERT INTO applicants
        (full_name,email,phone,location,age,public_name,story,needs,is_public,status,private_notes,source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual')`,
      fields
    );
  }
}

// -------- Estadísticas del fondo --------
router.post('/stats', wrap(async (req, res) => {
  const breakdown = [];
  for (let i = 0; i < 4; i++) {
    const label = req.body[`bd_label_${i}`];
    const pct = req.body[`bd_pct_${i}`];
    if (label) breakdown.push({ label, pct: parseInt(pct, 10) || 0 });
  }

  await pool.query(
    `UPDATE program_stats SET
      fund_goal=$1, becas_otorgadas=$2, equipos_entregados=$3, empresas_aliadas=$4,
      breakdown=$5, updated_at=now()
     WHERE id = 1`,
    [
      parseFloat(req.body.fund_goal) || 0,
      parseInt(req.body.becas_otorgadas, 10) || 0,
      parseInt(req.body.equipos_entregados, 10) || 0,
      parseInt(req.body.empresas_aliadas, 10) || 0,
      JSON.stringify(breakdown)
    ]
  );
  res.redirect('/admin');
}));

// -------- Donaciones manuales (Zelle, efectivo, etc.) --------
router.post('/donations/manual', wrap(async (req, res) => {
  await pool.query(
    `INSERT INTO donations (applicant_id, donor_name, donor_note, amount, method)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      req.body.applicant_id || null,
      req.body.donor_name || null,
      req.body.donor_note || null,
      parseFloat(req.body.amount) || 0,
      req.body.method || 'zelle'
    ]
  );
  res.redirect('/admin');
}));

router.post('/donations/:id/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM donations WHERE id = $1', [req.params.id]);
  res.redirect('/admin');
}));

// -------- Próximas fechas / cohortes --------
router.post('/dates/new', wrap(async (req, res) => {
  await pool.query(
    `INSERT INTO upcoming_dates (programa, modalidad, fecha, abierto, sort_order)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      req.body.programa,
      req.body.modalidad || null,
      req.body.fecha || 'Por confirmar',
      req.body.abierto === 'on',
      parseInt(req.body.sort_order, 10) || 0
    ]
  );
  res.redirect('/admin');
}));

router.post('/dates/:id/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM upcoming_dates WHERE id = $1', [req.params.id]);
  res.redirect('/admin');
}));

module.exports = router;
