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
let qrCache = {};
let scannedQRs = {};
let UIState = {
  expandedLoadId: null,
  showAdvancedOptions: false,
  filterMonth: null
};

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

// ==================== HELPERS ====================
function toast(msg, error = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' toast-error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function parseDate(dateStr) {
  return new Date(dateStr + 'T00:00:00');
}

function sortLoadsByDate(loadEntries) {
  return loadEntries.sort(([, a], [, b]) => {
    const dateA = parseDate(a.date);
    const dateB = parseDate(b.date);
    return dateB - dateA;
  });
}

function groupLoadsByMonth(loadEntries) {
  const grouped = {};
  loadEntries.forEach(([id, load]) => {
    const [year, month] = load.date.split('-');
    const monthKey = `${year}-${month}`;
    const monthName = new Date(year, parseInt(month) - 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    if (!grouped[monthKey]) grouped[monthKey] = { name: monthName, loads: [] };
    grouped[monthKey].loads.push([id, load]);
  });
  return grouped;
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
  UIState.expandedLoadId = null;
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
    case 'camera': renderCamera(); break;
    case 'qrcode': renderQRCode(); break;
    case 'materials': renderMaterials(); break;
  }
}

// ==================== HOME TAB ====================
function renderHome() {
  const mc = document.getElementById('mainContent');
  const allLoads = Object.values(loads);
  let totalPaletes = 0, totalApproved = 0, totalRejected = 0;
  allLoads.forEach(l => { const s = getLoadStats(l); totalPaletes += s.total; totalApproved += s.approved; totalRejected += s.rejected; });

  const recentLoads = sortLoadsByDate(Object.entries(loads)).slice(0, 5);

  mc.innerHTML = `
    <h1 style="font-size:24px;font-weight:700;margin-bottom:20px"><i class="fa-solid fa-chart-line" style="color:#3b82f6;margin-right:10px"></i>${appTitle}</h1>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
      <div class="stat-card"><div class="stat-val">${allLoads.length}</div><div class="stat-label">Carregamentos</div></div>
      <div class="stat-card"><div class="stat-val">${totalPaletes}</div><div class="stat-label">Paletes</div></div>
      <div class="stat-card"><div class="stat-val" style="color:#22c55e">${totalApproved}</div><div class="stat-label">Aprovados</div></div>
      <div class="stat-card"><div class="stat-val" style="color:#ef4444">${totalRejected}</div><div class="stat-label">Reprovados</div></div>
    </div>
    <h2 style="font-size:16px;font-weight:600;margin-bottom:12px;color:#94a3b8">Carregamentos Recentes</h2>
    ${recentLoads.length === 0 ? '<div class="card" style="text-align:center;color:#94a3b8;padding:24px"><i class="fa-solid fa-inbox" style="font-size:32px;margin-bottom:8px;display:block"></i>Nenhum carregamento ainda</div>' :
      recentLoads.map(([id, l]) => {
        const s = getLoadStats(l);
        const matName = materials[l.materialId]?.name || 'N/A';
        return `<div class="card" style="cursor:pointer;transition:all 0.3s ease" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 16px rgba(59, 130, 246, 0.15)'" onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='0 4px 6px rgba(0, 0, 0, 0.2)'" onclick="openLoadDetail('${id}')">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:10px">
            <div>
              <div style="font-size:14px;font-weight:600;color:#f1f5f9">${l.supplier}</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:4px"><i class="fa-solid fa-calendar" style="margin-right:4px;width:12px"></i>${formatDate(l.date)}</div>
              <div style="font-size:11px;color:#64748b;margin-top:3px">NF: ${l.invoiceNumber || 'N/A'} · Lote: ${l.lot}</div>
            </div>
            <span class="badge ${s.pct >= 80 ? 'badge-success' : s.pct === 0 ? 'badge-info' : 'badge-danger'}" style="font-weight:600">${s.pct}%</span>
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-bottom:8px">${matName} · ${s.total} paletes</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${s.pct}%;background:${s.pct >= 80 ? '#22c55e' : '#ef4444'};transition:width 0.3s ease"></div></div>
        </div>`;
      }).join('')}
  `;
}

