import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [vue(), Components({ resolvers: [ElementPlusResolver()], dts: 'components.d.ts' })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5176,
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
})
