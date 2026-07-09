# Fondo de Becas 4Geeks Venezuela

Sitio público + panel admin + API para el fondo de becas de 4Geeks Academy
en Venezuela. Node.js + Express + PostgreSQL. Pensado para desplegarse en
Railway directo desde GitHub.

## Qué incluye

- **Sitio público** (`/`): hero, manifiesto, programa AI Engineering,
  cómo ayudar, donar (Stripe + Zelle + donar equipos), transparencia,
  historias de postulantes, postulación (Typeform incrustado), calendario, FAQ.
- **API pública** (`/api/*`): datos que consume el sitio (resumen del
  fondo, postulantes públicos, fechas, config de links, donaciones de equipos).
- **Panel admin** (`/admin`, protegido con usuario/clave): gestión de
  postulantes (datos confidenciales vs públicos), estadísticas del fondo,
  donaciones manuales, fechas de cohortes, y donaciones de equipos ofrecidas
  (`/admin/equipment`).
- **Webhooks**: Stripe (registra donaciones automáticamente, vinculadas a
  una persona específica si se donó desde su historia) y Typeform (crea
  postulantes automáticamente desde el formulario).
- **Alertas por email**: aviso automático cuando entra una donación por
  Stripe, una postulación nueva, o un ofrecimiento de donación de equipos.
- **Import de Typeform** (`scripts/import-typeform-csv.js`): carga masiva
  de respuestas ya existentes desde un CSV exportado de Typeform.

### Donar a una persona específica — cómo queda vinculado

Al hacer click en "Apoyar a [nombre]" en una historia, el sitio guarda esa
selección y arma el link de Stripe agregando `?client_reference_id=applicant_ID`.
Stripe devuelve ese mismo valor en el webhook, así que la donación se guarda
en la base ya vinculada a esa persona — sin depender de que el donante
escriba bien el nombre. Para Zelle (que no permite pasar datos estructurados)
se le pide al donante escribir el nombre en la nota de la transferencia; el
equipo la asocia manualmente desde `/admin` si hace falta.

### Donar equipos — formulario propio

La pestaña "Donar equipos" (dentro de la sección Donar) tiene un formulario
público (contacto, tipo de equipo, modelo, cantidad, estado, costo
aproximado, descripción y foto opcional). Se guarda en la tabla
`equipment_donations` — la foto se guarda directo en Postgres (no depende
de almacenamiento de archivos persistente en Railway). El equipo revisa y
coordina la logística desde `/admin/equipment`, donde puede cambiar el
estado (pendiente / coordinando / recibido).

### Alertas por email — setup

Define estas variables en Railway (u opcionalmente en `.env` local) para
recibir un correo cada vez que entra una donación, postulación o
donación de equipos:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=tu-cuenta@gmail.com
SMTP_PASS=una-contraseña-de-aplicación   # no tu contraseña normal de Gmail
SMTP_FROM="Fondo de Becas 4Geeks <tu-cuenta@gmail.com>"
ALERT_EMAIL_TO=latam@4geeksacademy.com
```

Con Gmail: Cuenta de Google → Seguridad → Verificación en 2 pasos →
Contraseñas de aplicaciones → genera una y úsala en `SMTP_PASS`. Cualquier
otro proveedor SMTP (SendGrid, Mailgun, tu propio hosting) funciona igual.
Si dejas estas variables vacías, el sitio sigue funcionando normal — solo
no se envían alertas.

## Formulario de postulación (Typeform incrustado)

El formulario vive en Typeform (ya maneja subida de archivos, lógica
condicional, etc.) pero se muestra **embebido directo en la página**
de "Postular", no como link externo. Dos piezas:

1. **`TYPEFORM_FORM_ID`** en las variables de entorno — el sitio inyecta
   el widget oficial de Typeform (`embed.typeform.com/next/embed.js`)
   apuntando a ese ID. Si por algún motivo no carga (bloqueador de
   anuncios, etc.), se muestra un link de respaldo que abre el formulario
   en una pestaña nueva.
2. **Webhook** (`FORM_WEBHOOK_SECRET`) — para que cada nueva respuesta
   entre sola a la base de datos como postulante privado, sin que nadie
   la tipee a mano. Ver sección de Typeform/Jotform más abajo.

### Importar respuestas que ya existen (backfill)

Las respuestas que Typeform ya tiene recolectadas ANTES de conectar el
webhook no llegan solas — hay que importarlas una vez:

```bash
DATABASE_URL=postgres://... node scripts/import-typeform-csv.js ruta/al/export.csv
```

(Exporta el CSV desde Typeform: Results → Summary → Download → CSV)

Todo entra como **privado** y en estado `pending` — nada se muestra en
el sitio público hasta que alguien del equipo revise cada caso desde
`/admin`, escriba una historia curada y anonimizada, y la marque como
pública. Esto es intencional: las respuestas incluyen información muy
sensible (documentos de identidad, situaciones familiares, datos de
salud) que no debe publicarse sin revisión humana caso por caso.

**Nunca subas el CSV real al repositorio** — `.gitignore` ya excluye
`*.csv` por esta razón.

## Correr en local

```bash
npm install
cp .env.example .env
# edita .env con tu DATABASE_URL de Postgres local o de Railway
npm start
```

Abre `http://localhost:3000` para el sitio público y
`http://localhost:3000/admin` para el panel (usuario/clave de `.env`).

