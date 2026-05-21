'use strict';
/* ============================================================
   AppGemini.js — v6.0.0
   Controlador del chat asistente Gemini AI (client-side).
   Utiliza la API Key provista en el prompt para interactuar con Gemini 1.5 Flash.
   ============================================================ */

export class GeminiChatController {
  #chatHistory = [];
  #apiKey = 'AIzaSyAmgUEcj3daadBB24fIUboBOH-8I69FbaA';
  #apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
  #initialized = false;

  constructor() {
    App.log('GeminiChatController', 'constructor', 'Inicializando controlador Gemini');
  }

  init() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#initUI();
  }

  #initUI() {
    const form = document.getElementById('gemini-chat-form');
    const input = document.getElementById('gemini-input');
    
    if (!form || !input) {
      App.log('GeminiChatController', 'initUI', 'No se encontraron los elementos del chat de Gemini. Reintentando...');
      return;
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const message = input.value.trim();
      if (!message) return;

      input.value = '';
      this.#handleUserMessage(message);
    });

    App.log('GeminiChatController', 'initUI', 'UI del chat Gemini vinculada con éxito');
  }

  #compileSystemInstruction() {
    const activeCuenta = App.Store.cuenta;
    const cuentaObj = App.Store.cuentas.find(c => c.id_cuenta_principal === activeCuenta);
    const nombreCuenta = cuentaObj?.nombre || activeCuenta;
    const mes = App.Store.mes || '';
    const moneda = App.Store.globalCurrency || 'ARS';
    
    // Obtener KPIs del DOM actual
    const saldoText = document.getElementById('dash-saldo-val')?.textContent || '$ 0,00';
    const ingresosText = document.getElementById('dash-breakdown-ingresos')?.textContent || '$ 0,00';
    const egresosText = document.getElementById('dash-breakdown-egresos')?.textContent || '$ 0,00';
    
    // Módulos
    const tcTotal = cuentaObj?.modulo_tarjetas_activo ? (document.getElementById('dash-tc-total')?.textContent || '—') : 'Inactivo';
    const ccSaldo = cuentaObj?.modulo_cc_activo ? (document.getElementById('dash-cc-saldo')?.textContent || '—') : 'Inactivo';
    const ahorroTotal = cuentaObj?.modulo_ahorro_activo ? (document.getElementById('dash-ahorro-total')?.textContent || '—') : 'Inactivo';
    const inversionesValor = cuentaObj?.modulo_inversiones_activo ? (document.getElementById('dash-inversiones-valor')?.textContent || '—') : 'Inactivo';

    // Lista de últimos movimientos
    const recentMovs = App.Modules.dashboard?.movData || [];
    const movsContext = recentMovs.map(m => {
      const fecha = App.Utils.formatearFecha(m.fecha?.value || m.fecha || '');
      const tipo = m.tipo_mov || '';
      const cat = m.categoria_nombre || 'General';
      const desc = m.descripcion || '';
      const imp = App.Utils.formatearMoneda(m.importe);
      return `- ${fecha} | ${tipo} | ${cat} | ${desc} | ${imp}`;
    }).join('\n');

    const userDisplayName = App.Store.usuario?.user_metadata?.full_name || 
                            App.Store.usuario?.email?.split('@')[0] || 
                            'Gaston';

    return `Eres "Gemini AI", el asistente financiero inteligente integrado en la aplicación de finanzas personales "Fluxo".
Tu objetivo es ayudar al usuario a entender sus finanzas y responder a sus consultas de forma clara, directa, empática y concisa (ideal para visualización en un panel de chat móvil). Responde siempre en español.

CONTEXTO FINANCIERO ACTUAL DEL USUARIO:
- Usuario: ${userDisplayName}
- Cuenta Activa: ${nombreCuenta}
- Período de Análisis: ${mes}
- Moneda Principal: ${moneda}
- Saldo Total: ${saldoText}
- Total Ingresos del Mes: ${ingresosText}
- Total Egresos del Mes: ${egresosText}

ESTADO DE MÓDULOS DE LA CUENTA:
- Tarjetas de Crédito: ${cuentaObj?.modulo_tarjetas_activo ? `Activo (Total Consumos del mes: ${tcTotal})` : 'Desactivado'}
- Gastos Compartidos: ${cuentaObj?.modulo_cc_activo ? `Activo (Saldo Neto: ${ccSaldo})` : 'Desactivado'}
- Chanchito (Ahorro): ${cuentaObj?.modulo_ahorro_activo ? `Activo (Total Ahorrado: ${ahorroTotal})` : 'Desactivado'}
- Inversiones: ${cuentaObj?.modulo_inversiones_activo ? `Activo (Valor Actual: ${inversionesValor})` : 'Desactivado'}

ÚLTIMOS MOVIMIENTOS REGISTRADOS EN ESTE PERÍODO:
${movsContext || 'No hay movimientos registrados en este período.'}

INSTRUCCIONES DE COMPORTAMIENTO:
1. Responde preguntas del usuario basándote en el contexto financiero proporcionado. Si es posible, realiza resúmenes rápidos de gastos, categorías, o saldo.
2. Sé muy breve y conciso, utilizando negritas y listas viñetadas para estructurar las respuestas para pantallas móviles.
3. Si el usuario te pregunta por un módulo que está desactivado, menciónale amablemente que puede activarlo desde el panel de configuración de la cuenta.
4. Si el usuario te hace preguntas no financieras o no relacionadas con la aplicación, guíalo amablemente de vuelta a sus finanzas en Fluxo.`;
  }

  #formatMarkdown(text) {
    if (!text) return '';
    // Escapar caracteres HTML para seguridad
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

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
    if (inList) {
      processedLines.push('</ul>');
    }

    // Unir líneas e insertar <br> donde sea necesario
    let finalHtml = '';
    for (let i = 0; i < processedLines.length; i++) {
      const line = processedLines[i];
      if (line === '<ul>' || line === '</ul>' || line.startsWith('<li>')) {
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

    // 2. Agregar mensaje de usuario al historial de la conversación en memoria
    this.#chatHistory.push({
      role: 'user',
      parts: [{ text: message }]
    });

    // Mantener historial recortado a los últimos 20 mensajes para evitar desborde de tokens
    if (this.#chatHistory.length > 20) {
      this.#chatHistory.shift();
    }

    // 3. Mostrar indicador de escritura (loader)
    this.#showLoader();
    this.#scrollToBottom();

    try {
      const systemInstruction = this.#compileSystemInstruction();
      
      const response = await fetch(`${this.#apiUrl}?key=${this.#apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemInstruction }]
          },
          contents: this.#chatHistory,
          generationConfig: {
            temperature: 0.3
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const modelText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No pude procesar tu solicitud en este momento.';

      // Ocultar loader
      this.#hideLoader();

      // 4. Agregar respuesta del modelo al DOM y al historial
      this.#appendMessage('gemini', modelText);
      this.#chatHistory.push({
        role: 'model',
        parts: [{ text: modelText }]
      });

      this.#scrollToBottom();
    } catch (err) {
      App.log('GeminiChatController', 'error', err);
      this.#hideLoader();
      this.#appendMessage('error', 'Error de conexión: No se pudo contactar a Gemini AI.');
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
