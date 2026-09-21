import { GOODS, GOOD_IDS, BUILDINGS, CONSUMPTION_PER_K, STOCK_BUFFER_DAYS, HISTORY_LEN } from '../data/goods';
import { FACTIONS } from '../data/factions';
import { rankDef } from '../data/guild';
import { clamp, sum } from '../core/util';
import { seasonOfDay } from '../core/calendar';
import type { City, Faction, FactionId, GameState, GoodId, Road, Season } from './types';

/**
 * The economy engine. Prices are never scripted: every city computes demand
 * (population × season × events) and production (buildings × season × events),
 * stocks integrate the difference plus every merchant's actual trades, and
 * prices chase a scarcity-driven target with market inertia. Player and NPC
 * agents call the exact same trade primitives — one rulebook for everyone.
 */

/** Goods each faction is famous for producing — embargoed during wars. */
export const SIGNATURE_GOODS: Record<FactionId, GoodId[]> = {
  concord: ['spice'],
  khanate: ['horses'],
  vault: ['silk', 'porcelain', 'relics'],
  compact: ['iron', 'tools'],
  delta: ['wine', 'cloth'],
};

export function getCity(s: GameState, id: string): City {
  return s.cities[id];
}

export function roadBetween(s: GameState, a: string, b: string): Road | undefined {
  for (const id of s.roadOrder) {
    const r = s.roads[id];
    if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) return r;
  }
  return undefined;
}

export function roadsOf(s: GameState, cityId: string): Road[] {
  return s.roadOrder.map((id) => s.roads[id]).filter((r) => r.a === cityId || r.b === cityId);
}

export function neighborsOf(s: GameState, cityId: string): string[] {
  return roadsOf(s, cityId).map((r) => (r.a === cityId ? r.b : r.a));
}

export function atWar(f: Faction, other: FactionId): boolean {
  return f.wars.some((w) => w.enemy === other);
}

export function cityIsBesieged(c: City, day: number): boolean {
  return !!c.mods.besiegedBy && c.mods.siegeUntil > day;
}

/** Seasonal multipliers on production, per building family. */
function seasonProductionMult(buildingId: string, season: Season): number {
  switch (season) {
    case 'spring':
      if (buildingId === 'farm') return 0.7;
      if (buildingId === 'orchard') return 0.6;
      if (buildingId === 'stud') return 1.3;
      return 1;
    case 'summer':
      if (buildingId === 'farm') return 1.0;
      if (buildingId === 'sericulture') return 1.4;
      if (buildingId === 'orchard') return 1.1;
      return 1;
    case 'autumn':
      if (buildingId === 'farm') return 2.0; // harvest
      if (buildingId === 'orchard') return 1.5;
      if (buildingId === 'sawmill') return 1.2;
      return 1;
    case 'winter':
      if (buildingId === 'farm') return 0.1;
      if (buildingId === 'orchard') return 0.2;
      if (buildingId === 'sericulture') return 0.3;
      if (buildingId === 'ironmine') return 0.7;
      if (buildingId === 'sawmill') return 0.7;
      if (buildingId === 'kiln') return 0.8;
      if (buildingId === 'fishery') return 0.8;
      if (buildingId === 'spice_docks') return 0.85;
      if (buildingId === 'stud') return 0.8;
      return 1;
  }
}

/** Seasonal multipliers on demand. */
function seasonDemandMult(good: GoodId, season: Season): number {
  switch (season) {
    case 'winter':
      if (good === 'grain') return 1.1;
      if (good === 'timber') return 1.25;
      if (good === 'wine') return 1.15;
      if (good === 'horses') return 0.8;
      return 1;
    case 'spring':
      if (good === 'horses') return 1.25; // campaigning season opens
      if (good === 'iron') return 1.15;
      if (good === 'grain') return 1.08; // pre-harvest thinning
      return 1;
    case 'summer':
      if (good === 'wine') return 1.2;
      if (good === 'spice') return 1.1;
      if (good === 'grain') return 0.95;
      return 1;
    case 'autumn':
      if (good === 'grain') return 0.9; // harvest plenty
      if (good === 'cloth') return 1.15;
      if (good === 'timber') return 1.15;
      return 1;
  }
}

