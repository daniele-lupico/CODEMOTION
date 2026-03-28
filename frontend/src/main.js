import Chart from 'chart.js/auto';

const API = 'http://localhost:8000';

// Auth check — redirect to landing if not logged in
const _token   = localStorage.getItem('cai_token');
const _userId  = localStorage.getItem('cai_user_id');
const _company = localStorage.getItem('cai_company') || 'TechVenture Italia Srl';
if (!_token) { window.location.href = '/landing.html'; }

// Global state
const state = {
  chatHistory: [],
  attachedFile: null,
  chartInstances: [],
  lastUploadDone: false,
  currentChatId: crypto.randomUUID(),
  lastAiText: '',
  folders: [],
  openFolders: new Set(),
  allChats: [],       // full list from backend (with folder_id)
};

document.addEventListener('DOMContentLoaded', () => {
  initChatUI();
  initTheme();
  initSettings();
  initUserUI();
  loadSidebar();
  // Close context menus on outside click
  document.addEventListener('click', () => closeFolderContextMenu());
});

function initSettings() {
  const btn = document.getElementById('settings-btn');
  const modal = document.getElementById('settings-modal');
  const closeBtn = document.getElementById('close-settings');

  if(btn && modal) {
    btn.addEventListener('click', async () => {
      // Fetch stats
      try {
        const res = await fetch('http://localhost:8000/api/stats');
        const data = await res.json();
        
        document.getElementById('roi-cost').textContent = "$" + data.api_cost_usd.toFixed(4);
        document.getElementById('roi-time').textContent = data.hours_saved + " Ore";
        document.getElementById('roi-value').textContent = "€" + data.roi_eur.toFixed(2);
        
        modal.style.display = 'flex';
      } catch (e) {
        console.error("Error fetching stats", e);
      }
    });
    
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
}

function initTheme() {
  document.documentElement.className = 'dark-theme';
}

function initChatUI() {
  const sendBtn = document.getElementById('chat-send-btn');
  const chatInput = document.getElementById('chat-input');
  const attachBtn = document.getElementById('attach-btn');
  const fileInput = document.getElementById('chat-file-input');
  const suggestions = document.querySelectorAll('.chat-suggestion-chip');

  sendBtn.addEventListener('click', handleSend);
  
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  chatInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    if (this.value.trim() === '') {
      sendBtn.disabled = true;
    } else {
      sendBtn.disabled = false;
    }
  });

  attachBtn.addEventListener('click', () => fileInput.click());
  
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      state.attachedFile = e.target.files[0];
      showAttachmentPreview(state.attachedFile.name);
    }
  });

  suggestions.forEach(chip => {
    chip.addEventListener('click', () => {
      chatInput.value = chip.textContent;
      sendBtn.disabled = false;
      handleSend();
    });
  });
}

function showAttachmentPreview(filename) {
  // Check if preview already exists, remove it
  const existing = document.getElementById('attachment-preview');
  if (existing) existing.remove();

  const previewHtml = `
    <div class="file-attachment-chip" id="attachment-preview">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
      <span>${filename}</span>
      <button onclick="removeAttachment()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;margin-left:8px;">&times;</button>
    </div>
  `;
  
  const inputContainer = document.querySelector('.chat-input-container');
  inputContainer.insertAdjacentHTML('beforebegin', previewHtml);
}

window.removeAttachment = () => {
  state.attachedFile = null;
  const existing = document.getElementById('attachment-preview');
  if (existing) existing.remove();
  document.getElementById('chat-file-input').value = "";
};

