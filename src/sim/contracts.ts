import type { Rng } from '../core/rng';
import { clamp, uid } from '../core/util';
import { GOODS, GOOD_IDS } from '../data/goods';
import { PERSON_NAMES } from '../data/names';
import { SIGNATURE_GOODS, demandFor, roadBetween } from './economy';
import { findPath, agentDisplayName } from './agents';
import { effectiveRoadDays } from './events';
import { addNews } from './news';
import type { Contract, GameState, GoodId } from './types';

/**
 * Procedural contracts, priced off the *real* simulated economy: delivery
 * rewards are computed from actual city prices, route danger and deadlines —
 * so a contract is only profitable if the player reads the world well.
 */

const MAX_ACTIVE = 3;

function routeDays(s: GameState, from: string, to: string): number {
  const path = findPath(s, from, to);
  if (!path) return 99;
  let days = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const r = roadBetween(s, path[i], path[i + 1]);
    if (r) days += effectiveRoadDays(s, r);
  }
  return days;
}

function routeDanger(s: GameState, from: string, to: string): number {
  const path = findPath(s, from, to);
  if (!path) return 50;
  let d = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const r = roadBetween(s, path[i], path[i + 1]);
    if (r) d = Math.max(d, r.danger);
  }
  return d;
}

function patronName(s: GameState, rng: Rng, cityId: string, shady: boolean): string {
  const fac = s.cities[cityId].faction;
  const bank = PERSON_NAMES[fac];
  const name = `${rng.pick(bank.first)} ${rng.pick(bank.last)}`;
  if (shady) return `a hooded factor calling themselves “${rng.pick(bank.first)}”`;
  const title = rng.pick(['of the guild hall', 'factor for', 'steward to', 'agent of']);
  const org = rng.pick(['the Exchange', 'the temple treasury', 'the garrison', 'the Council', 'a widow of means', 'the Ledger-Lords']);
  return `${name}, ${title} ${org}`;
}

function legalGoodsHere(s: GameState, cityId: string): GoodId[] {
  const fac = s.factions[s.cities[cityId].faction];
  const embargoed: GoodId[] = [];
  for (const w of fac.wars) embargoed.push(...SIGNATURE_GOODS[w.enemy]);
  return GOOD_IDS.filter((g) => !fac.ideology.contraband.includes(g) && !embargoed.includes(g));
}

function contrabandGoodsHere(s: GameState, cityId: string): GoodId[] {
  const fac = s.factions[s.cities[cityId].faction];
  const out = [...fac.ideology.contraband];
  for (const w of fac.wars) out.push(...SIGNATURE_GOODS[w.enemy]);
  return [...new Set(out)];
}

