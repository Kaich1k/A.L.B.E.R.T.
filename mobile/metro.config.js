const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const repoRoot = path.resolve(projectRoot, '..')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot)

// Nested inside the Electron app repo — keep Metro from using the parent
// package.json "main" (./out/main/index.js) as the app entry.
config.projectRoot = projectRoot
config.watchFolders = [projectRoot]
config.resolver.blockList = [
  new RegExp(`^${repoRoot.replace(/[/\\]/g, '[/\\\\]')}/out(/|$)`)
]

module.exports = config