async function handleSend() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  const file = state.attachedFile;

  if (!text && !file) return;

  // Visualizza messaggio utente
  appendMessage('user', text, file ? file.name : null);
  
  input.value = '';
  input.style.height = 'auto';
  document.getElementById('chat-send-btn').disabled = true;

  // Cleanup attachment UI
  if (file) {
    removeAttachment();
  }

  // Visualizza loader AI
  const loadingId = appendLoadingBubble();
  scrollToBottom();

  try {
    let fileUploadedFlag = false;
    // Se c'è un file, fai prima l'upload classico per salvare in data JSON
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await fetch('http://localhost:8000/api/upload', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error('Errore upload');
      fileUploadedFlag = true;
      state.lastUploadDone = true;
    }

    // Use lastUploadDone so chips after upload also focus on that contract
    const hasNewFile = fileUploadedFlag || state.lastUploadDone;
    if (!fileUploadedFlag) state.lastUploadDone = false; // reset after first non-upload message

    // Poi chiama API chat (da implementare nel backend)
    const chatRes = await fetch('http://localhost:8000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: text,
        has_new_file: hasNewFile
      })
    });

    if (!chatRes.ok) throw new Error('Errore risposta AI');
    
    const data = await chatRes.json();
    
    removeLoadingBubble(loadingId);

    // Il backend risponderà con { text: "...", chart_data: null | {...} }
    appendMessage('ai', data.text, null, data.chart_data);
    state.lastAiText = data.text;

    if (fileUploadedFlag) {
      appendPostUploadSuggestions();
    }

    // Save chat after each AI response
    state.chatHistory.push({ role: 'user', content: text });
    state.chatHistory.push({ role: 'ai',   content: data.text });
    saveCurrentChat(text);

  } catch (err) {
    console.error(err);
    removeLoadingBubble(loadingId);
    appendMessage('ai', "Si è verificato un errore durante l'elaborazione. Riprova tra poco.");
  }
  
  scrollToBottom();
}