El esquema de base de datos (`db/schema.sql`) se crea automáticamente al
arrancar el servidor — no hace falta correr migraciones a mano.

## Desplegar en GitHub + Railway (desde cero)

### 1. Crear el repositorio en GitHub

1. Entra a [github.com/new](https://github.com/new).
2. Nombre sugerido: `fondo-becas-venezuela`. Puede ser privado.
3. NO marques "Initialize with README" (ya tenemos uno).
4. Copia la URL que te da GitHub (ej. `https://github.com/tu-usuario/fondo-becas-venezuela.git`).

### 2. Subir este proyecto

Desde la carpeta `fondo-becas-venezuela/` (ya tiene `git init` hecho):

```bash
git remote add origin https://github.com/TU-USUARIO/fondo-becas-venezuela.git
git branch -M main
git push -u origin main
```

Te pedirá autenticarte con GitHub (usuario + token de acceso personal,
no la contraseña normal — [cómo crear un token](https://github.com/settings/tokens)).

### 3. Crear el proyecto en Railway

1. Entra a [railway.app](https://railway.app) → **New Project** →
   **Deploy from GitHub repo** → selecciona `fondo-becas-venezuela`.
2. Railway detecta Node.js automáticamente (por `package.json`) y corre
   `npm install && npm start`.
3. Agrega una base de datos: **New** → **Database** → **PostgreSQL**.
   Railway crea automáticamente la variable `DATABASE_URL` y la conecta
   a tu servicio.

### 4. Configurar variables de entorno en Railway

En el servicio (no en la base de datos) → **Variables** → agrega todas
las de `.env.example`, con tus valores reales:

- `ADMIN_USER`, `ADMIN_PASSWORD` — clave del panel admin.
- `STRIPE_PAYMENT_LINK_URL` — ya lo tienes: `https://buy.stripe.com/eVq9AS21Ob8g2xRdaYdby0w`
- `STRIPE_WEBHOOK_SECRET` — opcional, ver paso 5.
- `APPLICATION_FORM_URL` — el link de tu Typeform/Jotform.
- `FORM_WEBHOOK_SECRET` — opcional, ver paso 6.
- `CONTACT_EMAIL` — `latam@4geeksacademy.com`.
- `ZELLE_QR_PATH` — déjalo en `/images/zelle-qr.png` y sube el archivo
  real a `public/images/zelle-qr.png` en el repo.

`DATABASE_URL` y `PORT` los pone Railway automáticamente, no los toques.

### 5. (Opcional) Webhook de Stripe — registra donaciones solas

1. En [Stripe Dashboard](https://dashboard.stripe.com/webhooks) → **Add endpoint**.
2. URL: `https://tu-app.up.railway.app/api/webhook/stripe`
3. Evento: `checkout.session.completed`.
4. Copia el **Signing secret** (`whsec_...`) a `STRIPE_WEBHOOK_SECRET` en Railway.
5. Opcional: en tu Payment Link, agrega un "custom field" tipo texto
   preguntando "¿A quién deseas apoyar?" — ese valor se guarda junto a
   la donación para que lo asocies manualmente desde el admin.

### 6. (Opcional) Webhook de Typeform/Jotform — postulantes automáticos

1. Define un secreto propio en `FORM_WEBHOOK_SECRET` (Railway).
2. En Typeform: **Connect** → **Webhooks** → URL:
   `https://tu-app.up.railway.app/api/webhook/form?secret=TU_SECRETO`
3. En Jotform: **Settings** → **Integrations** → **Webhooks** → misma URL.
4. Cada nueva postulación entra como confidencial (`is_public = false`)
   para que la revises y actives desde `/admin` antes de mostrarla.

## Panel admin — qué puedes editar sin tocar código

- Postulantes: crear, editar, marcar pública/privada, cambiar estado
  (pendiente, aprobado, beca otorgada, equipo entregado, rechazado).
- Estadísticas del fondo: monto comprometido, becas otorgadas, equipos
  entregados, empresas aliadas, distribución porcentual.
- Donaciones manuales (Zelle, efectivo).
- Fechas de próximas cohortes.

"Postulantes activos" y "personas beneficiadas" en el sitio público se
calculan automáticamente a partir de los postulantes cargados — no se
editan a mano.

## Estructura del proyecto

```
fondo-becas-venezuela/
├── db/schema.sql          # esquema de Postgres (se aplica solo al arrancar)
├── public/                 # sitio público estático (HTML/CSS/JS)
├── src/
│   ├── server.js            # entrypoint
│   ├── db.js                 # conexión a Postgres
│   ├── middleware/auth.js     # basic auth para /admin
│   ├── routes/public.js        # API pública
│   ├── routes/webhooks.js       # Stripe + Typeform/Jotform
│   ├── routes/admin.js           # panel admin
│   └── views/                     # plantillas EJS del admin
└── .env.example
```

## Pendientes antes de producción

- [ ] Subir la imagen real del QR de Zelle a `public/images/zelle-qr.png`.
- [ ] Conectar el link real del formulario en `APPLICATION_FORM_URL`.
- [ ] Cargar postulantes reales desde `/admin` (o vía webhook del formulario).
- [ ] Cambiar `ADMIN_USER` / `ADMIN_PASSWORD` a algo seguro antes de desplegar.
- [ ] Revisar con un asesor legal/fiscal el texto sobre deducibilidad de donaciones.
