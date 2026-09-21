import type { Rng } from '../core/rng';
import { GOOD_IDS, GOODS } from '../data/goods';
import { FACTIONS } from '../data/factions';
import { EPITHETS, PERSON_NAMES } from '../data/names';
import { clamp } from '../core/util';
import {
  SIGNATURE_GOODS, cargoSpace, neighborsOf, roadBetween, roadsOf, trade, fencePrice,
} from './economy';
import type { Agent, FactionId, GameState, GoodId } from './types';
import { addNews } from './news';

/**
 * NPC merchants. Each agent plans on stale price knowledge, weighs risk
 * against greed, hauls real cargo along real roads, pays real tariffs, and can
 * be robbed, ruined, or killed — exactly like the player. Their arbitrage is
 * the economy's invisible hand: they close price gaps, so the player's edge
 * must come from *information*, timing, and nerve.
 *
 * Agents with `owner === 'player'` are your AI caravans: same brain, your purse.
 */

const KNOWLEDGE_HORIZON = 75; // days before an agent distrusts a remembered price
const POPULATION_TARGET = 40;

/** Dijkstra over the road graph; returns an inclusive city-id path. */
export function findPath(s: GameState, from: string, to: string, avoidDanger = false): string[] | null {
  if (from === to) return [from];
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  for (;;) {
    let u: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) { best = d; u = id; }
    }
    if (u === null) return null;
    if (u === to) break;
    visited.add(u);
    for (const r of roadsOf(s, u)) {
      const v = r.a === u ? r.b : r.a;
      const w = avoidDanger ? r.days * (1 + r.danger / 40) : r.days;
      const nd = best + w;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
      }
    }
  }
  const path = [to];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur);
    if (p === undefined) return null;
    cur = p;
    path.unshift(cur);
  }
  return path;
}

function isContrabandIn(s: GameState, faction: FactionId, good: GoodId): boolean {
  return s.factions[faction].ideology.contraband.includes(good);
}

/** During a war, the enemy's signature goods are embargoed — legal flow strangles. */
export function embargoes(s: GameState, sellerFaction: FactionId, cityFaction: FactionId): GoodId[] {
  const out: GoodId[] = [];
  for (const w of s.factions[cityFaction].wars) {
    if (w.enemy === sellerFaction) out.push(...SIGNATURE_GOODS[sellerFaction]);
  }
  return out;
}

function recordDeed(a: Agent, day: number, text: string): void {
  a.deeds.push({ day, text });
  if (a.deeds.length > 5) a.deeds.shift();
}

export function agentDayTick(s: GameState, rng: Rng): void {
  for (const a of s.agents) {
    if (!a.alive) continue;
    if (a.loc.kind === 'city') agentInCity(s, rng, a);
    else agentOnRoad(s, rng, a);
  }
  maintainPopulation(s, rng);
}

