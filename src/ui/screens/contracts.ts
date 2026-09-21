/**
 * Contracts — the guild board. Parchment cards for open work in this city,
 * honest progress tracking for what you've signed, and abandonment with its
 * real consequences (advances clawed back, standing lost).
 */
import { game, takeContractPublic } from '../../sim/game';
import { abandonContract, activeContracts } from '../../sim/contracts';
import { bus, T } from '../../core/bus';
import { audio } from '../../audio/engine';
import { shell, type Screen } from '../shell';
import { h, rerender, type Child } from '../dom';
import { icon, factionSeal } from '../icons';
import { GOODS } from '../../data/goods';
import type { Contract, GoodId } from '../../sim/types';

const KIND_ICON: Record<string, string> = {
  delivery: 'box', procurement: 'market', escort: 'shield', smuggle: 'lantern', survey: 'map',
};
const KIND_NAME: Record<string, string> = {
  delivery: 'Delivery bond', procurement: 'Procurement bond', escort: 'Escort bond',
  smuggle: 'Smuggling bond', survey: 'Guild survey',
};

function progressLine(c: Contract): Child {
  const s = game.need();
  const have = (g?: GoodId): number => (g ? Math.floor(s.player.cargo[g] ?? 0) : 0);
  switch (c.kind) {
    case 'delivery': {
      const got = have(c.good);
      const ok = got >= (c.amount ?? 0);
      return h('div', { class: ok ? 'good small' : 'small dim' },
        `${ok ? '✓ Cargo aboard' : `Carry ${c.amount} × ${GOODS[c.good!].name} — you hold ${got}`} → deliver to ${s.cities[c.cityId].name}`);
    }
    case 'procurement':
      return h('div', { class: 'small dim' },
        `Buy ${c.amount} × ${GOODS[c.good!].name}${c.fromCity ? ` — whispered cheapest near ${s.cities[c.fromCity].name}` : ''} — and bring them to ${s.cities[c.cityId].name}. ${have(c.good) >= (c.amount ?? 0) ? '✓ Cargo aboard.' : `You hold ${have(c.good)}.`}`);
    case 'escort': {
      const a = s.agents.find((x) => x.id === c.escortAgent);
      const withYou = a && a.loc.kind === 'road' && s.player.loc.kind === 'road';
      return h('div', { class: 'small dim' },
        `${c.patron} travels when you travel${withYou ? ' — their wagon rolls beside yours now' : ''}. Reach ${s.cities[c.cityId].name} with them alive.`);
    }
    case 'smuggle':
      return h('div', { class: 'small dim' },
        `Get ${c.amount} × ${GOODS[c.good!].name} past the law to ${s.cities[c.cityId].name} — the fence there settles the bond. ${have(c.good) >= (c.amount ?? 0) ? '✓ Cargo aboard.' : `You hold ${have(c.good)}.`}`);
    case 'survey':
      return h('div', { class: 'small dim' },
        `Walk the road to ${s.cities[c.fromCity!].name} and set foot inside its gates. The Guild only asks that you go and see.`);
  }
  return null;
}

