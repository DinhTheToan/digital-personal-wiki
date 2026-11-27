import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    watch: {
      ignored: ['**/vault/**'],
    },
  },
  plugins: [
    react(),
    {
      name: 'watch-content',
      configureServer(server) {
        server.watcher.add('public/content.json');
        server.watcher.on('change', (p) => {
          if (p.endsWith('content.json')) server.ws.send({ type: 'full-reload' });
        });
      },
    },
  ],
});
