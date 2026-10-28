import { h } from './dom';

export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  action: () => void;
}

/** A non-clickable group title inside a menu. */
export interface MenuHeader {
  header: string;
}

let open: HTMLElement | null = null;

function closeMenu(): void {
  open?.remove();
  open = null;
  window.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', closeMenu);
  window.removeEventListener('resize', closeMenu);
}

function onOutside(e: Event): void {
  if (open && !open.contains(e.target as Node)) closeMenu();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeMenu();
  }
}

/** Small context menu at viewport coordinates; closes on choice, outside click, Esc, blur or resize. */
export function showContextMenu(x: number, y: number, items: (MenuItem | MenuHeader)[]): void {
  closeMenu();
  const menu = h(
    'div',
    { class: 'ctx-menu', role: 'menu' },
    ...items.map((item) =>
      'header' in item
        ? h('div', { class: 'ctx-header', role: 'presentation' }, item.header)
        : h(
        'button',
        {
          class: `ctx-item${item.danger ? ' danger' : ''}`,
          role: 'menuitem',
          disabled: item.disabled,
          onclick: () => {
            closeMenu();
            item.action();
          },
        },
        h('span', {}, item.label),
        item.shortcut ? h('kbd', {}, item.shortcut) : null,
      ),
    ),
  );
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
  open = menu;
  window.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);
}
