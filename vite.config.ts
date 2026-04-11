import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // @ts-ignore - process.cwd() exists in Node env but TS might complain in some setups
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
    },
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.VITE_API_KEY || env.API_KEY || ""),
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
  };
});