function appendMessage(role, text, attachedFilename = null, chartData = null) {
  const stream = document.getElementById('chat-stream');
  
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${role}`;
  
  // Format citations into clickable or highlighted spans [Fonte: ...]
  let formattedText = escapeHtml(text).replace(/\n/g, '<br/>');
  formattedText = formattedText.replace(/\[Fonte: (.*?)\]/g, '<span class="chat-citation" title="Clicca per aprire il documento originale">$1</span>');
  
  // Format markdown bold
  formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  let attachmentHtml = '';
  if (attachedFilename) {
    attachmentHtml = `
      <div class="file-attachment-chip" style="margin-bottom:8px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path></svg>
        <span>${attachedFilename}</span>
      </div>
    `;
  }

  const chartId = 'chart-' + Date.now();
  let chartHtml = '';
  if (chartData && role === 'ai') {
    chartHtml = `
      <div class="chat-chart-card">
        <canvas id="${chartId}"></canvas>
      </div>
    `;
  }

  // Action chips (TTS & Calendar)
  let ttsHtml = '';
  let calendarHtml = '';
  if (role === 'ai') {
    const ttsId = 'tts-' + Date.now();
    ttsHtml = `
      <button id="${ttsId}" class="action-chip tts-chip" style="margin-top:12px;background:var(--bg-surface-hover);border:1px solid var(--border-subtle);color:var(--text-secondary);padding:6px 12px;border-radius:16px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:.8rem;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
        Ascolta Sintesi
      </button>
    `;
    const calId = 'cal-' + Date.now();
    calendarHtml = `
      <button id="${calId}" class="action-chip cal-chip" style="margin-top:12px;margin-left:8px;background:transparent;border:1px solid var(--accent-light,#818cf8);color:var(--accent-light,#818cf8);padding:6px 12px;border-radius:16px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:.8rem;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Aggiungi a Google Calendar
      </button>
    `;
  }

  msgDiv.innerHTML = `
    <div class="chat-avatar">
      ${role === 'ai' ? 
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 0 1 2 2v10a2 2 0 0 1-4 0V4a2 2 0 0 1 2-2z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' : 
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'}
    </div>
    <div class="chat-content">
      ${attachmentHtml}
      <p>${formattedText}</p>
      ${chartHtml}
      <div class="chat-actions">
        ${ttsHtml}
        ${calendarHtml}
      </div>
    </div>
  `;
  
  stream.appendChild(msgDiv);

  // Attach listeners to chips
  if (role === 'ai') {
      const ttsBtn = msgDiv.querySelector('.tts-chip');
      if (ttsBtn) {
          ttsBtn.addEventListener('click', async () => {
              ttsBtn.innerHTML = '<span style="width:10px;height:10px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;display:inline-block"></span> Generazione...';
              try {
                  const res = await fetch('http://localhost:8000/api/tts', {
                      method: 'POST',
                      headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({text: text})
                  });
                  const json = await res.json();
                  ttsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Audio Generato (' + json.status + ')';
                  ttsBtn.style.color = "var(--green)";
                  console.log("TTS Backend Response:", json);
              } catch(e) {
                  ttsBtn.innerText = "API Error";
              }
          });
      }

      const calBtn = msgDiv.querySelector('.cal-chip');
      if (calBtn) {
          calBtn.addEventListener('click', async () => {
              // Get the last uploaded contract's end_date for the calendar event
              try {
                  const db = await fetch(`${API}/api/contracts`).then(r => r.json());
                  const last = db.contracts?.slice(-1)[0];
                  const endDate  = last?.end_date  || new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0,10);
                  const title    = last ? `Scadenza ${last.id} — ${last.client}` : 'Scadenza Contratto';
                  const details  = last ? `Contratto ${last.id} (${last.client}) scade il ${last.end_date}. Risk score: ${last.risk_score}/10. Generato da ContractAI.` : 'Scadenza contratto — ContractAI';
                  const res = await fetch(`${API}/api/calendar/schedule`, {
                      method: 'POST', headers: {'Content-Type':'application/json'},
                      body: JSON.stringify({ title, date: endDate, end_date: endDate, description: details })
                  });
                  const json = await res.json();
                  if (json.event_link) { window.open(json.event_link, '_blank'); }
                  calBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Aperto in Calendar';
                  calBtn.style.background = '#6366f1'; calBtn.style.color = '#fff';
              } catch(e) { calBtn.innerText = 'Errore'; }
          });
      }
  }

  if (chartData && role === 'ai') {
    renderInChatChart(chartId, chartData);
  }
}

function appendLoadingBubble() {
  const stream = document.getElementById('chat-stream');
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ai`;
  const id = 'loading-' + Date.now();
  msgDiv.id = id;
  msgDiv.innerHTML = `
    <div class="chat-avatar">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 0 1 2 2v10a2 2 0 0 1-4 0V4a2 2 0 0 1 2-2z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    </div>
    <div class="chat-content">
      <div style="display:flex;gap:4px;padding:8px 0;align-items:center;">
        <span style="width:6px;height:6px;background:var(--accent-primary);border-radius:50%;animation:pulse 1s infinite;"></span>
        <span style="width:6px;height:6px;background:var(--accent-primary);border-radius:50%;animation:pulse 1s infinite 0.2s;"></span>
        <span style="width:6px;height:6px;background:var(--accent-primary);border-radius:50%;animation:pulse 1s infinite 0.4s;"></span>
      </div>
    </div>
  `;
  const style = document.createElement('style');
  style.innerHTML = `@keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }`;
  document.head.appendChild(style);
  stream.appendChild(msgDiv);
  return id;
}

function removeLoadingBubble(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function scrollToBottom() {
  const stream = document.getElementById('chat-stream');
  stream.scrollTop = stream.scrollHeight;
}

function renderInChatChart(canvasId, chartConfig) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const COLORS = [
    '#818cf8','#34d399','#f87171','#fbbf24','#c084fc',
    '#60a5fa','#fb923c','#a3e635','#f472b6','#2dd4bf',
    '#e879f9','#38bdf8','#4ade80','#facc15','#f87171'
  ];
  const isRound = chartConfig.type === 'pie' || chartConfig.type === 'doughnut';
  const isLine  = chartConfig.type === 'line';
  const isHBar  = chartConfig.options?.indexAxis === 'y';

  // Detect if values look like currency (any value > 1000)
  const allValues = (chartConfig.data?.datasets ?? []).flatMap(ds => ds.data ?? []).map(Number);
  const isMoney = allValues.some(v => v > 1000);

  // --- Strip JS functions (safety net) ---
  const stripFn = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    const out = Array.isArray(obj) ? [] : {};
    for (const k of Object.keys(obj)) {
      if (k === 'callbacks') continue;
      out[k] = typeof obj[k] === 'function' ? undefined : stripFn(obj[k]);
    }
    return out;
  };
  if (chartConfig.options) chartConfig.options = stripFn(chartConfig.options);

  // --- Apply colors & style per dataset ---
  (chartConfig.data?.datasets ?? []).forEach((ds, di) => {
    if (isLine) {
      ds.borderColor     = COLORS[di % COLORS.length];
      ds.backgroundColor = COLORS[di % COLORS.length] + '33';
      ds.borderWidth     = 2;
      ds.tension         = 0.4;
      ds.pointRadius     = 4;
      ds.fill            = true;
    } else if (isRound) {
      ds.backgroundColor = COLORS;
      ds.borderColor     = '#1e293b';
      ds.borderWidth     = 2;
      ds.hoverOffset     = 8;
    } else {
      // bar
      const multiColor = ds.data?.length > 1;
      ds.backgroundColor = multiColor ? COLORS.slice(0, ds.data.length) : COLORS[di % COLORS.length];
      ds.borderRadius    = 5;
      ds.borderSkipped   = false;
    }
  });

  // --- Dynamic canvas height (horizontal bar: 36px per label) ---
  const labelCount = chartConfig.data?.labels?.length ?? 0;
  if (isHBar && labelCount > 0) {
    ctx.parentElement.style.height = Math.max(220, labelCount * 38 + 40) + 'px';
  } else if (!isRound) {
    ctx.parentElement.style.height = '280px';
  } else {
    ctx.parentElement.style.height = '300px';
  }

  // --- Options base ---
  if (!chartConfig.options) chartConfig.options = {};
  const opt = chartConfig.options;
  if (!opt.plugins) opt.plugins = {};

  // Legend
  opt.plugins.legend = {
    labels: { color: '#e2e8f0', padding: 16, font: { size: 12 } },
    display: isRound || (chartConfig.data?.datasets?.length ?? 0) > 1
  };

  // Title (keep if AI set it, ensure color)
  if (opt.plugins.title) {
    opt.plugins.title.color = opt.plugins.title.color || '#cbd5e1';
    opt.plugins.title.font  = { size: 13, weight: '600' };
  }

  // Smart tooltip
  if (!opt.plugins.tooltip) opt.plugins.tooltip = {};
  opt.plugins.tooltip.backgroundColor = '#1e293b';
  opt.plugins.tooltip.titleColor       = '#e2e8f0';
  opt.plugins.tooltip.bodyColor        = '#94a3b8';
  opt.plugins.tooltip.borderColor      = '#334155';
  opt.plugins.tooltip.borderWidth      = 1;
  opt.plugins.tooltip.padding          = 10;
  opt.plugins.tooltip.callbacks        = {
    label: function(context) {
      const val = context.raw ?? context.parsed?.y ?? context.parsed?.x ?? 0;
      const n   = Number(val);
      if (isRound) {
        const total = context.dataset.data.reduce((a, b) => a + Number(b), 0);
        const pct   = total > 0 ? ((n / total) * 100).toFixed(1) : '0';
        return isMoney
          ? ` €${n.toLocaleString('it-IT')} (${pct}%)`
          : ` ${n.toLocaleString('it-IT')} (${pct}%)`;
      }
      return isMoney ? ` €${n.toLocaleString('it-IT')}` : ` ${n.toLocaleString('it-IT')}`;
    }
  };

  // Scales (bar & line only)
  if (!isRound) {
    if (!opt.scales) opt.scales = {};
    const labelAxis = isHBar ? 'y' : 'x';
    const valueAxis = isHBar ? 'x' : 'y';

    if (!opt.scales[labelAxis]) opt.scales[labelAxis] = {};
    opt.scales[labelAxis].ticks = { color: '#94a3b8', font: { size: 11 } };
    opt.scales[labelAxis].grid  = { display: false };

    if (!opt.scales[valueAxis]) opt.scales[valueAxis] = {};
    opt.scales[valueAxis].grid  = { color: 'rgba(148,163,184,0.1)' };
    opt.scales[valueAxis].ticks = {
      color: '#94a3b8',
      font: { size: 11 },
      callback: function(value) {
        if (!isMoney) return value;
        return value >= 1000000 ? '€' + (value/1000000).toFixed(1) + 'M'
             : value >= 1000    ? '€' + (value/1000).toFixed(0) + 'k'
             : '€' + value;
      }
    };
    if (!opt.scales[valueAxis].beginAtZero) opt.scales[valueAxis].beginAtZero = true;
  }

  new Chart(ctx, {
    type: chartConfig.type || 'bar',
    data: chartConfig.data,
    options: Object.assign({ responsive: true, maintainAspectRatio: false }, opt)
  });
}