// ==================== LOADS TAB ====================
function renderLoads() {
  const mc = document.getElementById('mainContent');
  const entries = Object.entries(loads);

  if (entries.length === 0) {
    mc.innerHTML = `
      <h1 style="font-size:20px;font-weight:700;margin-bottom:20px"><i class="fa-solid fa-truck" style="color:#3b82f6;margin-right:8px"></i>Carregamentos</h1>
      <div class="card" style="text-align:center;color:#94a3b8;padding:32px">
        <i class="fa-solid fa-inbox" style="font-size:40px;margin-bottom:12px;display:block"></i>
        <p>Nenhum carregamento cadastrado</p>
        <p style="font-size:12px;margin-top:8px">Toque o botão + para criar um novo</p>
      </div>
    `;
    document.querySelectorAll('.fab').forEach(f => f.remove());
    const fab = document.createElement('button');
    fab.className = 'fab';
    fab.innerHTML = '<i class="fa-solid fa-plus"></i>';
    fab.onclick = () => showNewLoadModal();
    document.body.appendChild(fab);
    return;
  }

  const grouped = groupLoadsByMonth(sortLoadsByDate(entries));
  const monthKeys = Object.keys(grouped).sort().reverse();

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1 style="font-size:20px;font-weight:700"><i class="fa-solid fa-truck" style="color:#3b82f6;margin-right:8px"></i>Carregamentos</h1>
      <button id="toggleAdvOpts" class="btn-secondary" style="padding:8px 12px;background:#334155;border:none;border-radius:6px;color:#f1f5f9;cursor:pointer;font-size:12px;font-weight:600">
        <i class="fa-solid fa-sliders" style="margin-right:6px"></i>Opções
      </button>
    </div>
    
    <div id="advancedOptionsPanel" style="display:none;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:12px;margin-bottom:16px">
      <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;font-weight:600">FILTROS E AÇÕES</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="btn-secondary" style="padding:8px;background:#3b82f6;border:none;border-radius:6px;color:#f1f5f9;cursor:pointer;font-size:11px;font-weight:600" onclick="generateAllQRPDFs()">
          <i class="fa-solid fa-qrcode" style="margin-right:4px"></i>QR Códigos
        </button>
        <button class="btn-secondary" style="padding:8px;background:#3b82f6;border:none;border-radius:6px;color:#f1f5f9;cursor:pointer;font-size:11px;font-weight:600" onclick="generateAllReports()">
          <i class="fa-solid fa-file-pdf" style="margin-right:4px"></i>Relatórios
        </button>
      </div>
    </div>
  `;

  html += monthKeys.map(monthKey => {
    const group = grouped[monthKey];
    return `
      <div style="margin-bottom:20px">
        <h3 style="font-size:13px;font-weight:700;color:#64748b;text-transform:capitalize;margin-bottom:12px;padding:0 12px;letter-spacing:0.5px">${group.name}</h3>
        ${group.loads.map(([id, l]) => {
      const s = getLoadStats(l);
      const matName = materials[l.materialId]?.name || 'N/A';
      const statusColor = s.total === 0 ? 'badge-info' : s.pct >= 80 ? 'badge-success' : 'badge-danger';
      const statusText = s.total === 0 ? 'Pendente' : s.pct + '% OK';
      return `
            <div class="card" style="cursor:pointer;margin-bottom:10px;transition:all 0.3s ease" onmouseover="this.style.transform='translateX(4px)'" onmouseout="this.style.transform='translateX(0)'" onclick="openLoadDetail('${id}')">
              <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
                <div style="flex:1">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    <div style="width:4px;height:24px;background:${s.pct >= 80 ? '#22c55e' : '#ef4444'};border-radius:2px"></div>
                    <strong style="font-size:14px">${l.supplier}</strong>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;color:#94a3b8;margin-bottom:6px">
                    <div><i class="fa-solid fa-calendar" style="margin-right:4px;width:12px"></i>${formatDate(l.date)}</div>
                    <div><i class="fa-solid fa-file" style="margin-right:4px;width:12px"></i>NF: ${l.invoiceNumber || 'N/A'}</div>
                    <div><i class="fa-solid fa-cube" style="margin-right:4px;width:12px"></i>Lote: ${l.lot}</div>
                    <div><i class="fa-solid fa-flask" style="margin-right:4px;width:12px"></i>${matName}</div>
                  </div>
                  <div style="font-size:10px;color:#64748b"><i class="fa-solid fa-user" style="margin-right:4px;width:12px"></i>Resp: ${l.responsible}</div>
                </div>
                <div style="text-align:right">
                  <span class="badge ${statusColor}" style="font-weight:600;white-space:nowrap">${statusText}</span>
                  <div style="font-size:11px;color:#94a3b8;margin-top:6px">${s.total} paletes</div>
                </div>
              </div>
              <div class="progress-bar" style="margin-top:10px"><div class="progress-fill" style="width:${s.pct}%;background:${s.pct >= 80 ? '#22c55e' : '#ef4444'};transition:width 0.3s ease"></div></div>
            </div>
          `;
    }).join('')}
      </div>
    `;
  }).join('');

  mc.innerHTML = html;

  // Toggle Advanced Options
  document.getElementById('toggleAdvOpts').onclick = function () {
    const panel = document.getElementById('advancedOptionsPanel');
    UIState.showAdvancedOptions = !UIState.showAdvancedOptions;
    panel.style.display = UIState.showAdvancedOptions ? 'block' : 'none';
    this.style.background = UIState.showAdvancedOptions ? '#3b82f6' : '#334155';
  };

  document.querySelectorAll('.fab').forEach(f => f.remove());
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = '<i class="fa-solid fa-plus"></i>';
  fab.onclick = () => showNewLoadModal();
  document.body.appendChild(fab);
}

// ==================== QR CODE TAB ====================
function renderQRCode() {
  const mc = document.getElementById('mainContent');
  const entries = Object.entries(loads);

  mc.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <h1 style="font-size:20px;font-weight:700"><i class="fa-solid fa-qrcode" style="color:#3b82f6;margin-right:8px"></i>Gerador de QR Codes</h1>
      <button id="toggleQROptions" class="btn-secondary" style="padding:8px 12px;background:#334155;border:none;border-radius:6px;color:#f1f5f9;cursor:pointer;font-size:12px;font-weight:600">
        <i class="fa-solid fa-cog" style="margin-right:6px"></i>Ações
      </button>
    </div>
    
    <div id="qrOptionsPanel" style="display:none;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:12px;margin-bottom:16px">
      <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;font-weight:600">OPÇÕES RÁPIDAS</div>
      <button class="btn-secondary" style="width:100%;padding:10px;background:#3b82f6;border:none;border-radius:6px;color:#f1f5f9;cursor:pointer;font-size:12px;font-weight:600;margin-bottom:8px" onclick="generateAllQRPDFs()">
        <i class="fa-solid fa-download" style="margin-right:6px"></i>Baixar Todos QR Codes em PDF
      </button>
    </div>
    
    ${entries.length === 0 ? '<div class="card" style="text-align:center;color:#94a3b8;padding:32px"><i class="fa-solid fa-inbox" style="font-size:40px;margin-bottom:12px;display:block"></i><p>Nenhum carregamento para gerar QR Code</p></div>' :
      entries.map(([id, l]) => {
        const s = getLoadStats(l);
        const matName = materials[l.materialId]?.name || 'N/A';
        return `
          <div class="card" style="cursor:pointer;margin-bottom:10px;transition:all 0.3s ease" onclick="openQRGenerator('${id}')">
            <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
              <div style="flex:1">
                <strong style="font-size:14px;display:block;margin-bottom:6px">${l.supplier}</strong>
                <div style="font-size:11px;color:#94a3b8"><i class="fa-solid fa-calendar" style="margin-right:4px;width:12px"></i>${formatDate(l.date)} · NF: ${l.invoiceNumber || 'N/A'}</div>
                <div style="font-size:11px;color:#94a3b8;margin-top:4px"><i class="fa-solid fa-cube" style="margin-right:4px;width:12px"></i>Lote: ${l.lot} · ${matName}</div>
              </div>
              <span class="badge badge-info" style="font-weight:600">${s.total} paletes</span>
            </div>
          </div>
        `;
      }).join('')}
  `;

  document.getElementById('toggleQROptions').onclick = function () {
    const panel = document.getElementById('qrOptionsPanel');
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'block';
    this.style.background = isVisible ? '#334155' : '#3b82f6';
  };

  document.querySelectorAll('.fab').forEach(f => f.remove());
}

