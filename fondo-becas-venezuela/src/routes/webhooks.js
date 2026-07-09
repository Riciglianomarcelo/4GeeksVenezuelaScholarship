const express = require('express');
const Stripe = require('stripe');
const { pool } = require('../db');
const { sendAlert } = require('../lib/notify');

const formRouter = express.Router();

// ---------------------------------------------------------------------------
// STRIPE — registra automáticamente cada donación cuando se completa un pago
// en el Payment Link. Requiere STRIPE_WEBHOOK_SECRET (Stripe Dashboard ->
// Developers -> Webhooks -> Add endpoint -> URL: https://tu-app.up.railway.app/api/webhook/stripe
// -> evento: checkout.session.completed).
//
// IMPORTANTE: esta ruta se monta en server.js con express.raw(), NO con
// express.json(), porque Stripe necesita el body crudo para verificar la firma.
//
// Si en el Payment Link activas un "custom field" (Stripe Dashboard -> tu
// Payment Link -> Add custom field) preguntando "¿A quién deseas apoyar?",
// ese valor llega en session.custom_fields y lo guardamos como donor_note;
// el admin puede luego asociarlo manualmente a un postulante desde el panel.
//
// Cuando alguien hace click en "Apoyar a X" desde una historia, el sitio
// arma el link de Stripe agregando ?client_reference_id=applicant_ID. Stripe
// devuelve ese mismo valor en el webhook (session.client_reference_id), así
// que la donación queda vinculada AUTOMÁTICAMENTE a esa persona — sin
// depender de que el donante escriba bien el nombre en una nota.
// ---------------------------------------------------------------------------
// Handler standalone (no router) porque debe montarse en server.js ANTES
// del parser express.json() global, usando express.raw() solo en esta ruta.
async function stripeWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('⚠️  STRIPE_WEBHOOK_SECRET no configurado — se ignora el webhook.');
    return res.status(200).send('Webhook no configurado, ignorado.');
  }

  let event;
  try {
    const stripe = new Stripe('sk_dummy_not_used_for_verification_only', { apiVersion: '2024-06-20' });
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Firma de Stripe inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const amount = (session.amount_total || 0) / 100;
    const donorName = session.customer_details ? session.customer_details.name : null;
    let note = null;
    if (Array.isArray(session.custom_fields) && session.custom_fields.length > 0) {
      const f = session.custom_fields[0];
      note = f.text ? f.text.value : (f.dropdown ? f.dropdown.value : null);
    }

    // Resuelve el postulante vinculado (si el link llevaba
    // ?client_reference_id=applicant_ID) validando que ese id exista.
    let applicantId = null;
    let applicantName = null;
    const ref = session.client_reference_id || '';
    const m = ref.match(/^applicant_(\d+)$/);
    if (m) {
      try {
        const chk = await pool.query('SELECT id, public_name FROM applicants WHERE id = $1', [m[1]]);
        if (chk.rows[0]) {
          applicantId = chk.rows[0].id;
          applicantName = chk.rows[0].public_name;
        }
      } catch (err) {
        console.error('No se pudo validar el applicant_id del pago:', err.message);
      }
    }

    try {
      await pool.query(
        `INSERT INTO donations (applicant_id, donor_name, donor_note, amount, method, stripe_session_id)
         VALUES ($1, $2, $3, $4, 'stripe', $5)`,
        [applicantId, donorName, note, amount, session.id]
      );
      console.log(`✅ Donación Stripe registrada: $${amount}`);
      sendAlert(
        'Nueva donación por Stripe',
        `Monto: $${amount}\nDonante: ${donorName || 'anónimo'}\n` +
        `${applicantName ? `Apoya a: ${applicantName}` : 'Fondo general'}\n${note ? `Nota: ${note}` : ''}`
      );
    } catch (err) {
      console.error('Error guardando donación de Stripe:', err);
    }
  }

  res.json({ received: true });
}