const escapeHtml = (unsafe) => {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

function appendPostUploadSuggestions() {
  const stream = document.getElementById('chat-stream');
  const div = document.createElement('div');
  div.className = 'chat-message ai';

  const chips = [
    'Quali sono i rischi principali di questo contratto?',
    'Cosa devo negoziare o modificare prima di firmare?',
    'Ci sono clausole che potrebbero danneggiare la nostra azienda?'
  ];

  const avatarSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 0 1 2 2v10a2 2 0 0 1-4 0V4a2 2 0 0 1 2-2z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';

  div.innerHTML = `
    <div class="chat-avatar">${avatarSvg}</div>
    <div class="chat-content">
      <p>Cosa vuoi analizzare ora?</p>
      <div class="chat-suggestions">
        ${chips.map(c => `<button class="chat-suggestion-chip">${c}</button>`).join('')}
      </div>
    </div>
  `;

  div.querySelectorAll('.chat-suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('chat-input');
      input.value = chip.textContent;
      document.getElementById('chat-send-btn').disabled = false;
      handleSend();
    });
  });

  stream.appendChild(div);
  scrollToBottom();
}

function initUserUI() {
  // Show company name from auth
  const badge = document.querySelector('.company-badge');
  if (badge) badge.textContent = _company;

  // Add logout button to topbar
  const topbarRight = document.querySelector('.topbar-right');
  if (topbarRight) {
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'action-icon';
    logoutBtn.title = 'Esci';
    logoutBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('cai_token');
      localStorage.removeItem('cai_user_id');
      localStorage.removeItem('cai_company');
      localStorage.removeItem('cai_email');
      window.location.href = '/landing.html';
    });
    topbarRight.insertBefore(logoutBtn, topbarRight.firstChild);
  }
}

