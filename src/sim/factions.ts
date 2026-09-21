import type { Rng } from '../core/rng';
import { clamp, sum } from '../core/util';
import { GOOD_IDS } from '../data/goods';
import { FACTION_IDS } from '../data/factions';
import { roadsOf, cityIsBesieged } from './economy';
import { addNews } from './news';
import type { Faction, FactionId, GameState } from './types';

/**
 * Faction politics. Relations warm when their merchants actually trade with
 * each other (tradeFlow) and cool from grievances and wars. Wars erupt from
 * cold relations + military opportunity, cost real treasury, besiege real
 * cities (whose demand profiles change violently), and end in treaties,
 * exhaustion, or conquest. Cities can change hands forever.
 */

export function factionDayTick(s: GameState, rng: Rng): void {
  for (const fid of FACTION_IDS) {
    const f = s.factions[fid];
    const cities = s.cityOrder.map((id) => s.cities[id]).filter((c) => c.faction === fid);
    const garrison = sum(cities.map((c) => c.garrison));

    // Tax base — besieged cities pay nothing, of course.
    const taxedPop = cities.reduce((n, c) => n + (c.mods.besiegedBy && c.mods.siegeUntil > s.day ? 0 : c.pop), 0);
    f.treasury += taxedPop * 0.25;
    // Garrison upkeep.
    f.treasury -= garrison * 0.015;
    // Wars are expensive: this is the clock on every conflict. Armies of an
    // empty treasury fight (and cost) at a fraction — then melt away.
    f.treasury -= f.wars.length * f.military * (f.treasury > 300 ? 1.45 : 0.4);
    if (f.treasury < 0) f.military = Math.max(15, f.military - 0.05);

    // Bureaucracy, courts and splendor scale with wealth (treasury sink).
    f.treasury -= f.treasury * 0.0012;
    // Last-city resilience: a faction cornered into one town fights back
    // with the ferocity of the finished (prevents total faction extinction).
    const lastStand = cities.length <= 1;
    if (lastStand) { f.treasury += 3; f.military = Math.min(f.military + 0.1, 60); }
    if (f.wars.length === 0) f.military = Math.min(f.military + 0.03, 100);
    // Garrisons rebuild slowly.
    for (const c of cities) c.garrison = Math.min(c.garrison + 1.2, 60 * c.buildings.filter((b) => b === 'walls').length + c.pop * 2.2);
    // Trade flow memory fades.
    for (const other of FACTION_IDS) if (other !== fid) f.tradeFlow[other] *= 0.985;
  }

  // Monthly politics on the turn of each 30-day month.
  if (s.day % 30 === 0) monthlyPolitics(s, rng);
}

