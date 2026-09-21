import { Rng } from '../core/rng';
import { clamp } from '../core/util';
import { BUILDINGS, GOODS, GOOD_IDS, CONSUMPTION_PER_K, STOCK_BUFFER_DAYS } from '../data/goods';
import { FACTIONS, FACTION_BUILDING_POOL } from '../data/factions';
import { CITY_NAMES, PERSON_NAMES, EPITHETS } from '../data/names';
import { GUILD_RANKS } from '../data/guild';
import { priceTargetOf } from './economy';
import type {
  Agent, Biome, City, Faction, FactionId, GameState, GoodId, Road, RoadKind,
} from './types';

/**
 * World generation. A hand-authored macro layout (five homeland regions) with
 * per-seed jitter: city placement, road graph (MST + extra edges), initial
 * stocks/prices, faction relations and the roster of NPC merchants. The same
 * seed always yields the same Zeravesh.
 */

const REGION: Record<FactionId, { x: [number, number]; y: [number, number]; biome: Biome[] }> = {
  concord: { x: [0.06, 0.18], y: [0.26, 0.78], biome: ['coast'] },
  compact: { x: [0.30, 0.55], y: [0.07, 0.25], biome: ['forest'] },
  khanate: { x: [0.60, 0.93], y: [0.06, 0.30], biome: ['steppe'] },
  vault: { x: [0.64, 0.90], y: [0.42, 0.66], biome: ['mountain', 'highland'] },
  delta: { x: [0.30, 0.56], y: [0.70, 0.92], biome: ['delta'] },
};

const STARTING_RELATIONS: Record<string, number> = {
  'concord-delta': 40, 'concord-compact': 22, 'concord-vault': 12, 'concord-khanate': -14,
  'khanate-vault': -26, 'khanate-compact': -8, 'khanate-delta': -22,
  'vault-compact': 16, 'vault-delta': 2, 'compact-delta': 12,
};

interface PlacedCity {
  id: string; name: string; faction: FactionId; biome: Biome; x: number; y: number; capital: boolean;
}

function cityId(name: string): string {
  return 'c_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function terrainFactor(b1: Biome, b2: Biome): number {
  const f = (b: Biome) => (b === 'mountain' ? 1.4 : b === 'highland' ? 1.25 : b === 'forest' ? 1.15 : b === 'delta' ? 1.08 : b === 'steppe' ? 0.95 : 1.0);
  return Math.max(f(b1), f(b2));
}

function placeCities(rng: Rng): PlacedCity[] {
  const placed: PlacedCity[] = [];
  const minDist = 0.085;
  for (const fid of Object.keys(FACTIONS) as FactionId[]) {
    const region = REGION[fid];
    const count = FACTIONS[fid].cityCount;
    const names = rng.shuffled(CITY_NAMES[fid]);
    // Capital keeps its canonical name.
    const capitalName = FACTIONS[fid].capitalName;
    const ordered = names.includes(capitalName)
      ? [capitalName, ...names.filter((n) => n !== capitalName)]
      : names;
    for (let i = 0; i < count; i++) {
      let x = 0;
      let y = 0;
      for (let tries = 0; tries < 80; tries++) {
        x = rng.range(region.x[0], region.x[1]);
        y = rng.range(region.y[0], region.y[1]);
        const ok = placed.every((p) => Math.hypot(p.x - x, p.y - y) > minDist * (tries > 50 ? 0.6 : 1));
        if (ok) break;
      }
      const biome = i === 0 && region.biome.includes('mountain') ? 'mountain' : rng.pick(region.biome);
      placed.push({ id: cityId(ordered[i]), name: ordered[i], faction: fid, biome, x, y, capital: i === 0 });
    }
  }
  return placed;
}