function agentInCity(s: GameState, rng: Rng, a: Agent): void {
  if (a.loc.kind !== 'city') return;
  const cityId = a.loc.cityId;
  const city = s.cities[cityId];

  // Witness today's prices — this is how agent knowledge stays fresh.
  a.knowledge[cityId] = { day: s.day, price: { ...city.price } };

  // Offload leftovers the market couldn't absorb yesterday.
  if (Object.keys(a.cargo).length > 0) sellCargo(s, rng, a, cityId);

  if (a.loc.restUntil > s.day) return;

  // Success breeds ambition: flush merchants reinvest — and the very rich
  // eventually retire to the exchange, keeping wealth circulating.
  if (a.gold > 7000 && !a.owner && rng.chance(0.006)) {
    retireAgent(s, a);
    addNews(s, { kind: 'agent', importance: 2, text: `${agentDisplayName(a)} has left the road for good — counting-house, courtyard, and a fig tree. ${Math.round(a.gold)} sols' worth of fig tree. Somewhere, a nephew inherits a wagon and an impossible standard.` });
    return;
  }
  if (a.gold > 3000 && !a.owner && rng.chance(0.05)) {
    a.gold -= 1500;
    a.capacity += 110;
    a.guards += 1;
    recordDeed(a, s.day, 'bought a second wagon and armed it');
    if (a.gold > 3000 && rng.chance(0.3)) {
      addNews(s, { kind: 'agent', importance: 1, text: `${agentDisplayName(a)} has doubled their outfit — a second wagon, another blade on the payroll. Competitors pretend not to notice.` });
    }
  }

  if (a.gold < 40 && cargoSpace(a.cargo) < 1) {
    retireAgent(s, a);
    return;
  }

  const plan = bestVenture(s, rng, a, cityId);
  if (!plan) {
    // No known-profitable venture: scout a neighbor to grow their map of
    // prices. Knowledge spreads through the network this way — and stale
    // knowledge is refreshed before the horizon forces them to travel blind.
    if (a.gold > 60 && rng.chance(0.7)) {
      const nbrs = neighborsOf(s, cityId);
      if (nbrs.length) {
        const scored = nbrs
          .map((n) => ({ n, age: s.day - (a.knowledge[n]?.day ?? -999) }))
          .sort((x, y) => y.age - x.age);
        const target = rng.chance(0.75) ? scored[0].n : rng.pick(scored).n;
        const road = roadBetween(s, cityId, target);
        if (road) {
          a.gold -= road.days * (1 + a.guards * 0.5);
          a.dest = target;
          a.planPath = [cityId, target];
          a.loc = {
            kind: 'road', roadId: road.id, from: cityId, to: target,
            startDay: s.day, arriveDay: s.day + road.days,
          };
          return;
        }
      }
    }
    a.loc.restUntil = s.day + rng.int(1, 3);
    return;
  }

  const embargoed = embargoes(s, a.faction, city.faction);
  let spent = 0;
  for (const leg of plan.buys) {
    if (embargoed.includes(leg.good) || (isContrabandIn(s, city.faction, leg.good) && a.risk <= 0.62)) continue;
    const res = trade(s, cityId, leg.good, leg.qty, 'buy', { kind: a.owner ? 'ai' : 'agent', faction: a.faction });
    if (res.qty > 0) {
      a.cargo[leg.good] = (a.cargo[leg.good] ?? 0) + res.qty;
      a.gold -= res.net;
      spent += res.net;
    }
  }
  if (spent <= 0) {
    a.loc.restUntil = s.day + rng.int(1, 3);
    return;
  }

  // Travel costs (provisions, wheelwrights, small bribes) leave with them.
  let routeDays = 0;
  for (let i = 0; i < plan.path.length - 1; i++) {
    const rr = roadBetween(s, plan.path[i], plan.path[i + 1]);
    if (rr) routeDays += rr.days;
  }
  a.gold -= routeDays * (1 + a.guards * 1.2);

  const road = roadBetween(s, cityId, plan.path[1])!;
  a.dest = plan.path[plan.path.length - 1];
  a.planPath = plan.path;
  a.loc = {
    kind: 'road', roadId: road.id, from: cityId, to: plan.path[1],
    startDay: s.day, arriveDay: s.day + road.days,
  };
  if (rng.chance(0.12) && a.tradeVolume > 2000) {
    recordDeed(a, s.day, `departed ${city.name} heavy-laden for ${s.cities[a.dest].name}`);
  }
}

/** Sell everything sellable here. Returns true if anything moved. */
function sellCargo(s: GameState, rng: Rng, a: Agent, cityId: string): boolean {
  const city = s.cities[cityId];
  let soldAny = false;
  for (const g of GOOD_IDS) {
    const qty = a.cargo[g] ?? 0;
    if (qty <= 0) continue;
    if (isContrabandIn(s, city.faction, g)) {
      // Risk-taking agents offload contraband to the fence.
      if (a.risk > 0.62) {
        const unit = fencePrice(s, city, g) * 0.9;
        a.gold += unit * qty;
        a.tradeVolume += unit * qty;
        delete a.cargo[g];
        soldAny = true;
        if (rng.chance(0.15)) recordDeed(a, s.day, `sold forbidden ${GOODS[g].name.toLowerCase()} quietly in ${city.name}`);
      }
      continue;
    }
    if (embargoes(s, a.faction, city.faction).includes(g)) continue;
    const res = trade(s, cityId, g, qty, 'sell', { kind: a.owner ? 'ai' : 'agent', faction: a.faction });
    if (res.qty > 0) {
      a.gold += res.net;
      a.tradeVolume += res.gross;
      const left = qty - res.qty;
      if (left > 0) a.cargo[g] = left;
      else delete a.cargo[g];
      soldAny = true;
      if (res.gross > 600 && rng.chance(0.2)) {
        recordDeed(a, s.day, `turned ${Math.round(res.gross)} sols of ${GOODS[g].name.toLowerCase()} in ${city.name}`);
      }
    }
  }
  // Player-owned caravan completing its loop: skim the profit home.
  if (a.owner === 'player' && soldAny) {
    const book = s.player.aiCaravans.find((b) => b.agentId === a.id);
    if (book && cityId === book.route[0]) {
      const profit = a.gold - book.float;
      if (profit > 0) {
        s.player.gold += profit;
        a.gold = book.float;
        book.totalProfit += profit;
        s.stats.aiCaravanProfit += profit;
        book.lastReport = s.day;
        addNews(s, {
          kind: 'player', importance: 1,
          text: `Your caravan “${book.name}” returns to ${city.name}: +${Math.round(profit)} sols banked.`,
        });
      }
    }
  }
  return soldAny;
}

