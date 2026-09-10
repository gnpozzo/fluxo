'use strict';
/* ============================================================
   AppGemini.js — v6.1.0
   Controlador de FluxoAI (client-side).
   Soporta historial progresivo, búsqueda interna, consultas
   por instrumento, carga de archivos (XLSX, PDF, imágenes)
   e incorporación automática de movimientos a cuentas.
   ============================================================ */

export class GeminiChatController {
  #chatHistory = [];
  #initialized = false;
  #riskProfile = localStorage.getItem('fluxo_risk_profile') || 'MODERADO';
  #visibleCount = 8;
  #attachedFile = null;
  #searchQuery = '';

  constructor() {
    App.log('FluxoAI', 'constructor', 'Inicializando FluxoAI Controller');
  }

  get riskProfile() {
    return this.#riskProfile;
  }

  setRiskProfile(profile) {
    this.#riskProfile = profile;
    localStorage.setItem('fluxo_risk_profile', profile);
    this.#updateProfileUI();
  }

  open() {
    const geminiPanel = document.getElementById('gemini-panel');
    const geminiOverlay = document.getElementById('gemini-overlay');
    geminiPanel?.classList.add('open');
    geminiOverlay?.classList.add('open');
    this.onOpen();
  }

  onOpen() {
    if (!this.#initialized) {
      this.init();
    }
    // Si no estamos buscando, arrancar con el lote reciente (estilo WhatsApp)
    if (!this.#searchQuery && this.#chatHistory.length > 0) {
      this.#visibleCount = Math.min(10, this.#chatHistory.length);
      this.#renderChatMessages({ scrollToBottom: true });
    }
    this.scrollToBottom();
    // Asegurar scroll inferior una vez calculado el layout y las transiciones del panel
    requestAnimationFrame(() => {
      this.scrollToBottom();
      setTimeout(() => this.scrollToBottom(), 50);
      setTimeout(() => this.scrollToBottom(), 150);
      setTimeout(() => this.scrollToBottom(), 300);
      setTimeout(() => this.scrollToBottom(), 600);
    });
  }

  scrollToBottom() {
    this.#scrollToBottom();
  }

