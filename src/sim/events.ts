import type { Rng } from '../core/rng';
import { clamp } from '../core/util';
import { GOOD_IDS, GOODS } from '../data/goods';
import { BANDIT_CHIEF_NAMES } from '../data/names';
import { seasonOfDay } from '../core/calendar';
import { demandFor } from './economy';
import { killAgent } from './agents';
import { addNews } from './news';
import { addGrievance } from './factions';
import type { City, FactionId, GameState, GoodId, Road } from './types';

/**
 * World events. Weighted templates with conditions and real mechanical
 * effects: every event writes into the same state the economy and politics
 * read (city modifiers, road flags, stock, population), so each one ripples
 * through prices, agent plans, and faction behavior without special cases.
 */

interface WorldEvent {
  id: string;
  weight: (s: GameState) => number;
  cond: (s: GameState) => boolean;
  run: (s: GameState, rng: Rng) => void;
}

const citiesOf = (s: GameState, pred: (c: City) => boolean): City[] =>
  s.cityOrder.map((id) => s.cities[id]).filter(pred);

const roadsList = (s: GameState, pred?: (r: Road) => boolean): Road[] =>
  s.roadOrder.map((id) => s.roads[id]).filter(pred ?? (() => true));

const notBusy = (c: City, s: GameState): boolean =>
  c.mods.plagueUntil < s.day && c.mods.droughtUntil < s.day && c.mods.fireUntil < s.day && !c.mods.besiegedBy;