function buildRoads(rng: Rng, cities: PlacedCity[]): { roads: { a: string; b: string; d: number }[] } {
  const pos = new Map(cities.map((c) => [c.id, c]));
  const dist = (a: PlacedCity, b: PlacedCity) =>
    Math.hypot(a.x - b.x, a.y - b.y) * terrainFactor(a.biome, b.biome);

  // MST (Prim) guarantees connectivity.
  const inTree = new Set<string>([cities[0].id]);
  const edges: { a: string; b: string; d: number }[] = [];
  while (inTree.size < cities.length) {
    let best: { a: string; b: string; d: number } | null = null;
    for (const idA of inTree) {
      for (const cB of cities) {
        if (inTree.has(cB.id)) continue;
        const d = dist(pos.get(idA)!, cB);
        if (!best || d < best.d) best = { a: idA, b: cB.id, d };
      }
    }
    edges.push(best!);
    inTree.add(best!.b);
  }
  const linked = (a: string, b: string) => edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

  // Extra edges: near pairs become roads with per-seed probability; every city
  // ends with degree >= 2 so no town is a dead end.
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const a = cities[i];
      const b = cities[j];
      if (linked(a.id, b.id)) continue;
      const d = dist(a, b);
      if (d < 0.34 && rng.chance(0.3)) edges.push({ a: a.id, b: b.id, d });
    }
  }
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  for (const c of cities) {
    if ((degree.get(c.id) ?? 0) < 2) {
      let best: { id: string; d: number } | null = null;
      for (const o of cities) {
        if (o.id === c.id || linked(c.id, o.id)) continue;
        const d = dist(c, o);
        if (!best || d < best.d) best = { id: o.id, d };
      }
      if (best) {
        edges.push({ a: c.id, b: best.id, d: best.d });
        degree.set(c.id, (degree.get(c.id) ?? 0) + 1);
        degree.set(best.id, (degree.get(best.id) ?? 0) + 1);
      }
    }
  }
  return { roads: edges };
}

function roadKindAndDays(rng: Rng, a: PlacedCity, b: PlacedCity, d: number): { kind: RoadKind; days: number; dangerBase: number } {
  const mountainish = a.biome === 'mountain' || b.biome === 'mountain' || a.biome === 'highland' || b.biome === 'highland';
  let kind: RoadKind = 'open';
  if (mountainish && d > 0.16) kind = 'pass';
  else if (a.biome === 'delta' || b.biome === 'delta') kind = 'river';
  else if (a.faction === 'khanate' && b.faction === 'khanate') kind = 'open';
  const days = clamp(Math.round(d * 24) + (kind === 'pass' ? 1 : 0) + (rng.chance(0.15) ? 1 : 0), 1, 7);
  const dangerByFaction: Record<FactionId, number> = {
    khanate: 16, compact: 12, delta: 9, vault: 8, concord: 7,
  };
  let dangerBase = (dangerByFaction[a.faction] + dangerByFaction[b.faction]) / 2 + rng.range(-3, 5);
  if (kind === 'pass') dangerBase += 5;
  if (a.faction !== b.faction) dangerBase += 3; // border roads are lonelier
  return { kind, days, dangerBase: clamp(Math.round(dangerBase), 4, 32) };
}

function makeCityBuildings(rng: Rng, pc: PlacedCity, pop: number): string[] {
  const buildings: string[] = [];
  const fid = pc.faction;
  const add = (id: string, n: number) => { for (let i = 0; i < n; i++) buildings.push(id); };

  // Breadline: every city farms somewhat; the Delta farms hugely.
  let farms = Math.max(1, Math.ceil(pop / 10));
  if (fid === 'delta') farms += 2;
  if (fid === 'khanate') farms = Math.max(1, farms - 1);
  if (pc.biome === 'mountain') farms = Math.max(1, farms - 1);
  add('farm', farms);

  if (pc.capital) { add('walls', 1); add('market_house', 1); }
  if (pop > 22 && rng.chance(0.7)) add('walls', 1);
  if (pop > 18 && rng.chance(0.6)) add('market_house', 1);
  if ((fid === 'delta' || pc.capital) && rng.chance(0.8)) add('granary', 1);
  if (fid === 'concord' && pc.biome === 'coast') add('fishery', 1 + (rng.chance(0.5) ? 1 : 0));

  // Common crafts: every town weaves and salts; most have a smith and a
  // sawpit; wine is made nearly everywhere the Vault does not forbid it.
  // Cross-continent trade should flow in SURPLUSES and MONOPOLIES, not in
  // goods every town can make for itself.
  add('weavery', 1 + (fid === 'delta' ? rng.int(0, 2) : 0));
  if (pc.biome === 'coast' || pc.biome === 'steppe' || pc.biome === 'delta' || rng.chance(0.5)) add('saltworks', 1);
  if (fid !== 'compact') add('workshop', 1);
  if (fid !== 'compact' && (pc.biome === 'forest' || rng.chance(0.3))) add('sawmill', 1);
  if (fid !== 'vault' && ((fid === 'concord' || fid === 'delta') ? rng.chance(0.7) : rng.chance(0.25))) add('orchard', 1);

  // Signature industry: capitals get the full set, towns get a taste.
  const sig = FACTIONS[fid].signatureBuildings;
  for (const b of sig) {
    if (pc.capital) add(b, b === 'market_house' || b === 'walls' || b === 'granary' ? 0 : 2);
    else if (rng.chance(0.65)) add(b, 1);
  }
  // A little variety from the regional pool.
  const pool = FACTION_BUILDING_POOL[fid].filter((b) => !sig.includes(b) && !['walls', 'market_house', 'granary'].includes(b));
  for (const b of pool) if (rng.chance(0.4)) add(b, 1);
  if (rng.chance(0.3)) add('ruins', 1);
  return buildings.filter((b) => BUILDINGS[b]);
}