interface Venture {
  path: string[];
  buys: { good: GoodId; qty: number }[];
  profit: number;
}

/** Evaluate the best arbitrage this agent can see with its imperfect knowledge. */
function bestVenture(s: GameState, rng: Rng, a: Agent, cityId: string): Venture | null {
  const here = s.cities[cityId];
  const spaceLeft = a.capacity - cargoSpace(a.cargo);
  if (spaceLeft < 4) return null;

  let best: Venture | null = null;
  const threshold = 45 + a.greed * 95;

  for (const destId of s.cityOrder) {
    if (destId === cityId) continue;
    const kn = a.knowledge[destId];
    if (!kn || s.day - kn.day > KNOWLEDGE_HORIZON) continue; // won't travel blind
    const staleDays = s.day - kn.day;
    const staleMult = 1 + Math.min(staleDays, 40) * 0.004 * (rng.float() - 0.3);
    const path = findPath(s, cityId, destId, a.risk > 0.6);
    if (!path || path.length < 2) continue;

    let routeDays = 0;
    let routeDanger = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const r = roadBetween(s, path[i], path[i + 1])!;
      routeDays += r.days;
      routeDanger = Math.max(routeDanger, r.danger);
    }
    const destCity = s.cities[destId];
    const tariff = s.factions[destCity.faction].ideology.tariff;

    for (const g of GOOD_IDS) {
      const contraband = isContrabandIn(s, destCity.faction, g);
      if (contraband && a.risk <= 0.62) continue;
      const estSell = (kn.price[g] ?? GOODS[g].base) * staleMult;
      const buyPrice = here.price[g];
      const margin = estSell * (contraband ? 0.95 : 1 - tariff) - buyPrice;
      if (margin <= buyPrice * 0.08) continue;
      const qtyBySpace = Math.floor(spaceLeft / GOODS[g].space);
      const qtyByGold = Math.floor((a.gold - 30) / buyPrice);
      const qtyByStock = Math.floor(Math.max(0, here.stock[g] - 5) * 0.5);
      const qty = Math.max(0, Math.min(qtyBySpace, qtyByGold, qtyByStock, 160));
      if (qty < 1) continue;
      const cargoVal = qty * buyPrice;
      const tripCost = routeDays * (2 + a.guards * 1.5) + routeDanger * 0.01 * cargoVal * a.risk * 2.2;
      const profit = margin * qty - tripCost;
      if (profit < threshold) continue;
      if (!best || profit > best.profit) best = { path, buys: [{ good: g, qty }], profit };
    }
  }

  // Sometimes combine a second good on the same wagon.
  if (best && rng.chance(0.3)) {
    const usedSpace = best.buys[0].qty * GOODS[best.buys[0].good].space;
    const spaceLeft2 = spaceLeft - usedSpace;
    const goldLeft = a.gold - best.buys[0].qty * here.price[best.buys[0].good];
    const kn = a.knowledge[best.path[best.path.length - 1]];
    if (kn && spaceLeft2 > 4 && goldLeft > 60) {
      const destCity = s.cities[best.path[best.path.length - 1]];
      for (const g of GOOD_IDS) {
        if (g === best.buys[0].good) continue;
        if (isContrabandIn(s, destCity.faction, g)) continue;
        const estSell = kn.price[g] ?? GOODS[g].base;
        const margin = estSell * (1 - s.factions[destCity.faction].ideology.tariff) - here.price[g];
        if (margin > here.price[g] * 0.15) {
          const qty = Math.min(Math.floor(spaceLeft2 / GOODS[g].space), Math.floor(goldLeft / here.price[g]), 60);
          if (qty >= 2) {
            best.buys.push({ good: g, qty });
            break;
          }
        }
      }
    }
  }
  return best;
}

