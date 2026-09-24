import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// 本机模式(学员包)构建:src/demo/ 换成 src/demo-empty/——示范数据是作者自己的作品和提示词,不随包发。
const local = process.env.VITE_DB_MODE === 'local'
const empty = fileURLToPath(new URL('./src/demo-empty/', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: { alias: local ? [{ find: /^(\.\.\/|\.\/)demo\/(.+)$/, replacement: empty + '$2' }] : [] },
})
