import type { FactionId } from '../sim/types';

export interface CrewRole {
  id: string;
  name: string;
  desc: string;
  /** Base daily wage in sols. */
  wage: number;
  /** Factions whose taverns tend to produce this role. */
  affinity: FactionId[];
}

/**
 * Crew specialists. Each occupies a crew slot (slots scale with guild rank);
 * each wage is paid daily whether the road is kind or not. Effects are applied
 * in the sim via `crewBonus(state, roleId)` so numbers live in one place.
 */
export const CREW_ROLES: Record<string, CrewRole> = {
  navigator: {
    id: 'navigator', name: 'Navigator', wage: 4,
    desc: 'Shaves a day off long routes (3+ days). Reads stars, wells and wheel-ruts.',
    affinity: ['concord', 'khanate'],
  },
  quartermaster: {
    id: 'quartermaster', name: 'Quartermaster', wage: 3,
    desc: 'Provisions last 30% longer. Keeps the mules fat and the ledger honest.',
    affinity: ['delta', 'compact'],
  },
  bodyguard: {
    id: 'bodyguard', name: 'Bodyguard', wage: 5,
    desc: 'A veteran blade. Adds 40% of your guard strength again in a fight, and frightens small predators.',
    affinity: ['khanate', 'compact'],
  },
  linguist: {
    id: 'linguist', name: 'Linguist', wage: 4,
    desc: 'Tariffs drop 20% in foreign cities; rumors cost less. Speaks nine tongues and trusts none.',
    affinity: ['vault', 'concord'],
  },
  accountant: {
    id: 'accountant', name: 'Accountant', wage: 4,
    desc: 'Tariffs drop a further 10%; contract rewards pay 5% more. Argues with scales and wins.',
    affinity: ['concord', 'delta'],
  },
  spy: {
    id: 'spy', name: 'Spy', wage: 6,
    desc: 'A free rumor every third day, and tax patrols look the other way more often. Name unknown, probably.',
    affinity: ['vault', 'delta'],
  },
  physician: {
    id: 'physician', name: 'Physician', wage: 5,
    desc: 'Crew never deserts; plague cities cannot infect your company; wounds heal between trips.',
    affinity: ['vault', 'delta'],
  },
  pathfinder: {
    id: 'pathfinder', name: 'Pathfinder', wage: 4,
    desc: 'Road danger to your caravan drops 20% — they find the fords and the quiet tracks.',
    affinity: ['khanate', 'compact'],
  },
  smuggler: {
    id: 'smuggler', name: 'Smuggler', wage: 6,
    desc: 'Fences pay 15% more; patrols miss your hidden compartments twice as often. Ask no questions.',
    affinity: ['delta', 'khanate'],
  },
  herald: {
    id: 'herald', name: 'Herald', wage: 3,
    desc: 'Reputation gained rises 25%; bandits think twice about your banners.',
    affinity: ['concord', 'vault'],
  },
};


export interface CrewTrait {
  id: string;
  name: string;
  desc: string;
  wageMult: number;
}

/** Traits roll onto hired crew for flavor + small mechanical color. */
export const CREW_TRAITS: Record<string, CrewTrait> = {
  veteran: { id: 'veteran', name: 'Veteran', desc: 'Wages +25%, never deserts below half provisions.', wageMult: 1.25 },
  eager: { id: 'eager', name: 'Eager', desc: 'Wages −20%, but deserts if unpaid or starving.', wageMult: 0.8 },
  pious: { id: 'pious', name: 'Pious', desc: 'Refuses to haul relics into the Khanate (reputation shields you once).', wageMult: 1.0 },
  gambler: { id: 'gambler', name: 'Gambler', desc: 'Encounter outcomes swing wilder — for better and worse.', wageMult: 0.95 },
  famous: { id: 'famous', name: 'Famous', desc: 'Your fame grows 10% faster while they travel with you.', wageMult: 1.3 },
};

