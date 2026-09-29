import { resolve } from 'path'
import { defineConfig } from 'electron-vite'

// electron-vite 标准三段配置（main / preload / renderer）
// 产物约定：out/main/index.js、out/preload/index.js、out/renderer/
export default defineConfig({
  // 主进程：入口 src/main/index.js -> out/main/index.js（package.json main 字段）
  main: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.js')
      }
    }
  },
  // 预加载脚本：入口 src/preload/index.js -> out/preload/index.js
  preload: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.js')
      }
    }
  },
  // 渲染进程：root 指向 src/renderer，开发时经 ELECTRON_RENDERER_URL 提供
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})
