/**
 * The Almanac — the game's own codex: every good with its true production
 * chains, every power with its laws, and honest explanations of the rules
 * the simulation actually follows. Nothing here is decorative: it is the
 * manual the world wrote about itself.
 */
import { game } from '../../sim/game';
import { audio } from '../../audio/engine';
import { shell, type Screen } from '../shell';
import { h, rerender, type Child } from '../dom';
import { icon, factionSeal } from '../icons';
import { GOODS, GOOD_IDS, BUILDINGS } from '../../data/goods';
import { SIGNATURE_GOODS } from '../../sim/economy';
import type { GoodId } from '../../sim/types';

let tab: 'goods' | 'powers' | 'rules' | 'cities' = 'goods';

function producersOf(g: GoodId): string[] {
  return Object.values(BUILDINGS)
    .filter((b) => (b.produces?.[g] ?? 0) > 0)
    .map((b) => `${b.name} (+${b.produces![g]}/day)`);
}

function consumersOf(g: GoodId): string[] {
  return Object.values(BUILDINGS)
    .filter((b) => (b.consumes?.[g] ?? 0) > 0)
    .map((b) => `${b.name} (−${b.consumes![g]}/day)`);
}

function goodsTab(): Child {
  const s = game.need();
  return h('div', { class: 'grid c2' },
    ...GOOD_IDS.map((g) => {
      const def = GOODS[g];
      const moved = s.stats.goodsMoved[g] ?? 0;
      const visited = s.stats.citiesVisited;
      let lo = Infinity; let hi = 0; let loCity = ''; let hiCity = '';
      for (const cid of visited) {
        const kn = s.player.intel[cid];
        if (!kn) continue;
        if (kn.price[g] < lo) { lo = kn.price[g]; loCity = s.cities[cid].name; }
        if (kn.price[g] > hi) { hi = kn.price[g]; hiCity = s.cities[cid].name; }
      }
      return h('div', { class: 'codex-entry' },
        h('div', { class: 'gicon', html: icon(g, 24) }),
        h('div', { class: 'grow' },
          h('h4', null, def.name, ' ',
            h('span', { class: 'badge dim' }, def.tier),
            moved > 0 ? h('span', { class: 'badge gold', style: { 'margin-left': '6px' } }, `moved ${Math.round(moved)}`) : null),
          h('p', null, def.desc),
          h('p', { class: 'tiny', style: { 'margin-top': '4px' } },
            `fair value ${def.base} ⛁ · ${def.space} space/unit`,
            def.perish > 0 ? ` · spoils ${(def.perish * 100).toFixed(1)}%/road-day` : '',
            ` · price swings ${def.elasticity > 1.4 ? 'violently with scarcity' : def.elasticity > 1 ? 'firmly with scarcity' : 'gently'}`),
          producersOf(g).length
            ? h('p', { class: 'tiny dim' }, `Made by: ${producersOf(g).join(', ')}`)
            : h('p', { class: 'tiny dim' }, 'Grown or gathered from the land itself.'),
          consumersOf(g).length
            ? h('p', { class: 'tiny dim' }, `Wanted by: ${consumersOf(g).join(', ')}`)
            : null,
          visited.length && hi > 0
            ? h('p', { class: 'tiny gold' }, `You have seen it from ${lo.toFixed(1)} (${loCity}) to ${hi.toFixed(1)} (${hiCity}).`)
            : null,
        ),
      );
    }),
  );
}

function powersTab(): Child {
  const s = game.need();
  return h('div', { class: 'grid c2' },
    ...Object.values(s.factions).map((f) => h('div', { class: 'codex-entry', style: { 'border-left': `3px solid ${f.color}` } },
      h('div', { class: 'gicon', style: { color: f.color }, html: factionSeal(f.id, 26) }),
      h('div', { class: 'grow' },
        h('h4', null, f.name, h('span', { class: 'tiny dim' }, ` — ${f.epithet}`)),
        h('p', null, f.ideology.desc),
        h('p', { class: 'tiny' },
          `Ruled by ${f.ruler} from ${s.cities[f.capital].name} · tariff ${(f.ideology.tariff * 100).toFixed(0)}% · war appetite ${Math.round(f.ideology.aggression * 100)}%`),
        h('p', { class: 'tiny dim' },
          f.ideology.contraband.length
            ? `Forbids within its walls: ${f.ideology.contraband.map((g) => GOODS[g].name).join(', ')}.`
            : 'Forbids nothing — suspiciously permissive.'),
        h('p', { class: 'tiny gold' }, `Signature trade: ${SIGNATURE_GOODS[f.id].map((g) => GOODS[g].name).join(', ')} — in war with ${f.name}, enemies embargo exactly these, and fences pay for them.`),
      ),
    )),
  );
}

