/**
 * The Caravan — your company on one page: wagon & cargo manifest with honest
 * cost-basis accounting, provisions, guards, crew, upgrades and warehouses.
 */
import { game } from '../../sim/game';
import { bus, T } from '../../core/bus';
import { audio } from '../../audio/engine';
import { shell, type Screen } from '../shell';
import { h, rerender, type Child } from '../dom';
import { icon } from '../icons';
import { GOODS, GOOD_IDS } from '../../data/goods';
import { UPGRADES, UPGRADE_IDS } from '../../data/upgrades';
import { CREW_ROLES, CREW_TRAITS } from '../../data/crew';
import { rankDef } from '../../data/guild';
import { fencePrice, SIGNATURE_GOODS } from '../../sim/economy';

function referencePrices(s: ReturnType<typeof game.need>): Record<string, number> | null {
  if (s.player.loc.kind === 'city') return s.cities[s.player.loc.cityId].price;
  const intel = s.player.intel[s.player.loc.to];
  return intel ? intel.price : null;
}

function cargoPanel(): Child {
  const s = game.need();
  const prices = referencePrices(s);
  const used = game.spaceUsed();
  const cap = game.computeCapacity();
  const rows: Child[] = [];
  let totalValue = 0;
  let totalCost = 0;
  for (const g of GOOD_IDS) {
    const qty = s.player.cargo[g] ?? 0;
    if (qty <= 0) continue;
    const cost = s.player.cargoCost[g] ?? 0;
    const price = prices ? prices[g] : GOODS[g].base;
    const value = qty * price;
    totalValue += value;
    totalCost += cost;
    const here = s.player.loc.kind === 'city';
    rows.push(h('div', { class: 'cargo-row' },
      h('span', { html: icon(g, 18) }),
      h('b', { class: 'grow' }, `${Math.floor(qty)} × ${GOODS[g].name}`),
      h('span', { class: 'tiny dim' }, `${(qty * GOODS[g].space).toFixed(0)} space`),
      GOODS[g].perish > 0
        ? h('span', { class: 'tiny bad', 'data-tip': `Spoils ${(GOODS[g].perish * 100).toFixed(1)}% per travel day — half that while parked in a city.` }, `−${(qty * GOODS[g].perish).toFixed(1)}/day`)
        : null,
      h('span', { class: 'num', 'data-tip': here ? `At today's true prices here.` : 'Valued at your last known prices — the truth waits in the next city.' },
        `${Math.round(value)}${here ? '' : '~'}`),
      h('span', { class: `num tiny ${value - cost >= 0 ? 'good' : 'bad'}`, 'data-tip': `Against ${Math.round(cost)} sols invested.` },
        `${value - cost >= 0 ? '+' : ''}${Math.round(value - cost)}`),
    ));
  }
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('wagon', 18) }), 'The Wagon',
      h('small', null, `${used.toFixed(0)} / ${cap} space`)),
    h('div', { class: 'meter', style: { 'margin-bottom': '12px' } }, h('i', { style: { width: `${Math.min(100, (used / cap) * 100)}%` } })),
    rows.length ? h('div', { class: 'stack' }, ...rows,
      h('div', { class: 'spread', style: { 'border-top': '1px solid rgba(233,223,198,0.1)', 'padding-top': '8px' } },
        h('span', { class: 'dim small' }, `${rows.length} lot${rows.length > 1 ? 's' : ''} aboard`),
        h('span', null, 'worth ', h('b', { class: 'num' }, `${Math.round(totalValue)}${prices ? '' : '~'}`),
          ' · invested ', h('b', { class: 'num' }, String(Math.round(totalCost))),
          ' · ', h('b', { class: `num ${totalValue - totalCost >= 0 ? 'good' : 'bad'}` }, `${totalValue - totalCost >= 0 ? '+' : ''}${Math.round(totalValue - totalCost)}`)))
    ) : h('p', { class: 'dim small' }, 'The wagon bed is bare. An empty wagon is a question the next city gets to answer.'),
  );
}

