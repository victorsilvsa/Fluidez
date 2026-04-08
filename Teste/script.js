// Firebase Init
const firebaseConfig = { databaseURL: "https://materiaprima-803a4-default-rtdb.firebaseio.com" };
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// State
let materials = {};
let loads = {};
let currentTab = 'home';
let currentLoadId = null;
let appTitle = 'Controle de Fluidez';

// Element SDK
const defaultConfig = {
  app_title: 'Controle de Fluidez',
  background_color: '#0f172a',
  surface_color: '#1e293b',
  text_color: '#f1f5f9',
  accent_color: '#3b82f6',
  font_family: 'DM Sans'
};

if (window.elementSdk) {
  window.elementSdk.init({
    defaultConfig,
    onConfigChange: async (config) => {
      appTitle = config.app_title || defaultConfig.app_title;
      document.body.style.background = config.background_color || defaultConfig.background_color;
      document.body.style.color = config.text_color || defaultConfig.text_color;
      document.body.style.fontFamily = `${config.font_family || defaultConfig.font_family}, sans-serif`;
      renderCurrentTab();
    },
    mapToCapabilities: (config) => ({
      recolorables: [
        { get: () => config.background_color || defaultConfig.background_color, set: v => { config.background_color = v; window.elementSdk.setConfig({ background_color: v }); } },
        { get: () => config.surface_color || defaultConfig.surface_color, set: v => { config.surface_color = v; window.elementSdk.setConfig({ surface_color: v }); } },
        { get: () => config.text_color || defaultConfig.text_color, set: v => { config.text_color = v; window.elementSdk.setConfig({ text_color: v }); } },
        { get: () => config.accent_color || defaultConfig.accent_color, set: v => { config.accent_color = v; window.elementSdk.setConfig({ accent_color: v }); } }
      ],
      borderables: [],
      fontEditable: { get: () => config.font_family || defaultConfig.font_family, set: v => { config.font_family = v; window.elementSdk.setConfig({ font_family: v }); } },
      fontSizeable: undefined
    }),
    mapToEditPanelValues: (config) => new Map([
      ['app_title', config.app_title || defaultConfig.app_title]
    ])
  });
}

// Firebase Listeners
db.ref('materials').on('value', snap => {
  materials = snap.val() || {};
  renderCurrentTab();
});
db.ref('loads').on('value', snap => {
  loads = snap.val() || {};
  renderCurrentTab();
});

// Helpers
function toast(msg, error = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' toast-error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function getLoadStats(load) {
  const mat = materials[load.materialId];
  const paletes = load.paletes ? Object.values(load.paletes) : [];
  const total = paletes.length;
  if (!total || !mat) return { total: 0, approved: 0, rejected: 0, avg: 0, pct: 0 };
  const approved = paletes.filter(p => p.ifValue >= mat.ifMin && p.ifValue <= mat.ifMax).length;
  const avg = paletes.reduce((s, p) => s + p.ifValue, 0) / total;
  return { total, approved, rejected: total - approved, avg, pct: Math.round((approved / total) * 100) };
}

function switchTab(tab) {
  currentTab = tab;
  currentLoadId = null;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderCurrentTab();
}

function renderCurrentTab() {
  const mc = document.getElementById('mainContent');
  if (!mc) return;
  if (currentLoadId) { renderLoadDetail(); return; }
  switch (currentTab) {
    case 'home': renderHome(); break;
    case 'loads': renderLoads(); break;
    case 'materials': renderMaterials(); break;
    case 'reports': renderReports(); break;
  }
}

