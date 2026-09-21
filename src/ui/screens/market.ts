/**
 * The Market — the economic heart of the UI. True prices (you are standing
 * here), fair-value comparison, sparklines of real history, tariffs shown
 * honestly, contraband and wartime embargoes marked, and quantity steppers
 * that make orders move the price — visibly.
 */
import { game } from '../../sim/game';
import { bus, T } from '../../core/bus';
import { audio } from '../../audio/engine';
import { shell, type Screen } from '../shell';
import { h, rerender, type Child } from '../dom';
import { icon, factionSeal } from '../icons';
import { GOODS, GOOD_IDS } from '../../data/goods';
import { SIGNATURE_GOODS } from '../../sim/economy';

import type { GoodId, GoodTier, City, Faction } from '../../sim/types';

let filterTier: GoodTier | 'all' = 'all';
let sortMode: 'deal' | 'dear' | 'name' = 'deal';
let cargoOnly = false;
const qtyState: Partial<Record<GoodId, number>> = {};
let flashGood: GoodId | null = null;
let hintDismissed = false;

const TIER_LABEL: Record<GoodTier, string> = {
  staple: 'Staples', craft: 'Crafts', luxury: 'Luxuries', treasure: 'Treasures',
};

function tariffOf(city: City, s: ReturnType<typeof game.need>): number {
  if (city.mods.fairUntil > s.day) return 0;
  return s.factions[city.faction].ideology.tariff;
}

function embargoedHere(fac: Faction): GoodId[] {
  const out: GoodId[] = [];
  for (const w of fac.wars) out.push(...(SIGNATURE_GOODS[w.enemy] ?? []));
  return out;
}

function sparkline(history: number[], good: GoodId): Child {
  const pts = history.slice(-30);
  if (pts.length < 2) return h('span', { class: 'tiny faint' }, 'new market');
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = Math.max(0.001, max - min);
  const w = 108; const hgt = 26;
  const coords = pts.map((p, i) => `${(i / (pts.length - 1)) * w},${hgt - 2 - ((p - min) / span) * (hgt - 4)}`).join(' ');
  const rising = pts[pts.length - 1] >= pts[0];
  const color = rising ? 'var(--good)' : 'var(--bad)';
  return h('span', {
    class: 'spark',
    'data-tip': `${GOODS[good].name}, last ${pts.length} days: ${min.toFixed(1)} → ${max.toFixed(1)}`,
    html: `<svg width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}">
      <polyline points="${coords}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" opacity="0.9"/>
      <circle cx="${w}" cy="${hgt - 2 - ((pts[pts.length - 1] - min) / span) * (hgt - 4)}" r="2.2" fill="${color}"/>
    </svg>`,
  });
}