function makeAgentName(rng: Rng, faction: FactionId, used: Set<string>): string {
  const bank = PERSON_NAMES[faction];
  for (let i = 0; i < 40; i++) {
    const first = rng.pick(bank.first);
    const last = bank.patronymic && rng.chance(0.5)
      ? bank.patronymic((arr) => rng.pick(arr), rng.int(0, 1))
      : rng.pick(bank.last);
    const full = `${first} ${last}`;
    if (!used.has(full)) {
      used.add(full);
      return full;
    }
  }
  const fallback = `${rng.pick(bank.first)} ${rng.pick(bank.last)} ${used.size}`;
  used.add(fallback);
  return fallback;
}

function makeRuler(rng: Rng, fid: FactionId, used: Set<string>): string {
  return `${FACTIONS[fid].rulerTitle} ${makeAgentName(rng, fid, used)}`;
}

export function generateWorld(seed: string, playerName: string, weekly = false): GameState {
  const rng = new Rng(seed);
  const usedNames = new Set<string>();
  const placed = placeCities(rng);

  const cities: Record<string, City> = {};
  const cityOrder = placed.map((p) => p.id);

  // --- Factions -----------------------------------------------------------
  const factions = {} as Record<FactionId, Faction>;
  for (const fid of Object.keys(FACTIONS) as FactionId[]) {
    const tpl = FACTIONS[fid];
    const rel = {} as Record<FactionId, number>;
    const flow = {} as Record<FactionId, number>;
    const grievance = {} as Record<FactionId, number>;
    for (const other of Object.keys(FACTIONS) as FactionId[]) {
      if (other === fid) continue;
      const key = [fid, other].sort().join('-');
      rel[other] = clamp((STARTING_RELATIONS[key] ?? 0) + rng.int(-12, 12), -60, 70);
      flow[other] = 0;
      grievance[other] = 0;
    }
    const capital = placed.find((p) => p.faction === fid && p.capital)!;
    factions[fid] = {
      id: fid, name: tpl.name, epithet: tpl.epithet, color: tpl.color,
      ruler: makeRuler(rng, fid, usedNames),
      capital: capital.id,
      ideology: { tariff: tpl.tariff, contraband: tpl.contraband as GoodId[], aggression: tpl.aggression, desc: tpl.desc },
      treasury: tpl.startingTreasury + rng.int(-800, 800),
      military: tpl.startingMilitary + rng.int(-8, 8),
      relations: rel, wars: [], tradeFlow: flow, grievance,
    };
  }

  // --- Cities -------------------------------------------------------------
  for (const pc of placed) {
    const popBase = pc.capital ? rng.range(26, 40) : rng.range(8, 22);
    const pop = Math.round(popBase * (pc.faction === 'delta' ? 1.2 : 1) * 10) / 10;
    const buildings = makeCityBuildings(rng, pc, pop);
    const stock = {} as Record<GoodId, number>;
    const price = {} as Record<GoodId, number>;
    const history = {} as Record<GoodId, number[]>;
    const absorbed = {};
    const dispensed = {};

    const lawBase: Record<FactionId, number> = { vault: 76, concord: 70, compact: 62, delta: 52, khanate: 38 };
    const city: City = {
      id: pc.id, name: pc.name, faction: pc.faction, biome: pc.biome, x: pc.x, y: pc.y,
      pop, buildings, stock, price, history, absorbed, dispensed,
      law: clamp(lawBase[pc.faction] + rng.int(-8, 8), 20, 95),
      unrest: rng.int(2, 18),
      garrison: buildings.filter((b) => b === 'walls').length * 60 + Math.round(pop * 1.4),
      mods: {
        plagueUntil: 0, festivalUntil: 0, droughtUntil: 0, boomUntil: 0,
        besiegedBy: null, siegeUntil: 0, fairUntil: 0, fireUntil: 0,
      },
      fenceMult: rng.range(0.85, 1.15),
    };

    // A skeleton state so priceTargetOf can run during initialization.
    const partial = { day: 1, flags: {}, cities: { [pc.id]: city }, factions } as unknown as GameState;
    const producedHere = new Set<GoodId>();
    for (const b of buildings) {
      const def = BUILDINGS[b];
      if (def?.produces) for (const g of Object.keys(def.produces)) producedHere.add(g as GoodId);
    }
    for (const g of GOOD_IDS) {
      const target = Math.max(stockTargetInit(city, g), 2);
      if (FACTIONS[pc.faction].contraband.includes(g)) {
        city.stock[g] = 0;
      } else if (producedHere.has(g)) {
        city.stock[g] = target * rng.range(1.3, 2.4);
      } else {
        city.stock[g] = target * rng.range(0.7, 1.3);
      }
      city.price[g] = priceTargetOf(partial, city, g) * rng.range(0.92, 1.08);
      city.history[g] = [city.price[g]];
    }
    cities[pc.id] = city;
  }

  // --- Roads --------------------------------------------------------------
  const roads: Record<string, Road> = {};
  const roadOrder: string[] = [];
  const { roads: edges } = buildRoads(rng, placed);
  const posById = new Map(placed.map((p) => [p.id, p]));
  for (const e of edges) {
    const a = posById.get(e.a)!;
    const b = posById.get(e.b)!;
    const { kind, days, dangerBase } = roadKindAndDays(rng, a, b, e.d);
    const id = `r_${a.id.slice(2)}__${b.id.slice(2)}`;
    roads[id] = {
      id, a: a.id, b: b.id, kind, days, dangerBase, danger: dangerBase,
      banditsUntil: 0, stormUntil: 0, daysMod: 0, daysModUntil: 0, caravanserai: null,
    };
    roadOrder.push(id);
  }

  // --- Agents -------------------------------------------------------------
  const agents: Agent[] = [];
  const agentCounts: Record<FactionId, number> = { concord: 9, delta: 9, compact: 8, vault: 7, khanate: 7 };
  let agentNum = 0;
  for (const fid of Object.keys(agentCounts) as FactionId[]) {
    const homes = placed.filter((p) => p.faction === fid);
    for (let i = 0; i < agentCounts[fid]; i++) {
      const home = homes[i % homes.length];
      const rich = rng.chance(0.25);
      agents.push({
        id: `a${++agentNum}`,
        name: makeAgentName(rng, fid, usedNames),
        epithet: rng.chance(0.35) ? rng.pick(EPITHETS) : undefined,
        faction: fid,
        home: home.id,
        gold: rich ? rng.range(1200, 2800) : rng.range(260, 1100),
        capacity: rng.range(150, 420),
        cargo: {},
        guards: fid === 'khanate' ? rng.int(1, 5) : fid === 'vault' ? rng.int(0, 4) : rng.int(0, 3),
        risk: rng.range(0.2, 0.9),
        greed: rng.range(0.3, 0.9),
        loc: { kind: 'city', cityId: home.id, restUntil: 1 + rng.int(0, 3) },
        knowledge: { [home.id]: { day: 1, price: { ...cities[home.id].price } } },
        dest: null,
        deeds: [],
        alive: true,
        tradeVolume: 0,
      });
    }
  }

  // --- Player -------------------------------------------------------------
  const rep = {} as Record<FactionId, number>;
  for (const fid of Object.keys(FACTIONS) as FactionId[]) rep[fid] = 6;
  rep.delta = 14; // the homeland of your late uncle

  const startCity = pickStartCity(rng, cities, roads);
  const intel: GameState['player']['intel'] = {};
  const sc = cities[startCity];
  intel[startCity] = { day: 1, price: { ...sc.price } };
  for (const rid of roadOrder) {
    const r = roads[rid];
    const other = r.a === startCity ? r.b : r.b === startCity ? r.a : null;
    if (other) intel[other] = { day: 1, price: { ...cities[other].price } };
  }

  const player: GameState['player'] = {
    name: playerName || 'The Heir',
    epithet: 'the Young',
    gold: 300, debt: 0, debtDueDay: 0,
    loc: { kind: 'city', cityId: startCity },
    pace: 'steady',
    cargo: {}, cargoCost: {}, provisions: 8,
    capacity: GUILD_RANKS[0].capacityBonus + 120,
    guards: 0, crew: [], upgrades: {},
    intel, storage: {}, rep, guildRank: 1, fame: 0,
    caravanserais: [], warehouses: [], aiCaravans: [],
    contractsDone: 0, contractsFailed: 0, epithetPool: [],
    banned: {}, luck: 1,
  };

  const state: GameState = {
    version: 3,
    seed,
    day: 1,
    rngState: rng.getState(),
    cities, cityOrder, roads, roadOrder, factions, agents, player,
    contracts: [],
    news: [],
    chronicles: [],
    stats: {
      daysPlayed: 0, distanceTraveled: 0, tradeProfit: 0, totalBought: 0, totalSold: 0,
      tariffsPaid: 0, lostToBandits: 0, banditsBeaten: 0, contractsDone: 0, contractsFailed: 0,
      rumorsBought: 0, caravanseraiIncome: 0, aiCaravanProfit: 0, bestSingleTrade: 0,
      goodsMoved: {}, citiesVisited: [startCity], ambushesSurvived: 0, smuggledRuns: 0,
      caughtSmuggling: 0, chronicleMentions: 0, warProfits: 0,
    },
    ambitions: {},
    pending: [],
    startCityId: startCity,
    tutorial: 0,
    flags: { startCity: 0 },
    nextAgentNum: agentNum,
    weekly,
    settings: {
      sound: true, music: true, reducedMotion: false, autosave: true,
      confirmTrades: true, numberTicking: true,
    },
  };
  // Seed a few worldbuilding news items so the ticker is never empty.
  pushSeedNews(state, rng, placed);

  // Initial contract boards.
  return state;
}

