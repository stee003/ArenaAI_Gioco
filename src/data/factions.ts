import type { FactionId } from '../sim/types';

export interface FactionTemplate {
  id: FactionId;
  name: string;
  epithet: string;
  color: string;
  accent: string;
  desc: string;
  rulerTitle: string;
  capitalName: string; // preferred capital city name
  biomes: string[];
  /** Base import tariff on sales. */
  tariff: number;
  contraband: string[];
  aggression: number;
  startingTreasury: number;
  startingMilitary: number;
  cityCount: number;
  /** Buildings that only appear in this faction's cities. */
  signatureBuildings: string[];
}

export const FACTIONS: Record<FactionId, FactionTemplate> = {
  concord: {
    id: 'concord',
    name: 'The Serene Concord',
    epithet: 'League of the Green Water',
    color: '#2e7d8c',
    accent: '#8fd0d8',
    desc: 'A league of port cities ruled by ledger-lords. Spice and amber flow in from oceans beyond the map; tariffs are low and gold talks loudest. The Concord almost never strikes first — but it funds those who do.',
    rulerTitle: 'Ledger-Lord',
    capitalName: 'Marenza',
    biomes: ['coast'],
    tariff: 0.07,
    contraband: [],
    aggression: 0.15,
    startingTreasury: 9000,
    startingMilitary: 55,
    cityCount: 4,
    signatureBuildings: ['spice_docks', 'fishery', 'market_house'],
  },
  khanate: {
    id: 'khanate',
    name: 'The Ashen Khanate',
    epithet: 'Riders of the Grey Grass',
    color: '#b0562f',
    accent: '#e8a37f',
    desc: 'Steppe lords who count wealth in horses and oaths. Their studs feed every cavalry on the continent, their salt lakes glitter white, and their raid-parties keep the open roads honest — or dishonest, depending on the season. Relics are unclean here; idols are burned at the border.',
    rulerTitle: 'Khan',
    capitalName: 'Sarkel',
    biomes: ['steppe'],
    tariff: 0.1,
    contraband: ['relics'],
    aggression: 0.62,
    startingTreasury: 4500,
    startingMilitary: 90,
    cityCount: 3,
    signatureBuildings: ['stud', 'saltworks'],
  },
  vault: {
    id: 'vault',
    name: 'The Celestial Vault',
    epithet: 'Theocracy of the High Silence',
    color: '#5b5fa8',
    accent: '#a8addc',
    desc: 'A mountain empire of terraced silk, pale porcelain and iron discipline, ruled by priest-astronomers. Wine is profanity here; silk is scripture. The Vault\u2019s tariffs are steep, its roads are safe, and its wars are holy.',
    rulerTitle: 'Archon-Saint',
    capitalName: 'Anavrat',
    biomes: ['mountain', 'highland'],
    tariff: 0.18,
    contraband: ['wine'],
    aggression: 0.4,
    startingTreasury: 7000,
    startingMilitary: 75,
    cityCount: 3,
    signatureBuildings: ['sericulture', 'kiln', 'temple', 'ironmine'],
  },
  compact: {
    id: 'compact',
    name: 'The Iron Compact',
    epithet: 'Confederation of Forge and Fir',
    color: '#57646f',
    accent: '#a4b0ba',
    desc: 'Free mining towns and forest holds bound by one law: the forge eats everything. Iron, tools and timber leave in every wagon train; sumptuary edicts keep silk out (ostensibly for the soul, realistically for the trade balance). The Compact respects strength and invoices.',
    rulerTitle: 'Forge-Marshal',
    capitalName: 'Fernmark',
    biomes: ['forest'],
    tariff: 0.12,
    contraband: ['silk'],
    aggression: 0.5,
    startingTreasury: 5200,
    startingMilitary: 82,
    cityCount: 3,
    signatureBuildings: ['workshop', 'ironmine', 'sawmill'],
  },
  delta: {
    id: 'delta',
    name: 'The Ninefold Delta',
    epithet: 'Breadbasket of Nine Mouths',
    color: '#b08a2e',
    accent: '#e6cf8a',
    desc: 'Nine river mouths, one loose council, and enough grain to feed the world — which is exactly why everyone meddles here. Floods, festivals and coups arrive with the seasons. The Delta\u2019s wine is famous, its politics are worse, and its prices move first.',
    rulerTitle: 'Council-Speaker',
    capitalName: 'Suthra',
    biomes: ['delta'],
    tariff: 0.09,
    contraband: [],
    aggression: 0.22,
    startingTreasury: 5600,
    startingMilitary: 48,
    cityCount: 3,
    signatureBuildings: ['farm', 'weavery', 'orchard', 'granary'],
  },
};

export const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];

/** Which goods each faction's homeland naturally hosts (used by worldgen). */
export const FACTION_BUILDING_POOL: Record<FactionId, string[]> = {
  concord: ['fishery', 'saltworks', 'orchard', 'market_house', 'spice_docks', 'walls', 'granary'],
  khanate: ['stud', 'saltworks', 'farm', 'ruins', 'walls'],
  vault: ['sericulture', 'kiln', 'ironmine', 'temple', 'walls', 'farm', 'ruins', 'granary'],
  compact: ['ironmine', 'workshop', 'sawmill', 'farm', 'walls', 'ruins'],
  delta: ['farm', 'weavery', 'orchard', 'saltworks', 'granary', 'market_house', 'ruins', 'temple', 'fishery'],
};
