import './gui/styles.css';
import { App } from './gui/app';

const root = document.getElementById('app');
if (root) {
  App.boot(root).catch((err: unknown) => {
    console.error(err);
    root.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'boot error';
    msg.textContent = `OpenBand failed to start: ${err instanceof Error ? err.message : String(err)}`;
    root.append(msg);
  });
}
