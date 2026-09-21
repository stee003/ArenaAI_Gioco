/**
 * Menu — settings that actually control things, save management (export /
 * import as text so a run can travel between browsers), the Hall of Legend
 * where retired lives are shelved, and honest retirement.
 */
import {
  game, saveGame, deleteSave, exportSave, importSave, loadLegend,
  addLegendEntry, hasSavedGame,
} from '../../sim/game';
import { bus, T } from '../../core/bus';
import { audio } from '../../audio/engine';
import { shell, type Screen } from '../shell';
import { h, rerender, type Child } from '../dom';
import { icon } from '../icons';
import { rankDef } from '../../data/guild';
import { formatDay } from '../../core/calendar';

function toggleRow(label: string, tip: string, value: boolean, onSet: (v: boolean) => void): Child {
  return h('div', { class: 'toggle-row' },
    h('div', { 'data-tip': tip },
      h('div', null, label),
      h('div', { class: 'tiny faint' }, tip),
    ),
    h('div', {
      class: `toggle ${value ? 'on' : ''}`, role: 'switch', 'aria-checked': String(value),
      onclick: () => { audio.play('click'); onSet(!value); rerenderAll(); },
    }),
  );
}

function settingsPanel(): Child {
  const st = shell.settings;
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('sliders', 18) }), 'Settings'),
    toggleRow('Sound effects', 'Plucks, stamps, coins — all synthesized live, no samples.', st.sound, (v) => shell.saveSettings({ sound: v })),
    toggleRow('Generative music', 'A solo oud improvises in Maqam Hijaz over drone and wind. It never repeats exactly.', st.music, (v) => shell.saveSettings({ music: v })),
    toggleRow('Reduced motion', 'Stills animations and pulses; the world keeps turning.', st.reducedMotion, (v) => shell.saveSettings({ reducedMotion: v })),
    toggleRow('Autosave', 'The ledger closes itself after every day advanced.', st.autosave, (v) => shell.saveSettings({ autosave: v })),
    toggleRow('Confirm trades', 'Ask before every buy and sell. Off is faster; on is safer for large orders.', st.confirmTrades, (v) => shell.saveSettings({ confirmTrades: v })),
    toggleRow('Animated counters', 'Coin counts up and down instead of jumping.', st.numberTicking, (v) => shell.saveSettings({ numberTicking: v })),
  );
}

function savePanel(): Child {
  const s = game.need();
  const saved = hasSavedGame();
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('scroll', 18) }), 'The Ledger Book',
      h('small', null, saved ? 'a save exists' : 'nothing saved')),
    h('div', { class: 'tiny dim', style: { 'margin-bottom': '10px' } },
      `${s.player.name} ${s.player.epithet} · ${rankDef(s.player.guildRank).name} · ${formatDay(s.day)} · net worth ${Math.round(game.netWorth())} ⛁ · seed “${s.seed}”${s.weekly ? ' (weekly challenge)' : ''}`),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', onclick: () => { const ok = saveGame(s); audio.play(ok ? 'stamp' : 'thud'); shell.toast(ok ? 'info' : 'warning', ok ? 'Saved. The wax is still warm.' : 'This browser refuses to keep the ledger (storage unavailable).'); } }, 'Save now'),
      h('button', { class: 'btn', onclick: openExport }, 'Export as text'),
      h('button', { class: 'btn', onclick: openImport }, 'Import from text'),
      h('button', {
        class: 'btn danger',
        onclick: () => shell.confirm({
          title: 'Burn the save?',
          text: 'The saved ledger is destroyed. The world of this seed stops existing. Only the Hall of Legend keeps what you were.',
          confirmLabel: 'Burn it', danger: true,
          onConfirm: () => { deleteSave(); audio.play('thud'); shell.toast('info', 'The save is ash.'); rerenderAll(); },
        }),
      }, 'Delete save'),
    ),
  );
}

function openExport(): void {
  const text = exportSave(game.need());
  const ta = h('textarea', {
    class: 'inp', rows: '6', readonly: true,
    style: { width: '100%', 'font-family': 'monospace', 'font-size': '11px' },
  }) as HTMLTextAreaElement;
  ta.value = text;
  const close = shell.openModal({
    title: 'Export your ledger',
    icon: 'scroll',
    wide: true,
    body: [
      h('p', { class: 'dim small' }, 'This text is your entire world — save it anywhere. Pasting it back (here or in another browser) resumes this exact seed, day and atom of state.'),
      ta,
    ],
    actions: [
      h('button', {
        class: 'btn primary',
        onclick: () => {
          ta.select();
          navigator.clipboard?.writeText(text).then(
            () => shell.toast('info', 'Copied to clipboard.'),
            () => shell.toast('info', 'Select the text and copy manually.'),
          );
        },
      }, 'Copy'),
      h('button', {
        class: 'btn',
        onclick: () => {
          const blob = new Blob([text], { type: 'text/plain' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `caravanserai-${game.need().seed}-day${game.need().day}.txt` }) as HTMLAnchorElement;
          a.click();
          URL.revokeObjectURL(a.href);
        },
      }, 'Download file'),
      h('button', { class: 'btn ghost', onclick: () => close() }, 'Close'),
    ],
  });
}