// ── Sidebar: load folders + history together ──────────────────────────────
async function loadSidebar() {
  if (!_userId) return;
  try {
    const [chatsRes, foldersRes] = await Promise.all([
      fetch(`${API}/api/chats/${_userId}`),
      fetch(`${API}/api/folders/${_userId}`),
    ]);
    state.allChats = (await chatsRes.json()).chats  || [];
    state.folders  = (await foldersRes.json()).folders || [];
  } catch (_) {
    state.allChats = [];
    state.folders  = [];
  }
  renderFolders();
  renderChatHistory();
}

// ── Render the CARTELLE section ───────────────────────────────────────────
function renderFolders() {
  const section = document.getElementById('folders-section');
  if (!section) return;
  section.innerHTML = '';

  // Header row
  const header = document.createElement('div');
  header.className = 'nav-group-header';
  header.innerHTML = `
    <div class="nav-group-title">CARTELLE</div>
    <button class="btn-new-folder" id="new-folder-btn" title="Nuova cartella">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>`;
  section.appendChild(header);
  document.getElementById('new-folder-btn').addEventListener('click', createFolder);

  if (state.folders.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:.75rem;color:var(--text-muted);padding:4px 12px 8px;';
    empty.textContent = 'Nessuna cartella';
    section.appendChild(empty);
    return;
  }

  state.folders.forEach(folder => {
    const chatsInFolder = state.allChats.filter(c => c.folder_id === folder.id);
    const isOpen = state.openFolders.has(folder.id);

    const item = document.createElement('div');
    item.className = 'folder-item';
    item.dataset.folderId = folder.id;

    item.innerHTML = `
      <div class="folder-header" data-folder-id="${folder.id}">
        <svg class="folder-toggle ${isOpen ? 'open' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        <svg class="folder-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span class="folder-name">${escapeHtml(folder.name)}</span>
        <span class="folder-count">${chatsInFolder.length}</span>
        <button class="folder-delete" title="Elimina cartella" data-folder-id="${folder.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="folder-chats ${isOpen ? 'open' : ''}" data-folder-id="${folder.id}"></div>`;

    // Toggle open/close
    const folderHeader = item.querySelector('.folder-header');
    folderHeader.addEventListener('click', (e) => {
      if (e.target.closest('.folder-delete')) return;
      if (state.openFolders.has(folder.id)) {
        state.openFolders.delete(folder.id);
      } else {
        state.openFolders.add(folder.id);
      }
      renderFolders();
      renderChatHistory();
    });

    // Delete folder button
    item.querySelector('.folder-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteFolder(folder.id);
    });

    // Drag & drop target
    folderHeader.addEventListener('dragover', (e) => {
      e.preventDefault();
      folderHeader.classList.add('drag-over');
    });
    folderHeader.addEventListener('dragleave', () => {
      folderHeader.classList.remove('drag-over');
    });
    folderHeader.addEventListener('drop', (e) => {
      e.preventDefault();
      folderHeader.classList.remove('drag-over');
      const chatId = e.dataTransfer.getData('text/plain');
      if (chatId) moveChat(chatId, folder.id);
    });

    // Render chats inside folder
    const chatsContainer = item.querySelector('.folder-chats');
    chatsInFolder.forEach(chat => {
      chatsContainer.appendChild(buildChatNavItem(chat, folder.id));
    });

    section.appendChild(item);
  });
}

