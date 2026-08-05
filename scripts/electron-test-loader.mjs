import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const electronStub = new URL('./electron-test-stub.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: electronStub, shortCircuit: true }
  }

  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (
      error?.code !== 'ERR_MODULE_NOT_FOUND' ||
      !context.parentURL ||
      (!specifier.startsWith('./') && !specifier.startsWith('../'))
    ) {
      throw error
    }

    const candidate = new URL(`${specifier}.ts`, context.parentURL)
    if (!existsSync(fileURLToPath(candidate))) throw error
    return { url: candidate.href, shortCircuit: true }
  }
}