export function generateContract(s: GameState, rng: Rng, cityId: string): Contract {
  const city = s.cities[cityId];
  const kindRoll = rng.float();
  const contraband = contrabandGoodsHere(s, cityId);
  const canSmuggle = contraband.length > 0;
  const escorts = s.agents.filter((a) => a.alive && !a.owner && a.loc.kind === 'city' && a.loc.cityId === cityId && cargoHasValue(a));

  let kind: Contract['kind'];
  if (kindRoll < 0.28) kind = 'delivery';
  else if (kindRoll < 0.46) kind = 'procurement';
  else if (kindRoll < 0.6 && escorts.length) kind = 'escort';
  else if (kindRoll < 0.76 && canSmuggle) kind = 'smuggle';
  else kind = 'survey';

  switch (kind) {
    case 'delivery':
    case 'procurement': {
      const legal = legalGoodsHere(s, cityId);
      const good = rng.weighted(legal, (g) => (demandFor(s, city, g) > 0.05 ? 2 : 0.4)) ?? 'grain';
      const need = demandFor(s, city, good);
      const amount = contractAmount(s, rng, good, need);
      // Find the cheapest plausible source (true prices; the contract knows its market).
      let source = cityId;
      let bestPrice = Infinity;
      for (const other of s.cityOrder) {
        if (other === cityId) continue;
        const p = s.cities[other].price[good];
        if (p < bestPrice && routeDays(s, other, cityId) < 90) { bestPrice = p; source = other; }
      }
      const days = routeDays(s, source, cityId);
      const danger = routeDanger(s, source, cityId);
      const costEst = amount * Math.min(bestPrice, city.price[good]);
      const reward = Math.round(costEst * rng.range(1.3, 1.7) + danger * amount * 0.06 + days * 12);
      const deadline = s.day + days + rng.int(8, 18);
      const isDelivery = kind === 'delivery';
      return {
        id: uid('ct'), kind, cityId,
        patron: patronName(s, rng, cityId, false),
        faction: rng.chance(0.5) ? city.faction : undefined,
        good, amount,
        fromCity: isDelivery ? source : undefined,
        deadline, reward,
        advance: Math.round(reward * 0.15),
        repReward: 2 + (city.faction ? 1 : 0),
        desc: isDelivery
          ? `${amount} units of ${GOODS[good].name.toLowerCase()} are needed in ${city.name}. The assessor's note suggests buying in ${s.cities[source].name} (${bestPrice.toFixed(1)} sols/unit last counted) and making the deadline the hard way.`
          : `Procure ${amount} units of ${GOODS[good].name.toLowerCase()} by any honest road and deliver to ${city.name}. Where you find it is your business; that you find it is the contract.`,
        state: 'open',
      };
    }
    case 'escort': {
      const agent = rng.pick(escorts);
      const dest = rng.pick(s.cityOrder.filter((c) => c !== cityId));
      const days = routeDays(s, cityId, dest);
      const danger = routeDanger(s, cityId, dest);
      const cargoVal = Object.entries(agent.cargo).reduce((v, [g, q]) => v + (q as number) * (s.cities[dest].price[g as GoodId] ?? GOODS[g as GoodId].base), 0);
      const reward = Math.round(90 + cargoVal * rng.range(0.1, 0.18) + danger * rng.range(2, 4));
      return {
        id: uid('ct'), kind: 'escort', cityId,
        patron: agentDisplayName(agent),
        good: undefined, amount: undefined,
        fromCity: dest,
        deadline: s.day + days + rng.int(6, 14),
        reward, advance: Math.round(reward * 0.25),
        repReward: 2, escortAgent: agent.id,
        desc: `${agentDisplayName(agent)} intends to haul a nervous cargo to ${s.cities[dest].name} and wants your wagon beside theirs. Travel together, arrive together, be paid on the far side. ${danger > 30 ? 'The road is said to be hungry.' : 'The road is said to be tame — this year.'}`,
        state: 'open',
      };
    }
    case 'smuggle': {
      const good = rng.pick(contraband);
      const amount = clamp(Math.round(rng.range(6, 40) / GOODS[good].space) , 3, 60);
      const fenceValue = amount * GOODS[good].base;
      const reward = Math.round(fenceValue * rng.range(1.45, 2.1));
      return {
        id: uid('ct'), kind: 'smuggle', cityId,
        patron: patronName(s, rng, cityId, true),
        good, amount,
        deadline: s.day + rng.int(18, 40),
        reward, advance: 0, repReward: 0,
        desc: `${amount} units of ${GOODS[good].name.toLowerCase()} — forbidden here, and therefore wanted here. Acquire elsewhere, carry quietly, hand it to the factor beneath the ${rng.pick(['salt market', 'west gate', 'dyers\u2019 arch', 'old cistern'])} of ${city.name}. Patrols on faction roads search wagons. Searches can be survived, bribed, or outrun; reputations, less so.`,
        state: 'open',
      };
    }
    case 'survey':
    default: {
      const stale = s.cityOrder.filter((c) => {
        const kn = s.player.intel[c];
        return c !== cityId && (!kn || s.day - kn.day > 22);
      });
      const target = stale.length ? rng.pick(stale) : rng.pick(s.cityOrder.filter((c) => c !== cityId));
      const days = routeDays(s, cityId, target);
      const reward = Math.round(60 + days * rng.range(16, 26));
      return {
        id: uid('ct'), kind: 'survey', cityId,
        patron: `Assessor ${rng.pick(PERSON_NAMES[s.cities[cityId].faction].first)} of the Merchants' Guild`,
        fromCity: target,
        deadline: s.day + days * 2 + rng.int(10, 20),
        reward, advance: 20, repReward: 1,
        desc: `The Guild's maps of ${s.cities[target].name} are ${rng.pick(['embarrassingly old', 'guesswork at best', 'older than the assessor'])}. Travel there, walk its market, witness its true prices — the moment you do, the contract settles itself through the Guild's ledgers.`,
        state: 'open',
      };
    }
  }
}

