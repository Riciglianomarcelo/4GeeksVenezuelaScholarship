const fmt = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

const FAQ = [
  { q: "¿Quién puede postularse al fondo de becas?", a: "Cualquier persona en Venezuela con motivación para aprender tecnología e inteligencia artificial, tenga o no experiencia previa. Se evalúa la situación y necesidad de cada postulante." },
  { q: "¿Mis datos personales son públicos?", a: "No. Toda la información confidencial (nombre completo, contacto, documentos) se mantiene privada. Solo se muestra públicamente la información que cada postulante autoriza expresamente, de forma anonimizada." },
  { q: "¿Puedo donar a una persona específica en vez del fondo general?", a: "Sí. En la sección de Historias puedes conocer perfiles anonimizados y elegir apoyar a alguien en particular, indicando su nombre en la nota del pago (Stripe o Zelle)." },
  { q: "¿Cómo dono equipos como empresa?", a: "Escríbenos a latam@4geeksacademy.com contándonos qué equipos tienen disponibles (laptops o computadoras en buen estado) y coordinamos la logística de entrega." },
  { q: "¿Cómo se usa el dinero donado?", a: "Se distribuye entre becas de estudio, entrega de equipos, apoyo de conectividad y una porción mínima de operación del programa. Puedes ver el detalle actualizado en la sección de Transparencia." },
  { q: "¿Es deducible de impuestos mi donación?", a: "Actualmente no podemos garantizar deducibilidad fiscal de los aportes. Te recomendamos consultar con tu asesor fiscal según tu país de residencia." },
  { q: "¿El fondo cubre el programa AI Engineering completo?", a: "Sí, según la evaluación de cada caso. El fondo se dedica principalmente a AI Engineering (24 semanas); en algunos casos también puede cubrir AI Flex como alternativa, además de equipo y/o conectividad." }
];

const NEED_LABELS = { beca: ['Beca', 'np-beca'], laptop: ['Laptop', 'np-laptop'], internet: ['Internet', 'np-internet'] };

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Error cargando', url, err);
    return null;
  }
}

function loadTypeformEmbed(typeformId) {
  const wrap = document.getElementById('typeform-embed-wrap');
  if (!typeformId) {
    wrap.innerHTML = '<p class="empty-note">El formulario todavía no está conectado. Usa el link de abajo mientras tanto.</p>';
    return;
  }
  wrap.innerHTML = '';
  const widget = document.createElement('div');
  widget.setAttribute('data-tf-widget', typeformId);
  widget.setAttribute('data-tf-opacity', '100');
  widget.setAttribute('data-tf-iframe-props', 'title=Postulación Fondo de Becas 4Geeks Venezuela');
  widget.setAttribute('data-tf-transitive-search-params', '');
  widget.setAttribute('data-tf-medium', 'snippet');
  widget.style.width = '100%';
  widget.style.height = '600px';
  wrap.appendChild(widget);

  if (!document.getElementById('typeform-embed-script')) {
    const script = document.createElement('script');
    script.id = 'typeform-embed-script';
    script.src = 'https://embed.typeform.com/next/embed.js';
    document.body.appendChild(script);
  } else if (window.tf && typeof window.tf.reload === 'function') {
    window.tf.reload();
  }
}

async function loadConfig() {
  const cfg = await fetchJSON('/api/config');
  if (!cfg) return;
  document.getElementById('stripe-link-general').href = cfg.stripeLink || '#';
  document.getElementById('stripe-link-persona').href = cfg.stripeLink || '#';
  document.getElementById('form-link').href = cfg.applicationFormUrl || '#';
  loadTypeformEmbed(cfg.typeformId);

  const qrHtml = cfg.zelleQrPath
    ? `<img src="${cfg.zelleQrPath}" alt="QR de Zelle para 4GEEKS, LLC" onerror="this.parentElement.innerHTML='<span>QR de Zelle<br>(sube la imagen a ' + '${cfg.zelleQrPath}' + ')</span>'">`
    : '<span>QR de Zelle<br>(pendiente de subir imagen)</span>';
  document.getElementById('qr-box-general').innerHTML = qrHtml;
  document.getElementById('qr-box-persona').innerHTML = qrHtml;
}

