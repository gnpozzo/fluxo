import { defineConfig } from 'vite';

// [Origen -> Config -> vite.config.js]
// v1.0.0
// Configuración maestra para el pipeline de frontend de Vercel. 
// Optimizada para soportar imports dinámicos y proxy local.

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    // El proxy simula el comportamiento de las Vercel Serverless Functions
    // en la carpeta /api durante desarrollo local.
    proxy: {
      '/api': {
        target: 'http://localhost:3000', 
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        // Separa el código en chunks lógicos para mejor cache y SEO/perf
        manualChunks: {
          vendor_ui: ['chart.js'],
          vendor_db: ['@supabase/supabase-js']
        }
      }
    }
  }
});