function openQRGenerator(loadId) {
  currentLoadId = loadId;
  const l = loads[loadId];
  const mat = materials[l.materialId];
  const matName = mat?.name || 'N/A';
  const paletes = l.paletes ? Object.entries(l.paletes) : [];

  const mc = document.getElementById('mainContent');
  mc.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <button class="back-btn" onclick="switchTab('qrcode');currentLoadId=null" style="padding:8px;background:#334155;border-radius:6px;border:none;color:#f1f5f9;cursor:pointer"><i class="fa-solid fa-arrow-left"></i></button>
      <div style="flex:1">
        <h1 style="font-size:20px;font-weight:700">${l.supplier}</h1>
        <div style="font-size:12px;color:#94a3b8;margin-top:4px">Lote ${l.lot} · ${matName}</div>
      </div>
    </div>
    
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn-primary" style="flex:1;padding:10px;background:#3b82f6;border:none;border-radius:6px;color:#f1f5f9;cursor:pointer;font-size:12px;font-weight:600" onclick="generateQRPDFLoad('${loadId}')">
        <i class="fa-solid fa-file-pdf" style="margin-right:6px"></i>Gerar PDF Todos
      </button>
      <button class="btn-primary" style="flex:1;padding:10px;background:#22c55e;border:none;border-radius:6px;color:#f1f5f9;cursor:pointer;font-size:12px;font-weight:600" onclick="showBulkPaleteModal('${loadId}')">
        <i class="fa-solid fa-plus" style="margin-right:6px"></i>Adicionar Lote
      </button>
    </div>
    
    <h2 style="font-size:14px;font-weight:700;margin:16px 0 12px 0;color:#f1f5f9"><i class="fa-solid fa-cubes" style="margin-right:6px;color:#3b82f6"></i>Selecione um Palete</h2>
    ${paletes.length === 0 ? '<div class="card" style="text-align:center;color:#94a3b8;padding:24px"><i class="fa-solid fa-inbox" style="font-size:32px;margin-bottom:8px;display:block"></i>Nenhum palete neste carregamento</div>' :
      paletes.map(([pid, p], i) => `
        <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;cursor:pointer;transition:all 0.3s ease" onmouseover="this.style.background='#334155'" onmouseout="this.style.background='#1e293b'" onclick="showQRCodeModal('${loadId}','${pid}',${i + 1})">
          <div>
            <strong style="font-size:13px;display:block">Palete ${i + 1}</strong>
            <div style="font-size:11px;color:#94a3b8;margin-top:4px"><i class="fa-solid fa-calendar" style="margin-right:4px;width:12px"></i>${formatDate(p.date)} · IF: ${p.ifValue.toFixed(2)} g/10min</div>
          </div>
          <i class="fa-solid fa-qrcode" style="font-size:20px;color:#3b82f6"></i>
        </div>
      `).join('')}
  `;
  document.querySelectorAll('.fab').forEach(f => f.remove());
}

function showQRCodeModal(loadId, paleteId, paleteNum) {
  const l = loads[loadId];
  const mat = materials[l.materialId];
  const matName = mat?.name || 'N/A';

  const qrData = {
    supplier: l.supplier,
    invoiceNumber: l.invoiceNumber,
    lot: l.lot,
    material: matName,
    paleteNumber: paleteNum,
    date: formatDate(l.date),
    responsible: l.responsible,
    ifValue: l.paletes[paleteId].ifValue
  };

  const qrString = JSON.stringify(qrData);
  const qrId = `qr-${loadId}-${paleteId}`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
  overlay.innerHTML = `<div class="modal-content">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700"><i class="fa-solid fa-qrcode" style="color:#3b82f6;margin-right:8px"></i>QR Code - Palete ${paleteNum}</h2>
      <button onclick="closeModal()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:20px"><i class="fa-solid fa-x"></i></button>
    </div>
    
    <div class="qr-info-display">
      <div><strong>Fornecedor:</strong> ${l.supplier}</div>
      <div style="margin-top:6px"><strong>NF:</strong> ${l.invoiceNumber}</div>
      <div style="margin-top:6px"><strong>Lote:</strong> ${l.lot}</div>
      <div style="margin-top:6px"><strong>Matéria-Prima:</strong> ${matName}</div>
      <div style="margin-top:6px"><strong>Palete:</strong> ${paleteNum}</div>
      <div style="margin-top:6px"><strong>IF Value:</strong> ${l.paletes[paleteId].ifValue.toFixed(2)} g/10min</div>
      <div style="margin-top:6px"><strong>Responsável:</strong> ${l.responsible}</div>
    </div>
    
    <div class="qr-container" id="${qrId}"></div>
    
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px">
      <button class="btn-primary" style="background:#3b82f6;padding:10px;border-radius:6px;border:none;color:#f1f5f9;cursor:pointer;font-size:13px;font-weight:600" onclick="downloadQRCodeImage('${qrId}','palete_${paleteNum}_${l.lot}')"><i class="fa-solid fa-download" style="margin-right:6px"></i>Imagem</button>
      <button class="btn-primary" style="background:#3b82f6;padding:10px;border-radius:6px;border:none;color:#f1f5f9;cursor:pointer;font-size:13px;font-weight:600" onclick="downloadQRCodePDF('${qrId}','palete_${paleteNum}_${l.lot}')"><i class="fa-solid fa-file-pdf" style="margin-right:6px"></i>PDF</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);
  window.addEventListener('resize', handleViewportChange);
  handleViewportChange();

  setTimeout(() => {
    const qrContainer = document.getElementById(qrId);
    if (qrContainer && !qrContainer.innerHTML.includes('canvas')) {
      new QRCode(qrContainer, {
        text: qrString,
        width: 200,
        height: 200,
        colorDark: '#000000',
        colorLight: '#ffffff'
      });
    }
  }, 100);
}

function downloadQRCodeImage(qrId, filename) {
  const qrElement = document.getElementById(qrId);
  const canvas = qrElement.querySelector('canvas');
  if (!canvas) { toast('QR Code não gerado', true); return; }

  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = `${filename}.png`;
  link.click();
  toast('QR Code baixado!');
}

function downloadQRCodePDF(qrId, filename) {
  const { jsPDF } = window.jspdf;
  const qrElement = document.getElementById(qrId);
  const canvas = qrElement.querySelector('canvas');
  if (!canvas) { toast('QR Code não gerado', true); return; }

  const modalContent = qrElement.closest('.modal-content');
  const modalTitle = modalContent.querySelector('h2').textContent;
  const paleteNum = modalTitle.match(/Palete (\d+)/)[1];

  let loadId, loadData;
  for (const [lid, l] of Object.entries(loads)) {
    if (l.paletes) {
      for (const [pid, p] of Object.entries(l.paletes)) {
        if (`qr-${lid}-${pid}` === qrId) {
          loadId = lid;
          loadData = l;
          break;
        }
      }
    }
  }

  if (!loadData) { toast('Erro ao gerar PDF', true); return; }

  const matName = materials[loadData.materialId]?.name || 'N/A';
  const palete = loadData.paletes[Object.keys(loadData.paletes).find(pid => `qr-${loadId}-${pid}` === qrId)];
  const dataRegistro = palete?.date || loadData.date;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, 210, 297, 'F');

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 55, 'F');

  doc.setTextColor(241, 245, 249);
  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');

  doc.text('PALETE #' + paleteNum, 15, 5);

  doc.text('Lote: ' + loadData.lot, 15, 18);
  doc.text('Material: ' + matName, 15, 28);

  doc.setTextColor(200, 200, 200);
  doc.setFontSize(8);
  doc.text('Data: ' + formatDate(dataRegistro), 15, 45);

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(32);
  doc.setFont(undefined, 'bold');
  doc.text('PALETE #' + paleteNum, 105, 72, { align: 'center' });

  const qrImage = canvas.toDataURL('image/png');
  const qrSize = 120;
  const qrX = (210 - qrSize) / 2;
  doc.addImage(qrImage, 'PNG', qrX, 85, qrSize, qrSize);

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('DETALHES DA MATÉRIA-PRIMA', 15, 220);

  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.5);
  doc.line(15, 224, 195, 224);

  doc.setFont(undefined, 'normal');
  doc.setFontSize(12);
  doc.text('Tipo: ' + matName, 15, 238);
  doc.text('Data de Chegada: ' + formatDate(dataRegistro), 15, 252);

  doc.setFontSize(8);
  doc.setTextColor(150, 160, 170);
  doc.text('EMBALAGENS TATUÍ', 15, 290);

  doc.save(`${filename}.pdf`);
  toast('PDF gerado!');
}