// ---------------------------------------------------------------------------
// TYPEFORM / JOTFORM — recibe nuevas postulaciones y las crea como
// postulante PÚBLICO automáticamente (is_public = true, status = pending),
// para que la lista de historias crezca sola sin trabajo manual.
//
// Regla de seguridad clave: lo que se muestra en el campo público "story"
// se arma SOLO con respuestas de tipo opción múltiple / choice (categorías
// predefinidas del formulario, ej. "Vivienda con daños parciales"). Las
// respuestas de texto libre ('text', 'long_text') NUNCA entran al resumen
// público — quedan solo en private_notes / raw_submission, visibles nada
// más en /admin. El nombre público se reduce a "Nombre I." (nunca el
// apellido completo).
//
// El mapeo exacto de campos depende de tu formulario real. Este endpoint
// intenta detectar campos comunes por nombre/título; lo que no reconoce lo
// guarda íntegro en raw_submission para no perder información.
// Protegido con un secreto simple por query string: ?secret=FORM_WEBHOOK_SECRET
// ---------------------------------------------------------------------------
formRouter.post('/form', express.json({ limit: '2mb' }), async (req, res) => {
  const secret = req.query.secret;
  if (!process.env.FORM_WEBHOOK_SECRET || secret !== process.env.FORM_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Secreto inválido o no configurado.' });
  }

  const payload = req.body;

  try {
    const extracted = extractApplicantFields(payload);
    await pool.query(
      `INSERT INTO applicants
        (full_name, email, phone, location, age, public_name, story, needs,
         private_notes, raw_submission, source, is_public, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,'pending')`,
      [
        extracted.fullName,
        extracted.email,
        extracted.phone,
        extracted.location,
        extracted.age,
        extracted.publicName,
        extracted.publicStory,
        extracted.needs,
        extracted.privateNotes,
        JSON.stringify(payload),
        extracted.source
      ]
    );
    sendAlert(
      'Nueva postulación al Fondo de Becas',
      `Llegó una nueva postulación (${extracted.source}).\nNombre público: ${extracted.publicName}\n` +
      `Entra a /admin para ver el detalle completo y confidencial.`
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Error procesando webhook de formulario:', err);
    res.status(500).json({ error: 'No se pudo guardar la postulación.' });
  }
});

function extractApplicantFields(payload) {
  // Typeform: payload.form_response.answers[]
  // Jotform: payload es un objeto plano con claves tipo q3_email, q4_fullName, etc.
  // Best-effort: no rompas si el formato no calza exactamente — todo queda
  // respaldado en raw_submission para revisión manual desde el admin.
  let fullName = null, email = null, phone = null, location = null, age = null;
  let source = 'form';
  const safeCategoricalAnswers = []; // opción múltiple -> puede ser público
  const freeTextAnswers = [];        // texto libre -> nunca público

  if (payload && payload.form_response && Array.isArray(payload.form_response.answers)) {
    source = 'typeform';
    for (const a of payload.form_response.answers) {
      const title = (a.field && a.field.ref) || '';
      const type = a.type || (a.field && a.field.type) || '';
      const val = a.text || a.email || a.phone_number || a.number ||
        (a.choice && a.choice.label) ||
        (a.choices && a.choices.labels && a.choices.labels.join(', ')) || null;
      const t = title.toLowerCase();

      if (t.includes('name') || t.includes('nombre')) { fullName = val; continue; }
      if (t.includes('email') || t.includes('correo')) { email = val; continue; }
      if (t.includes('phone') || t.includes('telefono') || t.includes('teléfono')) { phone = val; continue; }
      if (t.includes('city') || t.includes('ciudad') || t.includes('location') || t.includes('ubicad')) { location = val; continue; }
      if (t.includes('age') || t.includes('edad')) { age = parseInt(val, 10) || null; continue; }

      // Cualquier otra respuesta: solo va al resumen público si es de tipo
      // opción múltiple (choice/choices/boolean) — nunca si es texto libre.
      if (!val) continue;
      if (type === 'choice' || type === 'choices' || type === 'boolean') {
        safeCategoricalAnswers.push(val);
      } else {
        freeTextAnswers.push(`${title || 'Respuesta'}: ${val}`);
      }
    }
  } else if (payload && typeof payload === 'object') {
    source = 'jotform';
    for (const [key, val] of Object.entries(payload)) {
      const k = key.toLowerCase();
      const v = typeof val === 'object' ? JSON.stringify(val) : val;
      if (k.includes('name') || k.includes('nombre')) fullName = fullName || v;
      else if (k.includes('email') || k.includes('correo')) email = email || v;
      else if (k.includes('phone') || k.includes('telefono')) phone = phone || v;
      else if (k.includes('city') || k.includes('ciudad')) location = location || v;
      else if (k.includes('age') || k.includes('edad')) age = age || (parseInt(v, 10) || null);
      // Jotform no distingue tipo en las claves planas del webhook — por
      // seguridad, todo lo demás se trata como texto libre (privado) y
      // requiere que el admin escriba el resumen público a mano.
      else if (v) freeTextAnswers.push(`${key}: ${v}`);
    }
  }

  const publicName = fullName ? `${fullName.split(' ')[0]} ${(fullName.split(' ')[1] || '').charAt(0)}.` : 'Postulante';
  const publicStory = safeCategoricalAnswers.length > 0
    ? safeCategoricalAnswers.join(' · ')
    : 'Postulante al Fondo de Becas.';

  return {
    fullName, email, phone, location, age,
    publicName,
    publicStory,
    privateNotes: freeTextAnswers.join('\n\n'),
    needs: ['beca'],
    source
  };
}

module.exports = { stripeWebhookHandler, formRouter };
