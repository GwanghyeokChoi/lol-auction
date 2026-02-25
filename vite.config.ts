import { defineConfig } from 'vite';

export default defineConfig({
  base: '/lol-auction/', // GitHub Pages 리포지토리 이름
  build: {
    outDir: 'dist',
  }
});