function generateQRPDFLoad(loadId) {
  const { jsPDF } = window.jspdf;
  const l = loads[loadId];
  if (!l || !l.paletes) { toast('Sem paletes para gerar QR Codes', true); return; }

  const mat = materials[l.materialId];
  const matName = mat?.name || 'N/A';
  const paletes = Object.entries(l.paletes);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  let isFirstPage = true;
  let qrCount = 0;
  let qrsGenerated = 0;

  const generateQRsAndPDF = async () => {
    for (let index = 0; index < paletes.length; index++) {
      const [pid, p] = paletes[index];

      if (!isFirstPage) {
        doc.addPage();
      }
      isFirstPage = false;

      const paleteNum = index + 1;

      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, 210, 297, 'F');

      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 210, 50, 'F');

      doc.setTextColor(241, 245, 249);
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      doc.text('PALETE #' + paleteNum, 15, 10);
      doc.text('Lote: ' + l.lot, 15, 20);
      doc.text('Material: ' + matName, 15, 30);

      doc.setTextColor(200, 200, 200);
      doc.setFontSize(8);
      doc.text('Data: ' + formatDate(p.date), 15, 40);

      doc.setTextColor(30, 41, 59);
      doc.setFontSize(32);
      doc.setFont(undefined, 'bold');
      doc.text('PALETE #' + paleteNum, 105, 72, { align: 'center' });

      const qrData = {
        supplier: l.supplier,
        invoiceNumber: l.invoiceNumber,
        lot: l.lot,
        material: matName,
        paleteNumber: paleteNum,
        date: formatDate(p.date),
        responsible: l.responsible,
        ifValue: p.ifValue
      };

      const qrString = JSON.stringify(qrData);

      await new Promise((resolve) => {
        const tempContainer = document.createElement('div');
        tempContainer.style.display = 'none';
        document.body.appendChild(tempContainer);

        new QRCode(tempContainer, {
          text: qrString,
          width: 200,
          height: 200,
          colorDark: '#000000',
          colorLight: '#ffffff'
        });

        setTimeout(() => {
          const canvas = tempContainer.querySelector('canvas');
          if (canvas) {
            const qrImage = canvas.toDataURL('image/png');
            const qrSize = 120;
            const qrX = (210 - qrSize) / 2;
            doc.addImage(qrImage, 'PNG', qrX, 85, qrSize, qrSize);
            qrsGenerated++;
          }
          tempContainer.remove();
          resolve();
        }, 200);
      });

      doc.setTextColor(30, 41, 59);
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text('DETALHES DA MATÉRIA-PRIMA', 15, 220);

      doc.setDrawColor(59, 130, 246);
      doc.setLineWidth(0.5);
      doc.line(15, 224, 195, 224);

      doc.setFont(undefined, 'normal');
      doc.setFontSize(12);
      doc.text('Tipo: ' + matName, 15, 238);
      doc.text('Data de Chegada: ' + formatDate(p.date), 15, 252);
   
      doc.setFontSize(8);
      doc.setTextColor(150, 160, 170);
      doc.text('EMBALAGENS TATUÍ', 15, 290);
    }

    doc.save(`QR_Codes_Lote_${l.lot}.pdf`);
    toast('PDF com ' + qrsGenerated + ' QR Code(s) gerado!');
  };

  generateQRsAndPDF();
}

function generateAllQRPDFs() {
  const allLoads = Object.entries(loads);
  if (allLoads.length === 0) { toast('Nenhum carregamento', true); return; }

  let processedCount = 0;
  const totalLoads = allLoads.length;

  const processLoad = (index) => {
    if (index >= allLoads.length) {
      toast(`Gerados ${processedCount} PDF(s) com QR Codes!`);
      return;
    }

    const [id] = allLoads[index];

    setTimeout(() => {
      generateQRPDFLoad(id);
      processedCount++;
      processLoad(index + 1);
    }, 800);
  };

  toast('Gerando ' + totalLoads + ' PDF(s)...');
  processLoad(0);
}