/** Demand per day for one good, after every modifier. The soul of price signals. */
export function demandFor(s: GameState, c: City, good: GoodId): number {
  const season = seasonOfDay(s.day);
  const fac = s.factions[c.faction];
  let d = (CONSUMPTION_PER_K[good] ?? 0) * c.pop;

  // Contraband has no open-market demand (it flows through fences instead).
  if (fac.ideology.contraband.includes(good)) return 0;

  d *= seasonDemandMult(good, season);

  // Garrisons ride: remounts and cavalry upkeep are the standing market for
  // horses and the reason border towns always pay a little more.
  if (good === 'horses') d += c.garrison * 0.001;

  const besieged = cityIsBesieged(c, s.day);
  const war = fac.wars.length > 0;
  if (besieged) {
    if (good === 'grain' || good === 'iron') d *= 2.2;
    else if (good === 'horses' || good === 'salt') d *= 1.8;
    else if (good === 'wine' || good === 'spice' || good === 'silk' || good === 'porcelain' || good === 'relics') d *= 0.25;
  } else if (war) {
    if (good === 'iron') d *= 1.6;
    else if (good === 'horses') d *= 1.5;
    else if (good === 'grain') d *= 1.15;
    else if (good === 'spice' || good === 'silk' || good === 'porcelain' || good === 'relics') d *= 0.6;
  }

  if (c.mods.festivalUntil > s.day) {
    if (good === 'wine') d *= 3;
    else if (good === 'grain' || good === 'spice') d *= 1.6;
    else if (good === 'relics') d *= 2;
  }
  if (c.mods.plagueUntil > s.day) d *= 0.6;
  if (c.unrest > 60) {
    if (good === 'grain') d *= 1.15; // hoarding
    if (GOODS[good].tier === 'luxury' || GOODS[good].tier === 'treasure') d *= 0.5;
  }
  // Holy prophecies (event flag) triple relic demand in Vault cities.
  if ((s.flags['prophecy_' + c.id] ?? 0) > s.day && good === 'relics') d *= 3;

  return d;
}

/** Total demand vector for a city per day. */
function cityDemand(s: GameState, c: City): Record<GoodId, number> {
  const out = {} as Record<GoodId, number>;
  for (const g of GOOD_IDS) out[g] = demandFor(s, c, g);
  return out;
}

/**
 * Production per day. Workshop chains consume real stock: no iron, no tools.
 * Returns { produced, consumedInputs }.
 */
function cityProduction(
  s: GameState,
  c: City,
): { produced: Partial<Record<GoodId, number>>; consumed: Partial<Record<GoodId, number>> } {
  const season = seasonOfDay(s.day);
  const produced: Partial<Record<GoodId, number>> = {};
  const consumed: Partial<Record<GoodId, number>> = {};
  const besieged = cityIsBesieged(c, s.day);

  for (const bid of c.buildings) {
    const def = BUILDING(bid);
    if (!def) continue;
    let mult = seasonProductionMult(bid, season);
    if (besieged) mult *= 0.3;
    if (c.mods.plagueUntil > s.day) mult *= 0.65;
    if (c.mods.droughtUntil > s.day && (bid === 'farm' || bid === 'orchard')) mult *= 0.3;
    if (c.mods.fireUntil > s.day) mult *= 0.5;
    if (c.mods.boomUntil > s.day && (bid === 'ironmine' || bid === 'ruins')) mult *= 2;
    if ((s.flags['blight_' + c.id] ?? 0) > s.day && bid === 'sericulture') mult *= 0.35;
    if ((s.flags['horseplague_' + c.id] ?? 0) > s.day && bid === 'stud') mult *= 0.3;
    if (mult <= 0.02) continue;

    // Chain inputs are drawn from city stock; output scales to what's available.
    let chainMult = 1;
    if (def.consumes) {
      for (const [g, amtRaw] of Object.entries(def.consumes)) {
        const amt = (amtRaw as number) * mult;
        const avail = c.stock[g as GoodId] ?? 0;
        chainMult = Math.min(chainMult, avail / Math.max(amt, 1e-6));
      }
      if (chainMult < 0.05) continue;
      for (const [g, amtRaw] of Object.entries(def.consumes)) {
        consumed[g as GoodId] = (consumed[g as GoodId] ?? 0) + (amtRaw as number) * mult * chainMult;
      }
    }
    if (def.produces) {
      for (const [g, amtRaw] of Object.entries(def.produces)) {
        produced[g as GoodId] = (produced[g as GoodId] ?? 0) + (amtRaw as number) * mult * chainMult;
      }
    }
  }
  return { produced, consumed };
}

