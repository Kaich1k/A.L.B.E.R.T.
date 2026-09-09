import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs'
import { dirname, resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const HMR_PAUSE = resolve('.albert-hmr-pause')

function hmrPaused(): boolean {
  if (!existsSync(HMR_PAUSE)) return false
  try {
    return Date.now() - statSync(HMR_PAUSE).mtimeMs < 15 * 60_000
  } catch {
    return false
  }
}

function ignoreWhilePaused(path: string): boolean {
  if (/[/\\]node_modules[/\\]/.test(path) || /[/\\]\.git[/\\]/.test(path)) return true
  if (!hmrPaused()) return false
  return (
    /[/\\]src[/\\]/.test(path) ||
    /[/\\]scripts[/\\]/.test(path) ||
    /electron\.vite\.config/.test(path) ||
    /[/\\]package\.json$/.test(path)
  )
}

/** Skip Vite HMR / rebuilds while Cursor is editing live ALBERT source. */
function albertHmrGuard(): Plugin {
  return {
    name: 'albert-hmr-guard',
    handleHotUpdate() {
      if (hmrPaused()) return []
    },
    hotUpdate() {
      if (hmrPaused()) return []
    }
  }
}

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

export default defineConfig(({ command }) => {
  const pauseWatch =
    command === 'serve'
      ? {
          watch: {
            chokidar: {
              ignored: ignoreWhilePaused
            }
          }
        }
      : {}

  return {
    main: {
      plugins: [
        albertHmrGuard(),
        externalizeDepsPlugin({
          exclude: []
        }),
        copyVoiceWorkersPlugin()
      ],
      server: {
        watch: { ignored: ignoreWhilePaused }
      },
      build: {
        ...pauseWatch,
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
      plugins: [albertHmrGuard(), externalizeDepsPlugin()],
      server: {
        watch: { ignored: ignoreWhilePaused }
      },
      build: {
        ...pauseWatch,
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
      plugins: [albertHmrGuard(), react()],
      server: {
        watch: { ignored: ignoreWhilePaused }
      }
    }
  }
})
