/**
 * Chronicle — the world's paper trail: a dispatch feed, the ten-day
 * broadsheet rendered as a real parchment newspaper, and the Powers board
 * where faction relations, wars, coffers and your own standing are legible.
 */
import { game } from '../../sim/game';
import { bus, T } from '../../core/bus';
import { audio } from '../../audio/engine';
import { shell, type Screen } from '../shell';
import { h, rerender, type Child } from '../dom';
import { icon, factionSeal } from '../icons';
import { formatDayShort, formatDay } from '../../core/calendar';
import { WORLD_CHRONICLE } from '../../data/names';
import { GOODS } from '../../data/goods';
import type { Faction, FactionId, NewsKind } from '../../sim/types';

let tab: 'dispatches' | 'chronicle' | 'powers' = 'dispatches';
let openIssue = 0; // index into s.chronicles (newest first view)

const KIND_ICON: Record<NewsKind, string> = {
  war: 'sword', politics: 'seal', plague: 'warn', festival: 'bloom', disaster: 'warn',
  discovery: 'star', agent: 'wagon', player: 'crown', market: 'market', crime: 'sword',
  omen: 'eye', caravanserai: 'house',
};

function relColor(v: number): string {
  if (v < -50) return '#c04a30';
  if (v < -20) return '#c07a50';
  if (v < 20) return '#a89b7e';
  if (v < 50) return '#79b78f';
  return '#4f9a7c';
}

function dispatchesTab(): Child {
  const s = game.need();
  const items = s.news.slice(-80).reverse();
  let lastDay = -1;
  const rows: Child[] = [];
  for (const n of items) {
    if (n.day !== lastDay) {
      lastDay = n.day;
      rows.push(h('div', { class: 'tiny faint', style: { 'margin-top': '10px', 'letter-spacing': '0.14em', 'text-transform': 'uppercase' } }, formatDay(n.day)));
    }
    rows.push(h('div', { class: `news-item imp${n.importance}` },
      h('span', { class: 'nday' }, formatDayShort(n.day).split(' · ')[0]),
      h('span', { class: 'nicon', html: icon(KIND_ICON[n.kind] ?? 'info', 15), style: { color: n.kind === 'war' ? 'var(--bad)' : n.kind === 'player' ? 'var(--gold)' : 'var(--text-faint)' } }),
      h('span', { class: 'ntext' }, n.text),
    ));
  }
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('quill', 18) }), 'Dispatches',
      h('small', null, 'the world, as it happens')),
    h('div', { class: 'news-feed' }, ...rows),
  );
}

function chronicleTab(): Child {
  const s = game.need();
  const issues = s.chronicles.slice().reverse();
  if (!issues.length) {
    return h('div', { class: 'panel' }, h('p', { class: 'dim' }, 'The first issue of the Chronicle is compiled every ten days. It has not been nailed to the post yet.'));
  }
  const issue = issues[Math.min(openIssue, issues.length - 1)];
  return h('div', { class: 'stack' },
    h('div', { class: 'row wrap' },
      h('span', { class: 'small dim' }, 'Issues:'),
      ...issues.slice(0, 12).map((it, i) =>
        h('button', {
          class: `btn sm ${i === openIssue ? 'primary' : 'ghost'}`,
          onclick: () => { openIssue = i; audio.play('page'); rerenderAll(); },
        }, formatDayShort(it.day)),
      ),
    ),
    h('div', { class: 'chronicle-page' },
      h('div', { class: 'masthead' },
        h('h1', null, WORLD_CHRONICLE),
        h('div', { class: 'folks' }, `${formatDay(issue.day)} · printed by the Guild of Stationers · one sol, or free at the post`),
      ),
      h('div', { class: 'chronicle-headline' }, issue.headline),
      h('div', { class: 'chronicle-cols' },
        ...issue.sections.map((sec) => h('div', { class: 'chronicle-sec' },
          h('h3', null, sec.title),
          h('ul', { style: { margin: 0, 'padding-left': '16px' } },
            ...sec.items.map((t) => h('li', null, t))),
        )),
      ),
    ),
  );
}

function coffersWord(f: Faction): { word: string; cls: string } {
  if (f.treasury > 25000) return { word: 'overflowing', cls: 'good' };
  if (f.treasury > 8000) return { word: 'healthy', cls: 'good' };
  if (f.treasury > 2000) return { word: 'strained', cls: '' };
  return { word: 'empty', cls: 'bad' };
}

