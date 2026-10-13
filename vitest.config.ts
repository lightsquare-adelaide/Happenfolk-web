import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'src/**/*.spec.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 20_000,
  },
})