  async init() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#loadPersistedHistory();
    this.#initUI();
    this.#updateProfileUI();
  }

  #loadPersistedHistory() {
    try {
      const saved = localStorage.getItem('fluxo_advisor_history');
      if (saved) {
        this.#chatHistory = JSON.parse(saved);
        if (this.#chatHistory.length > 0) {
          this.#renderChatMessages({ scrollToBottom: true });
        }
      }
    } catch (e) {
      App.log('FluxoAI', 'loadHistory', 'Error al cargar historial persistido:', e);
    }
  }

  #saveHistory() {
    try {
      localStorage.setItem('fluxo_advisor_history', JSON.stringify(this.#chatHistory));
    } catch (_) {}
  }

  resetChat() {
    this.#chatHistory = [];
    this.#visibleCount = 8;
    localStorage.removeItem('fluxo_advisor_history');
    const chatHistoryEl = document.getElementById('gemini-chat-history');
    const welcomeMsg = document.getElementById('gemini-welcome-msg');
    if (chatHistoryEl) {
      chatHistoryEl.innerHTML = '';
      chatHistoryEl.style.display = 'none';
    }
    if (welcomeMsg) welcomeMsg.style.display = 'block';
    if (App.Toast) App.Toast.info('Conversación reiniciada.');
  }

  #updateProfileUI() {
    const pill = document.getElementById('gemini-profile-pill');
    if (!pill) return;
    pill.textContent = this.#riskProfile;
    if (this.#riskProfile === 'CONSERVADOR') {
      pill.style.background = 'var(--verde-tint)';
      pill.style.color = 'var(--verde-text)';
    } else if (this.#riskProfile === 'AGRESIVO') {
      pill.style.background = 'var(--rojo-tint)';
      pill.style.color = 'var(--rojo-text)';
    } else {
      pill.style.background = 'var(--primary-tint)';
      pill.style.color = 'var(--primary)';
    }
  }

  #initUI() {
    const form = document.getElementById('gemini-chat-form');
    const input = document.getElementById('gemini-input');
    const pill = document.getElementById('gemini-profile-pill');
    const clearBtn = document.getElementById('gemini-panel-clear');
    const searchBtn = document.getElementById('gemini-panel-search-btn');
    const searchBar = document.getElementById('gemini-search-bar');
    const searchInput = document.getElementById('gemini-search-input');
    const searchClose = document.getElementById('gemini-search-close');
    const attachBtn = document.getElementById('gemini-attach-btn');
    const fileInput = document.getElementById('gemini-file-input');
    const attachRemove = document.getElementById('gemini-attachment-remove');
    const chatHistoryEl = document.getElementById('gemini-chat-history');

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('¿Querés reiniciar la conversación y borrar el historial de este chat?')) {
          this.resetChat();
        }
      });
    }

    if (pill) {
      pill.addEventListener('click', () => {
        const next = this.#riskProfile === 'CONSERVADOR' ? 'MODERADO' : (this.#riskProfile === 'MODERADO' ? 'AGRESIVO' : 'CONSERVADOR');
        this.setRiskProfile(next);
        if (App.Toast) App.Toast.info(`Perfil de inversor cambiado a: ${next}`);
      });
    }

    // Buscador en el chat
    if (searchBtn && searchBar && searchInput) {
      searchBtn.addEventListener('click', () => {
        const isHidden = searchBar.style.display === 'none';
        searchBar.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) {
          searchInput.focus();
        } else {
          this.#searchQuery = '';
          searchInput.value = '';
          const cnt = document.getElementById('gemini-search-count');
          if (cnt) cnt.textContent = '';
          this.#renderChatMessages();
        }
      });

      searchClose?.addEventListener('click', () => {
        searchBar.style.display = 'none';
        this.#searchQuery = '';
        searchInput.value = '';
        const cnt = document.getElementById('gemini-search-count');
        if (cnt) cnt.textContent = '';
        this.#renderChatMessages();
      });

      searchInput.addEventListener('input', () => {
        this.#searchQuery = searchInput.value.trim();
        this.#executeSearch();
      });
    }

    // Scroll to top para cargar más historial (estilo WhatsApp)
    if (chatHistoryEl) {
      chatHistoryEl.addEventListener('scroll', () => {
        if (chatHistoryEl.scrollTop <= 40 && this.#visibleCount < this.#chatHistory.length && !this.#searchQuery) {
          const oldScrollHeight = chatHistoryEl.scrollHeight;
          const oldScrollTop = chatHistoryEl.scrollTop;
          this.#visibleCount = Math.min(this.#visibleCount + 10, this.#chatHistory.length);
          this.#renderChatMessages({ preserveScroll: true, oldScrollHeight, oldScrollTop });
        }
      });
    }

    // Adjuntos de archivos (XLSX, PDF, imágenes)
    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 15 * 1024 * 1024) {
          if (App.Toast) App.Toast.warning('El archivo supera los 15MB máximos permitidos.');
          fileInput.value = '';
          return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target.result;
          const base64 = dataUrl.split(',')[1];
          const isImg = file.type.startsWith('image/');
          const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
          const isXlsx = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv');

          this.#attachedFile = {
            name: file.name,
            size: file.size,
            type: file.type || (isXlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : (isPdf ? 'application/pdf' : 'application/octet-stream')),
            base64: base64,
            icon: isImg ? '🖼️' : (isPdf ? '📄' : '📊')
          };

          const badge = document.getElementById('gemini-attachment-badge');
          const iconEl = document.getElementById('gemini-attachment-icon');
          const nameEl = document.getElementById('gemini-attachment-name');
          const sizeEl = document.getElementById('gemini-attachment-size');

          if (badge && nameEl) {
            if (iconEl) iconEl.textContent = this.#attachedFile.icon;
            nameEl.textContent = this.#attachedFile.name;
            if (sizeEl) {
              const kb = Math.round(this.#attachedFile.size / 1024);
              sizeEl.textContent = `(${kb > 1024 ? (kb/1024).toFixed(1) + ' MB' : kb + ' KB'})`;
            }
            badge.style.display = 'flex';
          }
        };

        reader.readAsDataURL(file);
      });
    }

    if (attachRemove) {
      attachRemove.addEventListener('click', () => {
        this.#attachedFile = null;
        if (fileInput) fileInput.value = '';
        const badge = document.getElementById('gemini-attachment-badge');
        if (badge) badge.style.display = 'none';
      });
    }

    // Bind Quick Action Chips
    document.querySelectorAll('.gemini-chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.dataset.prompt;
        if (prompt) {
          this.#handleUserMessage(prompt);
        }
      });
    });

    if (form && input) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = input.value.trim();
        if (!message && !this.#attachedFile) return;

        input.value = '';
        this.#handleUserMessage(message || 'Analizá el archivo adjunto y procesá sus movimientos.');
      });
    }

    App.log('FluxoAI', 'initUI', 'UI FluxoAI vinculada con éxito');
  }

  consultarInstrumento({ symbol, name, price, tipo }) {
    const geminiPanel = document.getElementById('gemini-panel');
    const geminiOverlay = document.getElementById('gemini-overlay');
    geminiPanel?.classList.add('open');
    geminiOverlay?.classList.add('open');

    const tick = symbol || name;
    const prompt = `Analizá el instrumento bursátil **${tick}** (${name || ''})${price ? ` con cotización de ${price}` : ''}. ¿Cuáles son los datos de su pliego de emisión o características técnicas, su TIR actual estimada o paridad, y me conviene invertir en él considerando mi perfil inversor (${this.#riskProfile})? Cuestioná la conveniencia con criterio financiero considerando mi horizonte y nivel de riesgo.`;
    this.#handleUserMessage(prompt);
  }

  #executeSearch() {
    const q = this.#searchQuery.toLowerCase();
    const countEl = document.getElementById('gemini-search-count');
    if (!q) {
      if (countEl) countEl.textContent = '';
      this.#renderChatMessages();
      return;
    }

    let matchCount = 0;
    this.#chatHistory.forEach(m => {
      if (m.text && m.text.toLowerCase().includes(q)) matchCount++;
    });

    if (countEl) {
      countEl.textContent = `${matchCount} coincidencia${matchCount === 1 ? '' : 's'}`;
    }

    // Expandir todo el historial para que la búsqueda alcance los mensajes viejos
    this.#visibleCount = this.#chatHistory.length;
    this.#renderChatMessages({ highlightQuery: q });

    // Desplazar al primer resultado
    setTimeout(() => {
      const firstMatch = document.querySelector('.gemini-chat-history mark');
      if (firstMatch) {
        firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }

  #renderChatMessages(opts = {}) {
    const welcomeMsg = document.getElementById('gemini-welcome-msg');
    const chatHistoryEl = document.getElementById('gemini-chat-history');
    if (!chatHistoryEl) return;

    if (this.#chatHistory.length === 0) {
      if (welcomeMsg) welcomeMsg.style.display = 'block';
      chatHistoryEl.style.display = 'none';
      chatHistoryEl.innerHTML = '';
      return;
    }

    if (welcomeMsg) welcomeMsg.style.display = 'none';
    chatHistoryEl.style.display = 'flex';
    chatHistoryEl.innerHTML = '';

    const total = this.#chatHistory.length;
    const countToShow = Math.min(this.#visibleCount, total);
    const hiddenCount = total - countToShow;

    // Botón superior para ver mensajes anteriores
    if (hiddenCount > 0 && !this.#searchQuery) {
      const loadMoreBtn = document.createElement('button');
      loadMoreBtn.type = 'button';
      loadMoreBtn.className = 'gemini-load-more-btn';
      loadMoreBtn.style.cssText = 'align-self:center; margin:8px 0 12px; background:var(--superficie); border:1px solid var(--borde); border-radius:20px; font-size:0.75rem; color:var(--texto-2); padding:5px 14px; cursor:pointer; font-weight:600; box-shadow:var(--sombra-sm); display:inline-flex; align-items:center; gap:6px; transition:all .15s ease;';
      loadMoreBtn.innerHTML = `▲ Ver mensajes anteriores (${hiddenCount})`;
      loadMoreBtn.addEventListener('click', () => {
        const oldScrollHeight = chatHistoryEl.scrollHeight;
        const oldScrollTop = chatHistoryEl.scrollTop;
        this.#visibleCount = Math.min(this.#visibleCount + 10, total);
        this.#renderChatMessages({ preserveScroll: true, oldScrollHeight, oldScrollTop });
      });
      chatHistoryEl.appendChild(loadMoreBtn);
    }

    const visibleMessages = this.#chatHistory.slice(-countToShow);
    visibleMessages.forEach(msg => {
      this.#appendMessageEl(msg.role === 'user' ? 'user' : 'gemini', msg.text, msg.fileInfo, opts.highlightQuery);
    });

    if (opts.scrollToBottom) {
      this.#scrollToBottom();
    } else if (opts.preserveScroll && opts.oldScrollHeight) {
      const newScrollHeight = chatHistoryEl.scrollHeight;
      chatHistoryEl.scrollTop = (newScrollHeight - opts.oldScrollHeight) + (opts.oldScrollTop || 0);
    }
  }

  #formatMarkdown(text, highlightQuery = '') {
    if (!text) return '';

    let cleanText = text;

    // 1. Extraer bloque de acción para importar movimientos si existe: [ACCION_IMPORTAR_MOVIMIENTOS: {...}]
    let importActionHtml = '';
    const importActionMatch = cleanText.match(/\[ACCION_IMPORTAR_MOVIMIENTOS:\s*(\{.+?\})\]/s);
    if (importActionMatch) {
      try {
        const actionData = JSON.parse(importActionMatch[1]);
        const movs = actionData.movimientos || [];
        const ctaNombre = actionData.cuentaNombre || 'la cuenta seleccionada';
        const ctaId = actionData.cuentaId || App.Store?.cuenta;

        importActionHtml = `
          <div class="gemini-import-card" style="margin-top:14px; padding:14px; background:var(--superficie); border:1.5px solid var(--primary); border-radius:var(--r); box-shadow:var(--sombra-md);">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
              <span style="font-size:1.4rem;">📥</span>
              <div>
                <strong style="display:block; color:var(--texto); font-size:0.92rem;">Incorporar Movimientos Extraídos</strong>
                <span style="font-size:0.78rem; color:var(--texto-3);">${movs.length} movimiento(s) para registrar en <strong>${App.Utils.escapeHtml(ctaNombre)}</strong></span>
              </div>
            </div>
            <button type="button" class="btn btn-primary gemini-btn-import-movs" data-cuenta-id="${ctaId}" data-movs='${JSON.stringify(movs).replace(/'/g, "&apos;")}' style="width:100%; display:flex; justify-content:center; align-items:center; gap:6px; font-size:0.85rem; padding:9px 14px; font-weight:600; cursor:pointer;">
              ✓ Confirmar e Incorporar ${movs.length} Gastos/Ingresos
            </button>
          </div>
        `;
        cleanText = cleanText.replace(importActionMatch[0], '').trim();
      } catch (err) {
        console.warn('[FluxoAI] Error parsing ACCION_IMPORTAR_MOVIMIENTOS:', err);
      }
    }

    // 2. Extraer bloque de opciones interactivas si existe
    let optionsHtml = '';
    const optionsMatch = cleanText.match(/\[OPCIONES:\s*(.+?)\]/i);

    if (optionsMatch) {
      cleanText = cleanText.replace(optionsMatch[0], '').trim();
      const rawOptions = optionsMatch[1].split('|').map(o => o.trim()).filter(Boolean);
      optionsHtml = `
        <div class="gemini-interactive-options" style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">
          ${rawOptions.map(opt => `
            <button type="button" class="gemini-option-choice-btn" data-choice="${opt}" style="
              text-align:left;
              padding:10px 14px;
              background:var(--superficie);
              border:1px solid var(--borde);
              border-radius:var(--r);
              cursor:pointer;
              font-size:0.84rem;
              color:var(--texto);
              font-weight:500;
              transition:all .15s ease;
              box-shadow:var(--sombra-sm);
            " onmouseover="this.style.borderColor='var(--primary)';this.style.background='var(--primary-tint)'" onmouseout="this.style.borderColor='var(--borde)';this.style.background='var(--superficie)'">
              ${opt}
            </button>
          `).join('')}
        </div>
      `;
    }

    let html = cleanText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    // Resaltar coincidencias de búsqueda si está activa
    if (highlightQuery && highlightQuery.length >= 2) {
      const re = new RegExp(`(${highlightQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      html = html.replace(re, '<mark style="background:#FFE066; color:#111; padding:0 3px; border-radius:3px; font-weight:700;">$1</mark>');
    }

    html = html.replace(/^(---|\*\*\*|___)\s*$/gm, '<hr style="border:none; border-top:1px solid var(--borde); margin:12px 0;">');
    html = html.replace(/^###\s+(.*$)/gm, '<strong style="display:block; margin:8px 0 4px; font-size:0.95rem; color:var(--texto);">$1</strong>');
    html = html.replace(/^##\s+(.*$)/gm, '<strong style="display:block; margin:10px 0 4px; font-size:1.02rem; color:var(--texto);">$1</strong>');

    // Tablas Markdown
    html = html.replace(/\|(.+)\|/g, (match) => {
      const cells = match.split('|').filter(c => c.trim() !== '');
      if (match.includes('---')) return '';
      return '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
    });
    if (html.includes('<tr>')) {
      html = html.replace(/(<tr>.*?<\/tr>(\s*<tr>.*?<\/tr>)*)/g, '<div class="table-card" style="margin:10px 0;overflow-x:auto;"><table class="table">$1</table></div>');
    }

    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Listas desordenadas
    const lines = html.split('\n');
    let inList = false;
    const processedLines = [];

    for (let line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
        if (!inList) {
          processedLines.push('<ul style="margin:6px 0; padding-left:18px;">');
          inList = true;
        }
        processedLines.push(`<li>${trimmed.substring(2)}</li>`);
      } else {
        if (inList) {
          processedLines.push('</ul>');
          inList = false;
        }
        processedLines.push(line);
      }
    }
    if (inList) processedLines.push('</ul>');

    let finalHtml = '';
    for (let i = 0; i < processedLines.length; i++) {
      const line = processedLines[i];
      if (line.startsWith('<ul') || line === '</ul>' || line.startsWith('<li>') || line.startsWith('<div class="table-card"') || line.startsWith('<hr') || line.startsWith('<strong style="display:block')) {
        finalHtml += line;
      } else {
        finalHtml += line + (i < processedLines.length - 1 ? '<br>' : '');
      }
    }

    return finalHtml + optionsHtml + importActionHtml;
  }

  async #handleUserMessage(message) {
    const welcomeMsg = document.getElementById('gemini-welcome-msg');
    const chatHistoryEl = document.getElementById('gemini-chat-history');

    if (welcomeMsg) welcomeMsg.style.display = 'none';
    if (chatHistoryEl) chatHistoryEl.style.display = 'flex';

    // 1. Manejar archivo adjunto si existe
    const fileInfo = this.#attachedFile ? {
      name: this.#attachedFile.name,
      size: this.#attachedFile.size,
      icon: this.#attachedFile.icon,
      base64: this.#attachedFile.base64,
      type: this.#attachedFile.type
    } : null;

    // Resetear input visual de adjuntos
    this.#attachedFile = null;
    const badge = document.getElementById('gemini-attachment-badge');
    const fileInput = document.getElementById('gemini-file-input');
    if (badge) badge.style.display = 'none';
    if (fileInput) fileInput.value = '';

    // 2. Historial en memoria y DOM
    const userMsgObj = {
      role: 'user',
      text: message,
      fileInfo: fileInfo ? { name: fileInfo.name, icon: fileInfo.icon, size: fileInfo.size } : null,
      timestamp: new Date().toISOString()
    };
    this.#chatHistory.push(userMsgObj);
    this.#visibleCount++;

    this.#appendMessageEl('user', message, userMsgObj.fileInfo);
    this.#scrollToBottom();

    // 3. Indicador de carga
    this.#showLoader();
    this.#scrollToBottom();

    try {
      const payload = {
        message: message,
        chatHistory: this.#chatHistory.slice(0, -1),
        cuentaId: App.Store?.cuenta || null,
        mes: App.Store?.mes || null,
        globalCurrency: App.Store?.globalCurrency || 'ARS',
        riskProfile: this.#riskProfile,
        fileBase64: fileInfo?.base64 || null,
        mimeType: fileInfo?.type || null,
        fileName: fileInfo?.name || null
      };

      const headers = { 'Content-Type': 'application/json' };
      if (window.App && window.App.Auth) {
        const token = window.App.Auth.getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/aiAdvisor', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      });

      let data = null;
      try {
        data = await response.json();
      } catch (_) {}

      this.#hideLoader();

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `HTTP error: ${response.status}`);
      }

      const modelText = data.reply || 'No se pudo generar respuesta.';

      // Actualizar perfil si el modelo diagnosticó uno nuevo
      if (modelText.includes('Perfil de Riesgo:') || modelText.includes('perfil asignado:') || modelText.includes('tu perfil es')) {
        if (modelText.toUpperCase().includes('CONSERVADOR')) this.setRiskProfile('CONSERVADOR');
        else if (modelText.toUpperCase().includes('AGRESIVO')) this.setRiskProfile('AGRESIVO');
        else if (modelText.toUpperCase().includes('MODERADO')) this.setRiskProfile('MODERADO');
      }

      this.#appendMessageEl('gemini', modelText);
      this.#chatHistory.push({
        role: 'model',
        text: modelText,
        timestamp: new Date().toISOString()
      });
      this.#visibleCount++;
      this.#saveHistory();
      this.#scrollToBottom();

    } catch (err) {
      App.log('FluxoAI', 'error', err);
      this.#hideLoader();
      this.#appendMessageEl('error', `Error de FluxoAI: ${err.message || 'Verificá tu conexión o credenciales.'}`);
      this.#scrollToBottom();
    }
  }

  #appendMessageEl(sender, text, fileInfo = null, highlightQuery = '') {
    const chatHistory = document.getElementById('gemini-chat-history');
    if (!chatHistory) return;

    const msgEl = document.createElement('div');
    msgEl.classList.add('message', sender);

    let fileSnippet = '';
    if (fileInfo) {
      fileSnippet = `
        <div style="display:inline-flex; align-items:center; gap:6px; background:rgba(0,0,0,0.06); padding:4px 10px; border-radius:12px; margin-bottom:6px; font-size:0.75rem; font-weight:600;">
          <span>${fileInfo.icon || '📎'}</span>
          <span>${App.Utils.escapeHtml(fileInfo.name)}</span>
        </div><br>
      `;
    }

    if (sender === 'gemini') {
      msgEl.innerHTML = fileSnippet + this.#formatMarkdown(text, highlightQuery);

      // Vincular eventos a los botones de opción interactiva
      msgEl.querySelectorAll('.gemini-option-choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const choice = btn.dataset.choice;
          if (choice) {
            msgEl.querySelectorAll('.gemini-option-choice-btn').forEach(b => {
              b.disabled = true;
              b.style.opacity = '0.6';
              b.style.pointerEvents = 'none';
            });
            btn.style.background = 'var(--primary)';
            btn.style.color = '#FFFFFF';
            btn.style.opacity = '1';
            this.#handleUserMessage(choice);
          }
        });
      });

      // Vincular botón para confirmar incorporación de movimientos
      msgEl.querySelectorAll('.gemini-btn-import-movs').forEach(btn => {
        btn.addEventListener('click', async () => {
          const cuentaId = btn.dataset.cuentaId || App.Store?.cuenta;
          const rawMovs = btn.dataset.movs;
          if (!rawMovs) return;

          let movs = [];
          try {
            movs = JSON.parse(rawMovs);
          } catch (_) {
            App.Toast?.error('Error al leer los movimientos para importar.');
            return;
          }

          btn.disabled = true;
          btn.innerHTML = `<span>⏳ Incorporando ${movs.length} movimientos...</span>`;

          try {
            let countOk = 0;
            for (const m of movs) {
              const res = await App.API.call('createMovimiento', {
                idCuentaPrincipal: cuentaId,
                fecha: m.fecha || App.Utils.toInputDate(new Date()),
                descripcion: m.descripcion || 'Gasto importado FluxoAI',
                importe: Number(m.importe || 0),
                tipoMov: m.tipo_mov || 'EGRESO',
                tipoEgreso: m.tipo_egreso || 'VARIABLE',
                idCategoria: m.id_categoria || 'CAT_OTROS',
                medioPago: m.medio_pago || 'Transferencia',
                moneda: m.moneda || 'ARS'
              });
              if (res && res.success) countOk++;
            }

            btn.style.background = 'var(--verde)';
            btn.style.borderColor = 'var(--verde)';
            btn.innerHTML = `✓ ${countOk} Movimientos incorporados con éxito`;

            if (App.Toast) App.Toast.success(`${countOk} movimientos registrados en la cuenta.`);
            App.Store?.markModuloLoaded('dashboard', false);
            App.Store?.markModuloLoaded('tarjetas', false);
            window.dispatchEvent(new CustomEvent('data:changed', { detail: { entity: 'movimientos' } }));

          } catch (err) {
            btn.disabled = false;
            btn.innerHTML = `⚠️ Reintentar incorporación`;
            if (App.Toast) App.Toast.error(err.message || 'Error al incorporar movimientos.');
          }
        });
      });

    } else {
      let contentHtml = fileSnippet + App.Utils.escapeHtml(text);
      if (highlightQuery && highlightQuery.length >= 2) {
        const re = new RegExp(`(${highlightQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        contentHtml = contentHtml.replace(re, '<mark style="background:#FFE066; color:#111; padding:0 3px; border-radius:3px; font-weight:700;">$1</mark>');
      }
      msgEl.innerHTML = contentHtml;
    }

    chatHistory.appendChild(msgEl);
  }

  #showLoader() {
    const chatHistory = document.getElementById('gemini-chat-history');
    if (!chatHistory || document.getElementById('gemini-chat-loader')) return;

    const loaderEl = document.createElement('div');
    loaderEl.id = 'gemini-chat-loader';
    loaderEl.classList.add('gemini-loader');
    loaderEl.innerHTML = '<span></span><span></span><span></span>';
    chatHistory.appendChild(loaderEl);
  }

  #hideLoader() {
    const loaderEl = document.getElementById('gemini-chat-loader');
    loaderEl?.remove();
  }

  #scrollToBottom() {
    const chatHistory = document.getElementById('gemini-chat-history');
    if (chatHistory) {
      chatHistory.scrollTop = chatHistory.scrollHeight;
    }
    const panelBody = document.querySelector('.gemini-panel-body');
    if (panelBody) {
      panelBody.scrollTop = panelBody.scrollHeight;
    }
  }
}

// Instanciar en el scope global
if (window.App) {
  window.App.Gemini = new GeminiChatController();
}