// ==================== CAMERA TAB ====================
function renderCamera() {
  const mc = document.getElementById('mainContent');
  mc.innerHTML = `
    <h1 style="font-size:20px;font-weight:700;margin-bottom:20px"><i class="fa-solid fa-camera" style="color:#3b82f6;margin-right:8px"></i>Leitor de QR Code</h1>
    
    <div style="position:relative;border-radius:12px;overflow:hidden;background:#0f172a;margin-bottom:16px;aspect-ratio:1/1;max-height:380px;box-shadow:0 8px 32px rgba(59,130,246,0.2)">
      <video id="cameraFeed" style="width:100%;height:100%;object-fit:cover;display:none"></video>
      <div id="cameraPlaceholder" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg, #1e293b, #0f172a);color:#94a3b8;font-size:14px;flex-direction:column;gap:12px">
        <i class="fa-solid fa-video" style="font-size:48px;color:#3b82f6;opacity:0.6"></i>
        <span style="font-weight:600">Câmera não iniciada</span>
      </div>
      
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:10;opacity:0;transition:opacity 0.3s" id="cameraReticle">
        <div style="width:200px;height:200px;border:2px solid #3b82f6;border-radius:50%;position:relative">
          <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:6px;height:6px;background:#22c55e;border-radius:50%;box-shadow:0 0 10px rgba(34,197,94,0.8)"></div>
        </div>
      </div>
      
      <div id="cameraStatus" style="position:absolute;top:12px;left:12px;display:flex;align-items:center;gap:6px;background:rgba(34,197,94,0.15);padding:8px 12px;border-radius:6px;border:1px solid rgba(34,197,94,0.4);opacity:0;transition:opacity 0.3s;font-size:11px;color:#22c55e;font-weight:600">
        <div style="width:6px;height:6px;background:#22c55e;border-radius:50%;animation:pulse 1.5s infinite"></div>
        <span>Ativo</span>
      </div>
    </div>
    
    <style>
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    </style>
    
    <div style="display:flex;gap:12px;margin-bottom:16px">
      <button class="btn-primary" style="flex:1;padding:12px;background:#3b82f6;border:none;border-radius:8px;color:#f1f5f9;font-weight:600;cursor:pointer;font-size:14px" id="toggleCameraBtn"><i class="fa-solid fa-play" style="margin-right:6px"></i>Iniciar</button>
      <div style="padding:12px;background:#334155;border-radius:8px;border:1px solid #475569;color:#94a3b8;font-weight:600;font-size:13px;text-align:center;min-width:80px">
        <span id="qrCounter">0</span>
      </div>
    </div>
    
    <div id="scannedResults" style="margin-top:12px"></div>
  `;
  document.querySelectorAll('.fab').forEach(f => f.remove());

  setTimeout(() => {
    const videoElement = document.getElementById('cameraFeed');
    const placeholder = document.getElementById('cameraPlaceholder');
    const toggleBtn = document.getElementById('toggleCameraBtn');
    const statusIndicator = document.getElementById('cameraStatus');
    const reticle = document.getElementById('cameraReticle');
    const qrCounter = document.getElementById('qrCounter');
    let isCameraActive = false;
    let stream = null;
    let scanInterval = null;
    let lastScannedTime = 0;

    toggleBtn.onclick = async () => {
      if (!isCameraActive) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'environment',
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          });
          videoElement.srcObject = stream;
          videoElement.style.display = 'block';
          placeholder.style.display = 'none';
          videoElement.play();
          toggleBtn.innerHTML = '<i class="fa-solid fa-stop" style="margin-right:6px"></i>Parar';
          statusIndicator.style.opacity = '1';
          reticle.style.opacity = '1';
          isCameraActive = true;

          scanInterval = setInterval(() => {
            if (!isCameraActive || videoElement.videoWidth === 0) return;

            const now = Date.now();
            if (now - lastScannedTime < 500) return;

            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = 480;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, canvas.width, canvas.height);

            if (code) {
              try {
                const qrData = JSON.parse(code.data);
                lastScannedTime = now;
                if (navigator.vibrate) navigator.vibrate(100);

                const reticleEl = document.getElementById('cameraReticle');
                if (reticleEl) {
                  reticleEl.style.borderColor = '#22c55e';
                  setTimeout(() => {
                    if (reticleEl && document.body.contains(reticleEl)) {
                      reticleEl.style.borderColor = '#3b82f6';
                    }
                  }, 400);
                }
                handleScannedQRCamera(qrData);
              } catch (e) { }
            }
          }, 500);
        } catch (err) {
          toast('Erro ao acessar câmera: ' + err.message, true);
        }
      } else {
        isCameraActive = false;
        if (scanInterval) {
          clearInterval(scanInterval);
          scanInterval = null;
        }
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
          stream = null;
        }
        videoElement.srcObject = null;
        videoElement.style.display = 'none';
        placeholder.style.display = 'flex';
        toggleBtn.innerHTML = '<i class="fa-solid fa-play" style="margin-right:6px"></i>Iniciar';
        statusIndicator.style.opacity = '0';
        reticle.style.opacity = '0';
      }
    };
  }, 100);
}

function handleScannedQRCamera(qrData) {
  const resultsDiv = document.getElementById('scannedResults');
  const qrCounter = document.getElementById('qrCounter');
  const qrId = `${qrData.supplier}-${qrData.lot}-${qrData.paleteNumber}`;

  if (scannedQRs[qrId]) return;

  scannedQRs[qrId] = qrData;
  const count = Object.keys(scannedQRs).length;
  if (qrCounter) qrCounter.textContent = count;

  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginBottom = '8px';
  card.style.cursor = 'pointer';
  card.style.transition = 'all 0.2s ease';
  card.style.borderLeft = '3px solid #3b82f6';
  card.onmouseover = function () { this.style.background = '#334155'; };
  card.onmouseout = function () { this.style.background = '#1e293b'; };

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px" onclick="showScannedQRModal('${qrId}')">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px;color:#f1f5f9">${qrData.supplier}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:3px">Palete #${qrData.paleteNumber} · Lote ${qrData.lot}</div>
      </div>
      <button class="btn-danger btn-sm" style="flex-shrink:0" onclick="event.stopPropagation();this.closest('.card').remove();delete scannedQRs['${qrId}'];document.getElementById('qrCounter').textContent = Object.keys(scannedQRs).length;"><i class="fa-solid fa-trash"></i></button>
    </div>
  `;
  resultsDiv.insertBefore(card, resultsDiv.firstChild);

  toast('✓ QR Code lido!');
}

function showScannedQRModal(qrId) {
  const qrData = Object.values(scannedQRs).find(q => `${q.supplier}-${q.lot}-${q.paleteNumber}` === qrId);
  if (!qrData) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };

  const qrString = JSON.stringify(qrData);
  const qrContainerId = `modal-qr-${Date.now()}`;

  overlay.innerHTML = `<div class="modal-content">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:16px;font-weight:700"><i class="fa-solid fa-qrcode" style="color:#3b82f6;margin-right:6px"></i>Palete #${qrData.paleteNumber}</h2>
      <button onclick="closeModal()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:18px"><i class="fa-solid fa-x"></i></button>
    </div>
    
    <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;margin-bottom:12px;font-size:12px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><span style="color:#64748b">Fornecedor:</span> <span style="font-weight:600;color:#f1f5f9">${qrData.supplier}</span></div>
        <div><span style="color:#64748b">Lote:</span> <span style="font-weight:600;color:#f1f5f9">${qrData.lot}</span></div>
        <div><span style="color:#64748b">Material:</span> <span style="font-weight:600;color:#f1f5f9">${qrData.material}</span></div>
        <div><span style="color:#64748b">IF:</span> <span style="font-weight:600;color:#f1f5f9">${qrData.ifValue.toFixed(2)}</span></div>
      </div>
    </div>
    
    <div class="qr-container" id="${qrContainerId}" style="background:#fff;padding:16px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:12px"></div>
    
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn-primary" style="background:#3b82f6;padding:10px;border-radius:6px;border:none;color:#f1f5f9;cursor:pointer;font-size:12px;font-weight:600" onclick="downloadScannedQRImage('${qrContainerId}','palete_${qrData.paleteNumber}')"><i class="fa-solid fa-download" style="margin-right:4px"></i>Imagem</button>
      <button class="btn-primary" style="background:#3b82f6;padding:10px;border-radius:6px;border:none;color:#f1f5f9;cursor:pointer;font-size:12px;font-weight:600" onclick="downloadScannedQRPDF('${qrContainerId}','palete_${qrData.paleteNumber}','${btoa(JSON.stringify(qrData))}')"><i class="fa-solid fa-file-pdf" style="margin-right:4px"></i>PDF</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);
  window.addEventListener('resize', handleViewportChange);
  handleViewportChange();

  setTimeout(() => {
    const qrContainer = document.getElementById(qrContainerId);
    if (qrContainer && !qrContainer.innerHTML.includes('canvas')) {
      new QRCode(qrContainer, {
        text: qrString,
        width: 180,
        height: 180,
        colorDark: '#000000',
        colorLight: '#ffffff'
      });
    }
  }, 100);
}

function downloadScannedQRImage(qrId, filename) {
  const qrElement = document.getElementById(qrId);
  const canvas = qrElement.querySelector('canvas');
  if (!canvas) { toast('QR Code não gerado', true); return; }

  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = `${filename}.png`;
  link.click();
  toast('QR Code baixado!');
}

