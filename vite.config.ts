import { defineConfig } from 'vite';

export default defineConfig({
  base: '/', // 커스텀 도메인 사용 시 루트 경로
  build: {
    outDir: 'dist',
  }
});