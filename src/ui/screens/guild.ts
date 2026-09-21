/**
 * The Guild — rank ladder & promotions, ambitions (the achievement system
 * that pays in coin, fame and epithets), the ledger of your life so far,
 * guild credit, and the late-game empire tools: AI caravans of your own.
 */
import { game } from '../../sim/game';
import { bus, T } from '../../core/bus';
import { audio } from '../../audio/engine';
import { shell, type Screen } from '../shell';
import { h, rerender, type Child } from '../dom';
import { icon } from '../icons';
import { GUILD_RANKS, rankDef, nextRankDef } from '../../data/guild';
import { AMBITIONS } from '../../data/ambitions';
import { GOODS, GOOD_IDS } from '../../data/goods';
import { findPath } from '../../sim/agents';
import { roadBetween } from '../../sim/economy';
import { formatDayShort } from '../../core/calendar';

// ------------------------------------------------------------------- ranks

function rankPanel(): Child {
  const s = game.need();
  const cur = rankDef(s.player.guildRank);
  const next = nextRankDef(s.player.guildRank);
  const check = game.canClaimRank();

  return h('div', { class: 'panel gold-edge' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('crown', 18) }), 'The Ladder',
      h('small', null, `${cur.name} · fame ${Math.round(s.player.fame)}`)),
    h('div', { class: 'rank-track' },
      ...GUILD_RANKS.map((r) =>
        h('div', {
          class: `rank-node ${r.rank <= s.player.guildRank ? 'earned' : ''} ${r.rank === s.player.guildRank ? 'current' : ''}`,
          'data-tip': `${r.desc}<br>${r.perks.map((p) => `· ${p}`).join('<br>')}`,
        }, h('div', { class: 'rn' }, r.name))),
    ),
    h('p', { class: 'lede', style: { 'margin-top': '18px' } }, cur.desc),
    h('div', { class: 'row wrap tiny dim' }, ...cur.perks.map((p) => h('span', { class: 'chip' }, p))),
    s.player.epithetPool.length > 1 || (s.player.epithet && s.player.epithet !== 'the Young')
      ? h('div', { class: 'row wrap', style: { 'margin-top': '10px' } },
          h('span', { class: 'tiny faint' }, 'Styled:'),
          h('b', { class: 'small gold' }, `${s.player.name} ${s.player.epithet}`),
          ...s.player.epithetPool.filter((e) => e !== s.player.epithet).map((e) =>
            h('button', {
              class: 'btn sm ghost',
              'data-tip': 'Wear a different earned style. The clerks will update the books.',
              onclick: () => {
                const st = game.need();
                const old = st.player.epithet;
                st.player.epithet = e;
                if (old && !st.player.epithetPool.includes(old)) st.player.epithetPool.push(old);
                audio.play('stamp');
                bus.emit(T.PLAYER);
                rerenderAll();
              },
            }, `as “${e}”`)))
      : null,
    next
      ? h('div', { style: { 'margin-top': '14px' } },
          h('div', { class: 'h3' }, `Next: ${next.name}`),
          h('div', { class: 'kv' }, h('dt', null, 'Net worth'),
            h('dd', { class: game.netWorth() >= next.netWorth ? 'good' : 'bad' }, `${Math.round(game.netWorth())} / ${next.netWorth}`)),
          h('div', { class: 'kv' }, h('dt', null, 'Contracts fulfilled'),
            h('dd', { class: s.stats.contractsDone >= next.contracts ? 'good' : 'bad' }, `${s.stats.contractsDone} / ${next.contracts}`)),
          h('div', { class: 'kv' }, h('dt', null, 'Fame'),
            h('dd', { class: s.player.fame >= next.fame ? 'good' : 'bad' }, `${Math.round(s.player.fame)} / ${next.fame}`)),
          h('div', { class: 'kv' }, h('dt', null, 'Ceremony fee'),
            h('dd', { class: s.player.gold >= next.fee ? 'good' : 'bad' }, `${next.fee} ⛁`)),
          h('button', {
            class: 'btn primary', style: { 'margin-top': '10px' },
            disabled: !check.ok,
            onclick: () => {
              const res = game.claimRank();
              audio.play(res.ok ? 'rank' : 'thud');
              bus.emit(T.PLAYER);
              rerenderAll();
            },
          }, check.ok ? `Claim the rank of ${next.name}` : check.why ?? 'Not yet'),
        )
      : h('p', { class: 'dim', style: { 'margin-top': '12px' } }, 'The ladder ends at the sky. You have climbed it.'),
  );
}

// --------------------------------------------------------------- ambitions