const EVENTS: WorldEvent[] = [
  {
    id: 'plague',
    weight: () => 2.2,
    cond: (s) => citiesOf(s, (c) => c.pop > 10 && notBusy(c, s)).length > 0,
    run: (s, rng) => {
      const c = rng.pick(citiesOf(s, (x) => x.pop > 10 && notBusy(x, s)));
      c.mods.plagueUntil = s.day + 25 + rng.int(0, 20);
      c.pop = Math.max(4, c.pop * (1 - rng.range(0.04, 0.09)));
      c.unrest = clamp(c.unrest + 15, 0, 100);
      addNews(s, {
        kind: 'plague', importance: 3, cityId: c.id,
        text: `THE COUGHING SICKNESS HAS COME TO ${c.name.toUpperCase()}. Gates close at dusk; vinegar and prayer sell at any price. Demand in the city has withered — except, grimly, for grain delivered to the door.`,
      });
    },
  },
  {
    id: 'harvest_bounty',
    weight: (s) => (seasonOfDay(s.day) === 'autumn' ? 6 : 0),
    cond: (s) => seasonOfDay(s.day) === 'autumn' && citiesOf(s, (c) => c.buildings.includes('farm') && c.mods.droughtUntil < s.day).length > 0,
    run: (s, rng) => {
      const c = rng.pick(citiesOf(s, (x) => x.buildings.includes('farm') && x.mods.droughtUntil < s.day));
      const bonus = demandFor(s, c, 'grain') * rng.range(35, 55);
      c.stock.grain += bonus;
      c.unrest = clamp(c.unrest - 8, 0, 100);
      addNews(s, { kind: 'market', importance: 2, cityId: c.id, text: `The harvest at ${c.name} is absurd, glorious, back-breaking. Granaries groan; grain prices sag under ${Math.round(bonus)} extra units. Merchants with wagon space are already smiling.` });
    },
  },
  {
    id: 'drought',
    weight: (s) => (seasonOfDay(s.day) === 'spring' || seasonOfDay(s.day) === 'summer' ? 3 : 0),
    cond: (s) => citiesOf(s, (c) => c.faction === 'delta' && notBusy(c, s)).length > 0,
    run: (s, rng) => {
      const c = rng.pick(citiesOf(s, (x) => x.faction === 'delta' && notBusy(x, s)));
      c.mods.droughtUntil = s.day + 40 + rng.int(0, 25);
      addNews(s, { kind: 'disaster', importance: 3, cityId: c.id, text: `The river-arms around ${c.name} run low and brown. Priests process; farmers watch the sky like creditors at a door. Fields will yield a third of usual for weeks — and the whole continent eats Delta bread.` });
    },
  },
  {
    id: 'festival',
    weight: () => 6,
    cond: (s) => citiesOf(s, (c) => c.mods.festivalUntil < s.day && !c.mods.besiegedBy).length > 0,
    run: (s, rng) => {
      const c = rng.pick(citiesOf(s, (x) => x.mods.festivalUntil < s.day && !x.mods.besiegedBy));
      c.mods.festivalUntil = s.day + 8 + rng.int(0, 7);
      c.unrest = clamp(c.unrest - 15, 0, 100);
      const which = rng.pick(['Festival of Lamps', 'Feast of the First Sheaf', 'Day of Open Hands', 'Festival of Nine Bells', 'Rite of the Turning Star', 'Wine-Blessing']);
      addNews(s, { kind: 'festival', importance: 1, cityId: c.id, text: `${c.name} keeps the ${which}: processions, free bread, paid wine. For ten days the city drinks like it is immortal — wine and spice dealers, take note.` });
    },
  },
  {
    id: 'mine_strike',
    weight: () => 2.4,
    cond: (s) => citiesOf(s, (c) => (c.buildings.includes('ironmine') || c.biome === 'mountain') && c.mods.boomUntil < s.day).length > 0,
    run: (s, rng) => {
      const c = rng.pick(citiesOf(s, (x) => (x.buildings.includes('ironmine') || x.biome === 'mountain') && x.mods.boomUntil < s.day));
      c.mods.boomUntil = s.day + 50 + rng.int(0, 30);
      if (!c.buildings.includes('ironmine')) c.buildings.push('ironmine');
      addNews(s, { kind: 'discovery', importance: 2, cityId: c.id, text: `A new seam of red ore opens near ${c.name} — "the mountain is bleeding money," say the miners. Iron output will double while the strike lasts. Iron prices there are already softening.` });
    },
  },
  {
    id: 'fire',
    weight: () => 3.2,
    cond: (s) => citiesOf(s, (c) => c.mods.fireUntil < s.day && !c.mods.besiegedBy).length > 0,
    run: (s, rng) => {
      const c = rng.pick(citiesOf(s, (x) => x.mods.fireUntil < s.day && !x.mods.besiegedBy));
      c.mods.fireUntil = s.day + 12 + rng.int(0, 8);
      const lost = GOOD_IDS.filter((g) => c.stock[g] > 10);
      const g: GoodId = lost.length ? rng.pick(lost) : 'timber';
      const burned = c.stock[g] * rng.range(0.25, 0.5);
      c.stock[g] -= burned;
      c.stock.timber *= 0.85;
      c.unrest = clamp(c.unrest + 12, 0, 100);
      addNews(s, { kind: 'disaster', importance: 2, cityId: c.id, text: `Fire walks the ${rng.pick(['weavers\u2019', 'warehouse', 'granary', 'coopers\u2019', 'lamp-oil'])} quarter of ${c.name} for half a night. ${Math.round(burned)} units of ${GOODS[g].name.toLowerCase()} are ash; production limps for weeks. Someone will sell them timber at a loving price.` });
    },
  },
  {
    id: 'bandit_confederacy',
    weight: (s) => (roadsList(s, (r) => r.banditsUntil < s.day && r.danger < 45).length > 0 ? 5 : 0),
    cond: (s) => roadsList(s, (r) => r.banditsUntil < s.day && r.danger < 45).length > 0,
    run: (s, rng) => {
      const r = rng.pick(roadsList(s, (x) => x.banditsUntil < s.day && x.danger < 45));
      r.banditsUntil = s.day + 30 + rng.int(0, 35);
      r.banditChief = rng.pick(BANDIT_CHIEF_NAMES);
      addNews(s, { kind: 'crime', importance: 2, text: `${r.banditChief} has united the loose brigands of the ${s.cities[r.a].name}–${s.cities[r.b].name} road. Tolls are being collected by people who are not the state. Travel armed, travel poor, or travel elsewhere.` });
    },
  },
  {
    id: 'storms',
    weight: (s) => (seasonOfDay(s.day) === 'winter' || seasonOfDay(s.day) === 'spring' ? 5 : 1.6),
    cond: (s) => roadsList(s, (r) => r.stormUntil < s.day).length > 0,
    run: (s, rng) => {
      const candidates = roadsList(s, (r) => r.stormUntil < s.day && (r.kind === 'river' || r.kind === 'pass' || r.kind === 'open'));
      const r = rng.pick(candidates);
      r.stormUntil = s.day + 8 + rng.int(0, 12);
      addNews(s, { kind: 'disaster', importance: 1, text: `${rng.pick(['Grey walls of rain', 'A wind with gravel in its fists', 'Snow at the wrong altitude', 'Three days of sky like a bruise'])} over the ${s.cities[r.a].name}–${s.cities[r.b].name} road. Every crossing on it will cost an extra day for a while — and fragile cargo should pray.` });
    },
  },
  {
    id: 'silk_blight',
    weight: () => 2,
    cond: (s) => citiesOf(s, (c) => c.buildings.includes('sericulture') && (s.flags[`blight_${c.id}`] ?? 0) < s.day).length > 0,
    run: (s, rng) => {
      const c = rng.pick(citiesOf(s, (x) => x.buildings.includes('sericulture') && (s.flags[`blight_${x.id}`] ?? 0) < s.day));
      s.flags[`blight_${c.id}`] = s.day + 40 + rng.int(0, 20);
      addNews(s, { kind: 'disaster', importance: 2, cityId: c.id, text: `Blight in the mulberry terraces of ${c.name}: the worms sicken, the silk browns. The Vault calls it a test of faith. The exchange calls it a price forecast. Silk output there is a third of normal for weeks.` });
    },
  },
  {
    id: 'horse_plague',
    weight: () => 2,
    cond: (s) => citiesOf(s, (c) => c.buildings.includes('stud') && (s.flags[`horseplague_${c.id}`] ?? 0) < s.day).length > 0,
    run: (s, rng) => {
      const c = rng.pick(citiesOf(s, (x) => x.buildings.includes('stud') && (s.flags[`horseplague_${x.id}`] ?? 0) < s.day));
      s.flags[`horseplague_${c.id}`] = s.day + 30 + rng.int(0, 20);
      addNews(s, { kind: 'plague', importance: 2, cityId: c.id, text: `The horse-sickness takes the studs of ${c.name}. Burned pyres of hay smell sweet for miles. Cavalry remounts and wagon teams alike will be scarce — everyone who owns a healthy horse just got richer.` });
    },
  },
  {
    id: 'succession_crisis',
    weight: (s) => ((s.flags.khanateCrisis ?? 0) < s.day ? 1.6 : 0),
    cond: (s) => (s.flags.khanateCrisis ?? 0) < s.day,
    run: (s, rng) => {
      s.flags.khanateCrisis = s.day + 35 + rng.int(0, 25);
      for (const c of citiesOf(s, (x) => x.faction === 'khanate')) c.unrest = clamp(c.unrest + 20, 0, 100);
      addNews(s, { kind: 'politics', importance: 2, text: `The ${s.factions.khanate.ruler} rides no more. Two ${rng.pick(['sons', 'widows', 'blood-brothers', 'generals'])} claim the ${rng.pick(['ashen throne', 'horse-tail banner', 'nine oaths'])}, and every raid-party not yet loyal to either is funding itself on the roads. The steppe holds its breath; merchants should hold their purses.` });
    },
  },
  {
    id: 'trade_fair',
    weight: (s) => (seasonOfDay(s.day) === 'autumn' ? 3.4 : 0),
    cond: (s) => seasonOfDay(s.day) === 'autumn' && citiesOf(s, (c) => c.faction === 'concord' && c.mods.fairUntil < s.day).length > 0,
    run: (s, rng) => {
      const c = rng.pick(citiesOf(s, (x) => x.faction === 'concord' && x.mods.fairUntil < s.day));
      c.mods.fairUntil = s.day + 10 + rng.int(0, 5);
      addNews(s, { kind: 'market', importance: 2, cityId: c.id, text: `THE GREAT FAIR OF ${c.name.toUpperCase()} opens: tariffs suspended by decree of the Ledger-Lords, every scale inspected, every stranger welcome. For ten days the whole Concord trades duty-free — and every agent worth their mules will converge there. Prices will move.` });
    },
  },
  {
    id: 'prophecy',
    weight: () => 1.6,
    cond: (s) => citiesOf(s, (c) => c.faction === 'vault' && (s.flags[`prophecy_${c.id}`] ?? 0) < s.day).length > 0,
    run: (s, rng) => {
      const targets = citiesOf(s, (x) => x.faction === 'vault' && (s.flags[`prophecy_${x.id}`] ?? 0) < s.day);
      const c1 = rng.pick(targets);
      s.flags[`prophecy_${c1.id}`] = s.day + 30 + rng.int(0, 20);
      const c2 = targets.find((x) => x.id !== c1.id);
      if (c2 && rng.chance(0.6)) s.flags[`prophecy_${c2.id}`] = s.day + 30;
      addNews(s, { kind: 'omen', importance: 2, cityId: c1.id, text: `An astronomer-saint of ${c1.name} has read the turning stars: "The relics of the righteous shall be counted thrice, and the Vault shall exalt them." Temple treasuries are opening. Relic demand in the high cities will triple while the omen holds.` });
    },
  },
  {
    id: 'comet',
    weight: () => 0.8,
    cond: () => true,
    run: (s, rng) => {
      for (const id of s.cityOrder) s.cities[id].unrest = clamp(s.cities[id].unrest + rng.range(1, 5), 0, 100);
      const name = rng.pick(['the Beggar\u2019s Torch', 'the Red Sickle', 'the Widow\u2019s Lamp', 'the Ashen Crown', 'the Second Moon']);
      addNews(s, { kind: 'omen', importance: 2, text: `A comet — ${name} — hangs over Zeravesh, green as a drowned thing. In ${rng.pick(s.cityOrder.map((id) => s.cities[id])).name} they beat drums at it. Somewhere, a khan postpones a war. Somewhere else, a war begins sooner. Nobody agrees on the meaning; everyone agrees on the sky.` });
    },
  },
  {
    id: 'bridge_washed',
    weight: () => 2.2,
    cond: (s) => roadsList(s, (r) => r.kind === 'river' && r.daysModUntil < s.day).length > 0,
    run: (s, rng) => {
      const r = rng.pick(roadsList(s, (x) => x.kind === 'river' && x.daysModUntil < s.day));
      r.daysMod = 2;
      r.daysModUntil = s.day + 20 + rng.int(0, 20);
      addNews(s, { kind: 'disaster', importance: 1, text: `The ${rng.pick(['old stone', 'rope-and-plank', 'toll'])} bridge on the ${s.cities[r.a].name}–${s.cities[r.b].name} road is gone — taken by the river in one night. The ford downstream adds two days to every crossing until masons arrive.` });
    },
  },
  {
    id: 'new_well',
    weight: () => 1.5,
    cond: (s) => roadsList(s, (r) => r.days >= 4 && r.daysModUntil < s.day).length > 0,
    run: (s, rng) => {
      const r = rng.pick(roadsList(s, (x) => x.days >= 4 && x.daysModUntil < s.day));
      r.days = Math.max(1, r.days - 1);
      r.dangerBase = Math.max(3, r.dangerBase - 2);
      addNews(s, { kind: 'discovery', importance: 1, text: `Water found where the map said there was none: a new well halves the ${s.cities[r.a].name}–${s.cities[r.b].name} run by a full day. Caravan-masters are already re-drawing their mental maps. Yours should be too.` });
    },
  },
  {
    id: 'lost_caravan',
    weight: () => 2,
    cond: (s) => s.agents.some((a) => a.alive && !a.owner && a.loc.kind === 'road'),
    run: (s, rng) => {
      const travelers = s.agents.filter((a) => a.alive && !a.owner && a.loc.kind === 'road');
      if (!travelers.length) return;
      const a = rng.pick(travelers);
      const road = s.roads[(a.loc as { roadId: string }).roadId];
      const cause = rng.pick([
        'perished in a flash flood that took the whole crossing',
        'was found at the bottom of a ravine, wagon above, fate below',
        'walked into a whiteout on the high road and never walked out',
      ]);
      killAgent(s, a, cause);
      // Their scattered cargo becomes salvage on that road for a while.
      const goods: Partial<Record<GoodId, number>> = {};
      let value = 40 + rng.range(0, 120);
      for (const [g, q] of Object.entries(a.cargo)) {
        const kept = Math.ceil((q as number) * rng.range(0.3, 0.8));
        if (kept > 0) { goods[g as GoodId] = kept; value += kept * GOODS[g as GoodId].base; }
      }
      road.salvage = { until: s.day + 18 + rng.int(0, 12), value, goods };
      addNews(s, { kind: 'crime', importance: 1, text: `Scavengers speak of a wrecked caravan scattered along the ${s.cities[road.a].name}–${s.cities[road.b].name} road. The road keeps what it takes — for a while. First honest finder, arguably.` });
    },
  },
  {
    id: 'famine_panic',
    weight: () => 3,
    cond: (s) => citiesOf(s, (c) => !c.mods.besiegedBy && c.mods.plagueUntil < s.day && c.stock.grain < demandFor(s, c, 'grain') * 6).length > 0,
    run: (s, rng) => {
      const c = rng.pick(citiesOf(s, (x) => !x.mods.besiegedBy && x.mods.plagueUntil < s.day && x.stock.grain < demandFor(s, x, 'grain') * 6));
      c.unrest = clamp(c.unrest + rng.range(10, 22), 0, 100);
      c.law = clamp(c.law - 4, 10, 100);
      addNews(s, { kind: 'market', importance: 2, cityId: c.id, text: `Bread-lines in ${c.name} have turned into bread-arguments, and the arguments are getting grammar. The magistrates have fixed a price ceiling nobody respects. Whoever lands grain there will be greeted like a prophet — and watched like a profiteer.` });
    },
  },
  {
    id: 'border_raids',
    weight: (s) => (hostilePairs(s).length ? 3 : 0),
    cond: (s) => hostilePairs(s).length > 0,
    run: (s, rng) => {
      const [f1, f2] = rng.pick(hostilePairs(s));
      const aggressor = s.factions[f1].ideology.aggression >= s.factions[f2].ideology.aggression ? f1 : f2;
      const victim = aggressor === f1 ? f2 : f1;
      const victimCities = citiesOf(s, (c) => c.faction === victim);
      const c = victimCities.length ? rng.pick(victimCities) : null;
      const amount = rng.range(5, 12);
      s.factions[aggressor].relations[victim] = clamp(s.factions[aggressor].relations[victim] - amount * 0.7, -100, 100);
      s.factions[victim].relations[aggressor] = clamp(s.factions[victim].relations[aggressor] - amount, -100, 100);
      addGrievance(s, victim, aggressor, rng.range(4, 10));
      addGrievance(s, aggressor, victim, rng.range(1, 4));
      if (c) c.unrest = clamp(c.unrest + 8, 0, 100);
      addNews(s, {
        kind: 'politics', importance: 2, cityId: c?.id,
        text: `${rng.pick(['Raiders', 'Rustlers', 'Border riders', '“Customs inspectors with lances”'])} out of ${s.factions[aggressor].name} struck ${c ? 'around ' + c.name : victim === 'khanate' ? 'the steppe marches' : 'the border villages'} at dawn. ${s.factions[victim].name} demands satisfaction; ${s.factions[aggressor].name} demands proof. Relations curdle further.` });
    },
  },
  {
    id: 'guild_assay',
    weight: () => 2,
    cond: () => true,
    run: (s, rng) => {
      const c = rng.pick(citiesOf(s, () => true));
      s.flags[`assay_${c.id}`] = s.day;
      addNews(s, { kind: 'politics', importance: 1, cityId: c.id, text: `Guild assessors arrive in ${c.name} with fresh scales and cold eyes. Every warehouse will be counted, every contract re-posted — the board there is unusually rich this week.` });
    },
  },
];

