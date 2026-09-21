import { defineConfig, loadEnv } from 'vite';

function localApiPlugin() {
  return {
    name: 'local-api-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && (req.url.startsWith('/api/') || req.url === '/api')) {
          try {
            const urlObj = new URL(req.url, 'http://localhost:3000');
            req.query = Object.fromEntries(urlObj.searchParams.entries());

            if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
              const buffers = [];
              for await (const chunk of req) {
                buffers.push(chunk);
              }
              const rawBody = Buffer.concat(buffers).toString('utf-8');
              if (rawBody) {
                try {
                  req.body = JSON.parse(rawBody);
                } catch (_) {
                  req.body = rawBody;
                }
              } else {
                req.body = {};
              }
            }

            res.status = function(code) {
              res.statusCode = code;
              return res;
            };
            res.json = function(data) {
              if (!res.headersSent) {
                res.setHeader('Content-Type', 'application/json');
              }
              res.end(JSON.stringify(data));
              return res;
            };

            const { default: handler } = await server.ssrLoadModule('/api/index.js');
            return await handler(req, res);
          } catch (err) {
            console.error('[Vite Local API Error]:', err);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          }
        } else {
          next();
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    plugins: [localApiPlugin()],
    envPrefix: ['VITE_', 'SUPABASE_'],
    server: {
      port: 3000,
      open: true
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks: {
            vendor_ui: ['chart.js'],
            vendor_db: ['@supabase/supabase-js']
          }
        }
      }
    }
  };
});