function ambitionPanel(): Child {
  const s = game.need();
  const done = AMBITIONS.filter((a) => s.ambitions[a.id]?.done);
  const open = AMBITIONS.filter((a) => !s.ambitions[a.id]?.done);
  const row = (a: (typeof AMBITIONS)[number], isDone: boolean): Child =>
    h('div', { class: `ambition ${isDone ? 'done' : ''}` },
      h('div', { class: 'abox' }, '✓'),
      h('div', { class: 'grow' },
        h('h4', null, a.name),
        h('p', null, a.desc),
        h('p', { class: 'tiny gold' },
          a.reward.gold ? `+${a.reward.gold} ⛁ ` : '',
          a.reward.fame ? `+${a.reward.fame} fame ` : '',
          a.reward.epithet ? `· earns the style “${a.reward.epithet}”` : ''),
      ),
      isDone ? h('span', { class: 'tiny faint' }, formatDayShort(s.ambitions[a.id].day ?? s.day)) : null,
    );
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('star', 18) }), 'Ambitions',
      h('small', null, `${done.length} of ${AMBITIONS.length} fulfilled`)),
    h('p', { class: 'tiny dim' }, 'The Guild keeps its own book of what a merchant ought to attempt. Fulfillments pay in coin, fame, and styles of address — and the Chronicle notices.'),
    h('div', { class: 'meter green', style: { margin: '8px 0 14px' } },
      h('i', { style: { width: `${(done.length / AMBITIONS.length) * 100}%` } })),
    h('div', { class: 'stack' },
      ...open.slice(0, 8).map((a) => row(a, false)),
      done.length ? h('div', { class: 'tiny faint', style: { 'margin-top': '6px' } }, `Fulfilled: ${done.map((a) => a.name).join(' · ')}`) : null,
    ),
  );
}

// ------------------------------------------------------------------ ledger

function ledgerPanel(): Child {
  const s = game.need();
  const st = s.stats;
  const cell = (v: string | number, label: string, tip?: string): Child =>
    h('div', { class: 'stat-cell', 'data-tip': tip ?? '' }, h('b', null, String(v)), h('span', null, label));
  const moved = GOOD_IDS.filter((g) => (st.goodsMoved[g] ?? 0) > 0)
    .sort((a, b) => (st.goodsMoved[b] ?? 0) - (st.goodsMoved[a] ?? 0));
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('book', 18) }), 'Your Ledger',
      h('small', null, `${st.daysPlayed} days on the road`)),
    h('div', { class: 'stat-grid' },
      cell(`${Math.round(st.tradeProfit)} ⛁`, 'trade profit', 'Realized buy-low-sell-high profit, net of tariffs.'),
      cell(`${Math.round(st.bestSingleTrade)} ⛁`, 'best single sale'),
      cell(`${Math.round(st.totalBought)} / ${Math.round(st.totalSold)}`, 'bought / sold'),
      cell(`${Math.round(st.tariffsPaid)} ⛁`, 'tariffs paid', 'Visible loyalty: tariffs raise standing with the collecting power.'),
      cell(st.distanceTraveled, 'road-days traveled'),
      cell(`${st.citiesVisited.length} / ${s.cityOrder.length}`, 'cities visited'),
      cell(`${st.contractsDone}✓ ${st.contractsFailed}✗`, 'contracts'),
      cell(`${st.banditsBeaten} / ${Math.round(st.lostToBandits)} ⛁`, 'ambushes won / lost to'),
      cell(st.rumorsBought, 'rumors bought'),
      cell(st.smuggledRuns, 'smuggling runs', `${st.caughtSmuggling} times caught`),
      cell(`${Math.round(st.warProfits)} ⛁`, 'war profits', 'Sols earned feeding besieged cities.'),
      cell(`${Math.round(st.aiCaravanProfit)} ⛁`, 'caravan dividends'),
      cell(`${Math.round(st.caravanseraiIncome)} ⛁`, 'caravanserai income'),
      cell(st.chronicleMentions, 'chronicle mentions'),
      cell(st.ambushesSurvived, 'ambushes survived'),
    ),
    moved.length
      ? h('div', { style: { 'margin-top': '12px' } },
          h('div', { class: 'tiny faint' }, 'Goods you have moved:'),
          h('div', { class: 'row wrap', style: { 'margin-top': '4px' } },
            ...moved.slice(0, 10).map((g) => h('span', { class: 'chip', html: `${icon(g, 13)} ${Math.round(st.goodsMoved[g]!)} ${GOODS[g].name}` }))))
      : null,
  );
}