async function loadSummary() {
  const s = await fetchJSON('/api/summary');
  if (!s) return;

  document.getElementById('hs-total').textContent = fmt(s.totalSoFar) + (s.communityRaised > 0 ? '' : '+');
  document.getElementById('hs-postulantes').textContent = s.postulantes;
  document.getElementById('hs-beneficiados').textContent = s.personasBeneficiadas;

  document.getElementById('tp-committed').textContent = fmt(s.committedSoFar);
  document.getElementById('tp-community').textContent = fmt(s.communityRaised);
  document.getElementById('tp-total').textContent = fmt(s.totalSoFar);

  document.getElementById('t-postulantes').textContent = s.postulantes;
  document.getElementById('t-beneficiados').textContent = s.personasBeneficiadas;
  document.getElementById('t-becas').textContent = s.becasOtorgadas;
  document.getElementById('t-equipos').textContent = s.equiposEntregados;
  document.getElementById('t-empresas').textContent = s.empresasAliadas;

  const colors = ['var(--blue)', 'var(--amber)', 'var(--red)', 'var(--muted)'];
  document.getElementById('breakdown-rows').innerHTML = (s.breakdown || []).map((b, i) => `
    <div class="bd-row">
      <div class="bd-label">${b.label}</div>
      <div class="bd-track"><div class="bd-fill" style="width:${b.pct}%;background:${colors[i % colors.length]};"></div></div>
      <div class="bd-pct">${b.pct}%</div>
    </div>
  `).join('') || '<p class="empty-note">Sin datos de distribución todavía.</p>';
}

async function loadApplicants() {
  const list = await fetchJSON('/api/applicants');
  const grid = document.getElementById('historias-grid');
  if (!list || list.length === 0) {
    grid.innerHTML = '<p class="empty-note">Todavía no hay historias públicas. Cuando el equipo apruebe postulantes para mostrar, aparecerán aquí.</p>';
    return;
  }
  grid.innerHTML = list.map(p => {
    const initials = p.public_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const needs = (p.needs || []).map(n => NEED_LABELS[n]
      ? `<span class="need-pill ${NEED_LABELS[n][1]}">${NEED_LABELS[n][0]}</span>` : '').join('');
    const meta = [p.age ? `${p.age} años` : null, p.location].filter(Boolean).join(' · ');
    return `
      <div class="card persona-card">
        <div class="persona-photo">${initials}</div>
        <div class="persona-body">
          <div class="meta">${meta}</div>
          <h4>${p.public_name}</h4>
          <p>${p.story || ''}</p>
          <div class="need-pills">${needs}</div>
          <a href="#donar" class="pill pill-primary" data-support="${p.public_name.split(' ')[0]}">Apoyar a ${p.public_name.split(' ')[0]} →</a>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('[data-support]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector('[data-tab="persona"]').click();
    });
  });
}

async function loadDates() {
  const dates = await fetchJSON('/api/dates');
  const body = document.getElementById('fechas-body');
  if (!dates || dates.length === 0) {
    body.innerHTML = '<tr><td colspan="4" class="empty-note">Sin fechas cargadas todavía. Consulta el calendario oficial.</td></tr>';
    return;
  }
  body.innerHTML = dates.map(d => `
    <tr>
      <td><b>${d.programa}</b></td>
      <td>${d.modalidad || '—'}</td>
      <td>${d.fecha || 'Por confirmar'}</td>
      <td>${d.abierto ? '<span class="badge-open">Inscripciones abiertas</span>' : 'Cerrado'}</td>
    </tr>
  `).join('');
}

function renderFaq() {
  const wrap = document.getElementById('faq-wrap');
  wrap.innerHTML = FAQ.map((f, i) => `
    <div class="faq-item" id="faq-${i}">
      <button class="faq-q" data-idx="${i}"><span>${f.q}</span><span class="chev">+</span></button>
      <div class="faq-a" id="faq-a-${i}"><p>${f.a}</p></div>
    </div>
  `).join('');

  wrap.querySelectorAll('.faq-q').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = btn.dataset.idx;
      const item = document.getElementById('faq-' + i);
      const answer = document.getElementById('faq-a-' + i);
      const isOpen = item.classList.contains('open');
      wrap.querySelectorAll('.faq-item').forEach(el => { el.classList.remove('open'); el.querySelector('.faq-a').style.maxHeight = null; });
      if (!isOpen) { item.classList.add('open'); answer.style.maxHeight = answer.scrollHeight + 'px'; }
    });
  });
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const which = btn.dataset.tab;
      document.getElementById('panel-general').classList.toggle('active', which === 'general');
      document.getElementById('panel-persona').classList.toggle('active', which === 'persona');
    });
  });
}

function initNav() {
  const burger = document.getElementById('burger');
  const links = document.querySelector('.navlinks');
  burger.addEventListener('click', () => {
    links.style.display = links.style.display === 'flex' ? 'none' : 'flex';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initNav();
  renderFaq();
  loadConfig();
  loadSummary();
  loadApplicants();
  loadDates();
});
