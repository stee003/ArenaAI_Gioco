import { Rng } from '../core/rng';
import { bus, T } from '../core/bus';
import { clamp, sum, uid } from '../core/util';
import { GOODS, GOOD_IDS } from '../data/goods';
import { CREW_ROLES, CREW_TRAITS } from '../data/crew';
import { UPGRADES } from '../data/upgrades';
import { rankDef, nextRankDef, baseCapacityForRank } from '../data/guild';
import { AMBITIONS } from '../data/ambitions';
import { AI_CARAVAN_NAMES, CARAVANSERAI_NAMES, EPITHETS } from '../data/names';
import { seasonOfDay } from '../core/calendar';
import {
  cargoSpace, cityIsBesieged, crewBonus, fencePrice, playerNetWorth,
  roadBetween, roadsOf, trade, SIGNATURE_GOODS,
} from './economy';
import { agentDayTick, agentDisplayName, findPath, killAgent } from './agents';
import { factionDayTick } from './factions';
import { cityDayTick } from './economy';
import { eventsDayTick, effectiveRoadDays, refreshRoadDanger } from './events';
import { rollEncounter, addFame, tempGuardsNote } from './encounters';
import { checkArrivalContracts, checkEscortArrival, contractsDayTick, complete as completeContract, activeContracts, takeContract } from './contracts';
import { compileChronicle } from './chronicle';
import { addNews } from './news';
import { generateWorld } from './worldgen';
import type {
  Agent, Contract, CrewMember, FactionId, GameState, GoodId, Pace, PendingToast, Road,
} from './types';

/**
 * The game orchestrator: owns the single GameState, the world RNG, and every
 * legal player action. UI code calls these functions and never mutates state
 * directly. One day = one advanceDay() = one full world heartbeat.
 */

export interface DayOutcome {
  day: number;
  arrived?: string;
  encounter?: import('./encounters').Encounter;
  notes: string[];
}

class Game {
  state: GameState | null = null;
  rng = new Rng(1);

  // ---------------------------------------------------------------- lifecycle

