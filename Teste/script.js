'use strict';

/* =====================================================================
 * Controle de Fluidez
 * ---------------------------------------------------------------------
 * Sections:
 *   1. Config & Firebase      6. Views (tabs + detail screens)
 *   2. State                  7. Modals & forms
 *   3. Utilities              8. Camera / QR scanner
 *   4. Domain (stats/status)  9. PDF generation
 *   5. QR helpers            10. Actions (event delegation) & boot
 *
 * Firebase data model (unchanged, backwards compatible):
 *   materials/{id}: { name, ifMin, ifMax }
 *   loads/{id}:     { date, invoiceNumber, supplier, lot, responsible,
 *                     materialId, paletes/{pid}: { date, ifValue } }
 *
 * QR payload format is unchanged so labels already printed keep scanning.
 * ===================================================================== */

/* ==================== 1. CONFIG & FIREBASE ==================== */
const firebaseConfig = { databaseURL: 'https://materiaprima-803a4-default-rtdb.firebaseio.com' };
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const APPROVAL_THRESHOLD = 80; // % of measured paletes inside the IF range
const COMPANY_NAME = 'EMBALAGENS TATUÍ';

const defaultConfig = {
  app_title: 'Controle de Fluidez',
  background_color: '#0b1120',
  surface_color: '#111a2e',
  text_color: '#f1f5f9',
  accent_color: '#3b82f6',
  font_family: 'DM Sans'
};

/* ==================== 2. STATE ==================== */
const state = {
  materials: {},
  loads: {},
  tab: 'home',
  /** Sub-screen inside a tab: null | { type: 'load' | 'qr', id } */
  detail: null,
  appTitle: defaultConfig.app_title,
  /** Scanned QR payloads keyed by supplier-lot-palete */
  scanned: new Map()
};

/* ==================== 3. UTILITIES ==================== */
const $ = (sel, root = document) => root.querySelector(sel);

/** Escapes user/DB content before it is interpolated into HTML. */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY'. Output is digits-only, so it is HTML-safe. */
function formatDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtIF = v => (Number(v) > 0 ? Number(v).toFixed(2) : '—');
const safeFile = s => String(s ?? '').replace(/[^\w.-]+/g, '_');