// ----------------------------------------------------------------- finance

function financePanel(): Child {
  const s = game.need();
  const rank = rankDef(s.player.guildRank);
  const maxLoan = 500 + s.player.guildRank * 300;
  const overdue = s.player.debt > 0 && s.day > s.player.debtDueDay;
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('coin', 18) }), 'Guild Credit'),
    !rank.canTakeLoans
      ? h('p', { class: 'dim small' }, 'The Guild lends to Factors (rank 2) and above. Peddlers carry their own risk.')
      : h('div', { class: 'stack' },
          s.player.debt > 0
            ? h('div', { class: `cargo-row ${overdue ? 'bad' : ''}` },
                h('span', { html: icon('warn', 16) }),
                h('b', { class: 'grow' }, `${Math.round(s.player.debt)} ⛁ owed`),
                h('span', { class: 'tiny dim' }, overdue ? `OVERDUE since day ${s.player.debtDueDay} — compounding 0.5%/day and costing fame` : `due day ${s.player.debtDueDay}`),
                h('button', { class: 'btn sm', disabled: s.player.gold < 1, onclick: () => fin(() => game.repayLoan(Math.min(s.player.gold, s.player.debt))) }, 'Repay all'),
              )
            : h('div', { class: 'row wrap' },
                h('span', { class: 'small dim' }, `Borrow up to ${maxLoan} ⛁ at 10% per 30 days. Overdue debt compounds and gnaws your fame.`),
                h('button', { class: 'btn sm', onclick: () => fin(() => game.takeLoan(Math.min(200, maxLoan))) }, 'Borrow 200'),
                h('button', { class: 'btn sm', onclick: () => fin(() => game.takeLoan(Math.min(500, maxLoan))) }, 'Borrow 500'),
              ),
        ),
  );
}

function fin(fn: () => { ok: boolean; why?: string }): void {
  const res = fn();
  audio.play(res.ok ? 'coin' : 'thud');
  if (!res.ok) shell.toast('warning', res.why ?? 'Not possible.');
  bus.emit(T.PLAYER);
  rerenderAll();
}

// ------------------------------------------------------------ AI caravans

let routeSel: Set<string> = new Set();

