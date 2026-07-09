const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { sendAlert } = require('../lib/notify');

const router = express.Router();

// Foto en memoria -> se guarda directo en Postgres (bytea). Límite de 5MB
// para no inflar la base con archivos gigantes.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// -----------------------------------------------------------------------
// POST /api/equipment-donations — alguien (empresa o persona) ofrece
// equipos (laptops, computadoras, etc.) para donar. Público, sin login.
// -----------------------------------------------------------------------
router.post('/equipment-donations', upload.single('photo'), async (req, res) => {
  try {
    const {
      donor_name, donor_email, donor_phone,
      item_type, model, quantity, condition_desc, estimated_value, description
    } = req.body;

    if (!donor_name && !donor_email) {
      return res.status(400).json({ error: 'Falta nombre o email de contacto.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO equipment_donations
        (donor_name, donor_email, donor_phone, item_type, model, quantity,
         condition_desc, estimated_value, description, photo, photo_mimetype)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        donor_name || null,
        donor_email || null,
        donor_phone || null,
        item_type || null,
        model || null,
        parseInt(quantity, 10) || 1,
        condition_desc || null,
        estimated_value ? parseFloat(estimated_value) : null,
        description || null,
        req.file ? req.file.buffer : null,
        req.file ? req.file.mimetype : null
      ]
    );

    sendAlert(
      'Nueva donación de equipos ofrecida',
      `${donor_name || 'Alguien'} (${donor_email || 'sin email'}) ofreció donar equipos.\n\n` +
      `Tipo: ${item_type || '—'}\nModelo: ${model || '—'}\nCantidad: ${quantity || 1}\n` +
      `Estado: ${condition_desc || '—'}\nValor aproximado: ${estimated_value ? '$' + estimated_value : '—'}\n\n` +
      `Detalles: ${description || '—'}\n\nRevisa el detalle y la foto en /admin/equipment.`
    );

    res.status(201).json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error('Error guardando donación de equipo:', err);
    res.status(500).json({ error: 'No se pudo registrar la donación de equipo.' });
  }
});

// Sirve la foto guardada en la base (pública — no contiene datos sensibles,
// solo la imagen del equipo).
router.get('/equipment-donations/:id/photo', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT photo, photo_mimetype FROM equipment_donations WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0] || !rows[0].photo) return res.status(404).send('Sin foto.');
    res.set('Content-Type', rows[0].photo_mimetype || 'image/jpeg');
    res.send(rows[0].photo);
  } catch (err) {
    console.error('Error sirviendo foto de equipo:', err);
    res.status(500).send('Error cargando la foto.');
  }
});

module.exports = router;
