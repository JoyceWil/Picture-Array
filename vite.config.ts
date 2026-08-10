import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    PACKAGE_VERSION: JSON.stringify('3.2.1'),
  },
  esbuild: {
    jsx: 'automatic',
  },
})