function goodRow(g: GoodId, city: City, fac: Faction, s: ReturnType<typeof game.need>): Child {
  const def = GOODS[g];
  const price = city.price[g];
  const hist = city.history[g] ?? [];
  const prev = hist.length > 1 ? hist[hist.length - 2] : price;
  const delta = price - prev;
  const ratio = price / def.base;
  const carrying = Math.floor(s.player.cargo[g] ?? 0);
  const banned = fac.ideology.contraband.includes(g);
  const embargoed = embargoedHere(fac).includes(g);
  const hot = banned || embargoed;
  const tariff = tariffOf(city, s);
  const costBasis = carrying > 0 ? (s.player.cargoCost[g] ?? 0) / carrying : 0;
  const sellUnit = price * (1 - tariff);

  const maxByGold = Math.floor((s.player.gold * (1 + ((s.player.upgrades.seal ?? 0) > 0 ? 0.3 : 0))) / Math.max(price, 0.01));
  const maxBySpace = Math.floor(game.spaceLeft() / def.space);
  const maxBuy = Math.max(0, Math.min(maxByGold, maxBySpace, Math.floor(city.stock[g])));
  if (!(g in qtyState)) {
    // A first click should feel like a real load: half the free wagon or
    // half the purse, whichever is smaller, capped by what's on offer.
    const bySpace = Math.floor(game.spaceLeft() * 0.5 / def.space);
    const byGold = Math.floor(s.player.gold * 0.5 / Math.max(price, 0.01));
    qtyState[g] = Math.max(1, Math.min(bySpace, byGold, maxBuy));
  }
  let qty = Math.max(0, Math.min(qtyState[g]!, Math.max(maxBuy, carrying)));

  const dealTag = ratio < 0.82 ? h('span', { class: 'deal-tag cheap' }, 'bargain')
    : ratio > 1.18 ? h('span', { class: 'deal-tag dear' }, 'dear')
    : h('span', { class: 'deal-tag fair' }, 'fair');

  const setQty = (n: number): void => {
    qtyState[g] = Math.max(0, n);
    rerenderRows();
    audio.play('click');
  };

  return h('div', {
    class: `market-good ${hot ? 'banned' : ''}`,
    dataset: { good: g },
    style: flashGood === g ? { background: 'rgba(217,164,65,0.08)' } : undefined,
  },
    h('div', {
      class: 'gicon', html: icon(g, 22),
      'data-tip': `<span class="tip-h">${def.name}</span>${def.desc}<br><b>${def.space}</b> wagon space/unit · base value <b>${def.base}</b>${def.perish > 0 ? ` · spoils ${(def.perish * 100).toFixed(1)}%/day` : ''}`,
    }),
    h('div', null,
      h('div', { class: 'gname' }, def.name),
      h('div', { class: 'gmeta' },
        `stock ${Math.floor(city.stock[g])}`,
        carrying > 0 ? h('span', { class: 'gold' }, ` · you carry ${carrying}`) : null,
        banned ? h('span', { class: 'bad' }, ' · forbidden here') : null,
        embargoed ? h('span', { class: 'bad' }, ' · wartime edict') : null,
      ),
    ),
    h('div', { class: 'intel' },
      h('div', { class: 'gprice', style: { color: ratio > 1.18 ? 'var(--bad)' : ratio < 0.82 ? 'var(--good)' : 'var(--text)' } },
        price.toFixed(1),
        h('span', { class: 'tiny', style: { color: delta >= 0 ? 'var(--good)' : 'var(--bad)', 'margin-left': '4px' } },
          `${delta >= 0 ? '▲' : '▼'}${Math.abs(delta).toFixed(1)}`),
      ),
      dealTag,
    ),
    h('div', { class: 'tiny faint', 'data-tip': `Fair value ≈ ${def.base} sols (the continental reference). Today ${city.name} trades at ${Math.round(ratio * 100)}% of it.` },
      h('div', null, `${Math.round(ratio * 100)}% of fair`),
      carrying > 0
        ? h('div', { class: sellUnit > costBasis ? 'good' : 'bad' },
            `net ${sellUnit.toFixed(1)}/u · ${sellUnit >= costBasis ? '+' : ''}${(sellUnit - costBasis).toFixed(1)}`)
        : h('div', null, `tariff ${(tariff * 100).toFixed(0)}% on sales`),
    ),
    h('div', { class: 'spark-cell' }, sparkline(hist, g)),
    h('div', { class: 'trade-ctl trade-cell' },
      hot && carrying === 0
        ? h('span', { class: 'tiny faint' }, banned ? 'no stall will touch it' : 'edict blocks sale')
        : h('div', { class: 'row' },
            h('button', { class: 'btn sm ghost', onclick: () => setQty(qty - 1), disabled: qty <= 0 }, '−'),
            h('input', {
              class: 'qty-input', type: 'number', min: '0', value: String(qty),
              onchange: (e) => { setQty(Number((e.target as HTMLInputElement).value) || 0); },
            }),
            h('button', { class: 'btn sm ghost', onclick: () => setQty(qty + 1) }, '+'),
            h('button', {
              class: 'btn sm ghost', disabled: maxBuy < 1,
              'data-tip': `Load the maximum the market, your purse and your wagon allow today (${maxBuy}).`,
              onclick: () => setQty(maxBuy),
            }, 'max'),
            h('button', {
              class: 'btn sm',
              disabled: maxBuy < 1,
              'data-tip': maxBuy < 1 ? 'Nothing to buy: no space, no coin, or the market is empty.' : `Buy up to ${maxBuy} today (~${Math.round(price * qty)} sols for ${qty}). Large orders move the price.`,
              onclick: () => doBuy(g, qty),
            }, `Buy ${qty > 0 ? `· ${Math.round(price * qty)}` : ''}`),
            h('button', {
              class: 'btn sm',
              disabled: carrying < 1 || (!hot && qty < 1) || (hot && carrying < 1),
              'data-tip': hot ? 'Sell to the fence in the tavern — forbidden goods never see the open market.' : `Sell ${Math.min(qty, carrying)} at ~${sellUnit.toFixed(1)}/u after ${(tariff * 100).toFixed(0)}% tariff.`,
              onclick: () => (hot ? shell.showScreen('tavern') : doSell(g, Math.min(qty, carrying))),
            }, hot ? 'Fence →' : 'Sell'),
            s.player.warehouses.includes(cityIdOf(s)) && carrying > 0
              ? h('button', {
                  class: 'btn sm ghost',
                  'data-tip': `Move ${qty || carrying} into your warehouse here (no spoilage; prices refresh every 5 days).`,
                  onclick: () => {
                    const n = Math.max(1, Math.min(qty, carrying));
                    const res = game.transferToWarehouse(cityIdOf(s), g, n);
                    audio.play(res.ok ? 'page' : 'thud');
                    if (!res.ok) shell.toast('warning', res.why ?? 'Cannot store.');
                    flashGood = g;
                    bus.emit(T.PLAYER);
                    rerenderRows();
                  },
                }, 'Store')
              : null,
          ),
    ),
  );
}

