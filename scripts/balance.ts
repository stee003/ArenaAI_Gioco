/**
 * Headless balance harness. Runs long simulations of the pure world (no player
 * interference) and a "greedy bot" player run, then reports whether the
 * economy stays alive: bounded prices, surviving agents, wars that start and
 * end, treasuries that don't explode. Run: npm run balance
 */
import { game } from '../src/sim/game';
import { GOOD_IDS, GOODS } from '../src/data/goods';
import { FACTION_IDS } from '../src/data/factions';
import { cargoSpace } from '../src/sim/economy';
import type { GameState } from '../src/sim/types';

interface Report {
  days: number;
  priceStats: Record<string, { min: number; max: number; avg: number }>;
  agentsAlive: number;
  agentGold: { avg: number; max: number; totalVolume: number };
  wars: number;
  ongoingWars: number;
  captures: number;
  treasuries: Record<string, number>;
  cityStockExtremes: { famineCities: number; glutCities: number };
  newsCount: number;
  chronicles: number;
  player?: { gold: number; netWorth: number; contracts: number; profit: number; cities: number };
}

function analyze(s: GameState, days: number): Report {
  const priceStats: Report['priceStats'] = {};
  for (const g of GOOD_IDS) {
    const prices = s.cityOrder.map((id) => s.cities[id].price[g]);
    priceStats[g] = {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: prices.reduce((a, b) => a + b, 0) / prices.length,
    };
  }
  const alive = s.agents.filter((a) => a.alive && !a.owner);
  let famine = 0;
  let glut = 0;
  for (const id of s.cityOrder) {
    const c = s.cities[id];
    if (c.stock.grain < c.pop * 2) famine++;
    if (c.stock.grain > c.pop * 80) glut++;
  }
  return {
    days,
    priceStats,
    agentsAlive: alive.length,
    agentGold: {
      avg: alive.reduce((a, b) => a + b.gold, 0) / Math.max(alive.length, 1),
      max: Math.max(0, ...alive.map((a) => a.gold)),
      totalVolume: alive.reduce((a, b) => a + b.tradeVolume, 0),
    },
    wars: s.news.filter((n) => n.text.startsWith('WAR.')).length,
    ongoingWars: FACTION_IDS.reduce((n, f) => n + s.factions[f].wars.length, 0) / 2,
    captures: s.news.filter((n) => n.text.includes('HAS FALLEN')).length,
    treasuries: Object.fromEntries(FACTION_IDS.map((f) => [f, Math.round(s.factions[f].treasury)])),
    cityStockExtremes: { famineCities: famine, glutCities: glut },
    newsCount: s.news.length,
    chronicles: s.chronicles.length,
  };
}

function runWorld(seed: string, days: number): Report {
  game.newGame(seed, 'Harness');
  for (let i = 0; i < days; i++) {
    const out = game.advanceDay();
    if (out.encounter) out.encounter.choices[0].resolve(game.state!, new Rng(i + 7));
  }
  return analyze(game.state!, days);
}