function hostilePairs(s: GameState): [FactionId, FactionId][] {
  const ids = Object.keys(s.factions) as FactionId[];
  const out: [FactionId, FactionId][] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const f = s.factions[ids[i]];
      const rel = f.relations[ids[j]] ?? 0;
      const warring = f.wars.some((w) => w.enemy === ids[j]);
      if (rel < -8 && !warring) out.push([ids[i], ids[j]]);
    }
  }
  return out;
}

export function eventsDayTick(s: GameState, rng: Rng): void {
  // Roughly one event per day across the whole continent, throttled after a
  // run of big stories so the world never drowns in catastrophe.
  const recentBig = s.news.filter((n) => n.day > s.day - 6 && n.importance >= 2).length;
  let rolls = recentBig > 3 ? 0.6 : 1.15;
  if ((s.flags.khanateCrisis ?? 0) > s.day) rolls += 0.3; // crises breed incidents
  const count = Math.floor(rolls) + (rng.chance(rolls - Math.floor(rolls)) ? 1 : 0);
  for (let i = 0; i < count; i++) rollEvent(s, rng);
}

function rollEvent(s: GameState, rng: Rng): void {
  const eligible = EVENTS.filter((e) => e.weight(s) > 0 && safeCond(e, s));
  const ev = rng.weighted(eligible, (e) => e.weight(s));
  if (ev) ev.run(s, rng);
}

