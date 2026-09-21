export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  maxLevel: number;
  /** Cost of level n (1-indexed). */
  cost: (level: number) => number;
  /** Minimum guild rank required to purchase. */
  rankReq?: number;
}

export const UPGRADES: Record<string, UpgradeDef> = {
  wagon: {
    id: 'wagon', name: 'Wagon Reinforcement', maxLevel: 4,
    cost: (l) => [0, 350, 900, 1800, 3200][l] ?? 99999,
    desc: 'Stronger axle, deeper bed: +28 wagon space per level.',
  },
  horses: {
    id: 'horses', name: 'Swift Team', maxLevel: 2,
    cost: (l) => [0, 600, 1500][l] ?? 99999,
    desc: 'Better blooded teams: travel 15% faster per level (days rounded, minimum 1).',
  },
  compartment: {
    id: 'compartment', name: 'Hidden Compartment', maxLevel: 2,
    cost: (l) => [0, 700, 1600][l] ?? 99999,
    desc: 'False floor beneath the cargo: patrols are 25% less likely to find contraband per level.',
  },
  oilskin: {
    id: 'oilskin', name: 'Oilskin Covers', maxLevel: 1,
    cost: () => 450,
    desc: 'Storms and spills cannot spoil perishable or fragile goods.',
  },
  lantern: {
    id: 'lantern', name: 'Lantern & Compass', maxLevel: 1,
    cost: () => 500,
    desc: 'Night marches: road danger to your caravan drops 10%.',
  },
  secondwagon: {
    id: 'secondwagon', name: 'Second Wagon', maxLevel: 1,
    cost: () => 2400, rankReq: 3,
    desc: 'A whole extra wagon and team: +90 wagon space, but provisions cost +50%.',
  },
  seal: {
    id: 'seal', name: 'Guild Seal of Credit', maxLevel: 1,
    cost: () => 1200, rankReq: 3,
    desc: 'Merchants honor your paper: buy goods with up to 30% less gold on hand (a short loan settled on your next sale).',
  },
  banner: {
    id: 'banner', name: 'Heraldic Banner', maxLevel: 1,
    cost: () => 800, rankReq: 2,
    desc: 'Your colors are known: +10% reputation gains, bandits weigh ambushing you more carefully.',
  },
};

export const UPGRADE_IDS = Object.keys(UPGRADES);