function BUILDING(id: string) {
  return BUILDINGS[id];
}

/** Target stock: how much a city "wants" to hold. Scarcity = stock/target. */
export function stockTarget(s: GameState, c: City, good: GoodId): number {
  const d = demandFor(s, c, good);
  const tier = GOODS[good].tier;
  const floor = tier === 'staple' ? c.pop * 0.5 : tier === 'craft' ? 10 : tier === 'luxury' ? 12 : 8;
  let target = Math.max(d * STOCK_BUFFER_DAYS, floor);
  if (good === 'grain' && c.buildings.includes('granary')) target *= 1.6;
  return target;
}

/** The price a city's market is gravitating toward right now. */
export function priceTargetOf(s: GameState, c: City, good: GoodId): number {
  const def = GOODS[good];
  const target = stockTarget(s, c, good);
  const stock = Math.max(c.stock[good], 0.5);
  const scarcityMult = clamp(Math.pow(target / stock, def.elasticity), 0.4, 3.6);
  // Illegal goods keep a shadow reference (fences use it); no open market.
  const fac = s.factions[c.faction];
  if (fac.ideology.contraband.includes(good)) return def.base * 0.9;
  // Embargoed wartime goods get a scarcity floor: legal supply is strangled.
  let embargoMult = 1;
  for (const w of fac.wars) {
    if (SIGNATURE_GOODS[w.enemy].includes(good)) embargoMult = 1.6;
  }
  return def.base * scarcityMult * embargoMult;
}

/** Recompute the smoothed market price for one good in one city. */
export function tickPrice(s: GameState, c: City, good: GoodId, rngFloat: number): void {
  const target = priceTargetOf(s, c, good);
  const alpha = 0.22; // market inertia
  let p = c.price[good] + (target - c.price[good]) * alpha;
  p *= 1 + (rngFloat - 0.5) * 2 * GOODS[good].volatility;
  p = Math.max(p, GOODS[good].base * 0.25);
  c.price[good] = p;
  const h = c.history[good];
  h.push(p);
  if (h.length > HISTORY_LEN) h.shift();
}

/** How many units the market will still ABSORB from sellers today. */
function absorbCapLeft(s: GameState, c: City, good: GoodId): number {
  const d = demandFor(s, c, good);
  const fac = s.factions[c.faction];
  const fair = c.mods.fairUntil > s.day;
  let cap = d * 3 + 5 + c.pop * 0.5;
  if (c.buildings.includes('market_house')) cap *= 1.8;
  if (fair) cap *= 2.5;
  if (fac.ideology.contraband.includes(good)) cap = 0; // fences only
  for (const w of fac.wars) if (SIGNATURE_GOODS[w.enemy].includes(good)) cap *= 0.15; // embargo strangles legal flow
  return Math.max(0, cap - (c.absorbed[good] ?? 0));
}

/** How many units the market will still DISPENSE to buyers today. */
export function dispenseCapLeft(s: GameState, c: City, good: GoodId): number {
  const d = demandFor(s, c, good);
  let cap = d * 2 + 5 + c.pop * 0.6;
  if (c.buildings.includes('market_house')) cap *= 1.6;
  const fac = s.factions[c.faction];
  if (fac.ideology.contraband.includes(good)) cap = 0;
  for (const w of fac.wars) if (SIGNATURE_GOODS[w.enemy].includes(good)) cap *= 0.15;
  // The city never sells below its safety reserve (5 days of need).
  cap = Math.min(cap, Math.max(0, c.stock[good] - d * 5));
  return Math.max(0, cap - (c.dispensed[good] ?? 0));
}

