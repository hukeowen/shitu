import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import legacy from '@vitejs/plugin-legacy'
import Components from 'unplugin-vue-components/vite'
import { VantResolver } from '@vant/auto-import-resolver'

export default defineConfig({
  plugins: [
    vue(),
    Components({ resolvers: [VantResolver()], dts: 'components.d.ts' }),
    legacy({ targets: ['Android >= 8', 'iOS >= 13'] }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // 四个端共用一份 favicon（蓝色品牌标），放在共享图标包里
  publicDir: fileURLToPath(new URL('../../packages/ui-icons/public', import.meta.url)),
  server: {
    port: 5174,
    host: true,
    proxy: { '/api': 'http://localhost:8080' },
  },
})
