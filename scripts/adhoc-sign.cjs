// electron-builder afterPack hook: ad-hoc code-sign macOS builds.
// Without a paid developer certificate, a valid ad-hoc signature is still required: arm64 Macs refuse to run
// apps whose signature is broken (packaging edits the prebuilt Electron bundle) and would report them as
// "damaged". With it, macOS only shows the usual "unverified developer" prompt.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // codesign rejects bundles carrying Finder/quarantine extended attributes ("detritus not allowed").
  execFileSync('xattr', ['-cr', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