/** Effective import tariff rate for a seller, given identity. */
export function tariffRate(s: GameState, c: City, sellerFaction: FactionId | 'player', isPlayer: boolean): number {
  let rate = FACTIONS[c.faction].tariff;
  if (c.mods.fairUntil > s.day) return 0;
  if (isPlayer) {
    const rep = s.player.rep[c.faction] ?? 0;
    if (rep >= 90) rate *= 0.4;
    else if (rep >= 70) rate *= 0.5;
    else if (rep >= 40) rate *= 0.75;
    if (rankDef(s.player.guildRank).rank >= 6) rate *= 0.9;
    if (crewBonus(s, 'accountant') > 0) rate *= 0.9;
    if (sellerFaction !== c.faction && crewBonus(s, 'linguist') > 0) rate *= 0.8;
  }
  return clamp(rate, 0, 0.5);
}

/** Presence check for a crew role (1 if employed, else 0). */
export function crewBonus(s: GameState, role: string): number {
  return s.player.crew.some((m) => m.role === role) ? 1 : 0;
}

/** Fence price for contraband in a city (the black market always buys). */
export function fencePrice(s: GameState, c: City, good: GoodId): number {
  let mult = c.fenceMult;
  if (crewBonus(s, 'smuggler') > 0) mult *= 1.15;
  // War embargoes make fences hungry for the enemy's signature goods.
  const fac = s.factions[c.faction];
  for (const w of fac.wars) if (SIGNATURE_GOODS[w.enemy].includes(good)) mult *= 1.35;
  return GOODS[good].base * mult;
}

export interface TradeActor {
  kind: 'player' | 'agent' | 'ai';
  faction: FactionId | 'player';
}

export interface TradeResult {
  qty: number;
  gross: number;
  tariff: number;
  net: number;
  unitPrice: number;
}

/**
 * The single trade primitive used by everyone.
 * side 'sell'  = actor sells into the city (city absorbs; tariff applies).
 * side 'buy'   = actor buys from the city (city dispenses).
 * Quantity is clamped by liquidity and stock; prices move immediately.
 */
export function trade(
  s: GameState,
  cityId: string,
  good: GoodId,
  qty: number,
  side: 'buy' | 'sell',
  actor: TradeActor,
): TradeResult {
  const c = s.cities[cityId];
  const zero: TradeResult = { qty: 0, gross: 0, tariff: 0, net: 0, unitPrice: c.price[good] };

  if (side === 'sell') {
    const cap = absorbCapLeft(s, c, good);
    const q = Math.min(qty, cap);
    if (q <= 0) return zero;
    const unit = c.price[good];
    const gross = unit * q;
    const rate = tariffRate(s, c, actor.faction, actor.kind === 'player');
    const tariff = gross * rate;
    c.stock[good] += q;
    c.absorbed[good] = (c.absorbed[good] ?? 0) + q;
    s.factions[c.faction].treasury += tariff;
    // Cross-faction trade warms relations (the peace loop). The player is
    // faction-less; their bridging is tracked separately in game.ts.
    if (actor.faction !== 'player' && actor.faction !== c.faction) {
      addTradeFlow(s, c.faction, actor.faction, gross);
    }
    // Immediate price response to the trade itself.
    tickPriceAfterTrade(s, c, good);
    return { qty: q, gross, tariff, net: gross - tariff, unitPrice: unit };
  } else {
    const cap = dispenseCapLeft(s, c, good);
    const q = Math.min(qty, cap);
    if (q <= 0) return zero;
    const unit = c.price[good];
    const gross = unit * q;
    c.stock[good] -= q;
    c.dispensed[good] = (c.dispensed[good] ?? 0) + q;
    tickPriceAfterTrade(s, c, good);
    return { qty: q, gross, tariff: 0, net: gross, unitPrice: unit };
  }
}

/** After a large trade the price jumps partway toward the new target at once. */
function tickPriceAfterTrade(s: GameState, c: City, good: GoodId): void {
  const target = priceTargetOf(s, c, good);
  c.price[good] = clamp(c.price[good] + (target - c.price[good]) * 0.5, GOODS[good].base * 0.25, GOODS[good].base * 6);
}

function addTradeFlow(s: GameState, f1: FactionId, f2: FactionId, value: number): void {
  if (f1 === f2) return;
  s.factions[f1].tradeFlow[f2] += value * 0.5;
  s.factions[f2].tradeFlow[f1] += value * 0.5;
}

