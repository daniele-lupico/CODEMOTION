import Chart from 'chart.js/auto';

// Global state
const state = {
  chatHistory: [],
  attachedFile: null,
  chartInstances: []
};

document.addEventListener('DOMContentLoaded', () => {
  initChatUI();
  initTheme();
  initSettings();
  
  // Esegui fetch dei contratti iniziali per metterli in stato se ci sono già
  fetchContractsSilently();
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
    }

    // Poi chiama API chat (da implementare nel backend)
    const chatRes = await fetch('http://localhost:8000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: text,
        has_new_file: fileUploadedFlag
      })
    });

    if (!chatRes.ok) throw new Error('Errore risposta AI');
    
    const data = await chatRes.json();
    
    removeLoadingBubble(loadingId);
    
    // Il backend risponderà con { text: "...", chart_data: null | {...} }
    appendMessage('ai', data.text, null, data.chart_data);
    
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
      <button id="${ttsId}" title="Riproduci Audio ElevenLabs" class="action-chip tts-chip" style="margin-top:12px; background:var(--bg-surface-hover); border:1px solid var(--border-subtle); color:var(--text-secondary); padding:6px 12px; border-radius:16px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-size:0.8rem; transition: background 0.2s;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
        Ascolta Sintesi
      </button>
    `;
    
    // Heuristic per suggerire meeting se si parla di rischi o incontri
    if (text.toLowerCase().includes("incontr") || text.toLowerCase().includes("rischi") || text.toLowerCase().includes("meeting")) {
         const calId = 'cal-' + Date.now();
         calendarHtml = `
            <button id="${calId}" title="Fissa meeting di recap" class="action-chip cal-chip" style="margin-top:12px; margin-left:8px; background:transparent; border:1px solid var(--accent-light); color:var(--accent-light); padding:6px 12px; border-radius:16px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-size:0.8rem; transition: background 0.2s;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              G-Calendar Pinc
            </button>
         `;
    }
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
              calBtn.innerHTML = '<span style="width:10px;height:10px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;display:inline-block"></span> Sync...';
              try {
                  const res = await fetch('http://localhost:8000/api/calendar/schedule', {
                      method: 'POST',
                      headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({title: "Re-check Contratti", date: new Date().toISOString(), description: "Generato da ContractAI"})
                  });
                  const json = await res.json();
                  calBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Schedulato in Calendar';
                  calBtn.style.background = "var(--accent-primary)";
                  calBtn.style.color = "#fff";
                  console.log("Calendar Backend Response:", json);
              } catch(e) {
                  calBtn.innerText = "Sync Error";
              }
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
  
  // Applica palette colori scura enterprise ai dataset forniti dall'LLM
  if (chartConfig.data && chartConfig.data.datasets) {
    const defaultColors = ['#818cf8', '#34d399', '#f87171', '#fbbf24', '#c084fc', '#60a5fa', '#a78bfa'];
    chartConfig.data.datasets.forEach(ds => {
      ds.backgroundColor = ds.type === 'line' ? 'transparent' : defaultColors;
      if (ds.type === 'line' || (!ds.type && chartConfig.type === 'line')) {
        ds.borderColor = '#818cf8';
        ds.borderWidth = 3;
        ds.tension = 0.4;
      } else {
        ds.borderRadius = ds.type === 'bar' ? 4 : 0;
      }
    });
  }

  // Assicura stili dark theme sulle griglie
  if (!chartConfig.options) chartConfig.options = {};
  if (!chartConfig.options.plugins) chartConfig.options.plugins = {};
  chartConfig.options.plugins.legend = { labels: { color: '#e2e8f0' } };
  
  if (chartConfig.type !== 'pie' && chartConfig.type !== 'doughnut') {
    if(!chartConfig.options.scales) chartConfig.options.scales = {};
    if(!chartConfig.options.scales.x) chartConfig.options.scales.x = { ticks:{color:'#94a3b8'}, grid:{display:false} };
    if(!chartConfig.options.scales.y) chartConfig.options.scales.y = { ticks:{color:'#94a3b8'}, grid:{color:'rgba(148,163,184,0.1)'} };
  }

  new Chart(ctx, {
    type: chartConfig.type || 'bar',
    data: chartConfig.data,
    options: Object.assign({ responsive: true, maintainAspectRatio: false }, chartConfig.options)
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

// MOCK: silent fetch per cache dati se si vogliono fare check pre-chat
async function fetchContractsSilently() {
  try {
    const res = await fetch('http://localhost:8000/api/contracts');
    const data = await res.json();
    console.log("Portafoglio in memoria:", data);
  } catch (err) {}
}
