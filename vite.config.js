import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from https://<user>.github.io/pace-trace/, so production builds need that base path.
// The dev server keeps serving from the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/pace-trace/' : '/',
  plugins: [react()],
}));
