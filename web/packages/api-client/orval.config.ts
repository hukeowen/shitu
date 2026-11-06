import { defineConfig } from 'orval'

/**
 * 从后端 springdoc 生成请求函数与类型：pnpm --filter @shitu/api-client generate
 * 需先启动 server（http://localhost:8080）。生成物在 src/generated，不入库。
 */
export default defineConfig({
  shitu: {
    input: { target: 'http://localhost:8080/v3/api-docs' },
    output: {
      mode: 'tags-split',
      target: 'src/generated',
      client: 'axios-functions',
      override: {
        mutator: { path: 'src/http.ts', name: 'request' },
      },
    },
  },
})