function companyPanel(): Child {
  const s = game.need();
  const p = s.player;
  const rank = rankDef(p.guildRank);
  const inCity = s.player.loc.kind === 'city';
  const daily = game.dailyWages();
  const prov = game.dailyProvisions();

  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('crown', 18) }), 'The Company',
      h('small', null, rank.name)),
    h('div', { class: 'kv' }, h('dt', null, 'Daily outlay'),
      h('dd', null, `${(daily + prov * (s.player.loc.kind === 'city' ? 0 : 1)).toFixed(1)} sols/day`,
        h('span', { class: 'tiny faint' }, ` — guards ${p.guards}×2 + crew wages`))),
    h('div', { class: 'kv' }, h('dt', null, 'Provisions'),
      h('dd', { class: p.provisions < prov * 4 ? 'bad' : 'good' },
        `${Math.floor(p.provisions)} days · burns ${prov.toFixed(1)}/day`)),
    h('div', { class: 'kv' }, h('dt', null, 'Guards'),
      h('dd', null, `${p.guards} hired`,
        inCity ? h('span', { class: 'row', style: { 'margin-left': '10px' } },
          h('button', { class: 'btn sm', onclick: () => act(() => game.hireGuards(1)) }, '+1 · 40⛁'),
          p.guards > 0 ? h('button', { class: 'btn sm ghost', onclick: () => { game.dismissGuards(1); audio.play('click'); bus.emit(T.PLAYER); rerenderAll(); } }, '−1') : null) : null)),
    h('div', { class: 'kv' }, h('dt', null, 'Crew'),
      h('dd', null, `${p.crew.length} / ${rank.crewSlots} slots`)),
    p.crew.length
      ? h('div', { class: 'stack', style: { 'margin-top': '8px' } },
          ...p.crew.map((m) => h('div', { class: 'crew-card' },
            h('div', { class: 'avatar' }, m.name.charAt(0)),
            h('div', { class: 'grow' },
              h('b', null, m.name),
              h('div', { class: 'tiny dim', 'data-tip': CREW_ROLES[m.role]?.desc ?? '' }, `${CREW_ROLES[m.role]?.name ?? m.role} · ${m.wage.toFixed(1)}/day`),
              m.trait ? h('span', { class: 'tiny gold', 'data-tip': CREW_TRAITS[m.trait]?.desc ?? '' }, CREW_TRAITS[m.trait]?.name ?? m.trait) : null,
            ),
            h('button', { class: 'btn sm ghost', onclick: () => { shell.confirm({ title: 'Dismiss crew', text: `${m.name} takes a final wage and goes. The company loses their skill immediately.`, confirmLabel: 'Dismiss', danger: true, onConfirm: () => { game.fireCrew(m.id); bus.emit(T.PLAYER); rerenderAll(); } }); } }, 'Dismiss'),
          )))
      : h('p', { class: 'tiny dim' }, 'No specialists. The tavern hiring hall is where the interesting ones drink.'),
    inCity && p.provisions < prov * 6
      ? h('button', { class: 'btn', style: { 'margin-top': '10px' }, onclick: () => act(() => game.buyProvisions(10)) }, 'Buy 10 days of provisions')
      : null,
  );
}

function act(fn: () => { ok: boolean; why?: string }): void {
  const res = fn();
  audio.play(res.ok ? 'coin' : 'thud');
  if (!res.ok) shell.toast('warning', res.why ?? 'Not possible.');
  bus.emit(T.PLAYER);
  rerenderAll();
}

function upgradesPanel(): Child {
  const s = game.need();
  const cards = UPGRADE_IDS.map((id) => {
    const def = UPGRADES[id];
    const level = s.player.upgrades[id] ?? 0;
    const maxed = level >= def.maxLevel;
    const cost = maxed ? 0 : def.cost(level + 1);
    const rankLocked = (def.rankReq ?? 0) > s.player.guildRank;
    return h('div', { class: 'ambition' },
      h('div', { class: 'abox', style: { 'border-radius': '8px' }, html: level > 0 ? icon('star', 14) : '' }),
      h('div', { class: 'grow' },
        h('h4', null, def.name, level > 0 ? h('span', { class: 'badge gold', style: { 'margin-left': '8px' } }, `lvl ${level}`) : null),
        h('p', null, def.desc),
        def.rankReq && rankLocked ? h('p', { class: 'tiny bad' }, `Requires guild rank ${def.rankReq} (${rankDef(def.rankReq).name}).`) : null,
      ),
      maxed
        ? h('span', { class: 'badge good' }, 'owned')
        : h('button', {
            class: 'btn sm primary',
            disabled: rankLocked || s.player.gold < cost,
            onclick: () => act(() => game.buyUpgrade(id)),
          }, `${cost} ⛁`),
    );
  });
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('tools', 18) }), 'Outfitting',
      h('small', null, 'permanent improvements')),
    h('div', { class: 'stack' }, ...cards),
  );
}