function monthlyPolitics(s: GameState, rng: Rng): void {
  // --- Relations update: trade warms, grievance chills, war freezes. -------
  for (const fid of FACTION_IDS) {
    const f = s.factions[fid];
    for (const other of FACTION_IDS) {
      if (other === fid) continue;
      const atWarNow = f.wars.some((w) => w.enemy === other);
      if (atWarNow) {
        f.relations[other] = clamp(f.relations[other] - 6, -100, -60);
        continue;
      }
      const flow = f.tradeFlow[other];
      const grievance = f.grievance[other];
      // Aggressive powers provoke their colder neighbors: raids, insults,
      // "incidents at the border". This is the engine that makes wars happen.
      if (f.relations[other] < 5 && f.ideology.aggression > 0.4) {
        let pressure = f.ideology.aggression * rng.range(1, 4);
        if ((s.flags.khanateCrisis ?? 0) > s.day && f.id === 'khanate') pressure *= 2;
        addGrievance(s, f.id, other, pressure);
      }
      const delta = flow * 0.0008 - grievance * 0.25 + rng.gauss(0, 1.2);
      f.relations[other] = clamp(f.relations[other] + delta, -100, 100);
      f.grievance[other] *= 0.85;
      f.tradeFlow[other] *= 0.6;
      // Peacemaking watch ("Quiet Loom" ambition): the pair was seen cold,
      // the player personally bridged their trade, and now they are warm.
      const key = pairKey(fid, other);
      if (f.relations[other] > 30 && s.flags[`coldpair_${key}`] === 1 && s.flags[`bridged_${key}`] === 1) {
        s.flags.brokeredPeace = 1;
      }
      if (f.relations[other] < -10) s.flags[`coldpair_${key}`] = 1;
    }
  }

  // --- War declarations ----------------------------------------------------
  for (let i = 0; i < FACTION_IDS.length; i++) {
    for (let j = i + 1; j < FACTION_IDS.length; j++) {
      const a = s.factions[FACTION_IDS[i]];
      const b = s.factions[FACTION_IDS[j]];
      if (a.wars.some((w) => w.enemy === b.id)) continue;
      if (a.relations[b.id] > -50) continue;
      if (a.wars.length >= 2 || b.wars.length >= 2) continue;
      const agg = (a.ideology.aggression + b.ideology.aggression) / 2;
      const ratio = a.military / Math.max(b.military, 1);
      const eager = ratio > 1.15 ? a : ratio < 1 / 1.15 ? b : null;
      let p = agg * 0.5 * (eager ? 1.6 : 0.6);
      if ((eager ?? a).treasury < 1800) p *= 0.25;
      if (rng.chance(p)) declareWar(s, rng, eager ?? (agg >= 0.5 ? a : b), eager === a || !eager ? b : a);
    }
  }

  // --- Battles & war endings ------------------------------------------------
  for (const fid of FACTION_IDS) {
    const f = s.factions[fid];
    for (const w of [...f.wars]) {
      const enemy = s.factions[w.enemy];
      if (!enemy.wars.some((x) => x.enemy === fid)) continue; // mirrored bookkeeping
      // Wars are mirrored in both factions; resolve each pair exactly once.
      if (fid > w.enemy) continue;
      w.battles += 1;
      const mirror = enemy.wars.find((x) => x.enemy === fid);
      if (mirror) mirror.battles = w.battles;

      // Find a contested border city (enemy city adjacent to ours).
      const target = pickSiegeTarget(s, fid, w.enemy, rng);
      if (target) {
        const city = s.cities[target];
        if (!cityIsBesieged(city, s.day)) {
          city.mods.besiegedBy = fid;
          city.mods.siegeUntil = s.day + 20 + rng.int(0, 25);
          addNews(s, {
            kind: 'war', importance: 3, cityId: city.id,
            text: `${f.name} has laid siege to ${city.name}. Banners on every horizon; the market house now sells fear by the ounce.`,
          });
        }
        // Monthly battle roll.
        const atk = f.military * rng.range(0.75, 1.25) + f.treasury * 0.004;
        const def = enemy.military * rng.range(0.8, 1.2) + city.garrison * 0.35 + (city.buildings.includes('walls') ? 25 : 0);
        if (atk > def * 1.15) captureCity(s, f, enemy, city.id);
        else {
          f.military = Math.max(10, f.military * 0.94);
          f.treasury -= 400;
          enemy.military = Math.max(10, enemy.military * 0.98);
          if (rng.chance(0.5)) {
            addNews(s, { kind: 'war', importance: 1, cityId: city.id, text: `The walls of ${city.name} held again. ${enemy.name} lights signal-fires; ${f.name} digs in for winter.` });
          }
        }
      }

      // War-ending checks.
      const duration = s.day - w.started;
      const exhausted = f.treasury < 500 && enemy.treasury < 500;
      const capitulation = enemy.treasury < 400 || w.captures.length >= 2;
      const stalemate = duration > 170;
      if (exhausted || capitulation || stalemate) {
        endWar(s, rng, f, enemy, capitulation ? 'capitulation' : exhausted ? 'exhaustion' : 'stalemate');
      }
    }
  }
}

function pairKey(a: FactionId, b: FactionId): string {
  return [a, b].sort().join('|');
}

function pickSiegeTarget(s: GameState, attacker: FactionId, defender: FactionId, rng: Rng): string | null {
  const myCities = s.cityOrder.filter((id) => s.cities[id].faction === attacker);
  const candidates: string[] = [];
  for (const mine of myCities) {
    for (const r of roadsOf(s, mine)) {
      const other = r.a === mine ? r.b : r.a;
      if (s.cities[other].faction === defender) candidates.push(other);
    }
  }
  if (!candidates.length) return null;
  // Besiege the weakest, but not always the same one.
  candidates.sort((x, y) => s.cities[x].garrison - s.cities[y].garrison);
  return rng.chance(0.75) ? candidates[0] : rng.pick(candidates);
}

