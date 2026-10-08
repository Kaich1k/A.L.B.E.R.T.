import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

if (process.platform !== 'darwin') {
  console.log('Native desktop helper is available on macOS only.')
} else {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const output = join(root, 'resources', 'albert-desktop-helper')
  mkdirSync(join(root, 'resources'), { recursive: true })
  const sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' }).trim()
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  execFileSync('xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macosx14.0`, '-sdk', sdk, '-module-cache-path', join(root, 'node_modules', '.cache', 'desktop-swift'),
    join(root, 'native', 'DesktopHelper.swift'), '-o', output,
    '-framework', 'AppKit', '-framework', 'ApplicationServices'], { stdio: 'inherit' })
  console.log('Built native desktop helper.')
}