function toast(msg, error = false) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' toast-error' : '');
  t.setAttribute('role', error ? 'alert' : 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

/** Coalesces bursts of Firebase events into a single render per frame. */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

/* ==================== 4. DOMAIN ==================== */
const paletesOf = load => (load && load.paletes ? Object.entries(load.paletes) : []);
const materialOf = load => state.materials[load?.materialId];
const isMeasured = p => Number(p?.ifValue) > 0; // bulk-created paletes start at 0 = not measured
const inRange = (mat, v) => !!mat && v >= mat.ifMin && v <= mat.ifMax;

function getLoadStats(load) {
  const mat = materialOf(load);
  const all = paletesOf(load).map(([, p]) => p);
  const measured = all.filter(isMeasured);
  const approved = measured.filter(p => inRange(mat, p.ifValue)).length;
  const avg = measured.length ? measured.reduce((s, p) => s + p.ifValue, 0) / measured.length : 0;
  return {
    total: all.length,
    measured: measured.length,
    pending: all.length - measured.length,
    approved,
    rejected: measured.length - approved,
    avg,
    pct: measured.length ? Math.round((approved / measured.length) * 100) : 0
  };
}

function loadStatus(stats) {
  if (!stats.measured) return { label: 'Pendente', tone: 'info' };
  return stats.pct >= APPROVAL_THRESHOLD
    ? { label: 'Aprovado', tone: 'success' }
    : { label: 'Reprovado', tone: 'danger' };
}

function paleteStatus(mat, p) {
  if (!isMeasured(p)) return { label: 'Sem IF', tone: 'info' };
  return inRange(mat, p.ifValue) ? { label: 'OK', tone: 'success' } : { label: 'Fora', tone: 'danger' };
}

const sortedLoads = () =>
  Object.entries(state.loads).sort(([, a], [, b]) => String(b.date).localeCompare(String(a.date)));

function groupByMonth(entries) {
  const groups = new Map();
  entries.forEach(([id, l]) => {
    const [y, m] = String(l.date || '').split('-');
    const key = `${y}-${m}`;
    if (!groups.has(key)) {
      const name = y && m
        ? new Date(+y, +m - 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
        : 'Sem data';
      groups.set(key, { name, items: [] });
    }
    groups.get(key).items.push([id, l]);
  });
  return [...groups.values()];
}

/* ==================== 5. QR HELPERS ==================== */
/**
 * Compact payload reduces QR matrix density by ~40%, allowing much larger
 * modules that scan instantly from further away and in 1 frame.
 */
function buildQrPayload(load, palete, paleteNumber) {
  return {
    p: paleteNumber,
    nf: load.invoiceNumber || '',
    s: load.supplier || '',
    l: load.lot || '',
    m: materialOf(load)?.name || 'N/A',
    d: formatDate(palete.date),
    r: load.responsible || '',
    if: Number(palete.ifValue) || 0
  };
}

/**
 * Normalizes both the new compact payload and legacy full-key payloads.
 */
function normalizeQrData(data) {
  if (!data || typeof data !== 'object') return null;
  const paleteNumber = data.paleteNumber ?? data.p;
  if (paleteNumber === undefined) return null;
  return {
    paleteNumber: Number(paleteNumber),
    invoiceNumber: String(data.invoiceNumber ?? data.nf ?? 'N/A'),
    supplier: String(data.supplier ?? data.s ?? 'N/A'),
    lot: String(data.lot ?? data.l ?? 'N/A'),
    material: String(data.material ?? data.m ?? 'N/A'),
    date: String(data.date ?? data.d ?? '—'),
    responsible: String(data.responsible ?? data.r ?? '—'),
    ifValue: Number(data.ifValue ?? data.if ?? 0)
  };
}

/**
 * Generates QR code using QRCode.CorrectLevel.H (HIGH: 30% error recovery).
 * Up to 30% of the QR code can be missing, covered, torn, stained, or occluded,
 * and it still decodes completely!
 */
function qrDataUrl(text, size = 640) {
  const host = document.createElement('div');
  new QRCode(host, {
    text,
    width: size,
    height: size,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
  const canvas = host.querySelector('canvas');
  return canvas ? canvas.toDataURL('image/png') : null;
}

const scannedKey = q => `${q.supplier}-${q.lot}-${q.paleteNumber}`;

/* ==================== 6. VIEWS ==================== */
function render() {
  const mc = $('#mainContent');
  if (!mc) return;
  document.querySelectorAll('.nav-btn').forEach(b => {
    const active = b.dataset.tab === state.tab && !state.detail;
    b.classList.toggle('active', active);
    b.setAttribute('aria-current', active ? 'page' : 'false');
  });

  if (state.tab === 'camera' && camera.stream && $('#cameraFeed')) {
    return;
  }

  let html = '';
  if (state.detail?.type === 'load') html = renderLoadDetail(state.detail.id);
  else if (state.detail?.type === 'qr') html = renderQrLoad(state.detail.id);
  else {
    switch (state.tab) {
      case 'home': html = renderHome(); break;
      case 'loads': html = renderLoads(); break;
      case 'camera': html = renderCamera(); break;
      case 'qrcode': html = renderQrTab(); break;
      case 'materials': html = renderMaterials(); break;
    }
  }

  mc.innerHTML = `<div class="container">${html}</div>`;

  if (state.tab === 'camera') {
    renderScannedList();
  }
}

/** Single FAB, replaced on each screen. */
function setFab(action, data = {}, label = 'Adicionar') {
  document.querySelectorAll('.fab').forEach(f => f.remove());
  if (!action) return;
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.dataset.action = action;
  Object.entries(data).forEach(([k, v]) => { fab.dataset[k] = v; });
  fab.setAttribute('aria-label', label);
  fab.innerHTML = '<i class="fa-solid fa-plus"></i>';
  document.body.appendChild(fab);
}

/* ---------- Shared partials ---------- */
const icon = name => `<i class="fa-solid fa-${name}" aria-hidden="true"></i>`;
const badge = ({ label, tone }) => `<span class="badge badge-${tone}">${esc(label)}</span>`;

function pageHeader(title, iconName, actionsHtml = '') {
  return `<header class="page-header">
    <h1 class="page-title">${icon(iconName)}<span>${esc(title)}</span></h1>
    ${actionsHtml ? `<div class="page-actions">${actionsHtml}</div>` : ''}
  </header>`;
}

function detailHeader(title, subtitle, back, trailing = '') {
  return `<header class="detail-header">
    <button class="btn-icon" data-action="back" data-to="${back}" aria-label="Voltar">${icon('arrow-left')}</button>
    <div class="detail-heading">
      <h1 class="detail-title">${esc(title)}</h1>
      <p class="detail-sub">${subtitle}</p>
    </div>
    ${trailing}
  </header>`;
}

function emptyState(text, hint = '') {
  return `<div class="empty-state">${icon('inbox')}<p>${esc(text)}</p>${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
}

function progress(pct, tone) {
  return `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <div class="progress-fill tone-${tone}" style="width:${pct}%"></div></div>`;
}

function loadCard(id, l, action = 'open-load') {
  const s = getLoadStats(l);
  const st = loadStatus(s);
  const pctLabel = s.measured ? `${s.pct}%` : st.label;
  return `<button class="list-card tone-edge-${st.tone}" data-action="${action}" data-id="${esc(id)}">
    <div class="list-card-top">
      <div class="list-card-title-group">
        <strong class="list-card-title">${esc(l.supplier)}</strong>
        <span class="nf-chip">NF ${esc(l.invoiceNumber || 'N/A')}</span>
      </div>
      ${badge({ label: pctLabel, tone: st.tone })}
    </div>
    <div class="meta-grid">
      <span>${icon('calendar')}${formatDate(l.date)}</span>
      <span>${icon('cube')}Lote ${esc(l.lot)}</span>
      <span>${icon('flask')}${esc(materialOf(l)?.name || 'N/A')}</span>
      <span>${icon('pallet')}${s.total} palete(s)</span>
    </div>
    ${progress(s.pct, st.tone)}
  </button>`;
}

/* ---------- Home ---------- */
function renderHome() {
  const all = Object.values(state.loads);
  const totals = all.reduce((acc, l) => {
    const s = getLoadStats(l);
    acc.paletes += s.total; acc.approved += s.approved; acc.rejected += s.rejected;
    return acc;
  }, { paletes: 0, approved: 0, rejected: 0 });
  const recent = sortedLoads().slice(0, 5);
  setFab(null);

  return `
    ${pageHeader(state.appTitle, 'chart-line')}
    <section class="stat-grid" aria-label="Resumo">
      <div class="stat-card"><span class="stat-val">${all.length}</span><span class="stat-label">Carregamentos</span></div>
      <div class="stat-card"><span class="stat-val">${totals.paletes}</span><span class="stat-label">Paletes</span></div>
      <div class="stat-card"><span class="stat-val tone-text-success">${totals.approved}</span><span class="stat-label">Aprovados</span></div>
      <div class="stat-card"><span class="stat-val tone-text-danger">${totals.rejected}</span><span class="stat-label">Reprovados</span></div>
    </section>
    <h2 class="section-title">Carregamentos recentes</h2>
    <div class="list">${recent.length ? recent.map(([id, l]) => loadCard(id, l)).join('') : emptyState('Nenhum carregamento ainda')}</div>
  `;
}

/* ---------- Loads ---------- */
function renderLoads() {
  const entries = sortedLoads();
  const actions = entries.length ? `
    <button class="btn btn-ghost btn-sm" data-action="pdf-labels-all">${icon('qrcode')}Etiquetas</button>
    <button class="btn btn-ghost btn-sm" data-action="pdf-reports-all">${icon('file-pdf')}Relatórios</button>` : '';
  setFab('new-load', {}, 'Novo carregamento');

  return `
    ${pageHeader('Carregamentos', 'truck', actions)}
    ${entries.length
      ? groupByMonth(entries).map(g => `
        <section class="month-group">
          <h2 class="section-title month-title">${esc(g.name)}</h2>
          <div class="list">${g.items.map(([id, l]) => loadCard(id, l)).join('')}</div>
        </section>`).join('')
      : emptyState('Nenhum carregamento cadastrado', 'Toque no botão + para criar um novo')}
  `;
}

/* ---------- QR tab ---------- */
function renderQrTab() {
  const entries = sortedLoads();
  const actions = entries.length
    ? `<button class="btn btn-ghost btn-sm" data-action="pdf-labels-all">${icon('download')}Baixar todas</button>` : '';
  setFab(null);

  return `
    ${pageHeader('Etiquetas QR', 'qrcode', actions)}
    <div class="list">${entries.length
      ? entries.map(([id, l]) => loadCard(id, l, 'open-qr-load')).join('')
      : emptyState('Nenhum carregamento para gerar QR Code')}</div>
  `;
}

function renderQrLoad(id) {
  const l = state.loads[id];
  if (!l) { state.detail = null; return render(); }
  const mat = materialOf(l);
  const paletes = paletesOf(l);
  setFab(null);

  return `
    ${detailHeader(l.supplier, `NF ${esc(l.invoiceNumber || 'N/A')} · Lote ${esc(l.lot)} · ${esc(mat?.name || 'N/A')}`, 'qrcode')}
    <div class="btn-row">
      <button class="btn btn-primary" data-action="pdf-labels-load" data-id="${esc(id)}" ${paletes.length ? '' : 'disabled'}>${icon('file-pdf')}PDF de todas</button>
      <button class="btn btn-success" data-action="bulk-palete" data-id="${esc(id)}">${icon('layer-group')}Gerar paletes</button>
    </div>
    <h2 class="section-title">Selecione um palete (${paletes.length})</h2>
    <div class="list">${paletes.length
      ? paletes.map(([pid, p], i) => `
        <button class="row-card" data-action="qr-modal" data-id="${esc(id)}" data-pid="${esc(pid)}" data-num="${i + 1}">
          <div>
            <strong>Palete ${i + 1}</strong>
            <small>${icon('calendar')}${formatDate(p.date)} · IF ${fmtIF(p.ifValue)}</small>
          </div>
          <span class="row-card-icon">${icon('qrcode')}</span>
        </button>`).join('')
      : emptyState('Nenhum palete neste carregamento')}</div>
  `;
}

/* ---------- Materials ---------- */
function renderMaterials() {
  const entries = Object.entries(state.materials).sort(([, a], [, b]) => String(a.name).localeCompare(String(b.name)));
  setFab('new-material', {}, 'Nova matéria-prima');

  return `
    ${pageHeader('Matérias-primas', 'flask')}
    <div class="list">${entries.length
      ? entries.map(([id, m]) => `
        <div class="row-card is-static">
          <div>
            <strong>${esc(m.name)}</strong>
            <small>${icon('gauge')}Faixa IF: ${esc(m.ifMin)} – ${esc(m.ifMax)} g/10min</small>
          </div>
          <button class="btn-icon btn-icon-danger" data-action="delete-material" data-id="${esc(id)}" aria-label="Excluir ${esc(m.name)}">${icon('trash')}</button>
        </div>`).join('')
      : emptyState('Nenhuma matéria-prima cadastrada', 'Toque no botão + para cadastrar')}</div>
  `;
}

/* ---------- Load detail ---------- */
function renderChart(mat, paletes) {
  if (!paletes.length || !mat) return '';
  const maxVal = Math.max(mat.ifMax * 1.3, ...paletes.map(([, p]) => Number(p.ifValue) || 0));
  const pos = v => (v / maxVal) * 100;
  return `<section class="card">
    <h2 class="card-title">${icon('chart-column')}IF por palete</h2>
    <div class="chart">
      <div class="chart-line tone-line-success" style="bottom:${pos(mat.ifMin)}%"><span>${esc(mat.ifMin)}</span></div>
      <div class="chart-line tone-line-danger" style="bottom:${pos(mat.ifMax)}%"><span>${esc(mat.ifMax)}</span></div>
      <div class="chart-bars">
        ${paletes.map(([, p], i) => {
          const st = paleteStatus(mat, p);
          return `<div class="chart-bar tone-bg-${st.tone}" style="height:${isMeasured(p) ? pos(p.ifValue) : 2}%" title="Palete ${i + 1}: ${fmtIF(p.ifValue)}"><span>P${i + 1}</span></div>`;
        }).join('')}
      </div>
    </div>
  </section>`;
}

function renderLoadDetail(id) {
  const l = state.loads[id];
  if (!l) { state.detail = null; return render(); }
  const mat = materialOf(l);
  const paletes = paletesOf(l);
  const s = getLoadStats(l);
  const st = loadStatus(s);
  setFab('new-palete', { id }, 'Novo palete');

  return `
    ${detailHeader(l.supplier, `${esc(mat?.name || 'N/A')} · Lote ${esc(l.lot)}`, state.tab, badge(st))}

    <section class="nf-hero">
      <span class="nf-hero-label">Nota fiscal</span>
      <span class="nf-hero-value">${esc(l.invoiceNumber || 'N/A')}</span>
    </section>

    <section class="card kv-grid">
      <div><span>Data</span>${formatDate(l.date)}</div>
      <div><span>Responsável</span>${esc(l.responsible)}</div>
      <div><span>Faixa IF</span>${mat ? `${esc(mat.ifMin)} – ${esc(mat.ifMax)}` : 'N/A'}</div>
      <div><span>Média IF</span>${s.measured ? `${s.avg.toFixed(2)} g/10min` : '—'}</div>
    </section>

    <section class="stat-grid">
      <div class="stat-card"><span class="stat-val">${s.approved}/${s.measured}</span><span class="stat-label">Aprovados</span></div>
      <div class="stat-card"><span class="stat-val tone-text-${st.tone}">${s.measured ? s.pct + '%' : '—'}</span><span class="stat-label">Taxa de aprovação</span></div>
    </section>

    <div class="btn-row">
      <button class="btn btn-ghost" data-action="edit-load" data-id="${esc(id)}">${icon('pen')}Editar</button>
      <button class="btn btn-ghost" data-action="pdf-report" data-id="${esc(id)}">${icon('file-lines')}Relatório</button>
      <button class="btn btn-primary" data-action="pdf-labels-load" data-id="${esc(id)}" ${paletes.length ? '' : 'disabled'}>${icon('qrcode')}Etiquetas</button>
    </div>

    ${renderChart(mat, paletes)}

    <h2 class="section-title">Paletes (${s.total})${s.pending ? ` · <span class="muted">${s.pending} sem IF</span>` : ''}</h2>
    <div class="list">${paletes.length
      ? paletes.map(([pid, p], i) => `
        <div class="row-card" data-action="edit-palete" data-id="${esc(id)}" data-pid="${esc(pid)}" data-num="${i + 1}" role="button" tabindex="0">
          <div>
            <strong>Palete ${i + 1}</strong>
            <small>${icon('calendar')}${formatDate(p.date)} · IF ${fmtIF(p.ifValue)} g/10min</small>
          </div>
          <div class="row-card-end">
            ${badge(paleteStatus(mat, p))}
            <button class="btn-icon btn-icon-danger" data-action="delete-palete" data-id="${esc(id)}" data-pid="${esc(pid)}" aria-label="Excluir palete ${i + 1}">${icon('trash')}</button>
          </div>
        </div>`).join('')
      : emptyState('Nenhum palete', 'Toque no botão + para adicionar')}</div>

    <button class="btn btn-danger btn-block danger-zone" data-action="delete-load" data-id="${esc(id)}">${icon('trash')}Excluir carregamento</button>
  `;
}

/* ==================== 7. MODALS & FORMS ==================== */
function closeModal() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
  document.removeEventListener('keydown', onModalKey);
}

function onModalKey(e) { if (e.key === 'Escape') closeModal(); }

function openModal(title, iconName, bodyHtml) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <header class="modal-header">
      <h2 id="modalTitle">${icon(iconName)}${esc(title)}</h2>
      <button class="btn-icon" data-action="modal-close" aria-label="Fechar">${icon('xmark')}</button>
    </header>
    ${bodyHtml}
  </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', onModalKey);
  document.body.appendChild(overlay);
  setTimeout(() => overlay.querySelector('input, select')?.focus(), 50);
  return overlay;
}

/** Declarative field builder: keeps every form visually identical. */
function field({ id, label, type = 'text', value = '', placeholder = '', required = true, step, min, max, options }) {
  const attrs = [
    `id="${id}"`, `name="${id}"`, 'class="input"', required ? 'required' : '',
    step ? `step="${step}"` : '', min !== undefined ? `min="${min}"` : '', max !== undefined ? `max="${max}"` : '',
    placeholder ? `placeholder="${esc(placeholder)}"` : ''
  ].filter(Boolean).join(' ');
  const control = options
    ? `<select ${attrs}>${options.map(o => `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
    : `<input type="${type}" ${attrs} value="${esc(value)}" ${type === 'number' ? 'inputmode="decimal"' : ''}>`;
  return `<label class="field"><span class="field-label">${esc(label)}</span>${control}</label>`;
}

function formModal({ title, iconName, fields, submitLabel, submitTone = 'primary', note = '', onSubmit }) {
  const overlay = openModal(title, iconName, `
    <form class="form-stack" novalidate>
      ${fields.join('')}
      ${note ? `<p class="hint">${icon('circle-info')}${esc(note)}</p>` : ''}
      <button type="submit" class="btn btn-${submitTone} btn-block">${esc(submitLabel)}</button>
    </form>`);
  const form = overlay.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    Object.keys(values).forEach(k => { values[k] = String(values[k]).trim(); });
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const ok = await onSubmit(values);
      if (ok !== false) closeModal();
    } catch (err) {
      toast('Erro ao salvar: ' + (err?.message || err), true);
    } finally {
      btn.disabled = false;
    }
  });
}

function materialModal() {
  formModal({
    title: 'Nova matéria-prima', iconName: 'flask', submitLabel: 'Salvar matéria-prima',
    fields: [
      field({ id: 'name', label: 'Nome', placeholder: 'Ex: Polietileno HD' }),
      `<div class="field-row">${field({ id: 'ifMin', label: 'IF mínimo', type: 'number', step: '0.01', placeholder: '0.00' })}${field({ id: 'ifMax', label: 'IF máximo', type: 'number', step: '0.01', placeholder: '0.00' })}</div>`
    ],
    onSubmit: async v => {
      const ifMin = parseFloat(v.ifMin), ifMax = parseFloat(v.ifMax);
      if (!v.name || isNaN(ifMin) || isNaN(ifMax)) { toast('Preencha todos os campos', true); return false; }
      if (ifMin >= ifMax) { toast('IF mínimo deve ser menor que o máximo', true); return false; }
      await db.ref('materials').push({ name: v.name, ifMin, ifMax });
      toast('Matéria-prima salva!');
    }
  });
}

function loadModal(id = null) {
  const matEntries = Object.entries(state.materials);
  if (!matEntries.length) { toast('Cadastre uma matéria-prima primeiro', true); return; }
  const l = id ? state.loads[id] : {};
  formModal({
    title: id ? 'Editar carregamento' : 'Novo carregamento',
    iconName: id ? 'pen' : 'truck',
    submitLabel: id ? 'Salvar alterações' : 'Criar carregamento',
    fields: [
      `<div class="field-row">${field({ id: 'date', label: 'Data', type: 'date', value: l.date || todayISO() })}${field({ id: 'invoiceNumber', label: 'Nota fiscal', value: l.invoiceNumber || '', placeholder: 'Nº da NF' })}</div>`,
      field({ id: 'supplier', label: 'Fornecedor', value: l.supplier || '', placeholder: 'Nome do fornecedor' }),
      `<div class="field-row">${field({ id: 'lot', label: 'Lote', value: l.lot || '', placeholder: 'Nº do lote' })}${field({ id: 'responsible', label: 'Responsável', value: l.responsible || '', placeholder: 'Nome' })}</div>`,
      field({ id: 'materialId', label: 'Matéria-prima', value: l.materialId || matEntries[0][0], options: matEntries.map(([mid, m]) => ({ value: mid, label: m.name })) })
    ],
    onSubmit: async v => {
      if (!v.date || !v.invoiceNumber || !v.supplier || !v.lot || !v.responsible || !v.materialId) {
        toast('Preencha todos os campos', true); return false;
      }
      if (id) { await db.ref('loads/' + id).update(v); toast('Carregamento atualizado!'); }
      else { await db.ref('loads').push(v); toast('Carregamento criado!'); }
    }
  });
}

function paleteModal(loadId, paleteId = null, num = null) {
  const p = paleteId ? state.loads[loadId]?.paletes?.[paleteId] : null;
  if (paleteId && !p) return;
  formModal({
    title: paleteId ? `Editar palete ${num}` : 'Novo palete',
    iconName: paleteId ? 'pen' : 'vial',
    submitLabel: paleteId ? 'Salvar palete' : 'Adicionar palete',
    fields: [
      field({ id: 'date', label: 'Data da análise', type: 'date', value: p?.date || todayISO() }),
      field({ id: 'ifValue', label: 'Valor IF (g/10min)', type: 'number', step: '0.01', min: 0, placeholder: '0.00', value: p && isMeasured(p) ? p.ifValue : '' })
    ],
    onSubmit: async v => {
      const ifValue = parseFloat(v.ifValue);
      if (!v.date || isNaN(ifValue) || ifValue < 0) { toast('Informe data e IF válidos', true); return false; }
      const ref = db.ref(`loads/${loadId}/paletes`);
      if (paleteId) { await ref.child(paleteId).update({ date: v.date, ifValue }); toast('Palete atualizado!'); }
      else { await ref.push({ date: v.date, ifValue }); toast('Palete adicionado!'); }
    }
  });
}

function bulkPaleteModal(loadId) {
  formModal({
    title: 'Gerar paletes', iconName: 'layer-group', submitLabel: 'Gerar paletes', submitTone: 'success',
    note: 'Os paletes são criados sem Índice de Fluidez. Informe o IF depois tocando em cada palete.',
    fields: [
      `<div class="field-row">${field({ id: 'date', label: 'Data da análise', type: 'date', value: todayISO() })}${field({ id: 'qty', label: 'Quantidade', type: 'number', min: 1, max: 100, value: '5' })}</div>`
    ],
    onSubmit: async v => {
      const qty = parseInt(v.qty, 10);
      if (!v.date || isNaN(qty) || qty < 1 || qty > 100) { toast('Quantidade deve ser entre 1 e 100', true); return false; }
      // One atomic multi-path write instead of N sequential round-trips.
      const ref = db.ref(`loads/${loadId}/paletes`);
      const updates = {};
      for (let i = 0; i < qty; i++) updates[ref.push().key] = { date: v.date, ifValue: 0 };
      await ref.update(updates);
      toast(`${qty} palete(s) gerado(s)!`);
    }
  });
}

function qrModal(loadId, paleteId, num) {
  const l = state.loads[loadId];
  const p = l?.paletes?.[paleteId];
  if (!p) return;
  const payload = buildQrPayload(l, p, num);
  const overlay = openModal(`Palete ${num}`, 'qrcode', `
    <div class="qr-preview"><img alt="QR Code do palete ${num}" src="${qrDataUrl(JSON.stringify(payload), 480)}"></div>
    <div class="nf-hero is-compact"><span class="nf-hero-label">Nota fiscal</span><span class="nf-hero-value">${esc(l.invoiceNumber || 'N/A')}</span></div>
    ${qrInfoGrid(payload)}
    <div class="btn-row">
      <button class="btn btn-ghost" data-action="download-qr-png">${icon('image')}Imagem</button>
      <button class="btn btn-primary" data-action="pdf-label" data-id="${esc(loadId)}" data-pid="${esc(paleteId)}" data-num="${num}">${icon('file-pdf')}PDF</button>
    </div>`);
  overlay.querySelector('[data-action="download-qr-png"]').dataset.name = safeFile(`palete_${num}_${l.lot}`);
}

function qrInfoGrid(q) {
  return `<div class="kv-grid card">
    <div><span>Fornecedor</span>${esc(q.supplier)}</div>
    <div><span>Lote</span>${esc(q.lot)}</div>
    <div><span>Matéria-prima</span>${esc(q.material)}</div>
    <div><span>IF</span>${fmtIF(q.ifValue)} g/10min</div>
    <div><span>Data</span>${esc(q.date)}</div>
    <div><span>Responsável</span>${esc(q.responsible)}</div>
  </div>`;
}

function scannedModal(key) {
  const q = state.scanned.get(key);
  if (!q) return;
  openModal(`Palete #${q.paleteNumber}`, 'qrcode', `
    <div class="nf-hero is-compact"><span class="nf-hero-label">Nota fiscal</span><span class="nf-hero-value">${esc(q.invoiceNumber || 'N/A')}</span></div>
    ${qrInfoGrid(q)}
    <button class="btn btn-primary btn-block" data-action="scanned-pdf" data-key="${esc(key)}">${icon('file-pdf')}Reimprimir etiqueta (PDF)</button>`);
}

/* ==================== 8. CAMERA / QR SCANNER ==================== */
const camera = {
  stream: null,
  animId: null,
  canvas: null,
  ctx: null,
  cropCanvas: null,
  cropCtx: null,
  lastHit: 0,
  busy: false
};

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1900, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch (e) {}
}

function renderCamera() {
  setFab(null);
  return `
    ${pageHeader('Leitor de QR Code', 'camera')}
    <div class="camera-frame">
      <video id="cameraFeed" playsinline muted hidden></video>
      <div id="cameraPlaceholder" class="camera-placeholder">${icon('video')}<span>Câmera desligada</span></div>
      <div id="cameraReticle" class="camera-reticle" hidden></div>
      <div id="cameraStatus" class="camera-status" hidden><i class="pulse-dot"></i>Leitura instantânea ativa</div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary btn-grow" id="toggleCameraBtn" data-action="camera-toggle">${icon('play')}Iniciar câmera</button>
      <div class="counter" aria-live="polite"><span id="qrCounter">${state.scanned.size}</span><small>lidos</small></div>
    </div>
    <div id="scannedResults" class="list"></div>
  `;
}

async function startCamera() {
  try {
    camera.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 480 }
      }
    });
    // Apply hardware continuous auto-focus on supported mobile devices
    const track = camera.stream?.getVideoTracks()[0];
    if (track && track.applyConstraints) {
      track.applyConstraints({
        advanced: [{ focusMode: 'continuous' }, { exposureMode: 'continuous' }]
      }).catch(() => {});
    }
  } catch (err) {
    toast('Erro ao acessar câmera: ' + err.message, true);
    return;
  }

  const video = $('#cameraFeed');
  video.srcObject = camera.stream;
  video.hidden = false;
  $('#cameraPlaceholder').hidden = true;
  $('#cameraReticle').hidden = false;
  $('#cameraStatus').hidden = false;
  $('#toggleCameraBtn').innerHTML = `${icon('stop')}Parar câmera`;
  await video.play().catch(() => {});

  camera.canvas = camera.canvas || document.createElement('canvas');
  camera.ctx = camera.ctx || camera.canvas.getContext('2d', { willReadFrequently: true });
  camera.cropCanvas = camera.cropCanvas || document.createElement('canvas');
  camera.cropCtx = camera.cropCtx || camera.cropCanvas.getContext('2d', { willReadFrequently: true });

  scanLoop();
}

function stopCamera() {
  if (camera.animId) {
    clearTimeout(camera.animId);
    camera.animId = null;
  }
  camera.stream?.getTracks().forEach(t => t.stop());
  camera.stream = null;
  const video = $('#cameraFeed');
  if (!video) return;
  video.srcObject = null;
  video.hidden = true;
  $('#cameraPlaceholder').hidden = false;
  $('#cameraReticle').hidden = true;
  $('#cameraStatus').hidden = true;
  $('#toggleCameraBtn').innerHTML = `${icon('play')}Iniciar câmera`;
}

/**
 * Continuous high-frequency scan loop (25-30 FPS):
 * Scans immediately when code touches the viewfinder without delay.
 */
function scanLoop() {
  if (!camera.stream) return;
  scanFrame();
  camera.animId = setTimeout(() => requestAnimationFrame(scanLoop), 35);
}

function scanFrame() {
  const video = $('#cameraFeed');
  if (!video || !video.videoWidth || !video.videoHeight || camera.busy) return;
  if (Date.now() - camera.lastHit < 500) return;

  camera.busy = true;
  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    let code = null;

    // 1. FAST PASS: Center 65% crop (fastest, decodes in 2ms for "só de bater")
    const cropSize = Math.round(Math.min(vw, vh) * 0.65);
    const cropX = Math.round((vw - cropSize) / 2);
    const cropY = Math.round((vh - cropSize) / 2);
    const targetCrop = 320;

    if (camera.cropCanvas.width !== targetCrop) {
      camera.cropCanvas.width = targetCrop;
      camera.cropCanvas.height = targetCrop;
    }
    camera.cropCtx.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, targetCrop, targetCrop);
    let imgData = camera.cropCtx.getImageData(0, 0, targetCrop, targetCrop);
    code = jsQR(imgData.data, targetCrop, targetCrop, { inversionAttempts: 'attemptBoth' });

    // 2. FALLBACK PASS: Full downscaled frame (catches QR at corners / steep angles)
    if (!code) {
      const scale = Math.min(1, 540 / vw);
      const fw = Math.round(vw * scale);
      const fh = Math.round(vh * scale);
      if (camera.canvas.width !== fw) {
        camera.canvas.width = fw;
        camera.canvas.height = fh;
      }
      camera.ctx.drawImage(video, 0, 0, fw, fh);
      imgData = camera.ctx.getImageData(0, 0, fw, fh);
      code = jsQR(imgData.data, fw, fh, { inversionAttempts: 'attemptBoth' });
    }

    if (!code) return;

    let raw;
    try { raw = JSON.parse(code.data); } catch { return; }
    const data = normalizeQrData(raw);
    if (!data) return;

    camera.lastHit = Date.now();
    playBeep();
    navigator.vibrate?.([80, 40, 80]);

    const reticle = $('#cameraReticle');
    reticle?.classList.add('is-hit');
    setTimeout(() => reticle?.classList.remove('is-hit'), 450);

    const key = scannedKey(data);
    if (state.scanned.has(key)) {
      toast(`Palete #${data.paleteNumber} já lido!`);
      return;
    }
    state.scanned.set(key, data);
    renderScannedList();
    toast(`✓ Palete #${data.paleteNumber} lido com sucesso!`);
  } catch (e) {
  } finally {
    camera.busy = false;
  }
}

function renderScannedList() {
  const list = $('#scannedResults');
  const counter = $('#qrCounter');
  if (counter) counter.textContent = state.scanned.size;
  if (!list) return;
  list.innerHTML = [...state.scanned.entries()].reverse().map(([key, q]) => `
    <div class="row-card" data-action="scanned-open" data-key="${esc(key)}" role="button" tabindex="0">
      <div>
        <div style="display:flex;align-items:center;gap:6px">
          <strong>${esc(q.supplier)}</strong>
          <span class="badge badge-info" style="font-size:10px;padding:1px 6px">PALETE #${q.paleteNumber}</span>
        </div>
        <small>NF ${esc(q.invoiceNumber || 'N/A')} · Lote ${esc(q.lot)} · ${esc(q.material)}</small>
      </div>
      <button class="btn-icon btn-icon-danger" data-action="scanned-remove" data-key="${esc(key)}" aria-label="Remover leitura">${icon('trash')}</button>
    </div>`).join('');
}

/* ==================== 9. PDF GENERATION ==================== */
const PDF = { W: 210, H: 297, M: 12 };
const newDoc = () => new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

/** Shrinks font size until `text` fits `maxWidth` (mm). Returns the size used. */
function fitFont(doc, text, maxSize, minSize, maxWidth) {
  let size = maxSize;
  doc.setFontSize(size);
  while (size > minSize && doc.getTextWidth(text) > maxWidth) doc.setFontSize(--size);
  return size;
}

/** Truncates with an ellipsis so a single line never exceeds `maxWidth`. */
function clip(doc, text, maxWidth) {
  let t = String(text ?? '');
  if (doc.getTextWidth(t) <= maxWidth) return t;
  while (t.length > 1 && doc.getTextWidth(t + '…') > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

/**
 * A4 Palete Label with Palete Number stamped prominently in multiple locations
 * so operators can identify the pallet from any angle (top, side, bottom corners,
 * far away or wrapped in plastic):
 *   1. Header band top-left: PALETE #X (giant font 24 bold)
 *   2. Header band top-right: PALETE #X badge
 *   3. Sub-header bar: IDENTIFICAÇÃO · PALETE #X
 *   4. Left and Right vertical side margin stamps: ◄ PALETE #X
 *   5. Giant Level-H QR code (144mm, 30% error correction recovery)
 *   6. Mega-Banner 1: NOTA FISCAL: XXXXX
 *   7. Mega-Banner 2: PALETE #X (huge bold banner)
 *   8. Details table: row 1 explicitly highlights PALETE #X
 *   9. Bottom corners: PALETE #X stamps on left and right
 */
function drawPaleteLabel(doc, { paleteNumber, invoiceNumber, supplier, lot, material, date, qrImage }) {
  const { W, M } = PDF;
  const CW = W - M * 2; // 186mm printable width
  const paleteStr = `PALETE #${paleteNumber}`;
  const nfStr = String(invoiceNumber || 'N/A');

  // Background
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, W, 297, 'F');

  // ================= 1. HEADER BAND (0 - 24 mm) =================
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 24, 'F');

  // Top-Left: Giant Palete #
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text(paleteStr, M, 16);

  // Top-Right: High-contrast corner badge for Palete #
  const tagW = 44, tagH = 15;
  doc.setFillColor(59, 130, 246);
  doc.roundedRect(W - M - tagW, 4.5, tagW, tagH, 2.5, 2.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(paleteStr, W - M - (tagW / 2), 14.5, { align: 'center' });

  // Header sub-info
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225);
  doc.text(`Lote ${lot} · ${date}`, W - M - tagW - 4, 15, { align: 'right' });

  // ================= 2. TOP SUB-HEADER (26 - 32 mm) =================
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);
  doc.text(`RASTREABILIDADE INDUSTRIAL  ·  ${paleteStr}  ·  NF ${nfStr}`, W / 2, 30, { align: 'center' });

  // ================= 3. VERTICAL SIDE MARGIN STAMPS =================
  // Left and right side margins so forklift driver viewing pallet from side sees palete #
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  doc.text(`◄ ${paleteStr}  ·  NF ${nfStr}`, 5, 110, { angle: 90 });
  doc.text(`${paleteStr}  ·  NF ${nfStr} ►`, W - 5, 110, { angle: 270 });

  // ================= 4. GIANT QR CODE (34 - 176 mm) =================
  // 142mm square with Level-H error correction (decodes even if 30% occluded/dirty)
  const qrSize = 142;
  const qrX = (W - qrSize) / 2;
  const qrY = 34;
  if (qrImage) {
    doc.addImage(qrImage, 'PNG', qrX, qrY, qrSize, qrSize);
  }

  // ================= 5. DOUBLE MEGA-BANNERS (180 - 238 mm) =================
  // Banner 1: NOTA FISCAL (180 - 207 mm)
  const b1Y = 180, b1H = 26;
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(M, b1Y, CW, b1H, 2.5, 2.5, 'F');
  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('NOTA FISCAL', W / 2, b1Y + 7, { align: 'center' });
  doc.setTextColor(255, 255, 255);
  fitFont(doc, nfStr, 54, 22, CW - 10);
  doc.text(nfStr, W / 2, b1Y + b1H - 5, { align: 'center' });

  // Banner 2: PALETE #X (210 - 237 mm) — High-contrast royal blue banner!
  const b2Y = 209, b2H = 26;
  doc.setFillColor(30, 58, 138);
  doc.roundedRect(M, b2Y, CW, b2H, 2.5, 2.5, 'F');
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.6);
  doc.roundedRect(M, b2Y, CW, b2H, 2.5, 2.5, 'S');

  doc.setTextColor(191, 219, 254);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('IDENTIFICAÇÃO DO PALETE', W / 2, b2Y + 7, { align: 'center' });
  doc.setTextColor(255, 255, 255);
  fitFont(doc, paleteStr, 54, 24, CW - 10);
  doc.text(paleteStr, W / 2, b2Y + b2H - 5, { align: 'center' });

  // ================= 6. DETAILS TABLE (241 - 275 mm) =================
  const colW = CW / 2 - 4;
  const rows = [
    [['PALETE', paleteStr], ['NOTA FISCAL', nfStr]],
    [['FORNECEDOR', supplier], ['MATÉRIA-PRIMA', material]],
    [['LOTE', lot], ['DATA DE CHEGADA', date]]
  ];

  rows.forEach((row, r) => {
    row.forEach(([label, value], c) => {
      const x = M + c * (CW / 2);
      const y = 245 + r * 10;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(label, x, y);

      // Highlight palete and NF with bolder text
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(label === 'PALETE' ? 37 : 15, label === 'PALETE' ? 99 : 23, label === 'PALETE' ? 235 : 42);
      doc.text(clip(doc, value || '—', colW), x, y + 4.5);
    });
  });

  // ================= 7. FOUR-CORNER BOTTOM STAMPS & FOOTER (280 - 294 mm) =================
  // Bottom-Left corner stamp: PALETE #X
  const bCornerW = 44, bCornerH = 10;
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(M, 281, bCornerW, bCornerH, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(paleteStr, M + (bCornerW / 2), 287.5, { align: 'center' });

  // Center: Company name
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`${COMPANY_NAME}  ·  CONTROLE DE FLUIDEZ`, W / 2, 287.5, { align: 'center' });

  // Bottom-Right corner stamp: PALETE #X
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(W - M - bCornerW, 281, bCornerW, bCornerH, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(paleteStr, W - M - (bCornerW / 2), 287.5, { align: 'center' });
}

/** Builds label data for one palete of a load (QR rendered fresh at print resolution). */
function labelFor(load, palete, num) {
  const payload = buildQrPayload(load, palete, num);
  return {
    paleteNumber: num,
    invoiceNumber: load.invoiceNumber,
    supplier: load.supplier,
    lot: load.lot,
    material: payload.material,
    date: payload.date,
    qrImage: qrDataUrl(JSON.stringify(payload))
  };
}

/** Appends one page per label; returns the number of pages written. */
function writeLabels(doc, labels, startFresh) {
  labels.forEach((label, i) => {
    if (i > 0 || !startFresh) doc.addPage();
    drawPaleteLabel(doc, label);
  });
  return labels.length;
}

const loadLabels = load => paletesOf(load).map(([, p], i) => labelFor(load, p, i + 1));

function pdfLabel(loadId, paleteId, num) {
  const l = state.loads[loadId];
  const p = l?.paletes?.[paleteId];
  if (!p) return;
  const doc = newDoc();
  drawPaleteLabel(doc, labelFor(l, p, num));
  doc.save(`Etiqueta_NF${safeFile(l.invoiceNumber)}_P${num}.pdf`);
  toast('PDF gerado!');
}

function pdfLabelsLoad(loadId) {
  const l = state.loads[loadId];
  const labels = loadLabels(l);
  if (!labels.length) { toast('Sem paletes para gerar etiquetas', true); return; }
  const doc = newDoc();
  writeLabels(doc, labels, true);
  doc.save(`Etiquetas_NF${safeFile(l.invoiceNumber)}_Lote${safeFile(l.lot)}.pdf`);
  toast(`PDF com ${labels.length} etiqueta(s) gerado!`);
}

/** All labels in ONE file — avoids the browser's multiple-download blocking. */
function pdfLabelsAll() {
  const doc = newDoc();
  let pages = 0;
  sortedLoads().forEach(([, l]) => { pages += writeLabels(doc, loadLabels(l), pages === 0); });
  if (!pages) { toast('Nenhum palete para gerar etiquetas', true); return; }
  doc.save(`Etiquetas_Todas_${todayISO()}.pdf`);
  toast(`PDF com ${pages} etiqueta(s) gerado!`);
}

function pdfScanned(key) {
  const q = state.scanned.get(key);
  if (!q) return;
  const doc = newDoc();
  drawPaleteLabel(doc, {
    paleteNumber: q.paleteNumber, invoiceNumber: q.invoiceNumber, supplier: q.supplier,
    lot: q.lot, material: q.material, date: q.date, qrImage: qrDataUrl(JSON.stringify(q))
  });
  doc.save(`Etiqueta_NF${safeFile(q.invoiceNumber)}_P${q.paleteNumber}.pdf`);
  toast('PDF gerado!');
}

function drawLoadReport(doc, id) {
  const l = state.loads[id];
  const mat = materialOf(l);
  const s = getLoadStats(l);
  const st = loadStatus(s);
  const { W, M } = PDF;

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 42, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(state.appTitle, M, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Relatório de carregamento', M, 23);
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('Gerado em ' + new Date().toLocaleString('pt-BR'), M, 31);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text('NOTA FISCAL', W - M, 15, { align: 'right' });
  fitFont(doc, String(l.invoiceNumber || 'N/A'), 26, 12, 90);
  doc.text(String(l.invoiceNumber || 'N/A'), W - M, 28, { align: 'right' });

  let y = 54;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.text('Dados do carregamento', M, y);
  y += 8;
  doc.setFontSize(10);
  [
    ['Fornecedor', l.supplier], ['Lote', l.lot], ['Data', formatDate(l.date)],
    ['Responsável', l.responsible], ['Matéria-prima', mat?.name || 'N/A'],
    ['Faixa IF', mat ? `${mat.ifMin} – ${mat.ifMax} g/10min` : 'N/A']
  ].forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold'); doc.text(k + ':', M, y);
    doc.setFont('helvetica', 'normal'); doc.text(clip(doc, v || '—', 140), M + 40, y);
    y += 6.5;
  });

  y += 4;
  const ok = st.tone === 'success';
  const [bg, fg] = st.tone === 'info' ? [[226, 232, 240], [51, 65, 85]] : ok ? [[220, 252, 231], [21, 128, 61]] : [[254, 226, 226], [185, 28, 28]];
  doc.setFillColor(...bg);
  doc.roundedRect(M, y, W - M * 2, 22, 3, 3, 'F');
  doc.setTextColor(...fg);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Resultado: ' + st.label.toUpperCase(), M + 6, y + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Média IF ${s.measured ? s.avg.toFixed(2) : '—'} g/10min  ·  ${s.approved}/${s.measured} aprovados (${s.pct}%)${s.pending ? `  ·  ${s.pending} sem IF` : ''}`, M + 6, y + 17);
  y += 32;

  // Palete table
  const cols = [M, M + 30, M + 75, M + 120];
  const header = () => {
    doc.setFillColor(241, 245, 249);
    doc.rect(M, y - 5, W - M * 2, 8, 'F');
    doc.setTextColor(71, 85, 105);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    ['PALETE', 'DATA', 'IF (g/10min)', 'STATUS'].forEach((h, i) => doc.text(h, cols[i] + 2, y));
    y += 8;
  };
  header();
  doc.setFont('helvetica', 'normal');
  paletesOf(l).forEach(([, p], i) => {
    if (y > 280) { doc.addPage(); y = 20; header(); doc.setFont('helvetica', 'normal'); }
    const ps = paleteStatus(mat, p);
    doc.setTextColor(15, 23, 42);
    doc.text(String(i + 1), cols[0] + 2, y);
    doc.text(formatDate(p.date), cols[1] + 2, y);
    doc.text(fmtIF(p.ifValue), cols[2] + 2, y);
    doc.setTextColor(...(ps.tone === 'success' ? [21, 128, 61] : ps.tone === 'danger' ? [185, 28, 28] : [100, 116, 139]));
    doc.text(ps.label, cols[3] + 2, y);
    y += 6.5;
  });
}

function pdfReport(id) {
  const l = state.loads[id];
  if (!l) return;
  const doc = newDoc();
  drawLoadReport(doc, id);
  doc.save(`Relatorio_NF${safeFile(l.invoiceNumber)}_${safeFile(l.supplier)}.pdf`);
  toast('Relatório gerado!');
}

function pdfReportsAll() {
  const entries = sortedLoads();
  if (!entries.length) { toast('Nenhum carregamento', true); return; }
  const doc = newDoc();
  entries.forEach(([id], i) => { if (i) doc.addPage(); drawLoadReport(doc, id); });
  doc.save(`Relatorios_${todayISO()}.pdf`);
  toast(`${entries.length} relatório(s) em um PDF!`);
}

/* ==================== 10. ACTIONS & BOOT ==================== */
function goTab(tab) {
  if (tab !== 'camera') stopCamera();
  state.tab = tab;
  state.detail = null;
  render();
  $('#mainContent').scrollTop = 0;
}

function openDetail(type, id) {
  state.detail = { type, id };
  render();
  $('#mainContent').scrollTop = 0;
}

const actions = {
  'tab': d => goTab(d.tab),
  'back': d => goTab(d.to || state.tab),
  'open-load': d => openDetail('load', d.id),
  'open-qr-load': d => openDetail('qr', d.id),
  'modal-close': () => closeModal(),

  'new-material': () => materialModal(),
  'new-load': () => loadModal(),
  'edit-load': d => loadModal(d.id),
  'new-palete': d => paleteModal(d.id),
  'edit-palete': d => paleteModal(d.id, d.pid, d.num),
  'bulk-palete': d => bulkPaleteModal(d.id),
  'qr-modal': d => qrModal(d.id, d.pid, +d.num),

  'delete-material': d => {
    const inUse = Object.values(state.loads).some(l => l.materialId === d.id);
    const msg = inUse
      ? 'Esta matéria-prima está em uso por carregamentos. Excluir mesmo assim?'
      : 'Excluir esta matéria-prima?';
    if (confirm(msg)) db.ref('materials/' + d.id).remove().then(() => toast('Matéria-prima removida!'));
  },
  'delete-load': d => {
    if (!confirm('Excluir este carregamento e todos os seus paletes?')) return;
    db.ref('loads/' + d.id).remove().then(() => toast('Carregamento excluído!'));
    goTab(state.tab);
  },
  'delete-palete': d => {
    if (confirm('Excluir este palete?')) db.ref(`loads/${d.id}/paletes/${d.pid}`).remove().then(() => toast('Palete removido!'));
  },

  'pdf-label': d => pdfLabel(d.id, d.pid, +d.num),
  'pdf-labels-load': d => pdfLabelsLoad(d.id),
  'pdf-labels-all': () => pdfLabelsAll(),
  'pdf-report': d => pdfReport(d.id),
  'pdf-reports-all': () => pdfReportsAll(),
  'download-qr-png': (d, el) => {
    const img = el.closest('.modal-content')?.querySelector('.qr-preview img');
    if (!img) return;
    const a = document.createElement('a');
    a.href = img.src;
    a.download = `${d.name || 'qrcode'}.png`;
    a.click();
    toast('QR Code baixado!');
  },

  'camera-toggle': () => (camera.stream ? stopCamera() : startCamera()),
  'scanned-open': d => scannedModal(d.key),
  'scanned-remove': d => { state.scanned.delete(d.key); renderScannedList(); },
  'scanned-pdf': d => pdfScanned(d.key)
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  e.stopPropagation();
  fn(el.dataset, el, e);
});

// Keyboard activation for non-button rows that carry role="button".
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-action]')) {
    e.preventDefault();
    e.target.click();
  }
});

