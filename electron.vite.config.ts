import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/** Copy ONNX child-process workers beside the main bundle. */
function copyVoiceWorkersPlugin(): Plugin {
  return {
    name: 'copy-voice-workers',
    closeBundle() {
      for (const name of ['kokoro-worker.cjs', 'whisper-worker.cjs']) {
        const src = resolve(`src/main/voice/${name}`)
        const dest = resolve(`out/main/${name}`)
        if (!existsSync(src)) continue
        mkdirSync(dirname(dest), { recursive: true })
        copyFileSync(src, dest)
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: []
      }),
      copyVoiceWorkersPlugin()
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts')
        },
        external: [
          '@huggingface/transformers',
          'onnxruntime-node',
          'kokoro-js',
          'phonemizer'
        ]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
