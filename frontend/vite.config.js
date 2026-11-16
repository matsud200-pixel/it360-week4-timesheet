import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The dev server sends /api to the backend. Default port 5000; on a Mac (AirPlay holds 5000)
// start the backend with PORT=5001 and run: API=http://localhost:5001 npm run dev
export default defineConfig({
  plugins: [react()],
  server: { port: 3000, proxy: { '/api': process.env.API || 'http://localhost:5000' } },
});