/** A simple greedy bot: buy cheapest-margin good, travel to best-known market, sell. */
function runBot(seed: string, days: number): Report {
  game.newGame(seed, 'Botris the Greedy');
  const s = () => game.state!;
  const trajectory: number[] = [];
  for (let day = 0; day < days; day++) {
    const st = s();
    if (day % 60 === 0) trajectory.push(Math.round(game.netWorth()));
    if (st.player.loc.kind === 'city') {
      // Hire muscle early; fight everything.
      if (st.player.guards < 1 && st.player.gold > 420) game.hireGuards(1);
      const cityId = st.player.loc.cityId;
      const city = st.cities[cityId];
      // Sell everything with positive margin over cost basis.
      for (const g of GOOD_IDS) {
        const qty = st.player.cargo[g] ?? 0;
        if (qty > 0) game.playerSell(g, qty);
      }
      // Buy the best spread good we know of (using true prices — a cheating bot,
      // which sets the upper bound of achievable profit).
      if (cargoSpace(st.player.cargo) < st.player.capacity * 0.7) {
        let bestG = null;
        let bestMargin = 0;
        let bestDest = '';
        for (const g of GOOD_IDS) {
          if (st.factions[city.faction].ideology.contraband.includes(g)) continue;
          const space = GOODS[g].space;
          const qty = Math.min(Math.floor(st.player.gold * 0.7 / city.price[g]), Math.floor((st.player.capacity - cargoSpace(st.player.cargo)) / space), 60);
          if (qty < 2) continue;
          for (const dest of st.cityOrder) {
            if (dest === cityId) continue;
            const margin = (st.cities[dest].price[g] * 0.9 - city.price[g]) * qty;
            if (margin > bestMargin) { bestMargin = margin; bestG = g; bestDest = dest; }
          }
        }
        if (bestG && bestMargin > 60) {
          const qty = Math.min(
            Math.floor(st.player.gold * 0.7 / city.price[bestG]),
            Math.floor((st.player.capacity - cargoSpace(st.player.cargo)) / GOODS[bestG].space),
            60,
          );
          if (qty >= 1) game.playerBuy(bestG, qty);
          // Walk toward bestDest one road at a time.
          const path = staticFindPath(st, cityId, bestDest);
          if (path && path.length > 1) {
            st.player.provisions = Math.max(st.player.provisions, 10);
            game.departTo(path[1]);
          }
        } else if (st.player.gold < 200) {
          // Broke: take any survey contract — walking is free money.
          const survey = st.contracts.find((c) => c.state === 'open' && c.kind === 'survey' && c.cityId === cityId);
          if (survey) {
            takeContractPublic(survey.id);
            const target = survey.fromCity!;
            const path = staticFindPath(st, cityId, target);
            if (path && path.length > 1) {
              st.player.provisions = Math.max(st.player.provisions, 10);
              game.departTo(path[1]);
            }
          }
        }
      }
    }
    const out = game.advanceDay();
    if (out.encounter) {
      // Fight when armed; otherwise take the second choice (pay/shelter/etc).
      const idx = s().player.guards >= 2 ? 0 : Math.min(1, out.encounter.choices.length - 1);
      let choice = out.encounter.choices[idx];
      if (choice.disabled) choice = out.encounter.choices.find((c) => !c.disabled) ?? choice;
      const rr = new Rng(day * 31 + 7);
      if (choice.disabled) out.encounter.choices[out.encounter.choices.length - 1].resolve(s(), rr);
      else choice.resolve(s(), rr);
    }
  }
  console.log('bot net worth trajectory (every 60d):', trajectory.join(' → '));
  const rep = analyze(s(), days);
  rep.player = {
    gold: Math.round(s().player.gold),
    netWorth: Math.round(game.netWorth()),
    contracts: s().stats.contractsDone,
    profit: Math.round(s().stats.tradeProfit),
    cities: s().stats.citiesVisited.length,
  };
  return rep;
}

import { findPath as staticFindPath } from '../src/sim/agents';
import { takeContractPublic } from '../src/sim/game';
import { Rng } from '../src/core/rng';

function printReport(title: string, r: Report): void {
  console.log(`\n=== ${title} (${r.days} days) ===`);
  console.log(`agents alive: ${r.agentsAlive} | avg gold ${r.agentGold.avg.toFixed(0)} | max ${r.agentGold.max.toFixed(0)} | total volume ${Math.round(r.agentGold.totalVolume)}`);
  console.log(`wars declared: ${r.wars} | ongoing: ${r.ongoingWars.toFixed(1)} | cities captured: ${r.captures}`);
  console.log(`treasuries:`, r.treasuries);
  console.log(`famine cities: ${r.cityStockExtremes.famineCities} | glut cities: ${r.cityStockExtremes.glutCities} | news ${r.newsCount} | chronicles ${r.chronicles}`);
  console.log('prices (min/avg/max across cities, base in parens):');
  for (const g of GOOD_IDS) {
    const p = r.priceStats[g];
    const base = GOODS[g].base;
    const flagLow = p.avg < base * 0.45 ? ' ⚠LOW' : '';
    const flagHigh = p.avg > base * 2.2 ? ' ⚠HIGH' : '';
    console.log(`  ${g.padEnd(10)} ${p.min.toFixed(1).padStart(7)} / ${p.avg.toFixed(1).padStart(7)} / ${p.max.toFixed(1).padStart(7)}  (${base})${flagLow}${flagHigh}`);
  }
  if (r.player) console.log('player bot:', r.player);
}

printReport('PURE WORLD — seed alpha', runWorld('balance-alpha', 720));
printReport('PURE WORLD — seed beta', runWorld('balance-beta', 720));
printReport('GREEDY BOT — seed alpha', runBot('balance-alpha', 480));