function cityIdOf(s: ReturnType<typeof game.need>): string {
  return s.player.loc.kind === 'city' ? s.player.loc.cityId : '';
}

function doBuy(g: GoodId, qty: number): void {
  if (qty < 1) return;
  const exec = (): void => {
    const res = game.playerBuy(g, qty);
    audio.play(res.ok ? 'buy' : 'thud');
    if (!res.ok) shell.toast('warning', res.why ?? 'Cannot buy.');
    flashGood = g;
    setTimeout(() => { flashGood = null; }, 700);
    bus.emit(T.MARKET);
  };
  if (shell.settings.confirmTrades) {
    const s = game.need();
    const city = s.cities[cityIdOf(s)];
    const est = Math.round(city.price[g] * qty);
    shell.confirm({
      title: `Buy ${qty} × ${GOODS[g].name}?`,
      text: `Roughly ${est} sols at today's opening price — large orders move the price as they fill, so the true cost may drift up. ${Math.round(qty * GOODS[g].space)} wagon space will be used.`,
      confirmLabel: 'Buy', onConfirm: exec,
    });
    return;
  }
  exec();
}

function doSell(g: GoodId, qty: number): void {
  if (qty < 1) return;
  const exec = (): void => {
    const res = game.playerSell(g, qty);
    audio.play(res.ok ? 'sell' : 'thud');
    if (!res.ok) shell.toast('warning', res.why ?? 'Cannot sell.');
    flashGood = g;
    setTimeout(() => { flashGood = null; }, 700);
    bus.emit(T.MARKET);
  };
  if (shell.settings.confirmTrades) {
    const s = game.need();
    const city = s.cities[cityIdOf(s)];
    const tariff = tariffOf(city, s);
    const basis = (s.player.cargoCost[g] ?? 0) * (qty / Math.max(1, s.player.cargo[g] ?? 1));
    const est = Math.round(city.price[g] * (1 - tariff) * qty);
    shell.confirm({
      title: `Sell ${qty} × ${GOODS[g].name}?`,
      text: `Roughly ${est} sols after the ${(tariff * 100).toFixed(0)}% tariff (${est - Math.round(basis) >= 0 ? 'a gain' : 'a loss'} of ${Math.abs(est - Math.round(basis))} against your cost basis). The market's daily appetite may fill less than asked.`,
      confirmLabel: 'Sell', onConfirm: exec,
    });
    return;
  }
  exec();
}

// ------------------------------------------------------------------ render

let tableHost: HTMLElement | null = null;
let headerHost: HTMLElement | null = null;

function visibleGoods(s: ReturnType<typeof game.need>): GoodId[] {
  let list = GOOD_IDS.filter((g) => filterTier === 'all' || GOODS[g].tier === filterTier);
  if (cargoOnly) list = list.filter((g) => (s.player.cargo[g] ?? 0) > 0);
  const ratio = (g: GoodId): number => {
    const c = s.cities[cityIdOf(s)];
    return c ? c.price[g] / GOODS[g].base : 1;
  };
  list.sort((a, b) =>
    sortMode === 'name' ? GOODS[a].name.localeCompare(GOODS[b].name)
    : sortMode === 'dear' ? ratio(b) - ratio(a)
    : ratio(a) - ratio(b));
  return list;
}