function warehousePanel(): Child | null {
  const s = game.need();
  if (s.player.loc.kind !== 'city') return null;
  const cityId = s.player.loc.cityId;
  if (!s.player.warehouses.includes(cityId)) return null;
  const store = s.player.storage[cityId] ?? {};
  const stored = GOOD_IDS.filter((g) => (store[g] ?? 0) > 0);
  const rows: Child[] = stored.map((g) => h('div', { class: 'cargo-row' },
    h('span', { html: icon(g, 18) }),
    h('b', { class: 'grow' }, `${Math.floor(store[g]!)} × ${GOODS[g].name}`),
    h('span', { class: 'tiny dim' }, `today ${s.cities[cityId].price[g].toFixed(1)}`),
    h('button', { class: 'btn sm', onclick: () => act(() => game.transferFromWarehouse(cityId, g, Math.max(1, Math.floor(store[g]!)))) }, 'Load all'),
  ));
  const carry = GOOD_IDS.filter((g) => (s.player.cargo[g] ?? 0) > 0).map((g) => h('div', { class: 'cargo-row' },
    h('span', { html: icon(g, 18) }),
    h('b', { class: 'grow' }, `${Math.floor(s.player.cargo[g]!)} × ${GOODS[g].name}`),
    h('button', { class: 'btn sm ghost', onclick: () => act(() => game.transferToWarehouse(cityId, g, Math.floor(s.player.cargo[g]!))) }, 'Store all'),
  ));
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('house', 18) }), `Your warehouse — ${s.cities[cityId].name}`,
      h('small', null, `${game.warehouseSpaceLeft(cityId)} space free`)),
    h('p', { class: 'tiny dim' }, 'Nothing spoils here, and a courier refreshes your price intel for this city every 5 days — even while you are away.'),
    h('div', { class: 'h3' }, 'On the shelves'),
    stored.length ? h('div', { class: 'stack' }, ...rows) : h('p', { class: 'tiny faint' }, 'Empty shelves, honest dust.'),
    carry.length ? h('div', null, h('div', { class: 'h3', style: { 'margin-top': '10px' } }, 'From the wagon'), h('div', { class: 'stack' }, ...carry)) : null,
  );
}

function fenceHintPanel(): Child | null {
  const s = game.need();
  if (s.player.loc.kind !== 'city') return null;
  const city = s.cities[s.player.loc.cityId];
  const fac = s.factions[city.faction];
  const hot = GOOD_IDS.filter((g) => (s.player.cargo[g] ?? 0) > 0 &&
    (fac.ideology.contraband.includes(g) || fac.wars.some((w) => (SIGNATURE_GOODS[w.enemy] ?? []).includes(g))));
  if (!hot.length) return null;
  return h('div', { class: 'panel', style: { 'border-color': 'rgba(176,74,50,0.5)' } },
    h('div', { class: 'panel-title' }, h('span', { html: icon('lantern', 18) }), 'Forbidden cargo aboard'),
    h('p', { class: 'small dim' }, `You are carrying ${hot.map((g) => `${Math.floor(s.player.cargo[g]!)} × ${GOODS[g].name}`).join(', ')} — forbidden or embargoed here. Open stalls will not touch it. The fence in the tavern pays about ${hot.map((g) => `${fencePrice(s, city, g).toFixed(0)}/unit for ${GOODS[g].name.toLowerCase()}`).join(', ')}.`),
    h('button', { class: 'btn danger', onclick: () => shell.showScreen('tavern') }, 'Find the fence'),
  );
}

let hostEl: HTMLElement | null = null;
function rerenderAll(): void {
  if (!hostEl) return;
  rerender(hostEl,
    h('div', { class: 'grid c2w' },
      h('div', { class: 'stack' }, cargoPanel(), warehousePanel(), fenceHintPanel()),
      h('div', { class: 'stack' }, companyPanel(), upgradesPanel()),
    ),
  );
}

export const caravanScreen: Screen = {
  id: 'caravan',
  label: 'Caravan',
  icon: 'wagon',

  mount(host) {
    hostEl = host;
    rerenderAll();
    shell.sub(T.PLAYER, rerenderAll);
    shell.sub(T.MARKET, rerenderAll);
    shell.sub(T.DAY, rerenderAll);
    this.unmount = () => { hostEl = null; };
  },

  pip: () => false,
};