/** "Fair value" shown in UI: the long-run reference price for a good here. */
export function fairValue(s: GameState, c: City, good: GoodId): number {
  return priceTargetOf(s, c, good);
}

/** Deal quality readout: how far below/above fair value the current price is. */
export function dealQuality(s: GameState, c: City, good: GoodId): number {
  const fair = fairValue(s, c, good);
  return fair > 0 ? (fair - c.price[good]) / fair : 0;
}

/** Total wagon space used by a cargo map. */
export function cargoSpace(cargo: Partial<Record<GoodId, number>>): number {
  return sum(GOOD_IDS.map((g) => (cargo[g] ?? 0) * GOODS[g].space));
}

/** Estimated value of a cargo map at given prices. */
export function cargoValue(cargo: Partial<Record<GoodId, number>>, price: Record<GoodId, number>): number {
  return sum(GOOD_IDS.map((g) => (cargo[g] ?? 0) * (price[g] ?? GOODS[g].base)));
}

/** Daily economic heartbeat for one city: production, consumption, prices. */
export function cityDayTick(s: GameState, c: City, rngFloat: () => number): string[] {
  const notes: string[] = [];
  const demand = cityDemand(s, c);
  const { produced, consumed } = cityProduction(s, c);

  for (const g of GOOD_IDS) {
    c.stock[g] += produced[g] ?? 0;
    c.stock[g] -= consumed[g] ?? 0;
    // Population eats; shortages bite.
    const need = demand[g];
    if (need > 0) {
      const eaten = Math.min(c.stock[g], need);
      c.stock[g] -= eaten;
      if (g === 'grain' && eaten < need * 0.9) {
        // Famine pressure: unrest climbs, population thins.
        c.unrest = clamp(c.unrest + 1.5, 0, 100);
        c.pop = Math.max(2, c.pop * (1 - 0.0008));
        if (c.unrest > 75 && rngFloat() < 0.02) notes.push(`Bread riots shake ${c.name}.`);
      }
    }
    // Slow spoilage in city granaries for perishables.
    if (GOODS[g].perish > 0) c.stock[g] *= 1 - GOODS[g].perish * 0.5;
    // Glut outflow: only once the local price has collapsed to the floor do
    // independent haulers carry the deep surplus away (the market's relief
    // valve — it must not eat exportable surplus that agents could move).
    const tgt = stockTarget(s, c, g);
    if (c.stock[g] > tgt * 3 && c.price[g] < GOODS[g].base * 0.55) {
      c.stock[g] -= (c.stock[g] - tgt * 3) * 0.05;
    }
    c.stock[g] = Math.max(c.stock[g], 0);
    c.absorbed[g] = 0;
    c.dispensed[g] = 0;
    tickPrice(s, c, g, rngFloat());
  }

  // Unrest decays toward law; law suppresses unrest; festivals calm everyone.
  const lawPull = (c.law - 50) / 50;
  c.unrest = clamp(c.unrest - lawPull * 1.2 - (c.mods.festivalUntil > s.day ? 2 : 0) + 0.15, 0, 100);
  if (c.unrest > 85 && rngFloat() < 0.05) {
    c.law = clamp(c.law - 4, 10, 100);
    notes.push(`Magistrates of ${c.name} have lost control of the streets.`);
  }
  // Fence appetite wobbles.
  c.fenceMult = clamp(c.fenceMult + (rngFloat() - 0.5) * 0.08, 0.7, 1.35);
  return notes;
}

/** Net worth estimate for the player (used by guild ranks & ambitions). */
export function playerNetWorth(s: GameState): number {
  const p = s.player;
  let v = p.gold - p.debt;
  const refCity = p.loc.kind === 'city' ? s.cities[p.loc.cityId] : null;
  for (const g of GOOD_IDS) {
    const qty = p.cargo[g] ?? 0;
    if (qty <= 0) continue;
    const price = refCity ? refCity.price[g] : GOODS[g].base;
    v += qty * price * 0.7;
  }
  v += p.caravanserais.length * 1500;
  v += p.warehouses.length * 400;
  for (const ac of p.aiCaravans) v += ac.float;
  return Math.max(v, 0);
}
