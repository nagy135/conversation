import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { 'react-native': 'react-native-web' } },
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