function agentOnRoad(s: GameState, rng: Rng, a: Agent): void {
  const loc = a.loc;
  if (loc.kind !== 'road') return;
  const road = s.roads[loc.roadId];

  // Lodging at YOUR caravanserai: they pay you, they're safe, they gossip.
  if (road.caravanserai === 'player') {
    const fee = rng.range(2, 5) * (a.gold > 400 ? 1.4 : 1);
    const paid = Math.min(fee, a.gold * 0.08);
    a.gold -= paid;
    s.player.gold += paid;
    s.stats.caravanseraiIncome += paid;
    if (rng.chance(0.045)) {
      addNews(s, {
        kind: 'caravanserai', importance: 1, cityId: loc.to,
        text: `At your caravanserai on the ${s.cities[road.a].name}–${s.cities[road.b].name} road, ${agentDisplayName(a)} says: “${caravanseraiGossip(s, rng, a)}”`,
      });
    }
  } else if (rng.chance((road.danger / 100) * 0.3 * (1 - clamp(a.guards / 6, 0, 0.6)))) {
    banditHitAgent(s, rng, a, road.danger);
  }

  if (s.day >= loc.arriveDay) arriveAgent(s, rng, a, loc.to);
}

function arriveAgent(s: GameState, rng: Rng, a: Agent, cityId: string): void {
  const city = s.cities[cityId];
  a.knowledge[cityId] = { day: s.day, price: { ...city.price } };
  sellCargo(s, rng, a, cityId);

  // Multi-hop plan? Keep rolling.
  if (a.planPath && a.planPath.length > 2 && a.planPath[1] === cityId) {
    const rest = a.planPath.slice(1);
    const road = roadBetween(s, cityId, rest[1]);
    if (road && cargoSpace(a.cargo) > 1) {
      a.planPath = rest;
      a.loc = {
        kind: 'road', roadId: road.id, from: cityId, to: rest[1],
        startDay: s.day, arriveDay: s.day + road.days,
      };
      return;
    }
  }
  a.dest = null;
  a.planPath = undefined;
  a.loc = { kind: 'city', cityId, restUntil: s.day + rng.int(0, 2) };
}

function banditHitAgent(s: GameState, rng: Rng, a: Agent, danger: number): void {
  const strength = a.guards * 10 + rng.range(0, 20);
  const bandits = danger * 0.7 + rng.range(5, 25);
  if (strength > bandits) {
    recordDeed(a, s.day, 'fought off bandits on the road');
    if (rng.chance(0.15)) {
      addNews(s, { kind: 'agent', importance: 1, text: `${agentDisplayName(a)} drove off raiders on the open road — ${a.guards > 3 ? 'their guards are worth every copper, say the teamsters' : 'pure luck, swear the teamsters'}.` });
    }
    return;
  }
  const refCity = s.cities[a.loc.kind === 'road' ? a.loc.to : a.loc.cityId];
  const lostFraction = rng.range(0.4, 0.85);
  let lostValue = 0;
  for (const g of GOOD_IDS) {
    const qty = a.cargo[g] ?? 0;
    if (qty <= 0) continue;
    const lost = Math.floor(qty * lostFraction);
    if (lost > 0) {
      const left = qty - lost;
      if (left > 0) a.cargo[g] = left; else delete a.cargo[g];
      lostValue += lost * refCity.price[g];
    }
  }
  const goldLost = Math.min(a.gold * rng.range(0.1, 0.4), 300);
  a.gold -= goldLost;
  lostValue += goldLost;
  if (lostValue > 200) recordDeed(a, s.day, `was robbed of ${Math.round(lostValue)} sols worth of goods`);
  if (a.gold < 60 && cargoSpace(a.cargo) < 5 && rng.chance(0.2)) {
    killAgent(s, a, 'was left dead by the roadside after a bandit ambush');
  }
}