function safeCond(e: WorldEvent, s: GameState): boolean {
  try {
    return e.cond(s);
  } catch {
    return false;
  }
}
/** Effective travel days for a road right now (storms, bridges, season). */
export function effectiveRoadDays(s: GameState, r: Road): number {
  let d = r.days;
  if (r.stormUntil > s.day) d += 1;
  if (r.daysModUntil > s.day) d += r.daysMod;
  if (seasonOfDay(s.day) === 'winter' && (r.kind === 'pass')) d += 2;
  return Math.max(1, d);
}

/** Recompute effective danger for every road from current world state. */
export function refreshRoadDanger(s: GameState): void {
  const winter = seasonOfDay(s.day) === 'winter';
  for (const id of s.roadOrder) {
    const r = s.roads[id];
    const ca = s.cities[r.a];
    const cb = s.cities[r.b];
    let d = r.dangerBase;
    if (r.banditsUntil > s.day) d += r.dangerBase * 1.3 + 8;
    if ((s.flags.khanateCrisis ?? 0) > s.day && (ca.faction === 'khanate' || cb.faction === 'khanate')) d += 10;
    const facA = s.factions[ca.faction];
    const facB = s.factions[cb.faction];
    if (facA.wars.length || facB.wars.length) d += 8;
    if (ca.mods.besiegedBy || cb.mods.besiegedBy) d += 18;
    if (facA.wars.some((w) => w.enemy === cb.faction) || facB.wars.some((w) => w.enemy === ca.faction)) d += 14;
    d += (100 - ca.law) * 0.08 + (100 - cb.law) * 0.08;
    d += (ca.unrest + cb.unrest) * 0.06;
    if (winter && (r.kind === 'open' || r.kind === 'pass')) d += 6;
    if (r.caravanserai === 'player') d -= 15;
    else if (r.caravanserai) d -= 5;
    if (ca.law > 72 && facA.treasury > 2500) d -= 4;
    if (cb.law > 72 && facB.treasury > 2500) d -= 4;
    r.danger = clamp(Math.round(d), 2, 95);
  }
}
