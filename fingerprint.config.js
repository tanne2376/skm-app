/** @type {import('expo/fingerprint').Config} */
const { SourceSkips } = require('expo/fingerprint');

module.exports = {
  // Version/build numbers (version, ios.buildNumber, android.versionCode) don't
  // change native compatibility. Without this, bumping android.versionCode alone
  // gave iOS and Android builds of the same code different runtime versions, so an
  // OTA update could only target one of them.
  // Setting sourceSkips replaces the default, so keep the default
  // (PackageJsonAndroidAndIosScriptsIfNotContainRun) alongside it.
  sourceSkips:
    SourceSkips.ExpoConfigVersions |
    SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun,
};