function contractCard(c: Contract, open: boolean): Child {
  const s = game.need();
  const daysLeft = c.deadline - s.day;
  const urgent = daysLeft <= 5;
  return h('div', { class: `contract-card ${open ? '' : 'taken'}` },
    h('div', { class: 'ct-foot', style: { margin: '2px 0 6px' } },
      h('span', { class: 'ct-kind', html: `${icon(KIND_ICON[c.kind] ?? 'scroll', 12)} ${KIND_NAME[c.kind] ?? c.kind}` }),
      c.faction ? h('span', {
        class: 'badge faction',
        style: { color: s.factions[c.faction].color, 'border-color': s.factions[c.faction].color },
        html: factionSeal(c.faction, 13),
      }, s.factions[c.faction].name.replace(/^The /, '')) : null,
      open
        ? h('span', { class: `badge ${urgent ? 'bad' : 'dim'}`, style: { 'margin-left': 'auto' } }, `${daysLeft}d to deadline`)
        : h('span', { class: `badge ${urgent ? 'bad' : 'good'}`, style: { 'margin-left': 'auto' } }, daysLeft >= 0 ? `${daysLeft}d remain` : 'overdue'),
    ),
    h('h3', null, c.desc),
    c.patron && c.kind !== 'escort' ? h('div', { class: 'tiny', style: { color: '#6d5a3a' } }, `— bonded to ${c.patron}`) : null,
    open ? null : progressLine(c),
    h('div', { class: 'ct-foot' },
      h('span', { class: 'reward' }, `${c.reward} ⛁`, c.advance > 0 ? h('span', { class: 'tiny', style: { color: '#6d5a3a' } }, ` (+${c.advance} on signing)`) : null),
      c.repReward ? h('span', { class: 'tiny', style: { color: '#6d5a3a' } }, `+${c.repReward.toFixed(1)} standing`) : null,
      h('div', { class: 'grow' }),
      open
        ? h('button', {
            class: 'btn primary sm',
            onclick: () => {
              const res = takeContractPublic(c.id);
              audio.play(res.ok ? 'stamp' : 'thud');
              if (!res.ok) shell.toast('warning', res.why ?? 'Cannot take.');
              else shell.toast('contract', `You sign the bond: “${c.desc}” — ${c.reward} sols on completion${c.advance ? `, ${c.advance} sols now` : ''}.`);
              bus.emit(T.PLAYER);
              rerenderAll();
            },
          }, 'Sign the bond')
        : h('button', {
            class: 'btn ghost sm',
            style: { color: '#7e2f1c', 'border-color': 'rgba(126,47,28,0.4)' },
            onclick: () => shell.confirm({
              title: 'Break the bond?',
              text: `Abandoning “${c.desc}” claws back the advance (${c.advance} ⛁) and costs standing with the patron. Word travels.`,
              confirmLabel: 'Break it',
              danger: true,
              onConfirm: () => {
                abandonContract(s, c.id);
                audio.play('thud');
                shell.toast('warning', 'The bond is broken. The Guild remembers.');
                bus.emit(T.PLAYER);
                rerenderAll();
              },
            }),
          }, 'Abandon'),
      h('span', { class: 'wax', html: icon('seal', 18) }),
    ),
  );
}

let hostEl: HTMLElement | null = null;

function rerenderAll(): void {
  const s = game.state;
  if (!hostEl || !s || s.player.loc.kind !== 'city') return;
  const cityId = s.player.loc.cityId;
  const city = s.cities[cityId];
  const mine = activeContracts(s);
  const board = s.contracts.filter((c) => c.state === 'open' && c.cityId === cityId);

  rerender(hostEl,
    h('div', { class: 'h1' }, `${city.name} — Guild Board`),
    h('p', { class: 'lede' }, 'Bonds are nailed to the post by patrons and the Guild alike. Signing is easy; the road decides the rest.'),
    h('div', { class: 'grid c2' },
      h('div', { class: 'stack' },
        h('div', { class: 'h2' }, `On the board here (${board.length})`),
        board.length
          ? board.map((c) => contractCard(c, true))
          : h('div', { class: 'panel' }, h('p', { class: 'dim small' }, 'The board is bare. New bonds are posted as the days pass — the clerk nails them up at dawn.')),
      ),
      h('div', { class: 'stack' },
        h('div', { class: 'h2' }, `Your signed bonds (${mine.length})`),
        mine.length
          ? mine.map((c) => contractCard(c, false))
          : h('div', { class: 'panel' }, h('p', { class: 'dim small' }, 'No bonds signed. Surveys pay for walking; deliveries pay for speed; the dark ones pay best and ask nothing about your conscience.')),
      ),
    ),
  );
}

export const contractsScreen: Screen = {
  id: 'contracts',
  label: 'Contracts',
  icon: 'scroll',
  inCityOnly: true,

  pip: () => {
    const s = game.state;
    if (!s) return false;
    const loc = s.player.loc;
    if (loc.kind !== 'city') return false;
    return s.contracts.some((c) => c.state === 'open' && c.cityId === loc.cityId);
  },

  mount(host) {
    hostEl = host;
    rerenderAll();
    shell.sub(T.DAY, rerenderAll);
    shell.sub(T.PLAYER, rerenderAll);
    shell.sub(T.MARKET, rerenderAll);
    this.unmount = () => { hostEl = null; };
  },
};
