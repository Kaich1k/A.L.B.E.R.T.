const { join } = require('node:path')
const { execFileSync } = require('node:child_process')
const { signAsync } = require('@electron/osx-sign')

// A personal local build still needs a complete bundle signature. Leaving the
// Electron linker's signature in place gives TCC an invalid "Electron" identity.
// This does not grant permissions or change designated-requirement protections.
module.exports = async function signLocalMac(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const root = context.packager.projectDir
  await signAsync({
    app,
    identity: '-',
    identityValidation: false,
    platform: 'darwin',
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile(file) {
      return {
        // Preserve the existing Electron runtime settings. The Swift controller
        // needs no runtime exceptions or sandbox entitlements.
        entitlements: file.endsWith('/MacOS/albert-desktop-helper')
          ? [] : join(root, 'build', 'entitlements.mac.plist'),
        hardenedRuntime: false,
        timestamp: 'none'
      }
    }
  })
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log('Verified local ALBERT bundle signature, including desktop controller.')
}