function retireAgent(s: GameState, a: Agent): void {
  a.alive = false;
  a.dest = null;
  if (a.tradeVolume > 3000 && !a.owner) {
    addNews(s, { kind: 'agent', importance: 1, text: `${agentDisplayName(a)} has hung up their scales — bankrupt after some ${Math.round(a.tradeVolume)} sols of trade. The tea-houses of ${s.cities[a.home].name} will be quieter.` });
  }
  if (a.owner === 'player') disbandAiCaravan(s, a, 'went bankrupt on the road');
}

export function killAgent(s: GameState, a: Agent, cause: string): void {
  a.alive = false;
  a.dest = null;
  addNews(s, {
    kind: 'agent', importance: a.tradeVolume > 4000 ? 2 : 1,
    text: `${agentDisplayName(a)} ${cause}.${a.tradeVolume > 4000 ? ' Half the exchange attended the funeral; the other half, the auction.' : ''}`,
  });
  if (a.owner === 'player') disbandAiCaravan(s, a, cause);
}

function disbandAiCaravan(s: GameState, a: Agent, cause: string): void {
  const idx = s.player.aiCaravans.findIndex((b) => b.agentId === a.id);
  if (idx < 0) return;
  const book = s.player.aiCaravans[idx];
  const salvage = Math.max(0, Math.min(a.gold, book.float));
  s.player.gold += salvage;
  s.player.aiCaravans.splice(idx, 1);
  addNews(s, { kind: 'player', importance: 2, text: `Your caravan “${book.name}” is no more — ${cause}. Salvaged ${Math.round(salvage)} sols of its float.` });
}

/** Young hopefuls replace the fallen; the exchange never sleeps for long. */
function maintainPopulation(s: GameState, rng: Rng): void {
  const alive = s.agents.filter((a) => a.alive && !a.owner).length;
  if (alive < POPULATION_TARGET && rng.chance(0.12)) {
    const fid = rng.pick(Object.keys(FACTIONS)) as FactionId;
    const homes = s.cityOrder.filter((c) => s.cities[c].faction === fid);
    if (!homes.length) return;
    const home = rng.pick(homes);
    const usedNames = new Set(s.agents.map((a) => a.name));
    const bank = PERSON_NAMES[fid];
    let name = `${rng.pick(bank.first)} ${rng.pick(bank.last)}`;
    for (let i = 0; i < 20 && usedNames.has(name); i++) name = `${rng.pick(bank.first)} ${rng.pick(bank.last)}`;
    s.agents.push({
      id: `a${++s.nextAgentNum}`,
      name,
      epithet: rng.chance(0.2) ? rng.pick(EPITHETS) : undefined,
      faction: fid, home,
      gold: rng.range(320, 800),
      capacity: rng.range(150, 260),
      cargo: {}, guards: rng.int(0, 2),
      risk: rng.range(0.35, 0.95), greed: rng.range(0.4, 0.95),
      loc: { kind: 'city', cityId: home, restUntil: s.day + rng.int(0, 2) },
      knowledge: { [home]: { day: s.day, price: { ...s.cities[home].price } } },
      dest: null, deeds: [], alive: true, tradeVolume: 0,
    });
  }
  // Prune long-dead records to keep state small (their stories live in the Chronicle).
  if (s.agents.length > 70) s.agents = s.agents.filter((a) => a.alive || a.owner === 'player');
}

export function agentDisplayName(a: Agent): string {
  return a.epithet ? `${a.name} ${a.epithet}` : a.name;
}

const GOSSIP = [
  'the {good} at {city} is priced by fools — fools in my favor',
  '{faction} granaries are lighter than the banners suggest',
  'a factor from {city} paid double for {good} and asked no questions',
  'the roads toward {city} smell of woodsmoke and bad intentions',
  'there is {good} cheap in {city}, if your wagon is fast and your conscience light',
  'war comes, mark my words. Buy {good} now, thank me at the funeral',
];

function caravanseraiGossip(s: GameState, rng: Rng, from: Agent): string {
  const heldGoods = GOOD_IDS.filter((g) => (from.cargo[g] ?? 0) > 0);
  const good = GOODS[rng.pick(heldGoods.length ? heldGoods : GOOD_IDS)].name.toLowerCase();
  const city = s.cities[rng.pick(s.cityOrder)].name;
  const faction = FACTIONS[rng.pick(Object.keys(FACTIONS)) as FactionId].name.replace(/^The /, '');
  return rng.pick(GOSSIP)
    .replace('{good}', good)
    .replace('{city}', city)
    .replace('{faction}', faction);
}
