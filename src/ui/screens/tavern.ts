/**
 * The Tavern — information is the real currency: rumors that write true
 * intel into your ledger, the hiring hall (guards & specialists), and the
 * fence in the dark corner who buys what the law forbids.
 */
import { game } from '../../sim/game';
import { bus, T } from '../../core/bus';
import { audio } from '../../audio/engine';
import { shell, type Screen } from '../shell';
import { h, rerender, type Child } from '../dom';
import { icon } from '../icons';
import { GOODS } from '../../data/goods';
import { CREW_ROLES, CREW_TRAITS } from '../../data/crew';
import { rankDef } from '../../data/guild';
import { fencePrice, SIGNATURE_GOODS } from '../../sim/economy';
import type { GoodId } from '../../sim/types';

let rumorOut: { title: string; text: string } | null = null;

function hereId(): string {
  const s = game.need();
  return s.player.loc.kind === 'city' ? s.player.loc.cityId : '';
}

function gossipPanel(): Child {
  const s = game.need();
  const city = s.cities[hereId()];
  const gossip = s.news.filter((n) => n.kind !== 'player').slice(-3).reverse();
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('lantern', 18) }),
      `The ${city.name} Tavern`, h('small', null, 'tonight')),
    h('p', { class: 'lede' }, 'Smoke, sour wine, and the only news that travels faster than wagons. Everything here costs coin — except the listening.'),
    ...gossip.map((n) => h('div', { class: 'news-item' },
      h('span', { class: 'nicon', html: icon(n.kind === 'war' ? 'sword' : n.kind === 'market' ? 'market' : n.kind === 'crime' ? 'sword' : 'info', 15) }),
      h('span', { class: 'ntext dim' }, n.text))),
  );
}

function rumorPanel(): Child {
  const s = game.need();
  const free = game.spyFreeRumor();
  const kinds: { id: 'prices' | 'war' | 'merchant' | 'roads'; name: string; desc: string; target?: 'city' | 'faction' }[] = [
    { id: 'prices', name: 'A distant price board', desc: 'A factor recites another city’s true prices from memory — written into your ledger as fresh intel.', target: 'city' },
    { id: 'war', name: 'The political weather', desc: 'Which thrones hate which, and how close the drums are.', target: 'faction' },
    { id: 'merchant', name: 'A rival’s business', desc: 'What a competing caravan carries, where it is bound, and how deep its purse runs.' },
    { id: 'roads', name: 'The state of the roads', desc: 'Teamsters’ honest numbers: danger on every road out of here.' },
  ];

  const cards = kinds.map((k) => {
    const cost = free ? 0 : game.rumorCost(k.id);
    let targetSel: Child = null;
    if (k.target === 'city') {
      targetSel = h('select', { class: 'sel', dataset: { targetFor: k.id } },
        h('option', { value: '' }, 'wherever is most interesting'),
        ...s.cityOrder.filter((c) => c !== hereId()).map((c) => h('option', { value: c }, s.cities[c].name)));
    } else if (k.target === 'faction') {
      targetSel = h('select', { class: 'sel', dataset: { targetFor: k.id } },
        h('option', { value: '' }, 'the tensest power'),
        ...Object.values(s.factions).map((f) => h('option', { value: f.id }, f.name)));
    }
    return h('div', { class: 'rumor-card' },
      h('span', { html: icon(k.id === 'prices' ? 'market' : k.id === 'war' ? 'sword' : k.id === 'merchant' ? 'wagon' : 'road', 20) }),
      h('div', { class: 'grow' },
        h('b', null, k.name),
        h('div', { class: 'tiny dim' }, k.desc),
        targetSel ? h('div', { style: { 'margin-top': '6px' } }, targetSel) : null,
      ),
      h('button', {
        class: 'btn sm primary',
        disabled: s.player.gold < cost,
        onclick: () => {
          const sel = document.querySelector<HTMLSelectElement>(`[data-target-for="${k.id}"]`);
          const res = game.buyRumor(k.id, sel?.value || undefined);
          if (res.ok && res.text) {
            audio.play('rumor');
            rumorOut = { title: k.name, text: res.text };
          } else {
            audio.play('thud');
            shell.toast('warning', res.why ?? 'The tavern has nothing.');
          }
          bus.emit(T.PLAYER);
          rerenderAll();
        },
      }, free ? 'free (spy)' : `${cost} ⛁`),
    );
  });

  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('eye', 18) }), 'The Rumor Counter',
      free ? h('small', { class: 'good' }, 'your spy whispers free today') : h('small', null, 'coin buys certainty')),
    h('div', { class: 'stack' }, ...cards),
    rumorOut
      ? h('div', { class: 'rumor-out', style: { 'margin-top': '14px' } },
          h('b', null, rumorOut.title, ': '), rumorOut.text)
      : null,
  );
}

