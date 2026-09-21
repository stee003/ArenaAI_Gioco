import type { GameState } from '../sim/types';

export interface AmbitionDef {
  id: string;
  name: string;
  desc: string;
  reward: { gold?: number; fame?: number; epithet?: string };
  /** Pure predicate over state; checked once per day for active ambitions. */
  check: (s: GameState) => boolean;
}

const netWorth = (s: GameState): number => {
  let v = s.player.gold - s.player.debt;
  for (const c of Object.entries(s.player.cargo)) {
    const city = s.player.loc.kind === 'city' ? s.cities[s.player.loc.cityId] : null;
    const price = city ? city.price[c[0] as keyof typeof city.price] : 0;
    v += c[1] * (price || 0) * 0.7; // cargo valued conservatively
  }
  v += s.player.caravanserais.length * 1500;
  v += s.player.warehouses.length * 400;
  for (const ac of s.player.aiCaravans) v += ac.float;
  return v;
};

const totalMoved = (s: GameState, good: string): number => s.stats.goodsMoved[good as never] ?? 0;

export const AMBITIONS: AmbitionDef[] = [
  { id: 'first_profit', name: 'The First Margin', desc: 'Complete a profitable trade run: buy in one city, sell in another for more.', reward: { gold: 50, fame: 2 }, check: (s) => s.stats.tradeProfit >= 1 },
  { id: 'first_blood', name: 'Road School', desc: 'Survive a bandit ambush and keep your cargo.', reward: { gold: 100, fame: 4, epithet: 'Iron-Nerved' }, check: (s) => s.stats.banditsBeaten >= 1 },
  { id: 'thousand', name: 'A Thousand Sols', desc: 'Reach a net worth of 1,000 sols.', reward: { fame: 3 }, check: (s) => netWorth(s) >= 1000 },
  { id: 'ten_k', name: 'Deep Pockets', desc: 'Hold 10,000 sols in cash.', reward: { fame: 6 }, check: (s) => s.player.gold >= 10000 },
  { id: 'five_contracts', name: 'Word Is Bond', desc: 'Fulfil 5 guild contracts.', reward: { gold: 300, fame: 6 }, check: (s) => s.stats.contractsDone >= 5 },
  { id: 'twenty_contracts', name: 'The Reliable', desc: 'Fulfil 20 guild contracts.', reward: { gold: 1200, fame: 12 }, check: (s) => s.stats.contractsDone >= 20 },
  { id: 'silk_baron', name: 'Silk Baron', desc: 'Move 200 units of silk over a lifetime.', reward: { gold: 800, fame: 8, epithet: 'Silkhand' }, check: (s) => totalMoved(s, 'silk') >= 200 },
  { id: 'grain_wolf', name: 'The Grain Wolf', desc: 'Sell 2,000 units of grain — the bread of empires passes through your wagon.', reward: { gold: 500, fame: 7, epithet: 'Grain Wolf' }, check: (s) => totalMoved(s, 'grain') >= 2000 },
  { id: 'smuggler', name: 'Quiet Cargo', desc: 'Complete 3 smuggling contracts without a single seizure.', reward: { gold: 700, fame: 8, epithet: 'Night-Fingered' }, check: (s) => s.stats.smuggledRuns >= 3 && s.stats.caughtSmuggling === 0 },
  { id: 'cornered', name: 'Cornered', desc: 'Own more than 80% of a city\u2019s entire stock of some good.', reward: { gold: 1000, fame: 10, epithet: 'the Monopolist' }, check: (s) => (s.flags.corneredMarket ?? 0) >= 1 },
  { id: 'war_profiteer', name: 'Merchant of Iron Rain', desc: 'Earn 3,000 sols selling into besieged cities.', reward: { fame: 10, epithet: 'Iron-Rain' }, check: (s) => s.stats.warProfits >= 3000 },
  { id: 'peacemaker', name: 'The Quiet Loom', desc: 'Trade so heavily between two factions that relations you saw sour turn friendly (> +30).', reward: { gold: 1500, fame: 12, epithet: 'Peacemaker' }, check: (s) => (s.flags.brokeredPeace ?? 0) >= 1 },
  { id: 'innkeeper', name: 'Innkeeper', desc: 'Build your first caravanserai.', reward: { fame: 10 }, check: (s) => s.player.caravanserais.length >= 1 },
  { id: 'network', name: 'A Lamp on Every Road', desc: 'Own 3 caravanserais.', reward: { gold: 3000, fame: 15, epithet: 'Lampkeeper' }, check: (s) => s.player.caravanserais.length >= 3 },
  { id: 'delegation', name: 'The Idle Wheel', desc: 'Earn 1,000 sols of profit from AI caravans running your routes.', reward: { fame: 8 }, check: (s) => s.stats.aiCaravanProfit >= 1000 },
  { id: 'fleet', name: 'Three Banners', desc: 'Run 3 AI caravans at once.', reward: { gold: 2000, fame: 12 }, check: (s) => s.player.aiCaravans.length >= 3 },
  { id: 'collector', name: 'A Full Wagon-Fire', desc: 'Employ 5 crew specialists at once.', reward: { fame: 6 }, check: (s) => s.player.crew.length >= 5 },
  { id: 'lore', name: 'Listener at Tables', desc: 'Buy 25 tavern rumors.', reward: { gold: 400, fame: 5 }, check: (s) => s.stats.rumorsBought >= 25 },
  { id: 'chronicled', name: 'Ink on Your Name', desc: 'Be mentioned in the Chronicle 10 times.', reward: { fame: 8, epithet: 'the Chronicled' }, check: (s) => s.stats.chronicleMentions >= 10 },
  { id: 'survivor', name: 'From Ashes', desc: 'After losing your entire cargo to bandits, climb back to a net worth of 5,000.', reward: { gold: 500, fame: 10, epithet: 'the Undrowned' }, check: (s) => (s.flags.robbedEmpty ?? 0) >= 1 && netWorth(s) >= 5000 },
  { id: 'winter_gambit', name: 'Winter\u2019s Gambit', desc: 'Cross a mountain pass in winter and live to sell.', reward: { gold: 600, fame: 8, epithet: 'Storm-Chaser' }, check: (s) => (s.flags.winterPass ?? 0) >= 1 },
  { id: 'long_haul', name: 'The Long Haul', desc: 'Complete a single trade run lasting 15+ travel days, profitably.', reward: { gold: 800, fame: 8 }, check: (s) => (s.flags.longHaul ?? 0) >= 1 },
  { id: 'seasoned', name: 'A Full Turning', desc: 'Survive one complete year (120 days) on the road.', reward: { gold: 1000, fame: 10 }, check: (s) => s.day >= 121 },
  { id: 'prince', name: 'Prince of the Road', desc: 'Attain the sixth guild rank.', reward: { gold: 5000, fame: 20, epithet: 'Prince of the Road' }, check: (s) => s.player.guildRank >= 6 },
  { id: 'quarter_million', name: 'The Amber Ledger', desc: 'Reach a net worth of 250,000 sols.', reward: { fame: 25, epithet: 'the Golden' }, check: (s) => netWorth(s) >= 250000 },
];