// ── Render CRONOLOGIA CHAT (ungrouped chats only) ─────────────────────────
function renderChatHistory() {
  const section = document.getElementById('history-section');
  if (!section) return;
  const title = section.querySelector('.nav-group-title');
  section.innerHTML = '';
  if (title) section.appendChild(title);

  const ungrouped = state.allChats.filter(c => !c.folder_id);
  ungrouped.slice(0, 15).forEach(chat => {
    section.appendChild(buildChatNavItem(chat, null));
  });
}

// ── Build a single chat nav item (used in folder and in history) ──────────
function buildChatNavItem(chat, folderId) {
  const btn = document.createElement('button');
  btn.className = 'nav-item';
  btn.draggable = !folderId; // only items outside folders are draggable (can also enable inside)
  btn.dataset.chatId = chat.id;
  btn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    <span class="nav-text">${escapeHtml(chat.title)}</span>
    <button class="chat-menu-btn" title="Opzioni" data-chat-id="${chat.id}">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
    </button>`;

  btn.addEventListener('click', (e) => {
    if (e.target.closest('.chat-menu-btn')) return;
    restoreChat(chat);
  });

  // Three-dot menu
  btn.querySelector('.chat-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    showChatContextMenu(e, chat, folderId);
  });

  // Drag start
  if (!folderId) {
    btn.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', chat.id);
      e.dataTransfer.effectAllowed = 'move';
    });
  }

  return btn;
}

// ── Context menu for chat items ───────────────────────────────────────────
let _activeMenu = null;
function closeFolderContextMenu() {
  if (_activeMenu) { _activeMenu.remove(); _activeMenu = null; }
}

function showChatContextMenu(e, chat, currentFolderId) {
  closeFolderContextMenu();
  const menu = document.createElement('div');
  menu.className = 'folder-context-menu';

  if (currentFolderId) {
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '↩ Rimuovi dalla cartella';
    removeBtn.addEventListener('click', () => { closeFolderContextMenu(); moveChat(chat.id, null); });
    menu.appendChild(removeBtn);
    const sep = document.createElement('div');
    sep.className = 'menu-separator';
    menu.appendChild(sep);
  }

  if (state.folders.length > 0) {
    const label = document.createElement('div');
    label.className = 'menu-submenu-title';
    label.textContent = 'Sposta in cartella';
    menu.appendChild(label);
    state.folders.forEach(folder => {
      if (folder.id === currentFolderId) return;
      const btn = document.createElement('button');
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;vertical-align:middle;color:var(--orange)"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>${escapeHtml(folder.name)}`;
      btn.addEventListener('click', () => { closeFolderContextMenu(); moveChat(chat.id, folder.id); });
      menu.appendChild(btn);
    });
  } else {
    const hint = document.createElement('button');
    hint.textContent = '+ Crea prima una cartella';
    hint.style.color = 'var(--text-muted)';
    hint.addEventListener('click', () => { closeFolderContextMenu(); createFolder(chat.id); });
    menu.appendChild(hint);
  }

  // Position near cursor
  menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 200) + 'px';
  document.body.appendChild(menu);
  _activeMenu = menu;
}

