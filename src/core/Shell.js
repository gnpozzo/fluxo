'use strict';
    (function() {
      const THEME_KEY = 'app_theme';
      const saved     = sessionStorage.getItem(THEME_KEY) || 'light';
      document.documentElement.setAttribute('data-theme', saved);

      function syncThemeUI(theme) {
        const themeText = document.getElementById('dropdown-theme-text');
        if (themeText) {
          themeText.textContent = theme === 'dark' ? 'Modo claro' : 'Modo oscuro';
        }
      }

      window.toggleAppTheme = function() {
        const current = document.documentElement.getAttribute('data-theme');
        const next    = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        sessionStorage.setItem(THEME_KEY, next);
        syncThemeUI(next);
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: next } }));
      };

      // Sincronizar texto inicial de tema
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => syncThemeUI(saved));
      } else {
        syncThemeUI(saved);
      }

      // --- Gemini panel toggle ---
      const btnGemini = document.getElementById('btn-gemini');
      const btnHeaderGemini = document.getElementById('btn-header-gemini');
      const geminiPanel = document.getElementById('gemini-panel');
      const geminiOverlay = document.getElementById('gemini-overlay');
      const geminiClose = document.getElementById('gemini-panel-close');

      function openGemini() {
        geminiPanel?.classList.add('open');
        geminiOverlay?.classList.add('open');
        if (window.App && window.App.Gemini) {
          window.App.Gemini.onOpen();
        }
      }

      function closeGemini() {
        geminiPanel?.classList.remove('open');
        geminiOverlay?.classList.remove('open');
      }

      btnGemini?.addEventListener('click', openGemini);
      btnHeaderGemini?.addEventListener('click', openGemini);
      geminiClose?.addEventListener('click', closeGemini);
      geminiOverlay?.addEventListener('click', closeGemini);

      // --- Config header button (same as sidebar Ajustes) ---
      document.getElementById('btn-admin-header')?.addEventListener('click', () => {
        document.getElementById('btn-admin')?.click();
      });
    })();