function openImport(): void {
  const ta = h('textarea', {
    class: 'inp', rows: '6', placeholder: 'Paste exported ledger text here…',
    style: { width: '100%', 'font-family': 'monospace', 'font-size': '11px' },
  }) as HTMLTextAreaElement;
  const close = shell.openModal({
    title: 'Import a ledger',
    icon: 'scroll',
    wide: true,
    body: [
      h('p', { class: 'dim small' }, 'This replaces your current game with the pasted one. The world it contains wakes exactly where it slept.'),
      ta,
    ],
    actions: [
      h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          const st = importSave(ta.value);
          if (!st) {
            audio.play('thud');
            shell.toast('warning', 'That text is not a ledger this version can read.');
            return;
          }
          game.attach(st);
          saveGame(st);
          close();
          audio.play('stamp');
          shell.toast('info', `Ledger accepted: ${st.player.name}, day ${st.day}.`);
          bus.emit(T.STATE);
          shell.showScreen('map');
        },
      }, 'Import & resume'),
    ],
  });
}

function legendPanel(): Child {
  const legends = loadLegend();
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('star', 18) }), 'Hall of Legend',
      h('small', null, `${legends.length} shelved ${legends.length === 1 ? 'life' : 'lives'}`)),
    legends.length === 0
      ? h('p', { class: 'dim small' }, 'Empty shelves. When a merchant retires — rich, ruined or merely done — the Guild writes one line here for each year they kept the road.')
      : h('div', { class: 'stack' },
          ...legends.map((l) => h('div', { class: 'legend-row' },
            h('div', null,
              h('b', null, l.name),
              h('div', { class: 'tiny dim' }, l.epitaph),
            ),
            h('span', { class: 'tiny dim' }, formatDay(l.day)),
            h('span', { class: 'tiny gold' }, `${rankDef(l.rank).name} · ${Math.round(l.netWorth)} ⛁`),
            h('span', { class: 'tiny faint' }, `${l.ambitions} ambitions${l.weekly ? ' · weekly' : ''}`),
          )),
        ),
  );
}

function retirePanel(): Child {
  return h('div', { class: 'panel', style: { 'border-color': 'rgba(176,74,50,0.4)' } },
    h('div', { class: 'panel-title' }, h('span', { html: icon('lantern', 18) }), 'Retirement'),
    h('p', { class: 'small dim' }, 'A merchant may stop. The Guild writes your line in the Hall of Legend, the wagons are sold, and the road goes on without you — exactly as it always did.'),
    h('button', {
      class: 'btn danger',
      onclick: () => shell.confirm({
        title: 'Retire from the road?',
        text: 'Your story ends here and is shelved in the Hall of Legend. The current save is closed. You can begin a new journey — same seed for the same world, or a fresh one.',
        confirmLabel: 'Lay down the ledger', danger: true,
        onConfirm: () => {
          const st = game.need();
          const nw = game.netWorth();
          const epitaph =
            nw > 30000 ? 'kept a house of stone and died of nothing worse than old age'
            : nw > 8000 ? 'retired wealthy enough to be eccentric, which is the point of wealth'
            : nw > 1500 ? 'never grew rich, and never once stopped walking'
            : st.stats.lostToBandits > nw ? 'gave rather more to the roads than the roads gave back'
            : 'proved that the road is longer than any one pair of boots';
          addLegendEntry({
            seed: st.seed, name: `${st.player.name} ${st.player.epithet}`, epitaph,
            day: st.day, netWorth: Math.round(nw), rank: st.player.guildRank,
            ambitions: Object.values(st.ambitions).filter((a) => a.done).length,
            weekly: st.weekly,
          });
          deleteSave();
          audio.play('stamp');
          shell.exitToTitle();
        },
      }),
    }, 'Retire & enter the Hall'),
  );
}

function colophonPanel(): Child {
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('info', 18) }), 'Colophon'),
    h('p', { class: 'small dim', style: { 'line-height': '1.65' } },
      'CARAVANSERAI runs a deterministic, seeded simulation: 16 cities, five powers, twelve goods and a few dozen rival merchants, all advancing one day at a time with a single serialized random stream — the same seed replays the same world exactly. Every icon, texture and sound is generated at runtime: the map is painted on canvas, the newspaper is written by the world’s own events, and the music is an oud improvising in Maqam Hijaz over synthesized wind. No assets, no servers, no tracking. Your ledger lives in this browser alone, and can leave it only by your hand, as text.'),
    h('p', { class: 'tiny faint' }, 'Keyboard: Space advances the day · Esc closes dialogs.'),
  );
}

let hostEl: HTMLElement | null = null;

function rerenderAll(): void {
  if (!hostEl) return;
  rerender(hostEl, h('div', { class: 'grid c2' },
    h('div', { class: 'stack' }, settingsPanel(), savePanel(), retirePanel()),
    h('div', { class: 'stack' }, legendPanel(), colophonPanel()),
  ));
}

export const menuScreen: Screen = {
  id: 'menu',
  label: 'Menu',
  icon: 'sliders',

  mount(host) {
    hostEl = host;
    rerenderAll();
    shell.sub(T.STATE, rerenderAll);
    shell.sub(T.PLAYER, rerenderAll);
    this.unmount = () => { hostEl = null; };
  },
};