function downloadScannedQRPDF(qrId, filename, qrDataEncoded) {
  const { jsPDF } = window.jspdf;
  const qrElement = document.getElementById(qrId);
  const canvas = qrElement.querySelector('canvas');
  if (!canvas) { toast('QR Code não gerado', true); return; }

  const qrData = JSON.parse(atob(qrDataEncoded));

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, 210, 297, 'F');

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 50, 'F');

  doc.setTextColor(59, 130, 246);
  doc.setFontSize(28);
  doc.setFont(undefined, 'bold');
  doc.text('PALETE', 15, 25);
  doc.setFontSize(24);
  doc.text('#' + qrData.paleteNumber, 75, 25);

  doc.setTextColor(100, 116, 139);
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text('Lote: ' + qrData.lot + ' | Data: ' + qrData.date, 15, 37);

  const qrImage = canvas.toDataURL('image/png');
  const qrSize = 110;
  const qrX = (210 - qrSize) / 2;
  doc.addImage(qrImage, 'PNG', qrX, 65, qrSize, qrSize);

  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.rect(qrX - 5, 60, qrSize + 10, qrSize + 10);

  let cardY = 185;

  doc.setFillColor(248, 250, 252);
  doc.roundedRect(15, cardY, 90, 24, 2, 2, 'F');
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.text('FORNECEDOR', 20, cardY + 6);
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text(qrData.supplier, 20, cardY + 16);

  doc.setFillColor(248, 250, 252);
  doc.roundedRect(105, cardY, 90, 24, 2, 2, 'F');
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.text('NOTA FISCAL', 110, cardY + 6);
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text(qrData.invoiceNumber, 110, cardY + 16);

  cardY += 30;

  doc.setFillColor(248, 250, 252);
  doc.roundedRect(15, cardY, 90, 24, 2, 2, 'F');
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.text('MATÉRIA-PRIMA', 20, cardY + 6);
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text(qrData.material, 20, cardY + 16);

  doc.setFillColor(59, 130, 246);
  doc.roundedRect(105, cardY, 90, 24, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(13);
  doc.setFont(undefined, 'bold');
  doc.text(qrData.ifValue.toFixed(2), 110, cardY + 16);

  doc.setTextColor(150, 150, 150);
  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  doc.text('Gerado em: ' + new Date().toLocaleString('pt-BR'), 15, 285);
  doc.text('Este QR Code garante rastreabilidade completa do palete', 15, 291);

  doc.save(`${filename}.pdf`);
  toast('PDF gerado!');
}

// ==================== MATERIALS TAB ====================
function renderMaterials() {
  const mc = document.getElementById('mainContent');
  const entries = Object.entries(materials);
  mc.innerHTML = `
    <h1 style="font-size:20px;font-weight:700;margin-bottom:20px"><i class="fa-solid fa-flask" style="color:#3b82f6;margin-right:8px"></i>Matérias-Primas</h1>
    ${entries.length === 0 ? '<div class="card" style="text-align:center;color:#94a3b8;padding:32px"><i class="fa-solid fa-inbox" style="font-size:40px;margin-bottom:12px;display:block"></i><p>Nenhuma matéria-prima cadastrada</p></div>' :
      entries.map(([id, m]) => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div style="flex:1">
          <strong style="font-size:14px;display:block;margin-bottom:6px">${m.name}</strong>
          <div style="font-size:12px;color:#94a3b8"><i class="fa-solid fa-gauge" style="margin-right:4px;width:12px"></i>Faixa IF: ${m.ifMin} — ${m.ifMax} g/10min</div>
        </div>
        <button class="btn-danger btn-sm" onclick="deleteMaterial('${id}')"><i class="fa-solid fa-trash"></i></button>
      </div>`).join('')}
  `;
  document.querySelectorAll('.fab').forEach(f => f.remove());
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = '<i class="fa-solid fa-plus"></i>';
  fab.onclick = () => showNewMaterialModal();
  document.body.appendChild(fab);
}
// ==================== LOAD DETAIL ====================
function openLoadDetail(id) {
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
  const statusColor = s.pct >= 80 ? '#22c55e' : '#ef4444';

  let chartHTML = '';
  if (paletes.length > 0 && mat) {
    const maxVal = Math.max(mat.ifMax * 1.3, ...paletes.map(([, p]) => p.ifValue));
    const minLine = (mat.ifMin / maxVal) * 100;
    const maxLine = (mat.ifMax / maxVal) * 100;
    chartHTML = `<div class="card">
      <div style="font-size:14px;font-weight:600;margin-bottom:12px;color:#f1f5f9"><i class="fa-solid fa-chart-bar" style="margin-right:6px;color:#3b82f6"></i>Gráfico IF por Palete</div>
      <div style="position:relative;height:160px;padding-bottom:24px">
        <div class="chart-line" style="bottom:${minLine}%;border-color:#22c55e40"></div>
        <div class="chart-line" style="bottom:${maxLine}%;border-color:#ef444440"></div>
        <div style="position:absolute;left:-4px;bottom:${minLine}%;font-size:10px;color:#22c55e;transform:translateY(50%);font-weight:600">${mat.ifMin}</div>
        <div style="position:absolute;left:-4px;bottom:${maxLine}%;font-size:10px;color:#ef4444;transform:translateY(50%);font-weight:600">${mat.ifMax}</div>
        <div class="chart-bar-container" style="height:100%;padding-left:32px">
          ${paletes.map(([, p], i) => {
      const h = (p.ifValue / maxVal) * 100;
      const ok = mat && p.ifValue >= mat.ifMin && p.ifValue <= mat.ifMax;
      return `<div class="chart-bar" style="height:${h}%;background:${ok ? '#22c55e' : '#ef4444'};border-radius:4px 4px 0 0">
                    <div class="chart-bar-label">P${i + 1}</div>
                  </div>`;
    }).join('')}
        </div>
      </div>
    </div>`;
  }

  mc.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <button class="back-btn" onclick="currentLoadId=null;renderCurrentTab()" style="padding:8px;background:#334155;border-radius:6px;border:none;color:#f1f5f9;cursor:pointer"><i class="fa-solid fa-arrow-left"></i></button>
      <div style="flex:1">
        <h1 style="font-size:20px;font-weight:700">${l.supplier}</h1>
        <div style="font-size:12px;color:#94a3b8;margin-top:4px">NF: ${l.invoiceNumber} · ${matName} · Lote ${l.lot}</div>
      </div>
      <span class="badge ${status === 'APROVADO' ? 'badge-success' : status === 'REPROVADO' ? 'badge-danger' : 'badge-info'}" style="font-size:12px;font-weight:600;padding:6px 12px">${status}</span>
    </div>
    
    <div class="card">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:12px">
        <div><span style="color:#94a3b8;display:block;font-size:11px;margin-bottom:4px">Data</span>${formatDate(l.date)}</div>
        <div><span style="color:#94a3b8;display:block;font-size:11px;margin-bottom:4px">Nota Fiscal</span>${l.invoiceNumber || 'N/A'}</div>
        <div><span style="color:#94a3b8;display:block;font-size:11px;margin-bottom:4px">Responsável</span>${l.responsible}</div>
        <div><span style="color:#94a3b8;display:block;font-size:11px;margin-bottom:4px">Média IF</span>${s.avg ? s.avg.toFixed(2) + ' g/10min' : '—'}</div>
      </div>
    </div>
    
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div style="background:rgba(59, 130, 246, 0.1);border-radius:8px;padding:12px;border-left:3px solid #3b82f6">
        <div style="font-size:11px;color:#94a3b8;margin-bottom:4px">Aprovados</div>
        <div style="font-size:18px;font-weight:700;color:#3b82f6">${s.approved}/${s.total}</div>
      </div>
      <div style="background:rgba(${s.pct >= 80 ? '34, 197, 94' : '239, 68, 68'}, 0.1);border-radius:8px;padding:12px;border-left:3px solid ${s.pct >= 80 ? '#22c55e' : '#ef4444'}">
        <div style="font-size:11px;color:#94a3b8;margin-bottom:4px">Taxa de Aprovação</div>
        <div style="font-size:18px;font-weight:700;color:${s.pct >= 80 ? '#22c55e' : '#ef4444'}">${s.pct}%</div>
      </div>
    </div>
    
    <div style="display:flex;gap:10px;margin-bottom:12px">
      <button class="btn-primary" style="flex:1;background:#3b82f6;padding:10px;border-radius:6px;border:none;color:#f1f5f9;cursor:pointer;font-size:13px;font-weight:600" onclick="showEditLoadModal('${id}')"><i class="fa-solid fa-edit" style="margin-right:6px"></i>Editar</button>
      <button class="btn-primary" style="flex:1;background:#3b82f6;padding:10px;border-radius:6px;border:none;color:#f1f5f9;cursor:pointer;font-size:13px;font-weight:600" onclick="generatePDFLoad('${id}')"><i class="fa-solid fa-download" style="margin-right:6px"></i>PDF</button>
    </div>
    
    ${chartHTML}
    
    <h2 style="font-size:14px;font-weight:700;margin:16px 0 12px 0;color:#f1f5f9"><i class="fa-solid fa-cubes" style="margin-right:6px;color:#3b82f6"></i>Paletes (${s.total})</h2>
    ${paletes.length === 0 ? '<div class="card" style="text-align:center;color:#94a3b8;padding:24px"><i class="fa-solid fa-inbox" style="font-size:32px;margin-bottom:8px;display:block"></i>Nenhum palete. Toque + para adicionar.</div>' :
      paletes.map(([pid, p], i) => {
        const ok = mat && p.ifValue >= mat.ifMin && p.ifValue <= mat.ifMax;
        return `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;cursor:pointer;transition:all 0.3s" onmouseover="this.style.background='#1e293b'" onmouseout="this.style.background='#0f172a'" onclick="showEditPaleteModal('${id}','${pid}',${i + 1})">
          <div style="flex:1">
            <strong style="font-size:13px">Palete ${i + 1}</strong>
            <div style="font-size:11px;color:#94a3b8;margin-top:4px"><i class="fa-solid fa-calendar" style="margin-right:4px;width:12px"></i>${formatDate(p.date)} · IF: ${p.ifValue.toFixed(2)} g/10min</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="badge ${ok ? 'badge-success' : 'badge-danger'}" style="font-weight:600">${ok ? '✓ OK' : '✗ Fora'}</span>
            <button class="btn-danger btn-sm" style="padding:6px 8px;background:#ef4444;border:none;border-radius:4px;color:#f1f5f9;cursor:pointer" onclick="event.stopPropagation();deletePaleteItem('${id}','${pid}')"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>`;
      }).join('')}
    
    <button class="btn-danger" style="width:100%;margin-top:16px;padding:10px;border-radius:6px;border:none;background:#ef4444;color:#f1f5f9;cursor:pointer;font-size:13px;font-weight:600" onclick="deleteLoadItem('${id}')"><i class="fa-solid fa-trash" style="margin-right:6px"></i>Excluir Carregamento</button>
  `;
  document.querySelectorAll('.fab').forEach(f => f.remove());
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = '<i class="fa-solid fa-plus"></i>';
  fab.onclick = () => showNewPaleteModal(id);
  document.body.appendChild(fab);
}