function cargoHasValue(a: { cargo: Partial<Record<GoodId, number>> }): boolean {
  return Object.values(a.cargo).some((q) => (q ?? 0) > 0);
}

/** Amounts scaled to good tier so contracts fit real wagon economics. */
function contractAmount(s: GameState, rng: Rng, good: GoodId, need: number): number {
  const tier = GOODS[good].tier;
  let amount: number;
  switch (tier) {
    case 'staple': amount = clamp(Math.round(need * rng.range(5, 14) + rng.range(10, 40)), 25, 260); break;
    case 'craft': amount = clamp(Math.round(need * rng.range(6, 16) + rng.range(4, 20)), 10, 110); break;
    case 'luxury': amount = clamp(Math.round(need * rng.range(8, 20) + rng.range(3, 12)), 5, 45); break;
    case 'treasure': amount = clamp(Math.round(need * rng.range(8, 22) + rng.range(1, 4)), 2, 12); break;
  }
  void s;
  return Math.max(1, Math.round(amount));
}

export function contractsDayTick(s: GameState, rng: Rng): void {
  // Expire hopeless open contracts; fail overdue active ones.
  for (const c of [...s.contracts]) {
    if (c.state === 'open' && c.deadline - s.day < 4) s.contracts.splice(s.contracts.indexOf(c), 1);
    if (c.state === 'active' && s.day > c.deadline) {
      c.state = 'failed';
      s.player.contractsFailed++;
      s.stats.contractsFailed++;
      if (c.faction) s.player.rep[c.faction] = clamp((s.player.rep[c.faction] ?? 0) - 3, -100, 100);
      addNews(s, { kind: 'player', importance: 1, text: `Contract failed: “${shortTitle(c)}” expired unfulfilled. ${c.faction ? `${s.factions[c.faction].name} notes it in a ledger that never forgets.` : 'The patron shrugs and re-posts it cheaper.'}` });
      s.contracts.splice(s.contracts.indexOf(c), 1);
    }
  }

  // Keep boards stocked. Assay events force a rich refresh.
  for (const cityId of s.cityOrder) {
    const city = s.cities[cityId];
    const openHere = s.contracts.filter((c) => c.state === 'open' && c.cityId === cityId).length;
    let maxOpen = 2 + (city === s.cities[s.factions[city.faction].capital] ? 1 : 0);
    if ((s.flags[`assay_${cityId}`] ?? 0) > s.day - 6) maxOpen += 2;
    if (openHere < maxOpen && rng.chance(0.3)) {
      s.contracts.push(generateContract(s, rng, cityId));
    }
  }
}

export function shortTitle(c: Contract): string {
  switch (c.kind) {
    case 'delivery': return `Deliver ${c.amount} ${GOODS[c.good!].name}`;
    case 'procurement': return `Procure ${c.amount} ${GOODS[c.good!].name}`;
    case 'escort': return `Escort ${c.patron.split(',')[0]}`;
    case 'smuggle': return `Smuggle ${c.amount} ${GOODS[c.good!].name}`;
    case 'survey': return 'Survey for the Guild';
  }
}