function factionCard(f: Faction): Child {
  const s = game.need();
  const cities = s.cityOrder.filter((cid) => s.cities[cid].faction === f.id);
  const rep = s.player.rep[f.id] ?? 0;
  const bannedUntil = s.player.banned[f.id] ?? 0;
  const coffers = coffersWord(f);
  const wars = f.wars.map((w) => s.factions[w.enemy]);

  return h('div', { class: 'panel', style: { 'border-top': `3px solid ${f.color}` } },
    h('div', { class: 'row', style: { 'margin-bottom': '8px' } },
      h('span', { style: { color: f.color, display: 'flex' }, html: factionSeal(f.id, 34) }),
      h('div', { class: 'grow' },
        h('div', { class: 'h2', style: { margin: 0 } }, f.name),
        h('div', { class: 'tiny dim' }, `${f.epithet} · ruled by ${f.ruler} from ${s.cities[f.capital].name}`),
      ),
      rep <= -40 ? h('span', { class: 'badge bad' }, 'outlawed') : rep >= 40 ? h('span', { class: 'badge good' }, 'honored') : null,
    ),
    h('p', { class: 'tiny dim', style: { 'font-style': 'italic' } }, f.ideology.desc),
    h('div', { class: 'kv' }, h('dt', null, 'Coffers'), h('dd', { class: coffers.cls }, coffers.word)),
    h('div', { class: 'kv' }, h('dt', null, 'Army'),
      h('dd', { style: { flex: '1', 'max-width': '140px' } },
        h('div', { class: `meter ${f.wars.length ? 'red' : ''}` }, h('i', { style: { width: `${Math.min(100, f.military)}%` } })))),
    h('div', { class: 'kv' }, h('dt', null, 'Cities'), h('dd', null, cities.map((c) => s.cities[c].name).join(', '))),
    h('div', { class: 'kv' }, h('dt', null, 'Tariff'), h('dd', null, `${(f.ideology.tariff * 100).toFixed(0)}%`)),
    f.ideology.contraband.length
      ? h('div', { class: 'kv' }, h('dt', null, 'Forbids'), h('dd', { class: 'bad' }, f.ideology.contraband.map((g) => GOODS[g].name).join(', ')))
      : null,
    wars.length
      ? h('div', { class: 'rel-war', style: { 'margin-top': '6px' } }, `⚔ AT WAR with ${wars.map((w) => w.name).join(', ')}`)
      : null,
    bannedUntil > s.day
      ? h('div', { class: 'small bad', style: { 'margin-top': '6px' } }, `You are banished from ${f.name} lands until day ${bannedUntil}. Their patrols would love to meet you before then.`)
      : null,
    h('div', { class: 'kv' }, h('dt', null, 'Your standing'),
      h('dd', { style: { flex: '1', 'max-width': '160px' } },
        h('div', { class: 'rel-bar' },
          h('span', { class: 'mid' }),
          h('i', {
            style: rep >= 0
              ? { left: '50%', width: `${rep / 2}%`, background: relColor(rep) }
              : { right: '50%', width: `${-rep / 2}%`, background: relColor(rep) },
          })))),
    h('div', { class: 'row', style: { 'margin-top': '8px' } },
      h('span', { class: 'tiny faint' }, 'Gift coin:'),
      h('button', { class: 'btn sm', disabled: s.player.gold < 50, onclick: () => donate(f.id, 50) }, '50 ⛁'),
      h('button', { class: 'btn sm', disabled: s.player.gold < 200, onclick: () => donate(f.id, 200) }, '200 ⛁'),
    ),
    h('div', { style: { 'margin-top': '10px' } },
      h('div', { class: 'tiny faint', style: { 'margin-bottom': '4px' } }, 'Relations:'),
      h('div', { class: 'rel-grid' },
        ...Object.values(s.factions).filter((o) => o.id !== f.id).map((o) => {
          const v = f.relations[o.id];
          const atWar = f.wars.some((w) => w.enemy === o.id);
          return h('div', { class: 'rel-row' },
            h('span', { class: 'tiny', style: { color: o.color } }, atWar ? `⚔ ${o.name.replace(/^The /, '')}` : o.name.replace(/^The /, '')),
            h('div', { class: 'rel-bar', 'data-tip': `${f.name} ↔ ${o.name}: ${Math.round(v)} / ±100` },
              h('span', { class: 'mid' }),
              h('i', {
                style: v >= 0
                  ? { left: '50%', width: `${v / 2}%`, background: relColor(v) }
                  : { right: '50%', width: `${-v / 2}%`, background: relColor(v) },
              })),
          );
        })),
      ),
  );
}

function donate(fid: FactionId, amount: number): void {
  const res = game.donate(fid, amount);
  audio.play(res.ok ? 'coin' : 'thud');
  if (!res.ok) shell.toast('warning', res.why ?? 'Cannot gift.');
  bus.emit(T.PLAYER);
  rerenderAll();
}

function powersTab(): Child {
  const s = game.need();
  return h('div', { class: 'grid c2' },
    ...Object.values(s.factions).map((f) => factionCard(f)),
  );
}

let hostEl: HTMLElement | null = null;

function rerenderAll(): void {
  if (!hostEl) return;
  rerender(hostEl,
    h('div', { class: 'tabs' },
      ...(['dispatches', 'chronicle', 'powers'] as const).map((t) =>
        h('button', {
          class: `tab ${tab === t ? 'active' : ''}`,
          onclick: () => { tab = t; audio.play('page'); rerenderAll(); },
        }, t === 'dispatches' ? 'Dispatches' : t === 'chronicle' ? 'The Chronicle' : 'Powers & Thrones')),
    ),
    tab === 'dispatches' ? dispatchesTab() : tab === 'chronicle' ? chronicleTab() : powersTab(),
  );
}

export const chronicleScreen: Screen = {
  id: 'chronicle',
  label: 'Chronicle',
  icon: 'quill',

  pip: () => {
    const s = game.state;
    return !!s && s.chronicles.length > 0 && s.day - s.chronicles[s.chronicles.length - 1].day <= 3;
  },

  mount(host) {
    hostEl = host;
    openIssue = 0;
    rerenderAll();
    shell.sub(T.DAY, rerenderAll);
    shell.sub(T.NEWS, rerenderAll);
    shell.sub(T.STATE, rerenderAll);
    this.unmount = () => { hostEl = null; };
  },
};
