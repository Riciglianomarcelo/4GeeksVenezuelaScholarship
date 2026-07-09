#!/usr/bin/env node
/**
 * Importa un CSV exportado de Typeform (Results -> Summary -> Download -> CSV)
 * como postulantes en la base de datos.
 *
 * Uso:
 *   DATABASE_URL=postgres://... node scripts/import-typeform-csv.js ruta/al/archivo.csv
 *
 * Comportamiento:
 *  - TODOS los postulantes se crean PÚBLICOS (is_public = true) y en estado
 *    "pending", para que la lista de historias crezca sola sin trabajo manual.
 *  - Lo que se muestra públicamente (campo "story") se genera SOLO a partir
 *    de las respuestas de opción múltiple del formulario (ej. "Vivienda con
 *    daños parciales · Familia priorizando gastos esenciales") — NUNCA del
 *    texto libre que la persona escribió a mano, y NUNCA del nombre completo
 *    (se muestra "Nombre I.", ej. "Carla N.").
 *  - El nombre completo, email, teléfono, el texto libre completo y los
 *    links a documentos (comprobantes, cédulas, etc.) quedan SOLO en los
 *    campos confidenciales (full_name, email, phone, private_notes,
 *    raw_submission) — visibles únicamente en /admin, nunca en la API pública.
 *  - Si un caso puntual no debe aparecer en absoluto (ej. situación muy
 *    identificable, menor de edad, pedido explícito de no publicar), el
 *    equipo lo oculta manualmente desde /admin desmarcando "Mostrar
 *    públicamente".
 *
 * IMPORTANTE — privacidad:
 *  - Este script NO debe commitearse junto con un CSV real de postulantes.
 *  - El .gitignore del proyecto ya excluye *.csv por esta razón.
 *  - Corre esto directo contra tu base de producción (Railway) o una local,
 *    nunca subas el archivo CSV a un repositorio.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Uso: node scripts/import-typeform-csv.js ruta/al/archivo.csv');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. Ejemplo: DATABASE_URL=postgres://... node scripts/import-typeform-csv.js archivo.csv');
  process.exit(1);
}

// --- Parser de CSV minimalista pero correcto: respeta comillas, comas y
// saltos de línea dentro de campos (Typeform exporta así los textos largos). ---
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* ignorar */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += c; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

function findCol(headers, ...candidates) {
  const lower = headers.map(h => h.toLowerCase());
  for (const cand of candidates) {
    const idx = lower.findIndex(h => h.includes(cand.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

function extractAge(raw) {
  if (!raw) return null;
  const m = raw.match(/\d{1,3}/);
  return m ? parseInt(m[0], 10) : null;
}

function publicNameFrom(fullName) {
  if (!fullName) return 'Postulante';
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] || 'Postulante';
  const second = parts[1] ? `${parts[1].charAt(0)}.` : '';
  return second ? `${first} ${second}` : first;
}

async function main() {
  const raw = fs.readFileSync(path.resolve(csvPath), 'utf8');
  const rows = parseCSV(raw);
  const headers = rows[0];
  const dataRows = rows.slice(1);

  const col = {
    fullName: findCol(headers, 'nombre completo', 'full name', 'nombre'),
    email: findCol(headers, 'correo', 'email'),
    phone: findCol(headers, 'teléfono', 'telefono', 'phone'),
    location: findCol(headers, 'ubicado', 'ubicación', 'location', 'ciudad'),
    age: findCol(headers, 'edad', 'age'),
    affected: findCol(headers, 'afectad', 'terremoto'),
    other: findCol(headers, 'other'),
    economic: findCol(headers, 'situación económica', 'situacion economica'),
    reality: findCol(headers, 'refleja mejor tu realidad', 'realidad'),
    proof: findCol(headers, 'comprobante'),
    story: findCol(headers, 'cuéntanos', 'cuentanos', 'situación', 'situacion'),
    submitDate: findCol(headers, 'submit date'),
  };

  console.log(`📄 ${dataRows.length} respuestas encontradas en el CSV.`);
  console.log('Columnas detectadas:', JSON.stringify(col));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  let inserted = 0;
  let skipped = 0;

  for (const r of dataRows) {
    const fullName = (col.fullName !== -1 ? r[col.fullName] : '').trim();
    const email = (col.email !== -1 ? r[col.email] : '').trim();
    if (!fullName && !email) { skipped++; continue; }

    const phone = (col.phone !== -1 ? r[col.phone] : '').replace(/^'/, '').trim();
    const location = col.location !== -1 ? r[col.location] : null;
    const age = extractAge(col.age !== -1 ? r[col.age] : null);

    // --- Resumen público SEGURO: solo campos de opción múltiple (categorías
    // predefinidas del formulario), nunca el texto libre que la persona
    // escribió a mano. Esto es lo único que se expone en /api/applicants. ---
    const publicSummary = [
      col.affected !== -1 ? r[col.affected] : null,
      col.economic !== -1 ? r[col.economic] : null,
      col.reality !== -1 ? r[col.reality] : null,
    ].filter(Boolean).join(' · ');

    // --- Todo lo demás (texto libre, documentos, "other") queda SOLO en
    // private_notes / raw_submission — visible únicamente en /admin. ---
    const privateNotesParts = [
      col.other !== -1 && r[col.other] ? `Detalle adicional: ${r[col.other]}` : null,
      col.proof !== -1 && r[col.proof] ? `Comprobante adjunto: ${r[col.proof]}` : null,
      col.story !== -1 && r[col.story] ? `\nHistoria completa (sin editar):\n${r[col.story]}` : null,
    ].filter(Boolean);

    const rawSubmission = {};
    headers.forEach((h, i) => { rawSubmission[h] = r[i] || null; });

    try {
      await pool.query(
        `INSERT INTO applicants
          (full_name, email, phone, location, age, public_name, story, needs,
           private_notes, raw_submission, source, is_public, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'typeform',true,'pending')`,
        [
          fullName || null,
          email || null,
          phone || null,
          location || null,
          age,
          publicNameFrom(fullName),
          publicSummary || 'Postulante al Fondo de Becas.',
          ['beca'],
          privateNotesParts.join('\n\n'),
          JSON.stringify(rawSubmission)
        ]
      );
      inserted++;
    } catch (err) {
      console.error(`⚠️  Error insertando fila (${fullName || email}):`, err.message);
      skipped++;
    }
  }

  console.log(`\n✅ Importación terminada: ${inserted} postulantes creados, ${skipped} filas omitidas.`);
  console.log('Todos quedaron PÚBLICOS con un resumen seguro (solo respuestas de opción');
  console.log('múltiple: nunca el texto libre, nunca el nombre completo, nunca documentos).');
  console.log('Entra a /admin si quieres OCULTAR algún caso puntual, escribirle una historia');
  console.log('curada a mano, o revisar el detalle completo (privado) antes de otorgar becas.');

  await pool.end();
}

main().catch(err => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