// ==================== MODALS ====================
function closeModal() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
  window.removeEventListener('resize', handleViewportChange);
}

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
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Nome da Matéria-Prima</label><input class="input-field" id="matName" required placeholder="Ex: Polietileno HD"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">IF Mínimo</label><input class="input-field" id="matMin" type="number" step="0.01" required placeholder="0.00"></div>
        <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">IF Máximo</label><input class="input-field" id="matMax" type="number" step="0.01" required placeholder="0.00"></div>
      </div>
      <button type="submit" class="btn-primary" style="width:100%;padding:10px;background:#3b82f6;border:none;border-radius:6px;color:#f1f5f9;font-weight:600;cursor:pointer;margin-top:8px">Salvar Matéria-Prima</button>
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
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Data</label><input class="input-field" id="loadDate" type="date" required></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Nota Fiscal</label><input class="input-field" id="loadInvoice" required placeholder="Número da NF"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Fornecedor</label><input class="input-field" id="loadSupplier" required placeholder="Nome do fornecedor"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Lote</label><input class="input-field" id="loadLot" required placeholder="Número do lote"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Responsável</label><input class="input-field" id="loadResp" required placeholder="Nome do responsável"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Matéria-Prima</label>
        <select class="input-field" id="loadMat" required>
          ${matEntries.map(([id, m]) => `<option value="${id}">${m.name}</option>`).join('')}
        </select>
      </div>
      <button type="submit" class="btn-primary" style="width:100%;padding:10px;background:#3b82f6;border:none;border-radius:6px;color:#f1f5f9;font-weight:600;cursor:pointer;margin-top:8px">Criar Carregamento</button>
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
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Data</label><input class="input-field" id="editDate" type="date" required value="${l.date}"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Nota Fiscal</label><input class="input-field" id="editInvoice" required placeholder="Número da NF" value="${l.invoiceNumber || ''}"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Fornecedor</label><input class="input-field" id="editSupplier" required placeholder="Nome do fornecedor" value="${l.supplier}"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Lote</label><input class="input-field" id="editLot" required placeholder="Número do lote" value="${l.lot}"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Responsável</label><input class="input-field" id="editResp" required placeholder="Nome do responsável" value="${l.responsible}"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Matéria-Prima</label>
        <select class="input-field" id="editMat" required>
          ${matEntries.map(([mid, m]) => `<option value="${mid}" ${mid === l.materialId ? 'selected' : ''}>${m.name}</option>`).join('')}
        </select>
      </div>
      <button type="submit" class="btn-primary" style="width:100%;padding:10px;background:#3b82f6;border:none;border-radius:6px;color:#f1f5f9;font-weight:600;cursor:pointer;margin-top:8px">Atualizar Carregamento</button>
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
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Data da Análise</label><input class="input-field" id="palDate" type="date" required></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Valor IF (g/10min)</label><input class="input-field" id="palIF" type="number" step="0.01" required placeholder="0.00"></div>
      <button type="submit" class="btn-primary" style="width:100%;padding:10px;background:#3b82f6;border:none;border-radius:6px;color:#f1f5f9;font-weight:600;cursor:pointer;margin-top:8px">Adicionar Palete</button>
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