const RULES: { title: string; body: string }[] = [
  { title: 'Prices are not scripted', body: 'Every city produces, consumes and re-prices every day. Price = fair value × scarcity^elasticity, clamped to 40%–360% of fair, plus small noise. Your own orders move the price as they fill — big trades pay worse per unit. Nothing is a decoration: rival caravans trade the same margins you do.' },
  { title: 'Information is a commodity', body: 'You only truly know prices where you stand. Elsewhere you see the last prices you witnessed (or heard) with a ~ mark; the older the intel, the wider the doubt. Rumors in taverns write fresh, true prices into your ledger. Warehouses send couriers every 5 days.' },
  { title: 'Tariffs feed thrones', body: 'Selling pays the local power its tariff — that coin becomes army and war. Trade between two powers warms their relations; grievances and raids cool them. Below −50 relations, war councils sit. Your tariffs-paid is visible loyalty and raises standing.' },
  { title: 'War rewrites the map of profit', body: 'At war, each side embargoes the enemy’s signature goods (trade strangled to 15%, prices ×1.6 in secret). Besieged cities pay fortunes for grain and iron — feeding one earns its gratitude and the besieger’s enmity. Fences buy what law forbids, at their own nightly multiplier, with a patrol risk that your fame, banners and compartments can soften.' },
  { title: 'The company eats', body: 'Provisions burn daily (more at hard pace); wages are paid daily. Run out of food and the company eats cargo grain, then deserts. Run out of coin for wages and the most eager leave first. Guards cost 2⛁/day and are worth exactly that on the day bandits come.' },
  { title: 'Roads remember', body: 'Danger rises with lawlessness, war and bandit confederacies (who are named, and boastful). Your own caravanserai on a road removes night predators entirely and pays lodging income. Salvage from lost caravans glints on the map until claimed or weather takes it.' },
  { title: 'Seasons turn the screw', body: 'Winter raises grain demand and closes mountain passes to slow traffic; autumn rushes harvest goods; spring festivals lift wine and cloth. Droughts, plagues, booms and fires are drawn from the same dice that draw your encounters.' },
  { title: 'Standing, fame, rank', body: 'Standing (per faction) grows from tariffs paid, gifts, feeding sieges, kept bonds — and falls from smuggling caught, broken bonds, selling to their enemies. Sink below −40 — fighting wardens, getting caught with forbidden goods — and you are banished for months: their patrols inspect your wagon daily, fine you, and confiscate anything forbidden until the ban lifts. Fame grows from notable deeds and softens bandit appetite. Guild ranks gate crew slots, caravan licenses, warehouses, credit and caravanserai permits.' },
  { title: 'Everything runs without you', body: 'Rival merchants live, reinvest, retire and die. Factions war, go bankrupt, capture and lose cities. The Chronicle prints every ten days whether you read it or not. Advance a day and the world advances with you — the simulation is deterministic per seed: the same seed replays the same world.' },
];

function rulesTab(): Child {
  return h('div', { class: 'grid c2' },
    ...RULES.map((r) => h('div', { class: 'panel' },
      h('div', { class: 'h3 gold' }, r.title),
      h('p', { class: 'small dim', style: { margin: 0, 'line-height': '1.6' } }, r.body),
    )),
  );
}

function citiesTab(): Child {
  const s = game.need();
  const visited = new Set(s.stats.citiesVisited);
  return h('div', { class: 'grid c2' },
    ...s.cityOrder.map((cid) => {
      const c = s.cities[cid];
      const seen = visited.has(cid);
      const fac = s.factions[c.faction];
      return h('div', { class: 'codex-entry', style: seen ? undefined : { opacity: '0.55' } },
        h('div', { class: 'gicon', style: { color: fac.color }, html: icon(seen ? 'house' : 'eye', 22) }),
        h('div', { class: 'grow' },
          h('h4', null, seen ? c.name : 'A city you have not seen'),
          seen
            ? h('p', null,
                `${fac.name} · ${c.pop.toFixed(1)}k souls · ${c.biome}`,
                h('br'),
                `Works: ${c.buildings.map((b) => BUILDINGS[b]?.name ?? b).join(', ')}`)
            : h('p', null, 'The Almanac leaves the page blank. Go there; the ink follows the road.'),
          seen && s.player.warehouses.includes(cid)
            ? h('p', { class: 'tiny gold' }, 'Your warehouse stands here.')
            : null,
        ),
      );
    }),
  );
}

let hostEl: HTMLElement | null = null;

function rerenderAll(): void {
  if (!hostEl) return;
  rerender(hostEl,
    h('div', { class: 'h1' }, 'The Almanac'),
    h('p', { class: 'lede' }, 'Your uncle kept one. Now you keep one: goods and their true chains, powers and their laws, the rules of the road written down honestly, and the cities your own eyes have vouched for.'),
    h('div', { class: 'tabs' },
      ...(['goods', 'powers', 'rules', 'cities'] as const).map((t) =>
        h('button', {
          class: `tab ${tab === t ? 'active' : ''}`,
          onclick: () => { tab = t; audio.play('page'); rerenderAll(); },
        }, t === 'goods' ? 'Goods' : t === 'powers' ? 'Powers' : t === 'rules' ? 'Rules of the Road' : 'Cities')),
    ),
    tab === 'goods' ? goodsTab() : tab === 'powers' ? powersTab() : tab === 'rules' ? rulesTab() : citiesTab(),
  );
}

export const almanacScreen: Screen = {
  id: 'almanac',
  label: 'Almanac',
  icon: 'book',

  mount(host) {
    hostEl = host;
    rerenderAll();
    shell.sub('state', rerenderAll);
    this.unmount = () => { hostEl = null; };
  },
};
