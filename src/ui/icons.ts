/**
 * Hand-authored inline SVG iconography — 24×24 stroke glyphs, one visual
 * family (1.6px round-cap strokes, currentColor). No external assets.
 */
const P: Record<string, string> = {
  // ---- goods --------------------------------------------------------------
  grain: `<path d="M12 22V8"/><path d="M12 8C10 6.5 9.5 4 9.5 4 12 4.5 12 8 12 8Z"/><path d="M12 8c2-1.5 2.5-4 2.5-4C12 4.5 12 8 12 8Z"/><path d="M12 12.5C10 11 9.5 8.5 9.5 8.5 12 9 12 12.5 12 12.5Z"/><path d="M12 12.5c2-1.5 2.5-4 2.5-4C12 9 12 12.5 12 12.5Z"/><path d="M12 17c-2-1.5-2.5-4-2.5-4C12 13.5 12 17 12 17Z"/><path d="M12 17c2-1.5 2.5-4 2.5-4C12 13.5 12 17 12 17Z"/>`,
  salt: `<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5"/><path d="M12 12v9"/><path d="M12 12L4 7.5"/>`,
  timber: `<path d="M7 7h11a3 3 0 013 3v4a3 3 0 01-3 3H7"/><ellipse cx="7" cy="12" rx="3" ry="5"/><ellipse cx="7" cy="12" rx="1.3" ry="2.4"/>`,
  iron: `<path d="M4.5 15.5L7 9h10l2.5 6.5z"/><path d="M7 9l1.8-2.5h6.4L17 9"/><path d="M4.5 15.5h15"/>`,
  cloth: `<path d="M8 5h9a2 2 0 012 2v10a2 2 0 01-2 2H8"/><path d="M8 5a3 3 0 00-3 3v8a3 3 0 003 3"/><path d="M8 8v11"/><path d="M12 9c1.5 1 1.5 5 0 6"/>`,
  tools: `<path d="M14.5 3.5l6 6-2.8 2.8-6-6z"/><path d="M12.5 8.5L4 17a2.1 2.1 0 003 3l8.5-8.5"/>`,
  wine: `<path d="M9.5 3h5"/><path d="M10.5 3v3c0 2-3.5 3.6-3.5 7.5C7 17.5 9 21 12 21s5-3.5 5-7.5c0-3.9-3.5-5.5-3.5-7.5V3"/><path d="M7.2 10.5C5.8 10.5 5 11.4 5 12.5"/><path d="M16.8 10.5c1.4 0 2.2.9 2.2 2"/>`,
  horses: `<path d="M8.5 21v-3.5c0-3 1-5 3-6.5L12.5 6l1.5 2 3.5-2-1.5 3.5c1.5 1.5 2 3.5 2 6V21"/><path d="M14.5 11h.01"/><path d="M8.5 17.5h10"/>`,
  spice: `<path d="M9 7L8 3h8l-1 4"/><path d="M7.5 7h9l2 11a2.4 2.4 0 01-2.4 3H7.9a2.4 2.4 0 01-2.4-3z"/><path d="M12 11v5M9.8 12.2l4.4 2.6M14.2 12.2l-4.4 2.6"/>`,
  silk: `<path d="M4 17c4.5 0 3.5-11 8-11s3.5 11 8 11"/><path d="M4 21c4.5 0 3.5-11 8-11"/><path d="M20 21c-4.5 0-3.5-11-8-11"/>`,
  porcelain: `<path d="M9.5 3h5"/><path d="M10.5 3c0 2.2-4 3.4-4 8.2 0 4.9 2.4 9.8 5.5 9.8s5.5-4.9 5.5-9.8c0-4.8-4-6-4-8.2"/><path d="M7 12.5h10"/>`,
  relics: `<path d="M5 20.5V11l7-6 7 6v9.5z"/><path d="M9.5 20.5v-6h5v6"/><path d="M12 5V2.2M10.6 3.6h2.8"/>`,
  // ---- ui ------------------------------------------------------------------
  map: `<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>`,
  market: `<path d="M12 4v16M7 20h10"/><path d="M6 8h12"/><path d="M6 8L3.2 14a3.2 3.2 0 005.6 0z"/><path d="M18 8l2.8 6a3.2 3.2 0 01-5.6 0z"/>`,
  wagon: `<path d="M3 15h12"/><path d="M5 15v-4.5h8.5l2.5 3.5V15"/><path d="M3 10.5V7h8"/><circle cx="7" cy="18" r="2"/><circle cx="15.5" cy="18" r="2"/>`,
  lantern: `<path d="M9.5 3h5M12 3v2.2"/><path d="M7.5 7.5h9l1 9.5a2.8 2.8 0 01-2.8 3h-5.4a2.8 2.8 0 01-2.8-3z"/><path d="M10.3 11v5M13.7 11v5"/>`,
  scroll: `<path d="M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z"/><path d="M9 8.5h6M9 12.5h6M9 16.5h4"/>`,
  quill: `<path d="M4 20c6.5-1.2 12.2-6.5 15-14.5.8 8.2-4.2 14.2-11.2 15.4L5 23z"/><path d="M4 20l4.2-1.1"/><path d="M11 13l-3.5.8"/>`,
  seal: `<circle cx="12" cy="9" r="6"/><path d="M9 14.2L7.5 21.5 12 19l4.5 2.5L15 14.2"/><path d="M12 6.2v5.6M9.6 8.2l4.8 1.6M14.4 8.2L9.6 9.8"/>`,
  book: `<path d="M5 4.5h5.5A2.5 2.5 0 0113 7v13a2.4 2.4 0 00-2.2-1.6H5z"/><path d="M19 4.5h-5.5A2.5 2.5 0 0011 7v13a2.4 2.4 0 012.2-1.6H19z"/>`,
  sliders: `<path d="M4 7h9M17.5 7H21M4 12h3M11.5 12H21M4 17h11M19 17h2"/><circle cx="15.2" cy="7" r="1.8"/><circle cx="9.2" cy="12" r="1.8"/><circle cx="17" cy="17" r="1.8"/>`,
  coin: `<ellipse cx="12" cy="7" rx="8" ry="3.2"/><path d="M4 7v5c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V7"/><path d="M4 12v5c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-5"/>`,
  sword: `<path d="M5 19l3-3M6.5 15.5l2 2M8 17L19 6l1.5-2.5L17 5 6 16"/><path d="M5 19l-1.5 1.5"/>`,
  sack: `<path d="M9 7L7.8 3.5h8.4L15 7"/><path d="M7.5 7h9l2.2 10.8A2.6 2.6 0 0116.2 21H7.8a2.6 2.6 0 01-2.5-3.2z"/>`,
  star: `<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z"/>`,
  crown: `<path d="M4 17l1.2-9.5 4 4L12 5l2.8 6.5 4-4L20 17z"/><path d="M4.5 20h15"/>`,
  box: `<path d="M4 8.2L12 4l8 4.2v7.6L12 20l-8-4.2z"/><path d="M4 8.2l8 4.3 8-4.3"/><path d="M12 12.5V20"/>`,
  speaker: `<path d="M5 9.5h3.5L13 5.5v13L8.5 14.5H5z"/><path d="M16.5 9a4.2 4.2 0 010 6"/><path d="M19 6.5a8 8 0 010 11"/>`,
  mute: `<path d="M5 9.5h3.5L13 5.5v13L8.5 14.5H5z"/><path d="M17 9.5l4 5M21 9.5l-4 5"/>`,
  sun: `<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"/>`,
  snow: `<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M9.4 4.6L12 7l2.6-2.4M9.4 19.4L12 17l2.6 2.4"/>`,
  bloom: `<circle cx="12" cy="12" r="2.4"/><path d="M12 9.6C12 7 10.8 5 12 3.8 13.2 5 12 7 12 9.6zM12 14.4c0 2.6-1.2 4.6 0 5.8 1.2-1.2 0-3.2 0-5.8zM9.6 12C7 12 5 10.8 3.8 12 5 13.2 7 12 9.6 12zM14.4 12c2.6 0 4.6 1.2 5.8 0-1.2-1.2-3.2 0-5.8 0z"/>`,
  leaf: `<path d="M5 19C5 9 12 4.5 20 4c0 9-5 15-13 15H5z"/><path d="M5 19c3-5 6.5-8.5 11-11"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.4"/>`,
  warn: `<path d="M12 3.5L21.5 20h-19z"/><path d="M12 9.5v5M12 17.3v.3"/>`,
  house: `<path d="M4 11l8-6.5 8 6.5V20H4z"/><path d="M9.5 20v-5.5h5V20"/><path d="M12 10.5v.2"/>`,
  road: `<path d="M6 21c0-6 12-6 12-12 0-2.5-2-4.5-4.5-4.5"/><path d="M9.5 4.5L13.5 4l1 3.8"/>`,
  eye: `<path d="M2.8 12S6.5 5.8 12 5.8 21.2 12 21.2 12 17.5 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="3"/>`,
  clock: `<circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.4l3.4 2"/>`,
  shield: `<path d="M12 3l7.5 3v5.5c0 5-3.2 8-7.5 9.5-4.3-1.5-7.5-4.5-7.5-9.5V6z"/>`,
  flag: `<path d="M6 3v18"/><path d="M6 4.5h12l-2.5 4L18 12.5H6z"/>`,
  handshake: `<path d="M3 11l3.5-3.5 3 1 2.5-1 2.5 1 3-1L21 11"/><path d="M6.5 7.5V16l3 3 2.5-2 2.5 2 3-3V7.5"/><path d="M10 12.5l2-2 2 2-2 2z"/>`,
};

export type IconName = keyof typeof P;

export function icon(name: string, size = 20, extraClass = ''): string {
  const body = P[name] ?? P.info;
  return `<svg class="icon ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Faction seals — small filled emblems drawn as SVG strings. */
export function factionSeal(fid: string, size = 22): string {
  const glyphs: Record<string, string> = {
    concord: `<path d="M12 3l7 4v6c0 4.5-3 7-7 8-4-1-7-3.5-7-8V7z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="1.6"/>`,
    khanate: `<path d="M4 17c3-6 5-9 8-13 3 4 5 7 8 13z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 17c1.5-2 4.5-2 6 0" stroke="currentColor" stroke-width="1.6"/>`,
    vault: `<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 4.5v15M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/>`,
    compact: `<path d="M5 19V9l7-5 7 5v10z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 19v-5h6v5M5 12h14" stroke="currentColor" stroke-width="1.6"/>`,
    delta: `<path d="M12 4c2.5 4 6 8 6 11a6 6 0 01-12 0c0-3 3.5-7 6-11z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9.5 14.5c1.5 1 3.5 1 5 0" stroke="currentColor" stroke-width="1.4"/>`,
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${glyphs[fid] ?? glyphs.concord}</svg>`;
}