function rerenderRows(): void {
  const s = game.state;
  if (!s || !tableHost) return;
  if (s.player.loc.kind !== 'city') return;
  const city = s.cities[s.player.loc.cityId];
  const fac = s.factions[city.faction];
  rerender(tableHost, ...visibleGoods(s).map((g) => goodRow(g, city, fac, s)));
}

function renderHeader(): void {
  const s = game.state;
  if (!s || !headerHost || s.player.loc.kind !== 'city') return;
  const city = s.cities[s.player.loc.cityId];
  const fac = s.factions[city.faction];
  const tariff = tariffOf(city, s);
  const cargoUnits = GOOD_IDS.reduce((n, g) => n + (s.player.cargo[g] ?? 0), 0);
  const cargoValue = GOOD_IDS.reduce((v, g) => v + (s.player.cargo[g] ?? 0) * city.price[g], 0);
  const cargoCost = GOOD_IDS.reduce((v, g) => v + (s.player.cargoCost[g] ?? 0), 0);
  const capacity = game.computeCapacity();
  const used = game.spaceUsed();

  rerender(headerHost,
    h('div', { class: 'panel gold-edge' },
      h('div', { class: 'spread', style: { 'flex-wrap': 'wrap', gap: '10px' } },
        h('div', { class: 'row' },
          h('span', { style: { color: fac.color, display: 'flex' }, html: factionSeal(city.faction, 34) }),
          h('div', null,
            h('div', { class: 'h1', style: { 'margin-bottom': '0' } }, `${city.name} Exchange`),
            h('div', { class: 'tiny dim' },
              `${fac.name} · tariff on sales <b class="${tariff === 0 ? 'good' : ''}">${(tariff * 100).toFixed(0)}%</b>${city.mods.fairUntil > s.day ? ' — waived during the fair!' : ''} · prices here are true, today`),
            (s.player.banned[city.faction] ?? 0) > s.day
              ? h('div', { class: 'badge bad', style: { 'margin-top': '4px' } }, `banished until day ${s.player.banned[city.faction]} — patrols inspect daily`)
              : null,
          ),
        ),
        h('div', { class: 'row', style: { gap: '16px', 'flex-wrap': 'wrap' } },
          h('div', { 'data-tip': `Wagon: ${used.toFixed(0)} of ${capacity} space used.` },
            h('div', { class: 'tiny dim' }, 'Wagon'),
            h('div', { class: 'meter', style: { width: '110px', 'margin-top': '3px' } },
              h('i', { style: { width: `${Math.min(100, (used / capacity) * 100)}%` } })),
          ),
          h('div', { 'data-tip': `${Math.floor(cargoUnits)} units aboard, worth ${Math.round(cargoValue)} sols at today's prices here.` },
            h('div', { class: 'tiny dim' }, 'Cargo worth'),
            h('b', { class: 'num' }, String(Math.round(cargoValue))),
          ),
          cargoUnits > 0
            ? h('div', { 'data-tip': 'Unrealized gain against what you actually paid (cost basis).' },
                h('div', { class: 'tiny dim' }, 'Unrealized'),
                h('b', { class: `num ${cargoValue - cargoCost >= 0 ? 'good' : 'bad'}` },
                  `${cargoValue - cargoCost >= 0 ? '+' : ''}${Math.round(cargoValue - cargoCost)}`))
            : null,
        ),
      ),
    ),
  );
}

