const { withAndroidManifest } = require('@expo/config-plugins')

/**
 * The optional Mac companion is an HTTP service on the user's private LAN.
 * Android blocks cleartext by default; direct cloud AI traffic remains HTTPS.
 */
module.exports = function withAlbertLocalNetwork(config) {
  return withAndroidManifest(config, (result) => {
    const application = result.modResults.manifest.application?.[0]
    if (application) {
      application.$ = application.$ || {}
      application.$['android:usesCleartextTraffic'] = 'true'
    }
    return result
  })
}