// HOME
function renderHome() {
  const mc = document.getElementById('mainContent');
  const allLoads = Object.values(loads);
  let totalPaletes = 0, totalApproved = 0, totalRejected = 0;
  allLoads.forEach(l => { const s = getLoadStats(l); totalPaletes += s.total; totalApproved += s.approved; totalRejected += s.rejected; });
  mc.innerHTML = `
    <h1 style="font-size:22px;font-weight:700;margin-bottom:16px"><i class="fa-solid fa-chart-line" style="color:#3b82f6;margin-right:8px"></i>${appTitle}</h1>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      <div class="stat-card"><div class="stat-val">${allLoads.length}</div><div class="stat-label">Carregamentos</div></div>
      <div class="stat-card"><div class="stat-val">${totalPaletes}</div><div class="stat-label">Paletes</div></div>
      <div class="stat-card"><div class="stat-val" style="color:#22c55e">${totalApproved}</div><div class="stat-label">Aprovados</div></div>
      <div class="stat-card"><div class="stat-val" style="color:#ef4444">${totalRejected}</div><div class="stat-label">Reprovados</div></div>
    </div>
    <h2 style="font-size:16px;font-weight:600;margin-bottom:10px;color:#94a3b8">Últimos Carregamentos</h2>
    ${allLoads.length === 0 ? '<div class="card" style="text-align:center;color:#94a3b8"><i class="fa-solid fa-inbox" style="font-size:28px;margin-bottom:8px;display:block"></i>Nenhum carregamento ainda</div>' :
      Object.entries(loads).slice(-5).reverse().map(([id, l]) => {
        const s = getLoadStats(l);
        const matName = materials[l.materialId]?.name || 'N/A';
        return `<div class="card" style="cursor:pointer" onclick="openLoad('${id}')">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong>${l.supplier}</strong><br><span style="font-size:12px;color:#94a3b8">${matName} · Lote ${l.lot}</span></div>
          <span class="badge ${s.pct >= 80 ? 'badge-success' : 'badge-danger'}">${s.pct}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${s.pct}%;background:${s.pct >= 80 ? '#22c55e' : '#ef4444'}"></div></div>
      </div>`;
      }).join('')}
  `;
}

// LOADS
function renderLoads() {
  const mc = document.getElementById('mainContent');
  const entries = Object.entries(loads);
  mc.innerHTML = `
    <h1 style="font-size:20px;font-weight:700;margin-bottom:16px"><i class="fa-solid fa-truck" style="color:#3b82f6;margin-right:8px"></i>Carregamentos</h1>
    ${entries.length === 0 ? '<div class="card" style="text-align:center;color:#94a3b8">Nenhum carregamento. Toque + para criar.</div>' :
      entries.reverse().map(([id, l]) => {
        const s = getLoadStats(l);
        const matName = materials[l.materialId]?.name || 'N/A';
        return `<div class="card" style="cursor:pointer" onclick="openLoad('${id}')">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div>
            <strong>${l.supplier}</strong>
            <div style="font-size:12px;color:#94a3b8;margin-top:2px">${matName} · Lote ${l.lot} · NF: ${l.invoiceNumber || 'N/A'} · ${l.date}</div>
            <div style="font-size:12px;color:#94a3b8">Resp: ${l.responsible}</div>
          </div>
          <div style="text-align:right">
            <span class="badge ${s.total === 0 ? 'badge-info' : s.pct >= 80 ? 'badge-success' : 'badge-danger'}">${s.total === 0 ? 'Sem paletes' : s.pct + '% OK'}</span>
            <div style="font-size:11px;color:#94a3b8;margin-top:4px">${s.total} paletes</div>
          </div>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${s.pct}%;background:${s.pct >= 80 ? '#22c55e' : '#ef4444'}"></div></div>
      </div>`;
      }).join('')}
  `;
  document.querySelectorAll('.fab').forEach(f => f.remove());
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = '<i class="fa-solid fa-plus"></i>';
  fab.onclick = () => showNewLoadModal();
  document.body.appendChild(fab);
}