export const marketScreen: Screen = {
  id: 'market',
  label: 'Market',
  icon: 'market',
  inCityOnly: true,

  mount(host) {
    headerHost = h('div');
    tableHost = h('div', { class: 'panel', style: { padding: '8px 10px' } });
    const controls = h('div', { class: 'row wrap', style: { 'margin-bottom': '12px' } },
      h('div', { class: 'tabs', style: { margin: '0' } },
        ...(['all', 'staple', 'craft', 'luxury', 'treasure'] as const).map((t) =>
          h('button', {
            class: `tab ${filterTier === t ? 'active' : ''}`,
            onclick: () => { filterTier = t; audio.play('click'); shell.showScreen('market'); },
          }, t === 'all' ? 'All goods' : TIER_LABEL[t])),
      ),
      h('select', {
        class: 'sel',
        onchange: (e) => { sortMode = (e.target as HTMLSelectElement).value as typeof sortMode; rerenderRows(); audio.play('click'); },
      },
        h('option', { value: 'deal', selected: sortMode === 'deal' }, 'Sort: cheapest vs fair'),
        h('option', { value: 'dear', selected: sortMode === 'dear' }, 'Sort: dearest vs fair'),
        h('option', { value: 'name', selected: sortMode === 'name' }, 'Sort: name'),
      ),
      h('label', { class: 'chip', style: { cursor: 'pointer' } },
        h('input', {
          type: 'checkbox', checked: cargoOnly,
          onchange: (e) => { cargoOnly = (e.target as HTMLInputElement).checked; rerenderRows(); },
        }), 'carrying only'),
    );

    const stalls = h('div', { class: 'panel', style: { 'margin-top': '12px' } },
      h('div', { class: 'spread' },
        h('div', null,
          h('div', { class: 'h3' }, 'Market stalls'),
          h('div', { class: 'tiny dim' }, `Provisions: ${Math.floor(game.need().player.provisions)} days carried · burns ${game.dailyProvisions().toFixed(1)}/day with your current company.`)),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => buyFood(5) }, '+5 days food'),
          h('button', { class: 'btn', onclick: () => buyFood(15) }, '+15 days food'),
        ),
      ),
    );

    function buyFood(days: number): void {
      const res = game.buyProvisions(days);
      audio.play(res.ok ? 'buy' : 'thud');
      if (!res.ok) shell.toast('warning', res.why ?? 'Cannot buy.');
      bus.emit(T.PLAYER);
      shell.showScreen('market');
    }

    const hintHost = h('div');
    host.append(headerHost, hintHost, controls, tableHost, stalls);

    const renderHint = (): void => {
      const st = game.need();
      if (hintDismissed) { hintHost.replaceChildren(); return; }
      const hasCargo = Object.keys(st.player.cargo).length > 0;
      // After the lessons fade, reappear only for a merchant down on their
      // luck — pointing at the real recovery systems, not a handout.
      const downOnLuck = st.tutorial >= 2 && !hasCargo && st.player.gold < 150;
      if (st.tutorial >= 2 && !downOnLuck) { hintHost.replaceChildren(); return; }
      hintHost.replaceChildren(h('div', {
        class: 'panel',
        style: { 'border-color': 'rgba(217,164,65,0.45)', 'margin-bottom': '12px' },
      },
        h('div', { class: 'row' },
          h('span', { html: icon('info', 18), style: { color: 'var(--gold)' } }),
          h('div', { class: 'grow small' },
            st.tutorial >= 2
              ? h('span', null, h('b', { class: 'gold' }, 'Down on your luck? '), 'Thin margins beat an idle wagon — even grain moved one town over restarts a ledger. The ', h('b', null, 'Contracts'), ' board pays 20 sols up front for Guild surveys: walk to a town whose prices you have not seen in a while and the contract settles itself. Below 25 sols the Guild\u2019s relief chest opens — no merchant is ever quite without options.')
              : hasCargo
              ? h('span', null, h('b', { class: 'gold' }, 'Second step: '), 'you are carrying goods. Open the Map, pick a neighboring town whose prices you have seen (or rumor first at the Tavern), and set out. Sell where the % of fair is high — the road is where margins are made.')
              : h('span', null, h('b', { class: 'gold' }, 'First lesson: '), 'buy where a thing is common. Rows tagged ', h('span', { class: 'deal-tag cheap' }, 'bargain'), ' trade below their fair continental value — grain and salt are the classic beginner loads. Watch the price move as your order fills: you are not the only one trading this market.')),
          h('button', { class: 'btn sm ghost', onclick: () => { hintDismissed = true; renderHint(); } }, 'Got it'),
        )));
    };
    renderHint();
    renderHeader();
    rerenderRows();

    shell.sub(T.MARKET, () => { rerenderRows(); renderHeader(); renderHint(); });
    shell.sub(T.PLAYER, () => { rerenderRows(); renderHeader(); renderHint(); });
    shell.sub(T.DAY, () => { rerenderRows(); renderHeader(); });

    this.unmount = () => { tableHost = null; headerHost = null; };
  },
};