export function activeContracts(s: GameState): Contract[] {
  return s.contracts.filter((c) => c.state === 'active');
}

/** Called on arrival: auto-fulfil delivery/procurement/survey contracts here. */
export function checkArrivalContracts(s: GameState, cityId: string): Contract[] {
  const fulfilled: Contract[] = [];
  for (const c of activeContracts(s)) {
    if (c.kind === 'survey' && c.fromCity === cityId) {
      complete(s, c);
      fulfilled.push(c);
      continue;
    }
    if ((c.kind === 'delivery' || c.kind === 'procurement') && c.cityId === cityId && c.good) {
      const have = s.player.cargo[c.good] ?? 0;
      if (have >= (c.amount ?? 0)) {
        s.player.cargo[c.good] = have - (c.amount ?? 0);
        if ((s.player.cargo[c.good] ?? 0) <= 0) delete s.player.cargo[c.good];
        complete(s, c);
        fulfilled.push(c);
      }
    }
  }
  return fulfilled;
}

export function complete(s: GameState, c: Contract): void {
  c.state = 'done';
  const payout = Math.max(0, c.reward - c.advance); // advance was paid on taking
  s.player.gold += payout;
  s.player.contractsDone++;
  s.stats.contractsDone++;
  s.player.fame += 1;
  if (c.faction) s.player.rep[c.faction] = clamp((s.player.rep[c.faction] ?? 0) + c.repReward, -100, 100);
  else if (c.kind === 'smuggle') s.stats.smuggledRuns++;
  addNews(s, { kind: 'player', importance: c.reward > 800 ? 2 : 1, text: `Contract fulfilled: “${shortTitle(c)}” — ${Math.round(c.reward)} sols collected. ${c.faction ? `${s.factions[c.faction].name} remembers a kept word.` : ''}` });
  s.contracts.splice(s.contracts.indexOf(c), 1);
}

/** Take a contract off the board. */
export function takeContract(s: GameState, contractId: string): { ok: boolean; why?: string } {
  const c = s.contracts.find((x) => x.id === contractId);
  if (!c || c.state !== 'open') return { ok: false, why: 'That parchment is gone.' };
  if (activeContracts(s).length >= MAX_ACTIVE) return { ok: false, why: `You may hold at most ${MAX_ACTIVE} active contracts — finish or abandon one first.` };
  c.state = 'active';
  c.takenDay = s.day;
  if (c.advance > 0) s.player.gold += c.advance;
  if (c.kind === 'escort' && c.escortAgent) {
    const a = s.agents.find((x) => x.id === c.escortAgent);
    if (a) addNews(s, { kind: 'agent', importance: 1, text: `${agentDisplayName(a)} watches you sign the escort bond and visibly relaxes: “Ride within sight of my wagon, friend.”` });
  }
  return { ok: true };
}

export function abandonContract(s: GameState, contractId: string): void {
  const c = s.contracts.find((x) => x.id === contractId);
  if (!c || c.state !== 'active') return;
  if (c.advance > 0) s.player.gold -= Math.min(c.advance, s.player.gold);
  if (c.faction) s.player.rep[c.faction] = clamp((s.player.rep[c.faction] ?? 0) - 1, -100, 100);
  c.state = 'open';
  c.takenDay = undefined;
}

/** Escort resolution when the player arrives with their escorted agent. */
export function checkEscortArrival(s: GameState, cityId: string): Contract | null {
  for (const c of activeContracts(s)) {
    if (c.kind !== 'escort' || !c.escortAgent) continue;
    const a = s.agents.find((x) => x.id === c.escortAgent);
    if (!a || !a.alive) continue;
    if (a.loc.kind === 'city' && a.loc.cityId === cityId && c.fromCity === cityId) {
      complete(s, c);
      return c;
    }
  }
  return null;
}