function showBulkPaleteModal(loadId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
  overlay.innerHTML = `<div class="modal-content">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px"><i class="fa-solid fa-cubes" style="color:#3b82f6;margin-right:8px"></i>Gerar Paletes para QR Code</h2>
    <form id="bulkPaleteForm" style="display:flex;flex-direction:column;gap:12px">
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Data da Análise</label><input class="input-field" id="bulkPalDate" type="date" required></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Quantidade de Paletes</label><input class="input-field" id="bulkPalCount" type="number" min="1" max="100" required placeholder="5" value="5"></div>
      <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px">
        <div style="font-size:11px;color:#94a3b8"><i class="fa-solid fa-info-circle" style="margin-right:6px;color:#3b82f6"></i>Os paletes serão criados SEM Índice de Fluidez. Você poderá adicionar os valores depois clicando em cada palete.</div>
      </div>
      <button type="submit" class="btn-primary" style="width:100%;padding:10px;background:#22c55e;border:none;border-radius:6px;color:#f1f5f9;font-weight:600;cursor:pointer;margin-top:8px"><i class="fa-solid fa-plus" style="margin-right:6px"></i>Gerar Paletes</button>
    </form>
  </div>`;
  document.body.appendChild(overlay);
  window.addEventListener('resize', handleViewportChange);
  handleViewportChange();
  document.getElementById('bulkPalDate').valueAsDate = new Date();

  document.getElementById('bulkPaleteForm').onsubmit = async e => {
    e.preventDefault();
    const date = document.getElementById('bulkPalDate').value;
    const quantity = parseInt(document.getElementById('bulkPalCount').value);

    if (!date || isNaN(quantity) || quantity < 1) { 
      toast('Preencha todos os campos corretamente', true); 
      return; 
    }

    let addedCount = 0;
    for (let i = 0; i < quantity; i++) {
      try {
        await new Promise((resolve) => {
          db.ref('loads/' + loadId + '/paletes').push({ date, ifValue: 0 }, (err) => {
            if (!err) addedCount++;
            resolve();
          });
        });
      } catch (err) { }
    }

    toast(`${addedCount} palete(s) gerado(s)! Clique em cada um para adicionar o Índice de Fluidez.`);
    closeModal();
  };
}

function showEditPaleteModal(loadId, paleteId, paleteNum) {
  const palete = loads[loadId].paletes[paleteId];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
  overlay.innerHTML = `<div class="modal-content">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px"><i class="fa-solid fa-edit" style="color:#3b82f6;margin-right:8px"></i>Editar Palete ${paleteNum}</h2>
    <form id="editPaleteForm" style="display:flex;flex-direction:column;gap:12px">
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Data da Análise</label><input class="input-field" id="editPalDate" type="date" required value="${palete.date}"></div>
      <div><label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:600">Valor IF (g/10min)</label><input class="input-field" id="editPalIF" type="number" step="0.01" required placeholder="0.00" value="${palete.ifValue}"></div>
      <button type="submit" class="btn-primary" style="width:100%;padding:10px;background:#3b82f6;border:none;border-radius:6px;color:#f1f5f9;font-weight:600;cursor:pointer;margin-top:8px">Salvar Palete</button>
    </form>
  </div>`;
  document.body.appendChild(overlay);
  window.addEventListener('resize', handleViewportChange);
  handleViewportChange();
  
  document.getElementById('editPaleteForm').onsubmit = e => {
    e.preventDefault();
    const date = document.getElementById('editPalDate').value;
    const ifValue = parseFloat(document.getElementById('editPalIF').value);
    if (!date || isNaN(ifValue)) { toast('Preencha todos os campos', true); return; }
    db.ref('loads/' + loadId + '/paletes/' + paleteId).update({ date, ifValue });
    toast('Palete atualizado!');
    closeModal();
  };
}



// ==================== DELETE FUNCTIONS ====================
function deleteMaterial(id) {
  const card = event.target.closest('.card');
  if (card.querySelector('.confirm-row')) return;
  const row = document.createElement('div');
  row.className = 'confirm-row';
  row.style.cssText = 'display:flex;gap:8px;margin-top:12px;justify-content:flex-end';
  row.innerHTML = `<span style="font-size:12px;color:#ef4444;line-height:28px;font-weight:600">Tem certeza?</span>
    <button class="btn-primary btn-sm" style="background:#ef4444;color:#f1f5f9;border:none;border-radius:4px;cursor:pointer;padding:6px 12px;font-weight:600" onclick="db.ref('materials/${id}').remove();toast('Removido!')">Sim</button>
    <button class="btn-primary btn-sm" style="background:#334155;color:#f1f5f9;border:none;border-radius:4px;cursor:pointer;padding:6px 12px;font-weight:600" onclick="this.parentElement.remove()">Não</button>`;
  card.appendChild(row);
}

function deleteLoadItem(id) {
  db.ref('loads/' + id).remove();
  toast('Carregamento excluído!');
  currentLoadId = null;
  renderCurrentTab();
}

function deletePaleteItem(loadId, paleteId) {
  db.ref('loads/' + loadId + '/paletes/' + paleteId).remove();
  toast('Palete removido!');
}

// ==================== PDF GENERATION ====================
function generatePDFLoad(id) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const l = loads[id];
  if (!l) return;
  const mat = materials[l.materialId];
  const matName = mat?.name || 'N/A';
  const s = getLoadStats(l);
  const status = s.total === 0 ? 'PENDENTE' : s.pct >= 80 ? 'APROVADO' : 'REPROVADO';

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
    ['Data', formatDate(l.date)],
    ['Responsável', l.responsible],
    ['Matéria-Prima', matName],
    ['Faixa IF', mat ? mat.ifMin + ' — ' + mat.ifMax + ' g/10min' : 'N/A']
  ];
  info.forEach(([k, v]) => {
    doc.setFont(undefined, 'bold'); doc.text(k + ': ', 14, y);
    doc.setFont(undefined, 'normal'); doc.text(v, 60, y);
    y += 6;
  });

  y += 10;
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

function generateAllReports() {
  const allLoads = Object.entries(loads);
  if (allLoads.length === 0) { toast('Nenhum carregamento', true); return; }
  allLoads.forEach(([id]) => {
    setTimeout(() => generatePDFLoad(id), 500);
  });
  toast('Gerando ' + allLoads.length + ' relatório(s)...');
}

// Initial render
renderCurrentTab();