// ── Folder CRUD ───────────────────────────────────────────────────────────
async function createFolder(autoMoveChatId = null) {
  const name = prompt('Nome della cartella:');
  if (!name || !name.trim()) return;
  try {
    const res  = await fetch(`${API}/api/folders/save`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ user_id: _userId, name: name.trim() }),
    });
    const data = await res.json();
    if (autoMoveChatId && data.folder_id) {
      await _doMoveChat(autoMoveChatId, data.folder_id);
    }
    await loadSidebar();
    // Auto-open new folder
    if (data.folder_id) state.openFolders.add(data.folder_id);
    renderFolders();
  } catch (_) {}
}

async function deleteFolder(folderId) {
  if (!confirm('Eliminare la cartella? I chat torneranno in Cronologia.')) return;
  try {
    await fetch(`${API}/api/folders/${_userId}/${folderId}`, { method: 'DELETE' });
    state.openFolders.delete(folderId);
    await loadSidebar();
  } catch (_) {}
}

async function moveChat(chatId, folderId) {
  await _doMoveChat(chatId, folderId);
  await loadSidebar();
}

async function _doMoveChat(chatId, folderId) {
  try {
    await fetch(`${API}/api/folders/${_userId}/move`, {
      method: 'PATCH', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ chat_id: chatId, folder_id: folderId }),
    });
  } catch (_) {}
}

// Legacy alias so saveCurrentChat still refreshes sidebar
async function loadChatHistory() {
  await loadSidebar();
}

function restoreChat(chat) {
  // Start fresh chat session with this chat's id
  state.currentChatId = chat.id;
  state.chatHistory   = chat.messages || [];
  const stream = document.getElementById('chat-stream');
  // Keep welcome message, replay saved messages
  stream.querySelectorAll('.chat-message:not(:first-child)').forEach(el => el.remove());
  (chat.messages || []).forEach(msg => {
    appendMessage(msg.role, msg.content);
  });
  scrollToBottom();
}

async function saveCurrentChat(firstUserText) {
  if (!_userId) return;
  const title = firstUserText.slice(0, 48) + (firstUserText.length > 48 ? '…' : '');
  try {
    await fetch(`${API}/api/chats/save`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        user_id:  _userId,
        chat_id:  state.currentChatId,
        title,
        messages: state.chatHistory,
      })
    });
    loadChatHistory(); // refresh sidebar
  } catch (_) {}
}