function captureCity(s: GameState, victor: Faction, loser: Faction, cityId: string): void {
  const city = s.cities[cityId];
  const oldValue = city.faction;
  city.faction = victor.id;
  city.mods.besiegedBy = null;
  city.mods.siegeUntil = 0;
  city.unrest = clamp(city.unrest + 30, 0, 100);
  city.law = clamp(city.law - 12, 10, 100);
  city.garrison = Math.round(city.garrison * 0.4);
  // Sack: stock plunders away, victor's treasury swells a little.
  let loot = 0;
  for (const g of GOOD_IDS) {
    loot += city.stock[g] * city.price[g] * 0.25;
    city.stock[g] *= 0.6;
  }
  victor.treasury += loot * 0.3;
  victor.military = Math.max(10, victor.military * 0.95);
  loser.military = Math.max(8, loser.military * 0.88);
  const warEntry = victor.wars.find((w) => w.enemy === loser.id);
  if (warEntry) warEntry.captures.push(city.name);
  // Refugees flee to a neighbor of the old allegiance.
  const refuge = s.cityOrder
    .map((id) => s.cities[id])
    .filter((c) => c.faction === oldValue && c.id !== cityId)
    .sort((a, b) => Math.hypot(a.x - city.x, a.y - city.y) - Math.hypot(b.x - city.x, b.y - city.y))[0];
  if (refuge) {
    refuge.pop += Math.max(0.5, city.pop * 0.08);
    refuge.unrest = clamp(refuge.unrest + 12, 0, 100);
    addNews(s, { kind: 'war', importance: 1, cityId: refuge.id, text: `Refugees from fallen ${city.name} crowd into ${refuge.name}. Bread grows dear, and so does pity.` });
  }
  addNews(s, {
    kind: 'war', importance: 3, cityId,
    text: `${city.name} HAS FALLEN. ${victor.name} rides through the gates; ${loser.name}'s banners are cut down. Every ledger on the continent is being rewritten tonight.`,
  });
}

function endWar(s: GameState, rng: Rng, a: Faction, b: Faction, how: 'capitulation' | 'exhaustion' | 'stalemate'): void {
  const captures = a.wars.find((w) => w.enemy === b.id)?.captures ?? [];
  a.wars = a.wars.filter((w) => w.enemy !== b.id);
  b.wars = b.wars.filter((w) => w.enemy !== a.id);
  // Lift sieges.
  for (const id of s.cityOrder) {
    const c = s.cities[id];
    if (c.mods.besiegedBy === a.id || c.mods.besiegedBy === b.id) {
      c.mods.besiegedBy = null;
      c.mods.siegeUntil = 0;
    }
  }
  let text: string;
  if (how === 'capitulation') {
    const loser = captures.length >= 2 || b.treasury < 400 ? b : a;
    const winner = loser === a ? b : a;
    const tribute = Math.max(0, loser.treasury * 0.15);
    loser.treasury -= tribute;
    winner.treasury += tribute;
    loser.relations[winner.id] = -22;
    winner.relations[loser.id] = -22;
    text = `TREATY OF THE ${rng.pick(['ASHEN TABLE', 'NINE LAMPS', 'BROKEN SPEAR', 'QUIET RIVER', 'SALT LINE'])}: ${loser.name} capitulates. ${Math.round(tribute)} sols in tribute flow to ${winner.name}; the roads reopen, cautiously.`;
  } else {
    a.relations[b.id] = -22;
    b.relations[a.id] = -22;
    text = `The war between ${a.name} and ${b.name} ends in ${how === 'exhaustion' ? 'mutual exhaustion' : 'a weary stalemate'}. Peace is signed not from love but from empty coffers. Traders will read it as a buy order.`;
  }
  addNews(s, { kind: 'war', importance: 3, text });
}

export function declareWar(s: GameState, rng: Rng, attacker: Faction, defender: Faction): void {
  attacker.wars.push({ enemy: defender.id, started: s.day, battles: 0, captures: [] });
  defender.wars.push({ enemy: attacker.id, started: s.day, battles: 0, captures: [] });
  attacker.relations[defender.id] = -85;
  defender.relations[attacker.id] = -85;
  const cause = rng.pick([
    `an unpaid blood-price for the sack of a border caravan`,
    `a disputed well and two generations of insults`,
    `a sermon that named the wrong heretic`,
    `tariffs that one side called theft and the other called law`,
    `a broken betrothal between minor houses — truly, that is all`,
    `maps that drew the same valley twice`,
  ]);
  addNews(s, {
    kind: 'war', importance: 3,
    text: `WAR. ${attacker.name} declares against ${defender.name} over ${cause}. Expect: iron dearer, horses dearer, roads worse, and widows on both sides.`,
  });
  // Wartime economy effects (requisition demand, embargoes, road danger) are
  // computed on the fly from faction war state — no extra bookkeeping needed.
}

/** Grievance injection used by events & player crimes. */
export function addGrievance(s: GameState, from: FactionId, toward: FactionId, amount: number): void {
  s.factions[from].grievance[toward] = clamp(s.factions[from].grievance[toward] + amount, 0, 100);
}
