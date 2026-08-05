/** Test-only resolver for Node's type-stripping mode and Metro-style imports. */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (originalError) {
    const relative = specifier.startsWith('.') || specifier.startsWith('/')
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier)
    if (relative && !hasExtension) {
      try {
        return await nextResolve(`${specifier}.ts`, context)
      } catch {
        // Preserve Node's original error, which points at the source import.
      }
    }
    throw originalError
  }
}
