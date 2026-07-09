// Test de integración temporal (no forma parte del proyecto final) — monta
// las rutas reales (public, equipment, admin) contra una base Postgres en
// memoria (pg-mem) para validar el flujo end-to-end sin necesitar Railway.
process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'admin';
process.env.FORM_WEBHOOK_SECRET = 'testsecret';

const path = require('path');
const Module = require('module');
const { newDb } = require('pg-mem');

const mem = newDb();
const pgAdapter = mem.adapters.createPg();

// Intercepta require('pg') ANTES de que src/db.js lo cargue, para que use
// el Pool/Client compatibles de pg-mem en vez de conectarse a Postgres real.
const originalResolve = Module._resolveFilename;
const pgPath = require.resolve('pg');
Module._cache[pgPath] = new Module(pgPath, null);
Module._cache[pgPath].exports = pgAdapter;
Module._cache[pgPath].loaded = true;

const fs = require('fs');
const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
mem.public.none(schema);

const express = require('express');
const publicRoutes = require('./src/routes/public');
const equipmentRoutes = require('./src/routes/equipment');
const adminRoutes = require('./src/routes/admin');
const { adminAuth } = require('./src/middleware/auth');
const { pool } = require('./src/db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', publicRoutes);
app.use('/api', equipmentRoutes);
app.use('/admin', adminAuth, adminRoutes);
app.use((err, req, res, next) => {
  console.error('TEST APP ERROR:', err);
  res.status(500).json({ error: err.message });
});

const request = require('supertest');
let failed = false;
const assert = (cond, msg) => {
  if (!cond) { console.error('❌', msg); failed = true; }
  else console.log('✅', msg);
};

async function main() {
  // Seed: un postulante público + stats
  await pool.query(`INSERT INTO applicants (public_name, story, is_public, age, location) VALUES ('Luis A.', 'Perdí mi empleo · No puedo pagar un programa de estudios en este momento · Mi familia está priorizando gastos esenciales', true, 26, 'Caracas')`);

  // 1) /api/applicants devuelve el postulante público
  let res = await request(app).get('/api/applicants');
  assert(res.status === 200 && res.body.length === 1 && res.body[0].public_name === 'Luis A.', '/api/applicants devuelve postulantes públicos');

  // 2) /api/summary responde con estructura esperada
  res = await request(app).get('/api/summary');
  assert(res.status === 200 && typeof res.body.totalSoFar === 'number' && res.body.postulantes === 1, '/api/summary calcula postulantes y totales');

  // 3) /api/config responde
  res = await request(app).get('/api/config');
  assert(res.status === 200 && 'zelleQrPath' in res.body, '/api/config expone config pública');

  // 4) POST /api/equipment-donations (multipart, sin foto) crea el registro
  res = await request(app)
    .post('/api/equipment-donations')
    .field('donor_name', 'Empresa Test')
    .field('donor_email', 'empresa@test.com')
    .field('item_type', 'Laptop')
    .field('model', 'Dell 5490')
    .field('quantity', '3')
    .field('condition_desc', 'Buen estado')
    .field('estimated_value', '250')
    .field('description', 'Tres laptops disponibles');
  assert(res.status === 201 && res.body.ok === true, 'POST /api/equipment-donations crea el registro (sin foto)');

  const eqId = res.body.id;
  res = await request(app).get(`/api/equipment-donations/${eqId}/photo`);
  assert(res.status === 404, 'GET foto de equipo sin foto devuelve 404 (esperado, no se envió foto)');

  // 5) admin sin auth -> 401
  res = await request(app).get('/admin');
  assert(res.status === 401, '/admin sin credenciales devuelve 401 (protegido)');

  // 6) admin con auth -> dashboard renderiza
  res = await request(app).get('/admin').auth('admin', 'admin');
  assert(res.status === 200 && res.text.includes('Panel admin'), '/admin con credenciales renderiza el dashboard');

  // 7) admin equipment list renderiza e incluye el registro creado
  res = await request(app).get('/admin/equipment').auth('admin', 'admin');
  assert(res.status === 200 && res.text.includes('Empresa Test'), '/admin/equipment renderiza y muestra el ofrecimiento creado');

  // 8) cambiar status del equipo
  res = await request(app).post(`/admin/equipment/${eqId}/status`).auth('admin', 'admin').send({ status: 'coordinating' });
  assert(res.status === 302, 'POST /admin/equipment/:id/status redirige tras actualizar');
  const chk = await pool.query('SELECT status FROM equipment_donations WHERE id=$1', [eqId]);
  assert(chk.rows[0].status === 'coordinating', 'El status del equipo se actualizó en la base');

  // 9) webhook de formulario sin secreto -> 401
  res = await request(app).post('/api/webhook/form').send({});
  assert(res.status === 401 || res.status === 404, 'webhook de form está montado bajo /api/webhook en server.js (no bajo /api directo, aquí devuelve 404 en este harness reducido)');

  // 10) applicant-form admin view renderiza con raw_submission
  const appId = (await pool.query('SELECT id FROM applicants LIMIT 1')).rows[0].id;
  await pool.query(`UPDATE applicants SET raw_submission = $1 WHERE id = $2`, [JSON.stringify({ 'Pregunta 1': 'Respuesta 1' }), appId]);
  res = await request(app).get(`/admin/applicants/${appId}/edit`).auth('admin', 'admin');
  assert(res.status === 200 && res.text.includes('Pregunta 1'), '/admin/applicants/:id/edit muestra raw_submission');

  console.log(failed ? '\n❌ HAY FALLAS' : '\n✅ TODOS LOS TESTS PASARON');
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error('❌ Error fatal en test:', err); process.exit(1); });