  newGame(seed: string, playerName: string, weekly = false): void {
    const safeName = playerName.replace(/[<>&"'`]/g, '').slice(0, 40) || 'A Nameless Merchant';
    this.state = generateWorld(seed, safeName, weekly);
    this.rng = new Rng(seed);
    this.rng.setState(this.state.rngState);
    // Stock the opening contract boards.
    for (let i = 0; i < 4; i++) contractsDayTick(this.state, this.rng);
    refreshRoadDanger(this.state);
    bus.emit(T.STATE);
  }

  attach(state: GameState, rngState?: number): void {
    this.state = state;
    this.rng = new Rng(state.seed);
    this.rng.setState(rngState ?? state.rngState);
  }

  startCityId(): string {
    return this.need().startCityId;
  }

  need(): GameState {
    if (!this.state) throw new Error('No game in progress');
    return this.state;
  }

  // ------------------------------------------------------------------ queries

  currentCityId(): string | null {
    const s = this.need();
    return s.player.loc.kind === 'city' ? s.player.loc.cityId : null;
  }

  currentRoad(): Road | null {
    const s = this.need();
    return s.player.loc.kind === 'road' ? s.roads[s.player.loc.roadId] : null;
  }

  travelProgress(): { day: number; ofDays: number } | null {
    const s = this.need();
    if (s.player.loc.kind !== 'road') return null;
    const total = Math.max(1, s.player.loc.arriveDay - s.player.loc.startDay);
    return { day: clamp(s.day - s.player.loc.startDay, 0, total), ofDays: total };
  }

  spaceUsed(): number {
    return cargoSpace(this.need().player.cargo);
  }

  spaceLeft(): number {
    const s = this.need();
    return s.player.capacity - this.spaceUsed();
  }

  netWorth(): number {
    return playerNetWorth(this.need());
  }

  /**
   * What the player knows about a city's prices. For the current city this is
   * exact and live; elsewhere it's the last witnessed snapshot (or a rumor),
   * with an uncertainty band that grows with staleness.
   */
  knownPrices(cityId: string): { day: number; price: Record<GoodId, number>; exact: boolean; uncertainty: number } {
    const s = this.need();
    const here = this.currentCityId();
    if (here === cityId) return { day: s.day, price: s.cities[cityId].price, exact: true, uncertainty: 0 };
    const kn = s.player.intel[cityId];
    if (!kn) {
      // No intel at all: show base values as a crude guess.
      const guess = {} as Record<GoodId, number>;
      for (const g of GOOD_IDS) guess[g] = GOODS[g].base;
      return { day: 0, price: guess, exact: false, uncertainty: 0.6 };
    }
    const age = s.day - kn.day;
    return { day: kn.day, price: kn.price, exact: false, uncertainty: Math.min(0.5, age * 0.012) };
  }

  /** Daily provisions burn for the whole company. */
  dailyProvisions(): number {
    const s = this.need();
    const p = s.player;
    let need = 1 + p.guards + p.crew.length + (s.flags.tempGuards as number ?? 0);
    if ((p.upgrades.secondwagon ?? 0) > 0) need *= 1.5;
    if (crewBonus(s, 'quartermaster') > 0) need *= 0.7;
    need += (p.cargo.horses ?? 0) * 2; // horses eat like horses
    return Math.max(1, Math.round(need * 10) / 10);
  }

  dailyWages(): number {
    const s = this.need();
    const p = s.player;
    const crewWages = sum(p.crew.map((m) => m.wage));
    const guardWages = p.guards * 2;
    const tempWages = p.loc.kind === 'road' ? ((s.flags.tempGuards as number) ?? 0) * 2 : 0;
    const captains = p.aiCaravans.length * 5;
    return crewWages + guardWages + tempWages + captains;
  }

  escortCompanion(): Agent | null {
    const s = this.need();
    for (const c of s.contracts) {
      if (c.state === 'active' && c.kind === 'escort' && c.escortAgent) {
        const a = s.agents.find((x) => x.id === c.escortAgent);
        if (a?.alive) return a;
      }
    }
    return null;
  }

  /** Travel days from here to a neighbor via the connecting road, with modifiers. */
  travelDaysTo(cityId: string): { days: number; road: Road } | null {
    const s = this.need();
    const here = this.currentCityId();
    if (!here) return null;
    const road = roadBetween(s, here, cityId);
    if (!road) return null;
    let days = effectiveRoadDays(s, road);
    const pace = s.player.pace;
    if (pace === 'cautious') days = Math.ceil(days * 1.25);
    if (pace === 'hard') days = Math.max(1, Math.round(days * 0.75));
    if (crewBonus(s, 'navigator') > 0 && days >= 3) days -= 1;
    const horses = s.player.upgrades.horses ?? 0;
    if (horses > 0) days = Math.max(1, Math.round(days * (1 - 0.15 * horses)));
    return { days: Math.max(1, days), road };
  }

  provisionsNeededFor(days: number): number {
    return Math.ceil(this.dailyProvisions() * days);
  }

  // ------------------------------------------------------------- player trades

  playerBuy(good: GoodId, qty: number): { ok: boolean; why?: string; result?: ReturnType<typeof trade> } {
    const s = this.need();
    const cityId = this.currentCityId();
    if (!cityId) return { ok: false, why: 'You are on the road. Markets are in cities.' };
    const city = s.cities[cityId];
    const fac = s.factions[city.faction];
    if (fac.ideology.contraband.includes(good)) return { ok: false, why: `${GOODS[good].name} is forbidden in ${city.name}. No stall will touch it — only the fence, to sell.` };
    const space = qty * GOODS[good].space;
    if (space > this.spaceLeft() + 1e-6) return { ok: false, why: `Not enough wagon space (need ${space}, have ${this.spaceLeft().toFixed(0)}).` };
    const cost = city.price[good] * qty;
    const credit = (s.player.upgrades.seal ?? 0) > 0 ? s.player.gold * 0.3 : 0;
    if (cost > s.player.gold + credit) return { ok: false, why: `That costs ~${Math.round(cost)} sols; you have ${Math.round(s.player.gold)}.` };

    const res = trade(s, cityId, good, qty, 'buy', { kind: 'player', faction: 'player' });
    if (res.qty <= 0) return { ok: false, why: `The market has no more ${GOODS[good].name.toLowerCase()} to dispense today.` };
    s.player.gold -= res.net;
    s.player.cargo[good] = (s.player.cargo[good] ?? 0) + res.qty;
    s.player.cargoCost[good] = (s.player.cargoCost[good] ?? 0) + res.net;
    s.stats.totalBought += res.net;
    s.player.lastBuyFaction = city.faction;
    // "Cornered" ambition: buying up the overwhelming bulk of a city's stock.
    const beforeStock = city.stock[good] + res.qty;
    if (res.qty >= 20 && res.qty >= beforeStock * 0.8) s.flags.corneredMarket = 1;
    // Trip accounting for "The Long Haul" ambition.
    s.flags.tripBuyDay = s.day;
    this.toast('trade', `Bought ${res.qty} × ${GOODS[good].name} @ ${res.unitPrice.toFixed(1)} — ${Math.round(res.net)} sols`);
    bus.emitTree(T.MARKET);
    bus.emit(T.PLAYER);
    return { ok: true, result: res };
  }

  playerSell(good: GoodId, qty: number): { ok: boolean; why?: string; profit?: number } {
    const s = this.need();
    const cityId = this.currentCityId();
    if (!cityId) return { ok: false, why: 'You are on the road.' };
    const city = s.cities[cityId];
    const fac = s.factions[city.faction];
    const embargoed: GoodId[] = [];
    for (const w of fac.wars) embargoed.push(...SIGNATURE_GOODS[w.enemy]);
    if (fac.ideology.contraband.includes(good)) return { ok: false, why: `${GOODS[good].name} is forbidden here. Find the fence in the tavern — quietly.` };
    if (embargoed.includes(good)) return { ok: false, why: `Wartime edict: ${GOODS[good].name} from the enemy cannot be sold openly in ${city.name}. The fence trades in exactly this kind of problem.` };
    const have = s.player.cargo[good] ?? 0;
    if (have < qty) return { ok: false, why: `You carry ${have}.` };

    const res = trade(s, cityId, good, qty, 'sell', { kind: 'player', faction: 'player' });
    if (res.qty <= 0) return { ok: false, why: `The market can absorb no more ${GOODS[good].name.toLowerCase()} today. Come back tomorrow — demand refills daily.` };

    s.player.gold += res.net;
    s.stats.totalSold += res.net;
    s.stats.tariffsPaid += res.tariff;
    s.player.cargo[good] = have - res.qty;
    // Honest profit accounting from the invested cost basis.
    const costBasis = (s.player.cargoCost[good] ?? 0) * (res.qty / have);
    s.player.cargoCost[good] = (s.player.cargoCost[good] ?? 0) - costBasis;
    if ((s.player.cargo[good] ?? 0) <= 0) {
      delete s.player.cargo[good];
      delete s.player.cargoCost[good];
    }
    const profit = res.net - costBasis;
    s.stats.tradeProfit += Math.max(0, profit);
    s.stats.goodsMoved[good] = (s.stats.goodsMoved[good] ?? 0) + res.qty;
    if (profit > s.stats.bestSingleTrade) s.stats.bestSingleTrade = Math.round(profit);

    // Tariffs paid are visible loyalty.
    s.player.rep[city.faction] = clamp((s.player.rep[city.faction] ?? 0) + Math.min(3, res.tariff * 0.02), -100, 100);

    // Feeding a besieged city: profit + gratitude from the besieged, anger from the besieger.
    if (cityIsBesieged(city, s.day) && ['grain', 'iron', 'horses', 'salt'].includes(good)) {
      s.stats.warProfits += res.net;
      s.player.rep[city.faction] = clamp(s.player.rep[city.faction] + Math.min(4, res.net * 0.006), -100, 100);
      const besieger = city.mods.besiegedBy!;
      s.player.rep[besieger] = clamp((s.player.rep[besieger] ?? 0) - Math.min(2.5, res.net * 0.003), -100, 100);
    }

    // Bridged-pair tracking for the peacemaker ambition.
    const lastBuy = s.player.lastBuyFaction;
    if (lastBuy && lastBuy !== city.faction) {
      s.flags[`bridged_${[lastBuy, city.faction].sort().join('|')}`] = 1;
    }

    // Long Haul ambition: a single profitable run of 15+ travel days.
    const tripBuyDay = s.flags.tripBuyDay as number | undefined;
    if (tripBuyDay && s.day - tripBuyDay >= 15 && profit > 0) s.flags.longHaul = 1;

    this.toast('trade', profit >= 0
      ? `Sold ${res.qty} × ${GOODS[good].name} @ ${res.unitPrice.toFixed(1)} — ${Math.round(res.net)} sols (profit ${Math.round(profit)}${res.tariff > 0 ? `, tariff ${Math.round(res.tariff)}` : ''})`
      : `Sold ${res.qty} × ${GOODS[good].name} @ ${res.unitPrice.toFixed(1)} — ${Math.round(res.net)} sols (loss ${Math.round(-profit)})`);
    if (profit > 500) {
      addFame(s, 1);
      addNews(s, { kind: 'player', importance: profit > 2000 ? 2 : 1, text: `${s.player.name} turned ${Math.round(profit)} sols of profit on a single ${GOODS[good].name.toLowerCase()} sale in ${city.name}. The exchange pretends not to be impressed.` });
    }
    bus.emitTree(T.MARKET);
    bus.emit(T.PLAYER);
    return { ok: true, profit };
  }

  playerSellToFence(good: GoodId, qty: number): { ok: boolean; why?: string; earned?: number } {
    const s = this.need();
    const cityId = this.currentCityId();
    if (!cityId) return { ok: false, why: 'The fence only trades in cities. So does the law.' };
    const city = s.cities[cityId];
    const fac = s.factions[city.faction];
    const embargoed: GoodId[] = [];
    for (const w of fac.wars) embargoed.push(...SIGNATURE_GOODS[w.enemy]);
    const isHot = fac.ideology.contraband.includes(good) || embargoed.includes(good);
    if (!isHot) return { ok: false, why: `The fence deals in forbidden goods only. ${GOODS[good].name} is legal here — use the open market for better prices.` };
    const have = s.player.cargo[good] ?? 0;
    if (have < qty) return { ok: false, why: `You carry ${have}.` };

    const unit = fencePrice(s, city, good);
    const earned = unit * qty;
    s.player.gold += earned;
    s.player.cargo[good] = have - qty;
    const costBasis = (s.player.cargoCost[good] ?? 0) * (qty / have);
    s.player.cargoCost[good] = (s.player.cargoCost[good] ?? 0) - costBasis;
    if ((s.player.cargo[good] ?? 0) <= 0) { delete s.player.cargo[good]; delete s.player.cargoCost[good]; }
    const profit = earned - costBasis;
    s.stats.tradeProfit += Math.max(0, profit);
    s.stats.goodsMoved[good] = (s.stats.goodsMoved[good] ?? 0) + qty;
    s.stats.totalSold += earned;

    // Smuggling contracts settle through the fence.
    for (const c of activeContracts(s)) {
      if (c.kind === 'smuggle' && c.cityId === cityId && c.good === good && qty >= (c.amount ?? 0)) {
        completeContract(s, c);
        this.toast('contract', `The hooded factor examines the ${GOODS[good].name.toLowerCase()}, nods once, and counts out your bond: ${c.reward} sols.`);
        break;
      }
    }
    this.toast('trade', `The fence takes ${qty} × ${GOODS[good].name.toLowerCase()} at ${unit.toFixed(1)} — ${Math.round(earned)} sols, no tariff, no names, no questions.`);
    bus.emitTree(T.MARKET);
    bus.emit(T.PLAYER);
    return { ok: true, earned };
  }

  // -------------------------------------------------------------- city services

  buyProvisions(days: number): { ok: boolean; why?: string } {
    const s = this.need();
    if (!this.currentCityId()) return { ok: false, why: 'Provisions are bought in cities.' };
    const cityId = this.currentCityId()!;
    const unit = Math.max(1.5, s.cities[cityId].price.grain * 0.55);
    const cost = Math.round(unit * days);
    if (s.player.gold < cost) return { ok: false, why: `${days} days of provisions costs ${cost} sols.` };
    s.player.gold -= cost;
    s.player.provisions += days;
    this.toast('info', `Bought ${days} days of provisions for ${cost} sols.`);
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  hireGuards(n: number): { ok: boolean; why?: string } {
    const s = this.need();
    if (!this.currentCityId()) return { ok: false, why: 'Guards are hired in cities.' };
    if (s.player.guards + n > 8) return { ok: false, why: 'Eight guards is the most one wagon can feed and pay.' };
    const cost = 40 * n;
    if (s.player.gold < cost) return { ok: false, why: `${n} guard${n > 1 ? 's' : ''} cost${n > 1 ? '' : 's'} ${cost} sols to hire (2 sols/day each thereafter).` };
    s.player.gold -= cost;
    s.player.guards += n;
    this.toast('info', `Hired ${n} guard${n > 1 ? 's' : ''} — 2 sols a day each, and worth it exactly when you least expect.`);
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  dismissGuards(n: number): void {
    const s = this.need();
    s.player.guards = Math.max(0, s.player.guards - n);
    bus.emit(T.PLAYER);
  }

  crewCandidates(cityId: string): CrewMember[] {
    const s = this.need();
    const rng = new Rng(`${s.seed}|crew|${cityId}|${Math.floor(s.day / 2)}`);
    const count = 2 + (cityId === s.factions[s.cities[cityId].faction].capital ? 2 : rng.int(0, 2));
    const out: CrewMember[] = [];
    for (let i = 0; i < count; i++) {
      const faction = s.cities[cityId].faction;
      const pool = Object.values(CREW_ROLES).filter((r) => r.affinity.includes(faction) || rng.chance(0.3));
      const role = rng.pick(pool.length ? pool : Object.values(CREW_ROLES));
      const trait = rng.chance(0.35) ? rng.pick(Object.values(CREW_TRAITS)) : undefined;
      out.push({
        id: `cand_${cityId}_${i}`,
        name: tavernName(rng, faction),
        role: role.id,
        wage: Math.round(role.wage * (trait?.wageMult ?? 1)),
        hiredDay: 0,
        trait: trait?.id,
      });
    }
    return out;
  }

  hireCrew(cityId: string, index: number): { ok: boolean; why?: string } {
    const s = this.need();
    const slots = rankDef(s.player.guildRank).crewSlots;
    if (s.player.crew.length >= slots) return { ok: false, why: `Your company has ${s.player.crew.length} specialists — the limit at rank ${s.player.guildRank} is ${slots}. Rise in the Guild to widen the fire-circle.` };
    const cands = this.crewCandidates(cityId);
    const cand = cands[index];
    if (!cand) return { ok: false, why: 'That table is empty now.' };
    const hireFee = cand.wage * 3;
    if (s.player.gold < hireFee) return { ok: false, why: `${cand.name} asks ${hireFee} sols up front (three days' wage).` };
    s.player.gold -= hireFee;
    s.player.crew.push({ ...cand, id: uid('crew'), hiredDay: s.day });
    this.toast('info', `${cand.name} (${CREW_ROLES[cand.role].name}) joins your company — ${cand.wage} sols/day.`);
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  fireCrew(id: string): void {
    const s = this.need();
    const member = s.player.crew.find((m) => m.id === id);
    s.player.crew = s.player.crew.filter((m) => m.id !== id);
    if (member) this.toast('info', `${member.name} takes their final wage and vanishes into the ${'crowd'}.`);
    bus.emit(T.PLAYER);
  }

  buyUpgrade(id: string): { ok: boolean; why?: string } {
    const s = this.need();
    const def = UPGRADES[id];
    if (!def) return { ok: false, why: 'No such upgrade.' };
    const level = s.player.upgrades[id] ?? 0;
    if (level >= def.maxLevel) return { ok: false, why: 'Already at the highest craft.' };
    if (def.rankReq && s.player.guildRank < def.rankReq) return { ok: false, why: `Requires guild rank ${def.rankReq} (${rankDef(def.rankReq).name}).` };
    const cost = def.cost(level + 1);
    if (s.player.gold < cost) return { ok: false, why: `Costs ${cost} sols; you have ${Math.round(s.player.gold)}.` };
    s.player.gold -= cost;
    s.player.upgrades[id] = level + 1;
    s.player.capacity = this.computeCapacity();
    this.toast('info', `${def.name} level ${level + 1} installed. ${def.desc}`);
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  computeCapacity(): number {
    const s = this.need();
    let cap = baseCapacityForRank(s.player.guildRank);
    cap += (s.player.upgrades.wagon ?? 0) * 28;
    if ((s.player.upgrades.secondwagon ?? 0) > 0) cap += 90;
    return cap;
  }

  buyWarehouse(cityId: string): { ok: boolean; why?: string } {
    const s = this.need();
    if (s.player.guildRank < 3) return { ok: false, why: 'Warehouses require guild rank 3 (Merchant).' };
    if (s.player.warehouses.includes(cityId)) return { ok: false, why: 'You already hold a warehouse here.' };
    if (s.player.gold < 500) return { ok: false, why: 'A warehouse costs 500 sols.' };
    s.player.gold -= 500;
    s.player.warehouses.push(cityId);
    s.player.storage[cityId] = {};
    this.toast('info', `Warehouse acquired in ${s.cities[cityId].name}: 300 units of space, no spoilage, and a courier refreshes your price intel here every 5 days.`);
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  warehouseSpaceLeft(cityId: string): number {
    const s = this.need();
    const st = s.player.storage[cityId] ?? {};
    return 300 - cargoSpace(st);
  }

  transferToWarehouse(cityId: string, good: GoodId, qty: number): { ok: boolean; why?: string } {
    const s = this.need();
    if (!s.player.warehouses.includes(cityId)) return { ok: false, why: 'No warehouse here.' };
    const have = s.player.cargo[good] ?? 0;
    if (have < qty) return { ok: false, why: `You carry ${have}.` };
    const space = qty * GOODS[good].space;
    if (space > this.warehouseSpaceLeft(cityId) + 1e-6) return { ok: false, why: 'Not enough warehouse space.' };
    s.player.cargo[good] = have - qty;
    const costShare = (s.player.cargoCost[good] ?? 0) * (qty / have);
    s.player.cargoCost[good] = (s.player.cargoCost[good] ?? 0) - costShare;
    if (s.player.cargo[good]! <= 0) { delete s.player.cargo[good]; delete s.player.cargoCost[good]; }
    const st = s.player.storage[cityId];
    st[good] = (st[good] ?? 0) + qty;
    s.flags[`wh_cost_${cityId}_${good}`] = ((s.flags[`wh_cost_${cityId}_${good}`] as number) ?? 0) + costShare;
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  transferFromWarehouse(cityId: string, good: GoodId, qty: number): { ok: boolean; why?: string } {
    const s = this.need();
    const st = s.player.storage[cityId];
    if (!st) return { ok: false, why: 'No warehouse here.' };
    const have = st[good] ?? 0;
    if (have < qty) return { ok: false, why: `The warehouse holds ${have}.` };
    const space = qty * GOODS[good].space;
    if (space > this.spaceLeft() + 1e-6) return { ok: false, why: 'Not enough wagon space.' };
    st[good] = have - qty;
    if (st[good]! <= 0) delete st[good];
    const costKey = `wh_cost_${cityId}_${good}`;
    const totalCost = (s.flags[costKey] as number) ?? 0;
    const share = totalCost * (qty / have);
    s.flags[costKey] = totalCost - share;
    s.player.cargo[good] = (s.player.cargo[good] ?? 0) + qty;
    s.player.cargoCost[good] = (s.player.cargoCost[good] ?? 0) + share;
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  // ------------------------------------------------------------------- rumors

  rumorCost(kind: string): number {
    const s = this.need();
    const base: Record<string, number> = { prices: 30, war: 45, merchant: 25, roads: 25 };
    let cost = base[kind] ?? 30;
    if (crewBonus(s, 'linguist') > 0) cost *= 0.85;
    return Math.round(cost);
  }

  spyFreeRumor(): boolean {
    const s = this.need();
    return crewBonus(s, 'spy') > 0 && s.day - ((s.flags.lastSpyRumor as number) ?? -99) >= 3;
  }

  buyRumor(kind: 'prices' | 'war' | 'merchant' | 'roads', target?: string): { ok: boolean; why?: string; text?: string } {
    const s = this.need();
    if (!this.currentCityId()) return { ok: false, why: 'Rumors are bought in taverns, and taverns are in cities.' };
    const free = this.spyFreeRumor();
    const cost = free ? 0 : this.rumorCost(kind);
    if (s.player.gold < cost) return { ok: false, why: `That rumor costs ${cost} sols.` };
    s.player.gold -= cost;
    if (free) s.flags.lastSpyRumor = s.day;
    s.stats.rumorsBought++;
    const here = this.currentCityId()!;
    let text = '';

    if (kind === 'prices') {
      const candidates = s.cityOrder.filter((c) => c !== here);
      const cityId = target && candidates.includes(target) ? target : pickBestRumorCity(s, candidates);
      s.player.intel[cityId] = { day: s.day, price: { ...s.cities[cityId].price } };
      text = `A grain-factor, two cups deep, recites ${s.cities[cityId].name}'s board from memory: ${topThreePrices(s, cityId)}. Fresh as this morning. Your ledger records it as fact.`;
    } else if (kind === 'war') {
      const fac = target && s.factions[target as FactionId] ? s.factions[target as FactionId] : pickTensestFaction(s);
      const lines: string[] = [];
      for (const other of Object.keys(fac.relations) as FactionId[]) {
        const rel = fac.relations[other];
        if (rel < -30) lines.push(`${s.factions[other].name}: ${rel < -55 ? 'HATRED — the war-councils are already seated' : 'cold (' + Math.round(rel) + ')'}`);
        else if (rel > 30) lines.push(`${s.factions[other].name}: warm (${Math.round(rel)})`);
      }
      const imminent = (Object.keys(fac.relations) as FactionId[]).some((o) => fac.relations[o] < -55 && !fac.wars.some((w) => w.enemy === o));
      text = `An old courier who sells state secrets by the cupful leans close: ${fac.name} — ${lines.length ? lines.join('; ') : 'at nominal peace with everyone, which nobody believes'}. ${imminent ? '“March-orders within a season,” he says. “Bet accordingly.”' : 'No drums yet. Yet.'}`;
    } else if (kind === 'merchant') {
      const alive = s.agents.filter((a) => a.alive && !a.owner);
      const a = alive.length ? pickInterestingAgent(s, alive) : null;
      if (a) {
        const goods = GOOD_IDS.filter((g) => (a.cargo[g] ?? 0) > 0);
        const cargoText = goods.length ? goods.map((g) => `${a.cargo[g]} × ${GOODS[g].name.toLowerCase()}`).join(', ') : 'an empty wagon and a full head of schemes';
        const dest = a.dest ? `bound for ${s.cities[a.dest].name}` : a.loc.kind === 'city' ? `still drinking in ${s.cities[a.loc.cityId].name}` : 'somewhere on the road';
        text = `“${agentDisplayName(a)}?” The cup-bearer shrugs. “${cargoText}, ${dest}, and ${a.gold > 1200 ? 'rich enough to buy this tavern but too mean to' : 'poor enough to be interesting'}.” That kind of information is a head start or a trap; the road decides which.`;
      } else {
        text = 'The cup-bearer has heard nothing — which is itself suspicious, and free of charge.';
      }
    } else {
      const cityId = target ?? here;
      const roads = roadsOf(s, cityId);
      const lines = roads.map((r) => {
        const other = r.a === cityId ? r.b : r.a;
        const chief = r.banditsUntil > s.day && r.banditChief ? `, ${r.banditChief} abroad` : '';
        return `${s.cities[other].name}: danger ${r.danger}${chief}`;
      });
      text = `Teamsters by the fire compare the roads out of ${s.cities[cityId].name}: ${lines.join(' — ')}. Truthful numbers, roughly. Teamsters lie about everything except danger.`;
    }
    bus.emit(T.PLAYER);
    return { ok: true, text };
  }

  // ------------------------------------------------------------------ travel

  setPace(pace: Pace): void {
    this.need().player.pace = pace;
    bus.emit(T.PLAYER);
  }

  departTo(cityId: string): { ok: boolean; why?: string } {
    const s = this.need();
    const plan = this.travelDaysTo(cityId);
    if (!plan) return { ok: false, why: 'No road connects here to there.' };
    const needed = this.provisionsNeededFor(plan.days);
    if (s.player.provisions < needed) return { ok: false, why: `The journey needs ${needed} days of provisions; you carry ${s.player.provisions.toFixed(0)}. Buy more at the market stalls.` };
    const escort = this.escortCompanion();
    s.player.loc = {
      kind: 'road', roadId: plan.road.id, from: this.currentCityId()!, to: cityId,
      startDay: s.day, arriveDay: s.day + plan.days,
    };
    s.flags.tripStartDay = s.day;
    if (s.tutorial < 2) s.flags.scheduledEncounter = 1; // first trip always meets a friendly wagon
    // The escorted merchant's wagon falls in beside yours.
    if (escort) {
      escort.loc = { ...s.player.loc };
      escort.escortFor = s.contracts.find((c) => c.state === 'active' && c.kind === 'escort')?.id;
      escort.dest = cityId;
    }
    this.toast('info', `Your caravan rolls for ${s.cities[cityId].name} — ${plan.days} day${plan.days > 1 ? 's' : ''} at ${paceWord(s.player.pace)} pace. The world keeps turning while you ride.`);
    bus.emit(T.TRAVEL);
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  // --------------------------------------------------------------- the day tick

  advanceDay(): DayOutcome {
    const s = this.need();
    const notes: string[] = [];
    s.day++;
    s.stats.daysPlayed = s.day - 1;

    // 1. Economy: every city produces, consumes, and re-prices.
    for (const cityId of s.cityOrder) {
      notes.push(...cityDayTick(s, s.cities[cityId], () => this.rng.float()));
    }
    // 2. Roads recompute danger from the world's current temper.
    refreshRoadDanger(s);
    // 3. World events.
    eventsDayTick(s, this.rng);
    // 4. Factions: treasuries, relations, wars, sieges, conquests.
    factionDayTick(s, this.rng);
    // 5. Rival merchants live their day.
    agentDayTick(s, this.rng);
    // 6. Player-owned AI caravans report weekly.
    this.aiCaravanReports();
    // 7. Contract boards refresh and deadlines bite.
    contractsDayTick(s, this.rng);
    // 8. Courier warehouses refresh intel every 5 days.
    if (s.day % 5 === 0) {
      for (const cityId of s.player.warehouses) {
        s.player.intel[cityId] = { day: s.day, price: { ...s.cities[cityId].price } };
      }
    }
    // 9. Loans accrue when overdue.
    if (s.player.debt > 0 && s.day > s.player.debtDueDay) {
      s.player.debt *= 1.005;
      if (s.day % 30 === 0) {
        s.player.fame = Math.max(0, s.player.fame - 1);
        addNews(s, { kind: 'player', importance: 1, text: `The Guild notes your overdue debt (${Math.round(s.player.debt)} sols). Creditors have long memories and short tempers.` });
      }
    }
    // 10. Wages & provisions.
    this.payDaily(s, notes);

    // Guild relief: a merchant with nothing but their name is never quite
    // without options — the game must never become unwinnable.
    if (s.player.gold < 25 && cargoSpace(s.player.cargo) < 1 &&
        s.day - (s.flags.lastRelief ?? -99) > 25) {
      s.flags.lastRelief = s.day;
      s.player.gold += 60;
      s.player.provisions += 5;
      addNews(s, { kind: 'player', importance: 1, text: `The Guild's relief chest opens for ${s.player.name}: sixty sols and five days of hard bread. “Every keeper of the ledger earns one more page,” the clerk says, not unkindly. “Spend it wisely, or don't. There are no more pages after this one for a while.”` });
      this.toast('info', 'Guild relief: +60 sols, +5 days of provisions. The road offers one more chance — survey contracts pay for walking.');
    }

    // 11. Player movement / encounters / arrival.
    let outcome: DayOutcome = { day: s.day, notes };
    if (s.player.loc.kind === 'road') {
      const escort = this.escortCompanion();
      if (s.day >= s.player.loc.arriveDay) {
        const arrivalCity = s.player.loc.to;
        s.stats.distanceTraveled += Math.max(1, s.player.loc.arriveDay - s.player.loc.startDay);
        s.player.tripFromCity = s.player.loc.from;
        s.player.loc = { kind: 'city', cityId: arrivalCity };
        if (escort) {
          escort.loc = { kind: 'city', cityId: arrivalCity, restUntil: s.day };
          escort.escortFor = undefined;
        }
        tempGuardsNote(s);
        this.onArrive(s, arrivalCity, notes);
        outcome.arrived = arrivalCity;
      } else {
        const road = s.roads[s.player.loc.roadId];
        if (escort) escort.loc = { ...s.player.loc };
        const encounter = rollEncounter(s, this.rng, road);
        if (encounter) outcome.encounter = encounter;
        // Provisions burn on the road.
        this.consumeProvisions(s, notes);
      }
    } else {
      // Waiting in a city: cargo ages (slowly), intel of this city refreshes.
      for (const g of GOOD_IDS) {
        if ((s.player.cargo[g] ?? 0) > 0 && GOODS[g].perish > 0) {
          const lost = (s.player.cargo[g] ?? 0) * GOODS[g].perish * 0.5;
          s.player.cargo[g] = (s.player.cargo[g] ?? 0) - lost;
          if (s.player.cargo[g]! < 0.5) delete s.player.cargo[g];
        }
      }
      const here = s.player.loc.cityId;
      s.player.intel[here] = { day: s.day, price: { ...s.cities[here].price } };
    }


    // 11b. Banished in a hostile city? Patrols make themselves felt daily.
    if (s.player.loc.kind === 'city') {
      const facId = s.cities[s.player.loc.cityId].faction;
      const banUntil = s.player.banned[facId] ?? 0;
      if (banUntil > s.day && this.rng.chance(0.3)) {
        const city = s.cities[s.player.loc.cityId];
        const hot = GOOD_IDS.filter((g) => (s.player.cargo[g] ?? 0) > 0 && s.factions[facId].ideology.contraband.includes(g));
        if (hot.length) {
          let value = 0;
          for (const g of hot) {
            value += (s.player.cargo[g] ?? 0) * city.price[g];
            delete s.player.cargo[g];
            delete s.player.cargoCost[g];
          }
          const fine = Math.min(s.player.gold, Math.round(value * 0.5));
          s.player.gold -= fine;
          s.player.rep[facId] = clamp((s.player.rep[facId] ?? 0) - 2, -100, 100);
          this.toast('warning', `A patrol pulls your wagon aside in ${city.name} and finds exactly what it hoped for: ${hot.map((g) => GOODS[g].name).join(', ')} confiscated, ${fine} sols fined. Banished merchants make excellent examples.`);
          addNews(s, { kind: 'crime', importance: 1, text: `Customs wardens in ${city.name} strip a banished merchant's wagon to the frame: ${hot.map((g) => GOODS[g].name.toLowerCase()).join(', ')} seized, ${fine} sols in fines. The crowd approves. The merchant's ledger does not.` });
        } else {
          const fine = Math.min(s.player.gold, Math.round(s.player.gold * 0.05) + 5);
          s.player.gold -= fine;
          this.toast('warning', `You are banished here until day ${banUntil}. The patrol "inspects" every crate twice and charges ${fine} sols for the privilege of not being arrested.`);
        }
        bus.emit(T.PLAYER);
      }
    }

    // 12. Chronicle every ten days.
    if (s.day % 10 === 0) {
      const issue = compileChronicle(s, this.rng);
      s.chronicles.unshift(issue);
      if (s.chronicles.length > 40) s.chronicles.pop();
      this.toast('chronicle', `A fresh Chronicle is nailed to the post: “${issue.headline.slice(0, 70)}${issue.headline.length > 70 ? '…' : ''}”`);
      bus.emit(T.NEWS);
    }

    // 13. Ambitions.
    this.checkAmbitions(s);

    // 14. Tutorial nudges.
    this.tutorialTick(s);

    s.rngState = this.rng.getState();
    if (s.settings.autosave) queueMicrotask(() => saveGame(s));
    bus.emit(T.DAY);
    bus.emit(T.STATE);
    return outcome;
  }

  private onArrive(s: GameState, cityId: string, notes: string[]): void {
    const banUntil = s.player.banned[s.cities[cityId].faction] ?? 0;
    if (banUntil > s.day) {
      notes.push(`You enter ${s.cities[cityId].name} under banishment (until day ${banUntil}). Every patrol you pass reads your face twice.`);
      this.toast('warning', `${s.cities[cityId].name} is ${s.factions[s.cities[cityId].faction].name} ground, and you are banished until day ${banUntil}. Expect daily inspections, fines, and confiscation of anything forbidden.`);
    }
    const first = !s.stats.citiesVisited.includes(cityId);
    s.player.intel[cityId] = { day: s.day, price: { ...s.cities[cityId].price } };
    if (first) {
      s.stats.citiesVisited.push(cityId);
      addFame(s, 1);
      notes.push(`You enter ${s.cities[cityId].name} for the first time. The Almanac records it; so, in its way, does the city.`);
    }
    // Winter pass ambition.
    const lastRoad = this.lastRoadUsed(s);
    if (lastRoad?.kind === 'pass' && seasonOfDay(s.day) === 'winter') s.flags.winterPass = 1;
    // Contracts that complete by standing here.
    const done = checkArrivalContracts(s, cityId);
    checkEscortArrival(s, cityId);
    for (const c of done) this.toast('contract', `Contract fulfilled: “${contractLabel(c)}” — ${c.reward} sols.`);
    if (first) this.toast('arrival', `Welcome to ${s.cities[cityId].name}, seat of the ${s.factions[s.cities[cityId].faction].name.replace(/^The /, '')}. Its true prices are now known to you.`);
    bus.emit(T.TRAVEL);
    bus.emit(T.PLAYER);
    bus.emit(T.MARKET);
  }

  private lastRoadUsed(s: GameState): Road | null {
    // loc is already 'city' on arrival; the trip origin remembers the road.
    const from = s.player.tripFromCity;
    const to = s.player.loc.kind === 'city' ? s.player.loc.cityId : null;
    if (from && to) return roadBetween(s, from, to) ?? null;
    return null;
  }

  private consumeProvisions(s: GameState, notes: string[]): void {
    const need = this.dailyProvisions();
    s.player.provisions -= need;
    if (s.player.provisions < 0) {
      // Eat cargo grain before starving (thematic and forgiving).
      const grain = s.player.cargo.grain ?? 0;
      const sacks = Math.min(grain, Math.ceil(-s.player.provisions / 3));
      if (sacks > 0) {
        s.player.cargo.grain = grain - sacks;
        if (s.player.cargo.grain <= 0) delete s.player.cargo.grain;
        s.player.provisions += sacks * 3;
        notes.push(`The company eats cargo grain (${sacks} sacks). The ledger weeps; the mules do not.`);
      }
    }
    if (s.player.provisions < 0) {
      s.player.provisions = 0;
      s.player.luck = clamp(s.player.luck - 0.01, 0.7, 1.3);
      if (this.rng.chance(0.35) && (s.flags.moraleUntil as number ?? 0) < s.day) {
        // Desertion.
        const eager = s.player.crew.find((m) => m.trait === 'eager');
        if (s.player.guards > 0 && !eager) {
          s.player.guards -= 1;
          notes.push('A guard walks off into the dawn without his wages. Hunger argues better than loyalty.');
        } else if (eager) {
          s.player.crew = s.player.crew.filter((m) => m !== eager);
          notes.push(`${eager.name} deserts at first light — the eager always leave first.`);
        } else if (s.player.crew.length > 0 && this.rng.chance(0.4)) {
          const gone = this.rng.pick(s.player.crew);
          if (gone.trait !== 'veteran') {
            s.player.crew = s.player.crew.filter((m) => m !== gone);
            notes.push(`${gone.name} leaves your company, citing "the menu".`);
          }
        }
      }
    }
  }

  private payDaily(s: GameState, notes: string[]): void {
    const wages = this.dailyWages();
    if (wages > 0) {
      if (s.player.gold >= wages) s.player.gold -= wages;
      else {
        const short = wages - s.player.gold;
        s.player.gold = 0;
        notes.push(`You cannot cover today's wages (${Math.round(short)} sols short). The fire-circle is quiet tonight.`);
        if ((s.flags.moraleUntil as number ?? 0) < s.day && s.player.crew.length > 0 && this.rng.chance(0.3)) {
          const gone = this.rng.pick(s.player.crew.filter((m) => m.trait !== 'veteran'));
          if (gone) {
            s.player.crew = s.player.crew.filter((m) => m !== gone);
            notes.push(`${gone.name} takes their unpaid wage out of your ledger in chalk — on the wagon — and leaves.`);
          }
        }
      }
    }
  }

  private aiCaravanReports(): void {
    const s = this.need();
    for (const book of s.player.aiCaravans) {
      const a = s.agents.find((x) => x.id === book.agentId);
      if (!a || !a.alive) continue;
      if (s.day - book.lastReport >= 7) {
        book.lastReport = s.day;
        const where = a.loc.kind === 'city' ? `in ${s.cities[a.loc.cityId].name}` : `on the road to ${a.dest ? s.cities[a.dest].name : 'market'}`;
        const standing = a.gold - book.float;
        addNews(s, {
          kind: 'player', importance: 1,
          text: `Weekly letter from “${book.name}” (${a.name ? 'captain ' + a.name.split(' ')[0] : ''}): ${where}, float ${Math.round(a.gold)} sols (${standing >= 0 ? '+' : '−'}${Math.abs(Math.round(standing))} vs. entrusted). ${standing > 0 ? 'The captain adds a drawing of a camel. It is meant to be you.' : 'The captain requests patience and better roads.'}`,
        });
      }
    }
  }

  // ------------------------------------------------------------- AI caravans

  hireAiCaravan(baseCityId: string, float: number, route: string[], name?: string): { ok: boolean; why?: string } {
    const s = this.need();
    const max = rankDef(s.player.guildRank).maxAiCaravans;
    if (s.player.aiCaravans.length >= max) return { ok: false, why: `Your rank licenses ${max} caravan${max === 1 ? '' : 's'}. The Guild does not bend paper.` };
    if (float < 400) return { ok: false, why: 'A captain will not take the road with less than 400 sols of float.' };
    const licenseFee = 400;
    if (s.player.gold < float + licenseFee) return { ok: false, why: `You need ${float} sols of float plus a ${licenseFee}-sol Guild license.` };
    if (route.length < 2 || route[0] !== baseCityId) return { ok: false, why: 'A route must start and end at its home city, with at least one other stop.' };
    s.player.gold -= float + licenseFee;
    const captainName = caravanCaptainName(s, this.rng);
    const agent: Agent = {
      id: `pc${++s.nextAgentNum}`,
      name: captainName, faction: s.cities[baseCityId].faction, home: baseCityId,
      gold: float, capacity: 260 + s.player.guildRank * 30, cargo: {}, guards: 2,
      risk: 0.55, greed: 0.6,
      loc: { kind: 'city', cityId: baseCityId, restUntil: s.day + 1 },
      knowledge: { [baseCityId]: { day: s.day, price: { ...s.cities[baseCityId].price } } },
      dest: null, deeds: [], alive: true, tradeVolume: 0,
      owner: 'player', route: [...route], float,
    };
    s.agents.push(agent);
    s.player.aiCaravans.push({
      agentId: agent.id, name: name ?? nextCaravanName(s), float, route: [...route],
      hiredDay: s.day, lastReport: s.day, totalProfit: 0,
    });
    this.toast('info', `“${s.player.aiCaravans[s.player.aiCaravans.length - 1].name}” takes the road with ${float} sols and captain ${captainName}. Its profits return to you whenever it completes its loop.`);
    addNews(s, { kind: 'player', importance: 1, text: `${s.player.name} puts a caravan of their own on the road — “${s.player.aiCaravans[s.player.aiCaravans.length - 1].name}”, out of ${s.cities[baseCityId].name}. The exchange files it under: ambitious.` });
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  dismissAiCaravan(agentId: string): void {
    const s = this.need();
    const book = s.player.aiCaravans.find((b) => b.agentId === agentId);
    if (!book) return;
    const a = s.agents.find((x) => x.id === agentId);
    if (a) {
      s.player.gold += Math.max(0, a.gold);
      killAgent(s, a, 'was mustered out of service when their master sold the wagons');
      a.alive = false;
    }
    s.player.aiCaravans = s.player.aiCaravans.filter((b) => b.agentId !== agentId);
    bus.emit(T.PLAYER);
  }

  // ------------------------------------------------------------- caravanserais

  caravanseraiCost(roadId: string): number {
    const s = this.need();
    const r = s.roads[roadId];
    return Math.round(1200 + r.days * 350 + r.danger * 6);
  }

  buildCaravanserai(roadId: string, name?: string): { ok: boolean; why?: string } {
    const s = this.need();
    if (!rankDef(s.player.guildRank).canBuildCaravanserai) return { ok: false, why: 'Caravanserai permits require guild rank 5 (Magnate).' };
    const r = s.roads[roadId];
    if (!r) return { ok: false, why: 'No such road.' };
    if (r.caravanserai) return { ok: false, why: 'That road already has a caravanserai. One lamp per road is the old rule.' };
    for (const cid of [r.a, r.b]) {
      const rep = s.player.rep[s.cities[cid].faction] ?? 0;
      if (rep < 30) return { ok: false, why: `${s.factions[s.cities[cid].faction].name} will not permit it — you need Trusted standing (30+) with them (${Math.round(rep)} now).` };
    }
    const cost = this.caravanseraiCost(roadId);
    if (s.player.gold < cost) return { ok: false, why: `Building here costs ${cost} sols.` };
    s.player.gold -= cost;
    r.caravanserai = 'player';
    r.caravanseraiName = name ?? nextCaravanseraiName(s);
    s.player.caravanserais.push(roadId);
    addNews(s, {
      kind: 'caravanserai', importance: 2,
      text: `${r.caravanseraiName} opens its gates on the ${s.cities[r.a].name}–${s.cities[r.b].name} road — ${s.player.name}'s own: a well, a wall, a lamp that burns all night. Traveling merchants will pay for the safety; the road itself grows quieter by fifteen degrees of danger.`,
    });
    this.toast('info', `${r.caravanseraiName} is yours. Merchants will lodge (and pay, and gossip), the road grows safer, and your nights on it are secure.`);
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  // ------------------------------------------------------------------- guild

  takeLoan(amount: number): { ok: boolean; why?: string } {
    const s = this.need();
    if (!rankDef(s.player.guildRank).canTakeLoans) return { ok: false, why: 'Guild credit begins at rank 2 (Factor).' };
    if (s.player.debt > 0) return { ok: false, why: 'Settle your existing debt first. The Guild reads its own ledgers.' };
    const max = 500 + s.player.guildRank * 300;
    if (amount > max) return { ok: false, why: `Your rank permits borrowing up to ${max} sols.` };
    s.player.gold += amount;
    s.player.debt = amount;
    s.player.debtDueDay = s.day + 30;
    this.toast('info', `Borrowed ${amount} sols at 10% per 30 days, due day ${s.player.debtDueDay}. Overdue debt compounds and costs you standing.`);
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  repayLoan(amount: number): { ok: boolean; why?: string } {
    const s = this.need();
    const pay = Math.min(amount, s.player.debt, s.player.gold);
    if (pay <= 0) return { ok: false, why: 'Nothing to repay.' };
    s.player.gold -= pay;
    s.player.debt -= pay;
    if (s.player.debt <= 0.5) s.player.debt = 0;
    this.toast('info', `Repaid ${Math.round(pay)} sols. Debt remaining: ${Math.round(s.player.debt)}.`);
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  donate(factionId: FactionId, amount: number): { ok: boolean; why?: string } {
    const s = this.need();
    if (s.player.gold < amount) return { ok: false, why: 'You cannot donate coin you do not have.' };
    s.player.gold -= amount;
    const repGain = Math.min(10, amount / 40) * (crewBonus(s, 'herald') > 0 ? 1.25 : 1);
    s.player.rep[factionId] = clamp((s.player.rep[factionId] ?? 0) + repGain, -100, 100);
    this.toast('info', `Gifted ${amount} sols to ${s.factions[factionId].name}: +${repGain.toFixed(1)} standing.`);
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  canClaimRank(): { ok: boolean; why?: string; def: ReturnType<typeof nextRankDef> } {
    const s = this.need();
    const def = nextRankDef(s.player.guildRank);
    if (!def) return { ok: false, why: 'You stand at the top of the Guild\u2019s ladder. It ends at the sky.', def: null };
    const nw = this.netWorth();
    if (nw < def.netWorth) return { ok: false, why: `Net worth ${Math.round(nw)} / ${def.netWorth} sols required.`, def };
    if (s.stats.contractsDone < def.contracts) return { ok: false, why: `${s.stats.contractsDone} / ${def.contracts} guild contracts fulfilled.`, def };
    if (s.player.fame < def.fame) return { ok: false, why: `Fame ${Math.round(s.player.fame)} / ${def.fame} required. Fame grows from notable deeds — big trades, kept contracts, survived roads.`, def };
    if (s.player.gold < def.fee) return { ok: false, why: `The promotion ceremony costs ${def.fee} sols.`, def };
    return { ok: true, why: undefined, def };
  }

  claimRank(): { ok: boolean; why?: string } {
    const s = this.need();
    const check = this.canClaimRank();
    if (!check.ok || !check.def) return { ok: false, why: check.why };
    const def = check.def;
    s.player.gold -= def.fee;
    s.player.guildRank = def.rank;
    s.player.capacity = this.computeCapacity();
    // A new epithet, earned: the ceremony asks you to stop being "the Young".
    if (s.player.epithetPool.length) {
      s.player.epithet = s.player.epithetPool[s.player.epithetPool.length - 1];
    } else if (s.player.epithet === 'the Young') {
      s.player.epithet = this.rng.pick(EPITHETS);
    }
    this.toast('rank', `The Guild seals your promotion: you are now ${def.name} — ${s.player.name} ${s.player.epithet}. ${def.perks.join(' · ')}`);
    addNews(s, { kind: 'player', importance: 2, text: `The Merchants' Guild raises ${s.player.name} ${s.player.epithet} to the rank of ${def.name}. Candles, wax, one bored notary, and a future that just got larger.` });
    bus.emit(T.PLAYER);
    return { ok: true };
  }

  // -------------------------------------------------------------- ambitions

  private checkAmbitions(s: GameState): void {
    for (const amb of AMBITIONS) {
      const prog = s.ambitions[amb.id];
      if (prog?.done) continue;
      let done = false;
      try { done = amb.check(s); } catch { done = false; }
      if (done) {
        s.ambitions[amb.id] = { done: true, day: s.day };
        if (amb.reward.gold) s.player.gold += amb.reward.gold;
        if (amb.reward.fame) addFame(s, amb.reward.fame);
        if (amb.reward.epithet) s.player.epithetPool.push(amb.reward.epithet);
        this.toast('ambition', `Ambition achieved — ${amb.name}: ${amb.desc}${amb.reward.gold ? ` (+${amb.reward.gold} sols)` : ''}${amb.reward.epithet ? ` You may now be styled "${amb.reward.epithet}".` : ''}`);
        addNews(s, { kind: 'player', importance: 2, text: `AMBITION FULFILLED. ${s.player.name} has ${amb.desc.toLowerCase()} The Guild enters “${amb.name}” against their account in the great book.` });
      }
    }
  }

  private tutorialTick(s: GameState): void {
    // Tutorial milestones keyed to real achievements, not scripted hand-holding.
    if (s.tutorial < 1 && Object.keys(s.player.cargo).length > 0) s.tutorial = 1;
    if (s.tutorial < 2 && s.stats.citiesVisited.length >= 2) s.tutorial = 2;
    if (s.tutorial < 3 && s.stats.tradeProfit >= 1) s.tutorial = 3;
    if (s.tutorial < 4 && s.stats.contractsDone >= 1) s.tutorial = 4;
  }

  // ---------------------------------------------------------------- utilities

  toast(kind: PendingToast['kind'], text: string): void {
    const s = this.need();
    s.pending.push({ id: uid('t'), kind, text });
    if (s.pending.length > 24) s.pending.shift();
    bus.emit(T.TOAST);
  }

  drainToasts(): PendingToast[] {
    const s = this.need();
    const out = s.pending;
    s.pending = [];
    return out;
  }

  resolveChoiceText(encounter: import('./encounters').Encounter, index: number): string {
    const s = this.need();
    const choice = encounter.choices[index];
    const text = choice.resolve(s, this.rng);
    s.rngState = this.rng.getState();
    bus.emit(T.PLAYER);
    bus.emit(T.MARKET);
    return text;
  }
}

// ------------------------------------------------------------------ helpers

function paceWord(p: Pace): string {
  return p === 'cautious' ? 'a cautious' : p === 'hard' ? 'a hard' : 'a steady';
}

function tavernName(rng: Rng, faction: FactionId): string {
  const firsts: Record<FactionId, string[]> = {
    concord: ['Aldous', 'Elira', 'Joran', 'Vessa', 'Perrin', 'Fiora'],
    khanate: ['Batu', 'Aigul', 'Qara', 'Selenge', 'Yesun', 'Sarnai'],
    vault: ['Yasha', 'Shirin', 'Farid', 'Leila', 'Davud', 'Rukhsana'],
    compact: ['Hild', 'Bram', 'Marta', 'Falk', 'Siglinde', 'Emeric'],
    delta: ['Sadi', 'Amara', 'Kesh', 'Zohra', 'Ilan', 'Nima'],
  };
  const lasts = ['Ashwake', 'Tireless', 'Two-Coins', 'of the Quay', 'Winterborn', 'Quickhands', 'the Elder', 'Oathfast', 'Nine-Roads', 'Stillwater'];
  return `${rng.pick(firsts[faction])} ${rng.pick(lasts)}`;
}

function topThreePrices(s: GameState, cityId: string): string {
  const c = s.cities[cityId];
  return GOOD_IDS
    .filter((g) => c.price[g] > 0)
    .sort((a, b) => c.price[b] / GOODS[b].base - c.price[a] / GOODS[a].base)
    .slice(0, 3)
    .map((g) => `${GOODS[g].name.toLowerCase()} at ${c.price[g].toFixed(1)}`)
    .join(', ');
}

function pickBestRumorCity(s: GameState, candidates: string[]): string {
  // The most "interesting" city: biggest recent price swing.
  let best = candidates[0];
  let bestSwing = -1;
  for (const cid of candidates) {
    const c = s.cities[cid];
    const swing = GOOD_IDS.reduce((m, g) => {
      const h = c.history[g];
      if (h.length < 6) return m;
      return Math.max(m, Math.abs(h[h.length - 1] - h[h.length - 6]) / GOODS[g].base);
    }, 0);
    if (swing > bestSwing) { bestSwing = swing; best = cid; }
  }
  return best;
}

function pickTensestFaction(s: GameState) {
  let best = s.factions.concord;
  let bestScore = Infinity;
  for (const f of Object.values(s.factions)) {
    const score = Math.min(...Object.values(f.relations)) - f.wars.length * 30;
    if (score < bestScore) { bestScore = score; best = f; }
  }
  return best;
}

function pickInterestingAgent(s: GameState, alive: Agent[]): Agent {
  const rng = new Rng(`${s.seed}|rumor|${s.day}`);
  const withCargo = alive.filter((a) => Object.keys(a.cargo).length > 0);
  return rng.pick(withCargo.length ? withCargo : alive);
}

function nextCaravanName(s: GameState): string {
  const used = new Set(s.player.aiCaravans.map((b) => b.name));
  for (const n of AI_CARAVAN_NAMES) if (!used.has(n)) return n;
  return `Caravan №${s.player.aiCaravans.length + 1}`;
}

function nextCaravanseraiName(s: GameState): string {
  const used = new Set(s.player.caravanserais.map((id) => s.roads[id].caravanseraiName));
  for (const n of CARAVANSERAI_NAMES) if (!used.has(n)) return n;
  return `The Wayfarer's Rest №${s.player.caravanserais.length}`;
}

function caravanCaptainName(s: GameState, rng: Rng): string {
  const pool = s.agents.filter((a) => !a.alive).map((a) => a.name);
  if (pool.length && rng.chance(0.5)) return `${rng.pick(pool).split(' ')[0]} Reborn`;
  return tavernName(rng, s.factions[rng.pick(Object.keys(s.factions)) as FactionId].id);
}

function contractLabel(c: Contract): string {
  switch (c.kind) {
    case 'delivery': return `Deliver ${c.amount} ${GOODS[c.good!].name}`;
    case 'procurement': return `Procure ${c.amount} ${GOODS[c.good!].name}`;
    case 'escort': return `Escort ${c.patron}`;
    case 'smuggle': return `Smuggle ${c.amount} ${GOODS[c.good!].name}`;
    case 'survey': return 'Guild Survey';
  }
}

export const game = new Game();

// ------------------------------------------------------------------ save/load

const SAVE_KEY = 'caravanserai.save.v3';
const SETTINGS_KEY = 'caravanserai.settings.v1';
const LEGEND_KEY = 'caravanserai.legend.v1';

export function saveGame(s: GameState): boolean {
  if (typeof localStorage === 'undefined') return false; // headless runs
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    return true;
  } catch (e) {
    console.error('save failed', e);
    return false;
  }
}

export function loadSavedGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    if (parsed.version !== 3) return migrate(parsed);
    return parsed;
  } catch (e) {
    console.error('load failed', e);
    return null;
  }
}

export function hasSavedGame(): boolean {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch { return false; }
}

export function deleteSave(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

export function exportSave(s: GameState): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(s))));
}

export function importSave(text: string): GameState | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(text.trim())))) as GameState;
    const st = parsed.version !== 3 ? migrate(parsed) : parsed;
    return st ? sanitizeState(st) : null;
  } catch {
    return null;
  }
}

/** Imported saves are untrusted input rendered into HTML: strip markup from
 *  every string that can reach the DOM through names or world text. */
function stripTags(v: string): string { return v.replace(/[<>&]/g, ''); }

function sanitizeState(s: GameState): GameState {
  s.player.name = stripTags(s.player.name).slice(0, 40) || 'A Nameless Merchant';
  s.player.epithet = stripTags(s.player.epithet).slice(0, 40);
  s.player.epithetPool = s.player.epithetPool.map((e) => stripTags(e).slice(0, 40));
  for (const b of s.player.aiCaravans) b.name = stripTags(b.name).slice(0, 50);
  for (const r of Object.values(s.roads)) if (r.caravanseraiName) r.caravanseraiName = stripTags(r.caravanseraiName).slice(0, 50);
  for (const n of s.news) n.text = stripTags(n.text);
  for (const iss of s.chronicles) {
    iss.headline = stripTags(iss.headline);
    for (const sec of iss.sections) sec.items = sec.items.map(stripTags);
  }
  return s;
}

function migrate(old: GameState & { version: number }): GameState | null {
  // Future schema migrations live here; for now old versions are rejected
  // rather than half-loaded into a corrupt world.
  console.warn('Save version', old.version, 'is no longer supported.');
  return null;
}

export interface SavedSettings { sound: boolean; music: boolean; reducedMotion: boolean; autosave: boolean; confirmTrades: boolean; numberTicking: boolean }

export function loadSettings(): SavedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { sound: true, music: true, reducedMotion: false, autosave: true, confirmTrades: true, numberTicking: true, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { sound: true, music: true, reducedMotion: false, autosave: true, confirmTrades: true, numberTicking: true };
}

export function persistSettings(set: SavedSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(set)); } catch { /* ignore */ }
}

export interface LegendEntryIO { seed: string; name: string; epitaph: string; day: number; netWorth: number; rank: number; ambitions: number; weekly?: boolean }

export function loadLegend(): LegendEntryIO[] {
  try {
    const raw = localStorage.getItem(LEGEND_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

export function addLegendEntry(entry: LegendEntryIO): void {
  const all = loadLegend();
  all.unshift(entry);
  try { localStorage.setItem(LEGEND_KEY, JSON.stringify(all.slice(0, 40))); } catch { /* ignore */ }
}

export { findPath };

/** Public wrappers so tooling (and the balance harness) can drive contracts. */
export const takeContractPublic = (id: string) => takeContract(game.need(), id);