function hiringPanel(): Child {
  const s = game.need();
  const rank = rankDef(s.player.guildRank);
  const cands = game.crewCandidates(hereId());
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('handshake', 18) }), 'The Hiring Hall',
      h('small', null, `crew ${s.player.crew.length}/${rank.crewSlots} · guards ${s.player.guards}/8`)),
    h('div', { class: 'row wrap', style: { 'margin-bottom': '12px' } },
      h('span', { class: 'small dim' }, 'Sword-arms: 40 ⛁ to hire, 2 ⛁/day each. They make ambushes survivable and merchants respectful.'),
      h('button', { class: 'btn sm', disabled: s.player.gold < 80 || s.player.guards >= 8, onclick: () => hire(() => game.hireGuards(2)) }, 'Hire 2 guards · 80 ⛁'),
      h('button', { class: 'btn sm', disabled: s.player.gold < 40 || s.player.guards >= 8, onclick: () => hire(() => game.hireGuards(1)) }, 'Hire 1 · 40 ⛁'),
    ),
    cands.length
      ? h('div', { class: 'stack' },
          ...cands.map((c, i) => h('div', { class: 'crew-card' },
            h('div', { class: 'avatar' }, c.name.charAt(0)),
            h('div', { class: 'grow' },
              h('b', null, c.name),
              h('div', { class: 'tiny dim', 'data-tip': CREW_ROLES[c.role]?.desc ?? '' }, `${CREW_ROLES[c.role]?.name ?? c.role} · ${c.wage.toFixed(1)} ⛁/day`),
              c.trait ? h('span', { class: 'tiny gold', 'data-tip': CREW_TRAITS[c.trait]?.desc ?? '' }, `“${CREW_TRAITS[c.trait]?.name ?? c.trait}”`) : null,
            ),
            h('button', {
              class: 'btn sm primary',
              disabled: s.player.crew.length >= rank.crewSlots || s.player.gold < c.wage * 5,
              'data-tip': s.player.crew.length >= rank.crewSlots ? 'No free crew slots — the Guild allows more at higher ranks.' : `A signing bonus of five days' wages (${Math.round(c.wage * 5)} ⛁) is customary.`,
              onclick: () => hire(() => game.hireCrew(hereId(), i)),
            }, `Hire · ${Math.round(c.wage * 5)} ⛁`),
          )))
      : h('p', { class: 'tiny dim' }, 'Nobody worth the salt tonight. The hall refills as days pass.'),
  );
}

function hire(fn: () => { ok: boolean; why?: string }): void {
  const res = fn();
  audio.play(res.ok ? 'coin' : 'thud');
  if (!res.ok) shell.toast('warning', res.why ?? 'Not possible.');
  bus.emit(T.PLAYER);
  rerenderAll();
}

function fencePanel(): Child {
  const s = game.need();
  const city = s.cities[hereId()];
  const fac = s.factions[city.faction];
  const embargoed: GoodId[] = [];
  for (const w of fac.wars) embargoed.push(...SIGNATURE_GOODS[w.enemy]);
  const hot = [...new Set([...fac.ideology.contraband, ...embargoed])];
  const carryingHot = hot.filter((g) => (s.player.cargo[g] ?? 0) > 0);

  return h('div', { class: 'panel', style: { 'border-color': 'rgba(176,74,50,0.35)' } },
    h('div', { class: 'panel-title' }, h('span', { html: icon('coin', 18) }), 'The Dark Corner',
      h('small', null, 'the fence')),
    h('p', { class: 'tiny dim' },
      `Here ${fac.name} law does not reach, or reaches slowly. The fence buys what stalls cannot: tonight his board pays a ${Math.round(city.fenceMult * 100)}% multiplier on forbidden goods. No tariffs, no names, no questions — and patrols sometimes watch the door.`,
      (s.player.upgrades.compartment ?? 0) > 0 ? ' Your hidden compartment keeps patrols from looking too closely.' : ''),
    h('div', { class: 'stack', style: { 'margin-top': '10px' } },
      ...hot.map((g) => {
        const banned = fac.ideology.contraband.includes(g);
        const carry = Math.floor(s.player.cargo[g] ?? 0);
        return h('div', { class: 'cargo-row' },
          h('span', { html: icon(g, 18) }),
          h('div', { class: 'grow' },
            h('b', null, GOODS[g].name),
            h('span', { class: 'badge bad', style: { 'margin-left': '8px' } }, banned ? 'forbidden' : 'embargoed'),
            h('div', { class: 'tiny dim' }, `fence pays ~${fencePrice(s, city, g).toFixed(1)}/unit · open market base ${GOODS[g].base}`),
          ),
          carry > 0
            ? h('button', {
                class: 'btn sm danger',
                onclick: () => {
                  const res = game.playerSellToFence(g, carry);
                  audio.play(res.ok ? 'sell' : 'thud');
                  if (!res.ok) shell.toast('warning', res.why ?? 'The fence declines.');
                  bus.emit(T.MARKET);
                  rerenderAll();
                },
              }, `Sell ${carry}`)
            : null,
        );
      }),
    ),
    carryingHot.length === 0 && hot.length === 0
      ? h('p', { class: 'tiny faint' }, 'Nothing is forbidden in this city tonight. The fence dozes.')
      : null,
  );
}

let hostEl: HTMLElement | null = null;
function rerenderAll(): void {
  if (!hostEl) return;
  rerender(hostEl, h('div', { class: 'grid c2' },
    h('div', { class: 'stack' }, gossipPanel(), rumorPanel()),
    h('div', { class: 'stack' }, hiringPanel(), fencePanel()),
  ));
}

export const tavernScreen: Screen = {
  id: 'tavern',
  label: 'Tavern',
  icon: 'lantern',
  inCityOnly: true,
  pip: () => game.spyFreeRumor(),

  mount(host) {
    rumorOut = null;
    hostEl = host;
    rerenderAll();
    shell.sub(T.PLAYER, rerenderAll);
    shell.sub(T.DAY, rerenderAll);
    shell.sub(T.MARKET, rerenderAll);
    this.unmount = () => { hostEl = null; };
  },
};
