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
  server: {
    port: 5173,
    host: true,
    // /r/{code} 扫码入口由后端处理（记访问、写渠道 Cookie、302 回 /?ch=），与生产 Nginx 一致
    proxy: { '/api': 'http://localhost:8080', '/r': 'http://localhost:8080' },
  },
})