function pickStartCity(rng: Rng, cities: Record<string, City>, roads: Record<string, Road>): string {
  // The beginner's town must offer a real first margin: something cheap and
  // stocked that 280 sols and a 120-space wagon can carry to a neighbor
  // within five safe-ish days for a solid profit after tariffs. Onboarding
  // is not allowed to depend on the player being clever about a dead end.
  const neighborsOf = (id: string): Road[] =>
    Object.values(roads).filter((r) => r.a === id || r.b === id);
  const bestFirstMargin = (id: string): number => {
    const c = cities[id];
    let top = 0;
    for (const g of GOOD_IDS) {
      const price = c.price[g];
      if (price <= 0 || c.stock[g] < 4) continue;
      const units = Math.min(
        Math.floor(280 / price),
        Math.floor(120 / GOODS[g].space),
        Math.floor(c.stock[g] * 0.5),
      );
      if (units < 2) continue;
      for (const r of neighborsOf(id)) {
        const o = cities[r.a === id ? r.b : r.a];
        const fac = FACTIONS[o.faction];
        if (fac.contraband.includes(g)) continue;
        if (r.days > 5 || r.dangerBase > 45) continue;
        const proceeds = units * o.price[g] * (1 - fac.tariff);
        top = Math.max(top, proceeds - units * price);
      }
    }
    return top;
  };
  const scored = Object.keys(cities)
    .map((id) => ({ id, m: bestFirstMargin(id), deg: neighborsOf(id).length }))
    .filter((x) => x.deg >= 2)
    .sort((a, b) => b.m - a.m || b.deg - a.deg);
  const good = scored.filter((x) => x.m >= 90);
  const pool = good.length >= 3 ? good.slice(0, 4) : scored.slice(0, 2);
  return (pool[0] ? rng.pick(pool) : scored[0]).id;
}