function caravanPanel(): Child {
  const s = game.need();
  const rank = rankDef(s.player.guildRank);
  const homeCity = s.player.loc.kind === 'city' ? s.player.loc.cityId : null;
  const inCity = homeCity !== null;

  const books = s.player.aiCaravans.map((b) => {
    const a = s.agents.find((x) => x.id === b.agentId);
    const where = a ? (a.loc.kind === 'city' ? s.cities[a.loc.cityId].name : `on the road to ${s.cities[a.loc.to].name}`) : 'lost';
    return h('div', { class: 'crew-card' },
      h('div', { class: 'avatar', html: icon('wagon', 20) }),
      h('div', { class: 'grow' },
        h('b', null, b.name),
        h('div', { class: 'tiny dim' }, `${where} · float ${Math.round(a?.gold ?? 0)} ⛁ · route: ${b.route.map((c) => s.cities[c].name).join(' → ')}`),
        h('div', { class: 'tiny gold' }, `dividends paid: ${Math.round(b.totalProfit)} ⛁ · since ${formatDayShort(b.hiredDay)}`),
      ),
      h('button', {
        class: 'btn sm ghost',
        onclick: () => shell.confirm({
          title: 'Muster out?',
          text: `“${b.name}” sells its wagons where it stands. Whatever float remains returns to you — minus whatever the road has taken.`,
          confirmLabel: 'Muster out', danger: true,
          onConfirm: () => { game.dismissAiCaravan(b.agentId); audio.play('thud'); bus.emit(T.PLAYER); rerenderAll(); },
        }),
      }, 'Recall'),
    );
  });

  const routePreview: Child = (() => {
    if (!homeCity || routeSel.size === 0) return null;
    const stops = [homeCity, ...routeSel];
    let totalDays = 0;
    const legs: string[] = [];
    for (let i = 0; i < stops.length; i++) {
      const a = stops[i]; const b = stops[(i + 1) % stops.length];
      if (a === b) continue;
      const path = findPath(s, a, b);
      if (!path) { legs.push(`${s.cities[a].name}→${s.cities[b].name}: no road`); continue; }
      for (let j = 0; j < path.length - 1; j++) {
        const r = roadBetween(s, path[j], path[j + 1]);
        if (r) totalDays += r.days;
      }
      legs.push(`${s.cities[a].name}→${s.cities[b].name}`);
    }
    return h('div', { class: 'tiny dim', style: { 'margin-top': '6px' } },
      `Loop: ${legs.join(' · ')} — roughly ${totalDays} road-days per circuit. Captains trade as they go and pay dividends on completing each loop.`);
  })();

  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('wagon', 18) }), 'Your Caravans',
      h('small', null, `${s.player.aiCaravans.length} / ${rank.maxAiCaravans} licensed`)),
    rank.maxAiCaravans === 0
      ? h('p', { class: 'dim small' }, 'At rank 3 (Merchant) the Guild licenses your first caravan to trade under your name — captains, wagons and all. They report and pay dividends while you do something else entirely.')
      : h('div', { class: 'stack' },
          ...books,
          s.player.aiCaravans.length < rank.maxAiCaravans
            ? inCity
              ? h('div', { class: 'panel', style: { background: 'rgba(0,0,0,0.2)' } },
                  h('div', { class: 'h3' }, `Fit out a caravan — home: ${s.cities[homeCity!].name}`),
                  h('div', { class: 'tiny dim' }, 'Choose the loop’s other stops (it returns home between circuits):'),
                  h('div', { class: 'row wrap', style: { margin: '8px 0' } },
                    ...s.cityOrder.filter((c) => c !== homeCity).map((c) =>
                      h('button', {
                        class: `btn sm ${routeSel.has(c) ? 'primary' : 'ghost'}`,
                        onclick: () => {
                          if (routeSel.has(c)) routeSel.delete(c); else routeSel.add(c);
                          audio.play('click');
                          rerenderAll();
                        },
                      }, s.cities[c].name)),
                  ),
                  routePreview,
                  h('button', {
                    class: 'btn primary', style: { 'margin-top': '10px' },
                    disabled: routeSel.size < 1 || s.player.gold < 400 + 400,
                    'data-tip': '400 ⛁ minimum float (the captain’s trading purse) + 400 ⛁ Guild license.',
                    onclick: () => {
                      const route = [homeCity!, ...routeSel, homeCity!];
                      const res = game.hireAiCaravan(homeCity!, 400, route);
                      audio.play(res.ok ? 'coin' : 'thud');
                      if (!res.ok) shell.toast('warning', res.why ?? 'Cannot fit out.');
                      else routeSel = new Set();
                      bus.emit(T.PLAYER);
                      rerenderAll();
                    },
                  }, 'Fit out — 800 ⛁ (400 float + 400 license)'),
                )
              : h('p', { class: 'tiny dim' }, 'Caravans are fitted out from a city — stand in one to license a new loop.')
            : null,
        ),
  );
}

// ------------------------------------------------------------- estates

function estatePanel(): Child {
  const s = game.need();
  if (!s.player.caravanserais.length && !s.player.warehouses.length) return null;
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('span', { html: icon('house', 18) }), 'Estates'),
    s.player.warehouses.length
      ? h('div', { class: 'tiny dim', style: { 'margin-bottom': '6px' } }, `Warehouses: ${s.player.warehouses.map((c) => s.cities[c].name).join(', ')}`)
      : null,
    ...s.player.caravanserais.map((rid) => {
      const r = s.roads[rid];
      return h('div', { class: 'cargo-row' },
        h('span', { html: icon('house', 16) }),
        h('b', { class: 'grow' }, r.caravanseraiName ?? 'Your caravanserai'),
        h('span', { class: 'tiny dim' }, `${s.cities[r.a].name} — ${s.cities[r.b].name} road`),
      );
    }),
    h('div', { class: 'tiny gold', style: { 'margin-top': '6px' } }, `Lifetime income: ${Math.round(s.stats.caravanseraiIncome)} ⛁ from lodging, ${Math.round(s.stats.aiCaravanProfit)} ⛁ in caravan dividends.`),
  );
}

let hostEl: HTMLElement | null = null;

function rerenderAll(): void {
  if (!hostEl) return;
  rerender(hostEl, h('div', { class: 'grid c2' },
    h('div', { class: 'stack' }, rankPanel(), financePanel(), ambitionPanel()),
    h('div', { class: 'stack' }, caravanPanel(), estatePanel(), ledgerPanel()),
  ));
}

export const guildScreen: Screen = {
  id: 'guild',
  label: 'Guild',
  icon: 'seal',

  pip: () => {
    const s = game.state;
    return !!s && game.canClaimRank().ok;
  },

  mount(host) {
    hostEl = host;
    routeSel = new Set();
    rerenderAll();
    shell.sub(T.PLAYER, rerenderAll);
    shell.sub(T.DAY, rerenderAll);
    this.unmount = () => { hostEl = null; };
  },
};
