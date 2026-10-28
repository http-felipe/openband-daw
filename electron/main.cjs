// Desktop shell: loads the Vite build (or a dev server) in a sandboxed window.
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');

const ALLOWED_PERMISSIONS = new Set(['media', 'midi']);
/** `--smoke-test`: load hidden, check the UI and audio engine booted, print a JSON report and exit 0/1 (used by CI). */
const SMOKE_TEST = process.argv.includes('--smoke-test');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: !SMOKE_TEST,
    backgroundColor: '#14161b',
    title: 'OpenBand DAW',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  if (SMOKE_TEST) runSmokeTest(win);
}

function runSmokeTest(win) {
  const problems = [];
  const finish = (report) => {
    console.log(JSON.stringify({ ...report, problems }, null, 2));
    app.exit(problems.length ? 1 : 0);
  };
  setTimeout(() => {
    problems.push('timed out waiting for the app to load');
    finish({});
  }, 30000);
  win.webContents.on('console-message', (event, level, message) => {
    const text = message ?? event.message;
    // 3 = error; the engine logs an "[OpenBand]" warning when it has to fall back from AudioWorklet.
    if (level >= 3 || String(text).includes('[OpenBand]')) problems.push(`console: ${text}`);
  });
  win.webContents.on('did-fail-load', (_e, code, description) => problems.push(`load failed: ${code} ${description}`));
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const report = await win.webContents.executeJavaScript(`(() => ({
        title: document.title,
        toolbar: !!document.querySelector('.toolbar'),
        tracks: document.querySelectorAll('.trk').length,
        bootError: document.querySelector('.boot.error')?.textContent ?? null,
      }))()`);
      if (!report.toolbar) problems.push('the UI did not render');
      if (report.bootError) problems.push(`boot error: ${report.bootError}`);
      finish({ electron: process.versions.electron, platform: `${process.platform}-${process.arch}`, ...report });
    }, 2500);
  });
}

app.whenReady().then(() => {
  // Microphone (amp-sim input) and Web MIDI controllers are the only capabilities the app asks for.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
