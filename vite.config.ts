import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    inspectAttr(),
    react(),
    // word-extractor（老式 .doc 解析）依赖 buffer/stream/path/fs 等 Node 内置模块，浏览器端需 polyfill
    nodePolyfills({ include: ['buffer', 'stream', 'path', 'fs', 'util', 'events'] }),
    viteSingleFile(),
  ],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
