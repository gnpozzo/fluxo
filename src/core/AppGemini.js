'use strict';
/* ============================================================
   AppGemini.js — v6.0.0
   Controlador del chat asistente Gemini AI (client-side).
   Utiliza la API Key provista en el prompt para interactuar con Gemini 1.5 Flash.
   ============================================================ */

export class GeminiChatController {
  #chatHistory = [];
  #initialized = false;
  #riskProfile = localStorage.getItem('fluxo_risk_profile') || 'MODERADO';

  constructor() {
    App.log('GeminiChatController', 'constructor', 'Inicializando Fluxo Wealth Advisor');
  }

  get riskProfile() {
    return this.#riskProfile;
  }

  setRiskProfile(profile) {
    this.#riskProfile = profile;
    localStorage.setItem('fluxo_risk_profile', profile);
    this.#updateProfileUI();
  }

  async init() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#initUI();
    this.#updateProfileUI();
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

    if (pill) {
      pill.addEventListener('click', () => {
        const next = this.#riskProfile === 'CONSERVADOR' ? 'MODERADO' : (this.#riskProfile === 'MODERADO' ? 'AGRESIVO' : 'CONSERVADOR');
        this.setRiskProfile(next);
        if (App.Toast) App.Toast.info(`Perfil de inversor cambiado a: ${next}`);
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
        if (!message) return;

        input.value = '';
        this.#handleUserMessage(message);
      });
    }

    App.log('GeminiChatController', 'initUI', 'UI Fluxo Wealth Advisor vinculada con éxito');
  }

  #formatMarkdown(text) {
    if (!text) return '';
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    // Tablas Markdown
    html = html.replace(/\|(.+)\|/g, (match) => {
      const cells = match.split('|').filter(c => c.trim() !== '');
      if (match.includes('---')) return ''; // Línea separadora
      return '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
    });
    if (html.includes('<tr>')) {
      html = html.replace(/(<tr>.*?<\/tr>(\s*<tr>.*?<\/tr>)*)/g, '<div class="table-card" style="margin:10px 0;overflow-x:auto;"><table class="table">$1</table></div>');
    }

    // Negritas **texto**
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Listas desordenadas (* o -)
    const lines = html.split('\n');
    let inList = false;
    const processedLines = [];

    for (let line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
        if (!inList) {
          processedLines.push('<ul>');
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
      if (line === '<ul>' || line === '</ul>' || line.startsWith('<li>') || line.startsWith('<div class="table-card"')) {
        finalHtml += line;
      } else {
        finalHtml += line + (i < processedLines.length - 1 ? '<br>' : '');
      }
    }

    return finalHtml;
  }

  async #handleUserMessage(message) {
    const welcomeMsg = document.getElementById('gemini-welcome-msg');
    const chatHistory = document.getElementById('gemini-chat-history');

    if (welcomeMsg) welcomeMsg.style.display = 'none';
    if (chatHistory) chatHistory.style.display = 'flex';

    // 1. Agregar mensaje de usuario al DOM
    this.#appendMessage('user', message);
    this.#scrollToBottom();

    // 2. Historial en memoria
    this.#chatHistory.push({
      role: 'user',
      text: message
    });

    if (this.#chatHistory.length > 20) {
      this.#chatHistory.shift();
    }

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
        riskProfile: this.#riskProfile
      };

      const response = await fetch('/api/aiAdvisor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      this.#hideLoader();

      if (!data.success) {
        throw new Error(data.error || 'Error al procesar consulta');
      }

      const modelText = data.reply || 'No se pudo generar respuesta.';

      // Actualizar perfil si el modelo diagnosticó uno nuevo
      if (modelText.includes('Perfil de Riesgo:') || modelText.includes('perfil asignado:') || modelText.includes('tu perfil es')) {
        if (modelText.toUpperCase().includes('CONSERVADOR')) this.setRiskProfile('CONSERVADOR');
        else if (modelText.toUpperCase().includes('AGRESIVO')) this.setRiskProfile('AGRESIVO');
        else if (modelText.toUpperCase().includes('MODERADO')) this.setRiskProfile('MODERADO');
      }

      this.#appendMessage('gemini', modelText);
      this.#chatHistory.push({
        role: 'model',
        text: modelText
      });

      this.#scrollToBottom();

    } catch (err) {
      App.log('GeminiChatController', 'error', err);
      this.#hideLoader();
      this.#appendMessage('error', `Error al contactar al asesor: ${err.message || 'Verificá tu conexión o credenciales.'}`);
      this.#scrollToBottom();
    }
  }

  #appendMessage(sender, text) {
    const chatHistory = document.getElementById('gemini-chat-history');
    if (!chatHistory) return;

    const msgEl = document.createElement('div');
    msgEl.classList.add('message', sender);

    if (sender === 'gemini') {
      msgEl.innerHTML = this.#formatMarkdown(text);
    } else {
      msgEl.textContent = text;
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
  }
}

// Instanciar en el scope global
if (window.App) {
  window.App.Gemini = new GeminiChatController();
}
