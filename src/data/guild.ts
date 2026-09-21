/**
 * The Merchants' Guild: neutral across factions, the player's spine of
 * progression. Ranks are *claimed* (deliberately, at the Guild screen) once
 * thresholds are met, and each carries a promotion fee — a money sink that
 * always feels like a ceremony, never a chore.
 */
export interface GuildRankDef {
  rank: number;
  name: string;
  desc: string;
  /** Requirements to claim. */
  netWorth: number;
  contracts: number;
  fame: number;
  /** Promotion fee in sols. */
  fee: number;
  /** What this rank grants. */
  perks: string[];
  capacityBonus: number;
  crewSlots: number;
  maxAiCaravans: number;
  canBuildCaravanserai: boolean;
  canTakeLoans: boolean;
}

export const GUILD_RANKS: GuildRankDef[] = [
  {
    rank: 1, name: 'Peddler', desc: 'A wagon, a name, and road dust.',
    netWorth: 0, contracts: 0, fame: 0, fee: 0,
    perks: ['Wagon space 120', 'Sell in any open market'],
    capacityBonus: 0, crewSlots: 1, maxAiCaravans: 0,
    canBuildCaravanserai: false, canTakeLoans: false,
  },
  {
    rank: 2, name: 'Factor', desc: 'You keep a ledger now, and the ledger keeps you.',
    netWorth: 1200, contracts: 2, fame: 5, fee: 150,
    perks: ['+30 wagon space', 'Crew slot 2', 'Guild loans (500 sols @ 10%/30 days)'],
    capacityBonus: 30, crewSlots: 2, maxAiCaravans: 0,
    canBuildCaravanserai: false, canTakeLoans: true,
  },
  {
    rank: 3, name: 'Merchant', desc: 'Your name opens doors in three cities at once.',
    netWorth: 5000, contracts: 6, fame: 15, fee: 500,
    perks: ['+30 wagon space', 'Crew slot 3', 'Warehouses (storage + courier intel)', 'Seal of Credit upgrade'],
    capacityBonus: 60, crewSlots: 3, maxAiCaravans: 0,
    canBuildCaravanserai: false, canTakeLoans: true,
  },
  {
    rank: 4, name: 'Master Merchant', desc: 'Other merchants copy your routes. Flattery and theft, mostly theft.',
    netWorth: 20000, contracts: 14, fame: 30, fee: 1500,
    perks: ['+40 wagon space', 'Crew slot 4', 'AI caravan license (1st)', 'Courier contracts'],
    capacityBonus: 100, crewSlots: 4, maxAiCaravans: 1,
    canBuildCaravanserai: false, canTakeLoans: true,
  },
  {
    rank: 5, name: 'Magnate', desc: 'Kings answer your letters. Slowly, and with invoices.',
    netWorth: 60000, contracts: 26, fame: 55, fee: 4000,
    perks: ['+40 wagon space', 'Crew slot 5', 'Caravanserai building permits', 'AI caravan license (2nd)'],
    capacityBonus: 140, crewSlots: 5, maxAiCaravans: 2,
    canBuildCaravanserai: true, canTakeLoans: true,
  },
  {
    rank: 6, name: 'Prince of the Road', desc: 'The road itself seems to greet you by name.',
    netWorth: 160000, contracts: 44, fame: 85, fee: 10000,
    perks: ['+60 wagon space', 'Crew slot 6', 'Tariffs −10% everywhere', 'AI caravan license (3rd)', 'Hall of Legends entry'],
    capacityBonus: 200, crewSlots: 6, maxAiCaravans: 3,
    canBuildCaravanserai: true, canTakeLoans: true,
  },
];

export function rankDef(rank: number): GuildRankDef {
  return GUILD_RANKS[Math.min(Math.max(rank, 1), GUILD_RANKS.length) - 1];
}

export function nextRankDef(rank: number): GuildRankDef | null {
  return rank < GUILD_RANKS.length ? GUILD_RANKS[rank] : null;
}

/** Total wagon capacity for a rank + purchased upgrades. */
export function baseCapacityForRank(rank: number): number {
  return 120 + rankDef(rank).capacityBonus;
}
