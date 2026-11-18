import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [vue(), Components({ resolvers: [ElementPlusResolver()], dts: 'components.d.ts' })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // 四个端共用一份 favicon（蓝色品牌标），放在共享图标包里
  publicDir: fileURLToPath(new URL('../../packages/ui-icons/public', import.meta.url)),
  server: {
    port: 5175,
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
})