function stockTargetInit(c: City, good: GoodId): number {
  const d = (CONSUMPTION_PER_K[good] ?? 0) * c.pop;
  let t = Math.max(d * STOCK_BUFFER_DAYS, GOODS[good].tier === 'staple' ? c.pop * 0.5 : 4);
  if (good === 'grain' && c.buildings.includes('granary')) t *= 1.6;
  return t;
}

function pushSeedNews(state: GameState, rng: Rng, placed: PlacedCity[]): void {
  const items: [string, GameState['news'][number]['kind']][] = [
    [`The caravans of ${rng.pick(placed.filter((p) => p.faction === 'delta')).name} move again; the Council-Speaker promises cheap grain "for friends of the Delta".`, 'market'],
    [`Riders of the Ashen Khanate were seen counting horses on the eastern grass. Nobody agrees on what that means.`, 'omen'],
    [`Astronomers of the Celestial Vault report the silkworms hatching early. Silk factors pretend not to be delighted.`, 'market'],
    [`Your uncle's wagon is yours now: one axle's worth of rust, two mules with opinions, and a letter you have read eleven times.`, 'player'],
  ];
  items.forEach(([text, kind], i) => {
    state.news.push({ id: `seed_${i}`, day: 1, kind, text, importance: i === 3 ? 2 : 1 });
  });
}
