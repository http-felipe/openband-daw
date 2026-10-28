const s = (body: string, filled = true) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;

export const ICONS = {
  rewind: s('<path d="M6 5h2v14H6zM20 5v14L9 12z"/>'),
  play: s('<path d="M7 4.5v15l13-7.5z"/>'),
  pause: s('<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'),
  stop: s('<rect x="6" y="6" width="12" height="12" rx="1.5"/>'),
  record: s('<circle cx="12" cy="12" r="6.5"/>'),
  loop: s('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>', false),
  metronome: s('<path d="M9 3h6l4 18H5z"/><path d="M12 15l5-8"/>', false),
  tuner: s('<path d="M9 2v7a3 3 0 0 0 6 0V2"/><path d="M12 12v10"/>', false),
  undo: s('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', false),
  redo: s('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>', false),
  power: s('<path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>', false),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>', false),
  left: s('<path d="M15 6l-6 6 6 6"/>', false),
  right: s('<path d="M9 6l6 6-6 6"/>', false),
};
