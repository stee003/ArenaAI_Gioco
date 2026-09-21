/**
 * First-session audit: for several seeds, generate a world and report what a
 * brand-new player (300 sols, one wagon) actually faces — the starting city,
 * its cheap goods, the margins at each adjacent city (perfect-info upper
 * bound minus tariff), and provisions needed. If the first margin isn't
 * obvious and achievable on day one, onboarding fails.
 *
 * Run: npx vite-node scripts/firstsession.ts
 */
import { game } from '../src/sim/game';
import { GOODS, GOOD_IDS } from '../src/data/goods';
import { effectiveRoadDays } from '../src/sim/events';

const SEEDS = ['alpha', 'beta', 'smoke-test-seed', 'merivan', 'the-road-remembers', 'weekly-2026-w38'];

for (const seed of SEEDS) {
  game.newGame(seed, 'Auditor');
  const s = game.need();
  const start = s.startCityId;
  const c0 = s.cities[start];
  console.log(`\n=== seed "${seed}" — start: ${c0.name} (${s.factions[c0.faction].name}, ${c0.biome}, pop ${c0.pop.toFixed(1)}k) ===`);

  const neighbors = s.roadOrder
    .map((rid) => s.roads[rid])
    .filter((r) => r.a === start || r.b === start)
    .map((r) => ({ road: r, other: r.a === start ? r.b : r.a }));

  // What can 300 sols buy here, and what is it worth next door (after tariff)?
  const opportunities: string[] = [];
  for (const g of GOOD_IDS) {
    const price = c0.price[g];
    if (c0.stock[g] < 4) continue;
    const maxUnits = Math.min(
      Math.floor(280 / price),
      Math.floor(120 / GOODS[g].space),
      Math.floor(c0.stock[g] * 0.5),
    );
    if (maxUnits < 2) continue;
    for (const { road, other } of neighbors) {
      const cN = s.cities[other];
      const fac = s.factions[cN.faction];
      if (fac.ideology.contraband.includes(g)) continue;
      const embargoed = fac.wars.some((w) => w.enemy === c0.faction);
      if (embargoed) continue;
      const tariff = cN.mods.fairUntil > s.day ? 0 : fac.ideology.tariff;
      const proceeds = maxUnits * cN.price[g] * (1 - tariff);
      const cost = maxUnits * price;
      const days = effectiveRoadDays(s, road);
      const profit = proceeds - cost;
      if (profit > 30) {
        opportunities.push(
          `${GOODS[g].name} ×${maxUnits} → ${cN.name} (${days}d, danger ${Math.round(road.danger)}): ${Math.round(cost)} → ~${Math.round(proceeds)} = +${Math.round(profit)} sols`,
        );
      }
    }
  }
  opportunities.sort((a, b) => Number(b.split('+')[1]) - Number(a.split('+')[1]));
  console.log(opportunities.slice(0, 6).join('\n') || '  ⚠ NO first-run margin over 30 sols — onboarding broken for this seed');
  const cheap = GOOD_IDS.filter((g) => c0.price[g] / GOODS[g].base < 0.9).map((g) => `${GOODS[g].name} ${c0.price[g].toFixed(1)}`);
  console.log(`  local bargains: ${cheap.join(', ') || 'none'}`);
  console.log(`  provisions/day: ${game.dailyProvisions().toFixed(1)} · grain price here: ${c0.price.grain.toFixed(1)}`);
}
