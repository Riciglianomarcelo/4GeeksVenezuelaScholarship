-- Esquema de base de datos — Fondo de Becas 4Geeks Venezuela
-- Ejecutar una vez contra la base de Postgres (Railway lo hace automático
-- en el primer arranque vía src/db.js -> ensureSchema()).

CREATE TABLE IF NOT EXISTS applicants (
  id SERIAL PRIMARY KEY,

  -- Datos confidenciales — SOLO visibles en el panel admin, nunca en la API pública
  full_name TEXT,
  email TEXT,
  phone TEXT,
  id_document TEXT,
  private_notes TEXT,
  raw_submission JSONB, -- payload crudo si llegó por webhook (Typeform/Jotform)

  -- Datos públicos — se muestran en /api/applicants SOLO si is_public = true
  public_name TEXT NOT NULL DEFAULT 'Postulante',
  age INT,
  location TEXT,
  story TEXT,
  needs TEXT[] DEFAULT '{}', -- valores esperados: beca, laptop, internet

  is_public BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | scholarship_awarded | equipment_given | rejected
  source TEXT NOT NULL DEFAULT 'manual',  -- manual | typeform | jotform

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS donations (
  id SERIAL PRIMARY KEY,
  applicant_id INT REFERENCES applicants(id) ON DELETE SET NULL, -- NULL = fondo general
  donor_name TEXT,
  donor_note TEXT,
  amount NUMERIC(12,2) NOT NULL,
  method TEXT NOT NULL, -- stripe | zelle | other
  stripe_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS program_stats (
  id INT PRIMARY KEY DEFAULT 1,
  fund_goal NUMERIC(12,2) NOT NULL DEFAULT 50000,
  becas_otorgadas INT NOT NULL DEFAULT 0,
  equipos_entregados INT NOT NULL DEFAULT 0,
  empresas_aliadas INT NOT NULL DEFAULT 0,
  breakdown JSONB NOT NULL DEFAULT '[
    {"label":"Becas de estudio","pct":60},
    {"label":"Equipos y laptops","pct":25},
    {"label":"Conectividad / internet","pct":10},
    {"label":"Operación del programa","pct":5}
  ]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO program_stats (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS upcoming_dates (
  id SERIAL PRIMARY KEY,
  programa TEXT NOT NULL,
  modalidad TEXT,
  fecha TEXT,
  abierto BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0
);