// MATERIALS
function renderMaterials() {
  const mc = document.getElementById('mainContent');
  const entries = Object.entries(materials);
  mc.innerHTML = `
    <h1 style="font-size:20px;font-weight:700;margin-bottom:16px"><i class="fa-solid fa-flask" style="color:#3b82f6;margin-right:8px"></i>Matérias-Primas</h1>
    ${entries.length === 0 ? '<div class="card" style="text-align:center;color:#94a3b8">Nenhuma matéria-prima. Toque + para criar.</div>' :
      entries.map(([id, m]) => `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <strong>${m.name}</strong>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px">IF: ${m.ifMin} — ${m.ifMax} g/10min</div>
        </div>
        <button class="btn-danger btn-sm" onclick="deleteMaterial('${id}')"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`).join('')}
  `;
  document.querySelectorAll('.fab').forEach(f => f.remove());
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = '<i class="fa-solid fa-plus"></i>';
  fab.onclick = () => showNewMaterialModal();
  document.body.appendChild(fab);
}

// REPORTS
function renderReports() {
  const mc = document.getElementById('mainContent');
  const entries = Object.entries(loads);
  
  // Filter by month
  const currentMonth = document.getElementById('monthFilter')?.value || new Date().toISOString().slice(0, 7);
  const filteredEntries = entries.filter(([id, l]) => l.date && l.date.slice(0, 7) === currentMonth);
  
  mc.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1 style="font-size:20px;font-weight:700"><i class="fa-solid fa-file-pdf" style="color:#3b82f6;margin-right:8px"></i>Relatórios</h1>
      <input type="month" id="monthFilter" class="input-field" value="${currentMonth}" style="width:140px;height:36px;font-size:13px" onchange="renderReports()">
    </div>
    ${filteredEntries.length === 0 ? '<div class="card" style="text-align:center;color:#94a3b8">Nenhum carregamento neste mês.</div>' :
      filteredEntries.reverse().map(([id, l]) => {
        const matName = materials[l.materialId]?.name || 'N/A';
        const s = getLoadStats(l);
        return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong>${l.supplier}</strong> — ${matName}
            <div style="font-size:12px;color:#94a3b8">NF: ${l.invoiceNumber || 'N/A'} · Lote ${l.lot} · ${s.total} paletes</div>
          </div>
          <button class="btn-primary btn-sm" onclick="generatePDF('${id}')"><i class="fa-solid fa-download" style="margin-right:4px"></i>PDF</button>
        </div>
      </div>`;
      }).join('')}
  `;
  document.querySelectorAll('.fab').forEach(f => f.remove());
}

// LOAD DETAIL
function openLoad(id) {
  currentLoadId = id;
  renderLoadDetail();
}

function renderLoadDetail() {
  const mc = document.getElementById('mainContent');
  const id = currentLoadId;
  const l = loads[id];
  if (!l) { switchTab('loads'); return; }
  const mat = materials[l.materialId];
  const matName = mat?.name || 'N/A';
  const paletes = l.paletes ? Object.entries(l.paletes) : [];
  const s = getLoadStats(l);
  const status = s.total === 0 ? 'PENDENTE' : s.pct >= 80 ? 'APROVADO' : 'REPROVADO';

  // Chart
  let chartHTML = '';
  if (paletes.length > 0 && mat) {
    const maxVal = Math.max(mat.ifMax * 1.3, ...paletes.map(([, p]) => p.ifValue));
    const minLine = (mat.ifMin / maxVal) * 100;
    const maxLine = (mat.ifMax / maxVal) * 100;
    chartHTML = `<div class="card">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:#94a3b8">Gráfico IF por Palete</div>
      <div style="position:relative;height:140px;padding-bottom:20px">
        <div class="chart-line" style="bottom:${minLine}%;border-color:#22c55e40"></div>
        <div class="chart-line" style="bottom:${maxLine}%;border-color:#ef444440"></div>
        <div style="position:absolute;left:-2px;bottom:${minLine}%;font-size:9px;color:#22c55e;transform:translateY(50%)">${mat.ifMin}</div>
        <div style="position:absolute;left:-2px;bottom:${maxLine}%;font-size:9px;color:#ef4444;transform:translateY(50%)">${mat.ifMax}</div>
        <div class="chart-bar-container" style="height:100%;padding-left:28px">
          ${paletes.map(([, p], i) => {
      const h = (p.ifValue / maxVal) * 100;
      const ok = mat && p.ifValue >= mat.ifMin && p.ifValue <= mat.ifMax;
      return `<div class="chart-bar" style="height:${h}%;background:${ok ? '#22c55e' : '#ef4444'}">
              <div class="chart-bar-label">P${i + 1}</div>
            </div>`;
    }).join('')}
        </div>
      </div>
    </div>`;
  }

  mc.innerHTML = `
    <div class="detail-header">
      <button class="back-btn" onclick="currentLoadId=null;renderCurrentTab()"><i class="fa-solid fa-arrow-left"></i></button>
      <div>
        <h1 style="font-size:18px;font-weight:700">${l.supplier}</h1>
        <div style="font-size:12px;color:#94a3b8">NF: ${l.invoiceNumber || 'N/A'} · ${matName} · Lote ${l.lot}</div>
      </div>
      <span class="badge ${status === 'APROVADO' ? 'badge-success' : status === 'REPROVADO' ? 'badge-danger' : 'badge-info'}" style="margin-left:auto">${status}</span>
    </div>
    <div class="card">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
        <div><span style="color:#94a3b8">Data:</span> ${l.date}</div>
        <div><span style="color:#94a3b8">NF:</span> ${l.invoiceNumber || 'N/A'}</div>
        <div><span style="color:#94a3b8">Faixa IF:</span> ${mat ? mat.ifMin + ' — ' + mat.ifMax : 'N/A'}</div>
        <div><span style="color:#94a3b8">Média IF:</span> ${s.avg ? s.avg.toFixed(2) : '—'}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button class="btn-primary" style="flex:1" onclick="showEditLoadModal('${id}')"><i class="fa-solid fa-edit" style="margin-right:6px"></i>Editar</button>
      <button class="btn-primary" style="flex:1" onclick="generatePDF('${id}')"><i class="fa-solid fa-download" style="margin-right:6px"></i>PDF</button>
    </div>
    ${chartHTML}
    <h2 style="font-size:15px;font-weight:600;margin-bottom:10px">Paletes (${s.total})</h2>
    ${paletes.length === 0 ? '<div class="card" style="text-align:center;color:#94a3b8">Nenhum palete. Toque + para adicionar.</div>' :
      paletes.map(([pid, p], i) => {
        const ok = mat && p.ifValue >= mat.ifMin && p.ifValue <= mat.ifMax;
        return `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <strong>Palete ${i + 1}</strong>
          <div style="font-size:12px;color:#94a3b8">${p.date} · IF: ${p.ifValue} g/10min</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="badge ${ok ? 'badge-success' : 'badge-danger'}">${ok ? 'OK' : 'Fora'}</span>
          <button class="btn-danger btn-sm" onclick="deletePalete('${id}','${pid}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`;
      }).join('')}
    <button class="btn-danger" style="width:100%;margin-top:12px" onclick="deleteLoad('${id}')"><i class="fa-solid fa-trash" style="margin-right:6px"></i>Excluir Carregamento</button>
  `;
  document.querySelectorAll('.fab').forEach(f => f.remove());
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = '<i class="fa-solid fa-plus"></i>';
  fab.onclick = () => showNewPaleteModal(id);
  document.body.appendChild(fab);
}

// MODALS
function closeModal() { document.querySelectorAll('.modal-overlay').forEach(m => m.remove()); window.removeEventListener('resize', handleViewportChange); }

function handleViewportChange() {
  const overlay = document.querySelector('.modal-overlay');
  if (!overlay) return;
  const vh = window.innerHeight;
  if (vh < 600) {
    overlay.classList.add('keyboard-open');
  } else {
    overlay.classList.remove('keyboard-open');
  }
}

function showNewMaterialModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
  overlay.innerHTML = `<div class="modal-content">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px"><i class="fa-solid fa-flask" style="color:#3b82f6;margin-right:8px"></i>Nova Matéria-Prima</h2>
    <form id="matForm" style="display:flex;flex-direction:column;gap:12px">
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Nome</label><input class="input-field" id="matName" required placeholder="Ex: Polietileno HD"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">IF Mínimo</label><input class="input-field" id="matMin" type="number" step="0.01" required placeholder="0.00"></div>
        <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">IF Máximo</label><input class="input-field" id="matMax" type="number" step="0.01" required placeholder="0.00"></div>
      </div>
      <button type="submit" class="btn-primary" style="width:100%">Salvar</button>
    </form>
  </div>`;
  document.body.appendChild(overlay);
  window.addEventListener('resize', handleViewportChange);
  handleViewportChange();
  document.getElementById('matForm').onsubmit = e => {
    e.preventDefault();
    const name = document.getElementById('matName').value.trim();
    const ifMin = parseFloat(document.getElementById('matMin').value);
    const ifMax = parseFloat(document.getElementById('matMax').value);
    if (!name || isNaN(ifMin) || isNaN(ifMax)) { toast('Preencha todos os campos', true); return; }
    if (ifMin >= ifMax) { toast('IF mínimo deve ser menor que máximo', true); return; }
    db.ref('materials').push({ name, ifMin, ifMax });
    toast('Matéria-prima salva!');
    closeModal();
  };
}

function showNewLoadModal() {
  const matEntries = Object.entries(materials);
  if (matEntries.length === 0) { toast('Cadastre uma matéria-prima primeiro', true); return; }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
  overlay.innerHTML = `<div class="modal-content">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px"><i class="fa-solid fa-truck" style="color:#3b82f6;margin-right:8px"></i>Novo Carregamento</h2>
    <form id="loadForm" style="display:flex;flex-direction:column;gap:12px">
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Data</label><input class="input-field" id="loadDate" type="date" required></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Nota Fiscal</label><input class="input-field" id="loadInvoice" required placeholder="Número da NF"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Fornecedor</label><input class="input-field" id="loadSupplier" required placeholder="Nome do fornecedor"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Lote</label><input class="input-field" id="loadLot" required placeholder="Número do lote"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Responsável</label><input class="input-field" id="loadResp" required placeholder="Nome do responsável"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Matéria-Prima</label>
        <select class="input-field" id="loadMat" required>
          ${matEntries.map(([id, m]) => `<option value="${id}">${m.name}</option>`).join('')}
        </select>
      </div>
      <button type="submit" class="btn-primary" style="width:100%">Salvar</button>
    </form>
  </div>`;
  document.body.appendChild(overlay);
  window.addEventListener('resize', handleViewportChange);
  handleViewportChange();
  document.getElementById('loadDate').valueAsDate = new Date();
  document.getElementById('loadForm').onsubmit = e => {
    e.preventDefault();
    const date = document.getElementById('loadDate').value;
    const invoiceNumber = document.getElementById('loadInvoice').value.trim();
    const supplier = document.getElementById('loadSupplier').value.trim();
    const lot = document.getElementById('loadLot').value.trim();
    const responsible = document.getElementById('loadResp').value.trim();
    const materialId = document.getElementById('loadMat').value;
    if (!date || !invoiceNumber || !supplier || !lot || !responsible) { toast('Preencha todos os campos', true); return; }
    db.ref('loads').push({ date, invoiceNumber, supplier, lot, responsible, materialId });
    toast('Carregamento criado!');
    closeModal();
  };
}

function showEditLoadModal(id) {
  const l = loads[id];
  if (!l) return;
  const matEntries = Object.entries(materials);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
  overlay.innerHTML = `<div class="modal-content">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px"><i class="fa-solid fa-edit" style="color:#3b82f6;margin-right:8px"></i>Editar Carregamento</h2>
    <form id="editLoadForm" style="display:flex;flex-direction:column;gap:12px">
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Data</label><input class="input-field" id="editDate" type="date" required value="${l.date}"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Nota Fiscal</label><input class="input-field" id="editInvoice" required placeholder="Número da NF" value="${l.invoiceNumber || ''}"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Fornecedor</label><input class="input-field" id="editSupplier" required placeholder="Nome do fornecedor" value="${l.supplier}"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Lote</label><input class="input-field" id="editLot" required placeholder="Número do lote" value="${l.lot}"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Responsável</label><input class="input-field" id="editResp" required placeholder="Nome do responsável" value="${l.responsible}"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Matéria-Prima</label>
        <select class="input-field" id="editMat" required>
          ${matEntries.map(([mid, m]) => `<option value="${mid}" ${mid === l.materialId ? 'selected' : ''}>${m.name}</option>`).join('')}
        </select>
      </div>
      <button type="submit" class="btn-primary" style="width:100%">Atualizar</button>
    </form>
  </div>`;
  document.body.appendChild(overlay);
  window.addEventListener('resize', handleViewportChange);
  handleViewportChange();
  document.getElementById('editLoadForm').onsubmit = e => {
    e.preventDefault();
    const date = document.getElementById('editDate').value;
    const invoiceNumber = document.getElementById('editInvoice').value.trim();
    const supplier = document.getElementById('editSupplier').value.trim();
    const lot = document.getElementById('editLot').value.trim();
    const responsible = document.getElementById('editResp').value.trim();
    const materialId = document.getElementById('editMat').value;
    if (!date || !invoiceNumber || !supplier || !lot || !responsible) { toast('Preencha todos os campos', true); return; }
    db.ref('loads/' + id).update({ date, invoiceNumber, supplier, lot, responsible, materialId });
    toast('Carregamento atualizado!');
    closeModal();
  };
}

function showNewPaleteModal(loadId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
  overlay.innerHTML = `<div class="modal-content">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px"><i class="fa-solid fa-vial" style="color:#3b82f6;margin-right:8px"></i>Novo Palete</h2>
    <form id="paleteForm" style="display:flex;flex-direction:column;gap:12px">
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Data da Análise</label><input class="input-field" id="palDate" type="date" required></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Valor IF (g/10min)</label><input class="input-field" id="palIF" type="number" step="0.01" required placeholder="0.00"></div>
      <button type="submit" class="btn-primary" style="width:100%">Adicionar</button>
    </form>
  </div>`;
  document.body.appendChild(overlay);
  window.addEventListener('resize', handleViewportChange);
  handleViewportChange();
  document.getElementById('palDate').valueAsDate = new Date();
  document.getElementById('paleteForm').onsubmit = e => {
    e.preventDefault();
    const date = document.getElementById('palDate').value;
    const ifValue = parseFloat(document.getElementById('palIF').value);
    if (!date || isNaN(ifValue)) { toast('Preencha todos os campos', true); return; }
    db.ref('loads/' + loadId + '/paletes').push({ date, ifValue });
    toast('Palete adicionado!');
    closeModal();
  };
}

// DELETE
function deleteMaterial(id) {
  const card = event.target.closest('.card');
  if (card.querySelector('.confirm-row')) return;
  const row = document.createElement('div');
  row.className = 'confirm-row';
  row.style.cssText = 'display:flex;gap:8px;margin-top:10px;justify-content:flex-end';
  row.innerHTML = `<span style="font-size:12px;color:#ef4444;line-height:28px">Confirmar exclusão?</span>
    <button class="btn-primary btn-sm" style="background:#ef4444" onclick="db.ref('materials/${id}').remove();toast('Removido!')">Sim</button>
    <button class="btn-primary btn-sm" style="background:#334155" onclick="this.parentElement.remove()">Não</button>`;
  card.appendChild(row);
}

function deleteLoad(id) {
  db.ref('loads/' + id).remove();
  toast('Carregamento excluído!');
  currentLoadId = null;
  renderCurrentTab();
}

function deletePalete(loadId, paleteId) {
  db.ref('loads/' + loadId + '/paletes/' + paleteId).remove();
  toast('Palete removido!');
}

// PDF
function generatePDF(id) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const l = loads[id];
  if (!l) return;
  const mat = materials[l.materialId];
  const matName = mat?.name || 'N/A';
  const paletes = l.paletes ? Object.values(l.paletes) : [];
  const s = getLoadStats(l);
  const status = s.total === 0 ? 'PENDENTE' : s.pct >= 80 ? 'APROVADO' : 'REPROVADO';

  // Header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 50, 'F');
  doc.setTextColor(241, 245, 249);
  doc.setFontSize(20);
  doc.text(appTitle, 14, 18);
  doc.setFontSize(12);
  doc.text('Relatório de Carregamento', 14, 30);
  doc.setFontSize(10);
  doc.text('NF: ' + (l.invoiceNumber || 'N/A'), 14, 38);
  doc.setFontSize(9);
  doc.text('Gerado em: ' + new Date().toLocaleString('pt-BR'), 14, 45);

  // Info
  doc.setTextColor(30, 41, 59);
  let y = 58;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Dados do Carregamento', 14, y);
  y += 8;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  const info = [
    ['Nota Fiscal', l.invoiceNumber || 'N/A'],
    ['Fornecedor', l.supplier],
    ['Lote', l.lot],
    ['Data', l.date],
    ['Responsável', l.responsible],
    ['Matéria-Prima', matName],
    ['Faixa IF', mat ? mat.ifMin + ' — ' + mat.ifMax + ' g/10min' : 'N/A']
  ];
  info.forEach(([k, v]) => {
    doc.setFont(undefined, 'bold'); doc.text(k + ': ', 14, y);
    doc.setFont(undefined, 'normal'); doc.text(v, 60, y);
    y += 6;
  });

  // Table
  y += 6;
  if (paletes.length > 0) {
    doc.autoTable({
      startY: y,
      head: [['#', 'Data Análise', 'IF (g/10min)', 'Status']],
      body: paletes.map((p, i) => {
        const ok = mat && p.ifValue >= mat.ifMin && p.ifValue <= mat.ifMax;
        return [i + 1, p.date, p.ifValue.toFixed(2), ok ? 'DENTRO' : 'FORA'];
      }),
      theme: 'grid',
      headStyles: { fillColor: [59, 130, 246], textColor: 255 },
      styles: { fontSize: 9 },
      didParseCell: function (data) {
        if (data.section === 'body' && data.column.index === 3) {
          data.cell.styles.textColor = data.cell.raw === 'DENTRO' ? [34, 197, 94] : [239, 68, 68];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // Summary
  doc.setFillColor(s.pct >= 80 ? 230 : 254, s.pct >= 80 ? 255 : 226, s.pct >= 80 ? 230 : 226);
  doc.roundedRect(14, y, 182, 24, 3, 3, 'F');
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(s.pct >= 80 ? 22 : 239, s.pct >= 80 ? 163 : 68, s.pct >= 80 ? 74 : 68);
  doc.text('Resultado: ' + status, 20, y + 10);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(`Média IF: ${s.avg.toFixed(2)} g/10min | ${s.approved}/${s.total} aprovados (${s.pct}%)`, 20, y + 18);

  doc.save(`Relatorio_NF${l.invoiceNumber}_${l.supplier}.pdf`);
  toast('PDF gerado!');
}

// Initial render
renderCurrentTab();