// Release the camera when the tab is hidden (battery + privacy).
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

// Optional host SDK (theme/title editing)
if (window.elementSdk) {
  window.elementSdk.init({
    defaultConfig,
    onConfigChange: async config => {
      state.appTitle = config.app_title || defaultConfig.app_title;
      document.body.style.background = config.background_color || defaultConfig.background_color;
      document.body.style.color = config.text_color || defaultConfig.text_color;
      document.body.style.fontFamily = `${config.font_family || defaultConfig.font_family}, sans-serif`;
      scheduleRender();
    },
    mapToCapabilities: config => {
      const color = key => ({
        get: () => config[key] || defaultConfig[key],
        set: v => { config[key] = v; window.elementSdk.setConfig({ [key]: v }); }
      });
      return {
        recolorables: ['background_color', 'surface_color', 'text_color', 'accent_color'].map(color),
        borderables: [],
        fontEditable: {
          get: () => config.font_family || defaultConfig.font_family,
          set: v => { config.font_family = v; window.elementSdk.setConfig({ font_family: v }); }
        },
        fontSizeable: undefined
      };
    },
    mapToEditPanelValues: config => new Map([['app_title', config.app_title || defaultConfig.app_title]])
  });
}

db.ref('materials').on('value', snap => { state.materials = snap.val() || {}; scheduleRender(); });
db.ref('loads').on('value', snap => { state.loads = snap.val() || {}; scheduleRender(); });

render();
window.__app = { state, actions, goTab, openDetail, render };
