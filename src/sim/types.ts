/**
 * Central type definitions for the whole simulation. Every system speaks these
 * shapes; the save file is a serialized GameState.
 */

export type GoodId =
  | 'grain' | 'salt' | 'timber' | 'iron' | 'cloth' | 'tools'
  | 'wine' | 'horses' | 'spice' | 'silk' | 'porcelain' | 'relics';

export type GoodTier = 'staple' | 'craft' | 'luxury' | 'treasure';

export type Biome = 'steppe' | 'coast' | 'mountain' | 'delta' | 'forest' | 'highland';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export type FactionId = 'concord' | 'khanate' | 'vault' | 'compact' | 'delta';

export type Pace = 'cautious' | 'steady' | 'hard';

export interface GoodDef {
  id: GoodId;
  name: string;
  tier: GoodTier;
  /** Reference value per unit in sols. */
  base: number;
  /** Wagon space consumed per unit. */
  space: number;
  /** Fraction of stock lost per day of travel (spoilage/attrition). */
  perish: number;
  /** Exponent on scarcity → price. Staples spike hard, luxuries are flat. */
  elasticity: number;
  /** Daily price noise, fraction of price. */
  volatility: number;
  desc: string;
}

export interface BuildingDef {
  id: string;
  name: string;
  desc: string;
  /** Output per day per building instance (before season/event modifiers). */
  produces?: Partial<Record<GoodId, number>>;
  /** Input consumed per day per instance; production halts if input missing. */
  consumes?: Partial<Record<GoodId, number>>;
  /** Extra garrison provided. */
  garrison?: number;
  /** Multiplies daily market absorption (liquidity). */
  liquidity?: number;
  /** Multiplies grain stock target (stability). */
  granary?: boolean;
}

export interface CityModifiers {
  /** day until which modifier runs, plus multipliers on production/demand */
  plagueUntil: number;
  festivalUntil: number;
  droughtUntil: number;
  boomUntil: number; // mine discovery / gold strike
  besiegedBy: FactionId | null;
  siegeUntil: number;
  fairUntil: number; // trade fair: zero tariffs, agents flock
  fireUntil: number; // recent fire: production penalty
}

export interface City {
  id: string;
  name: string;
  faction: FactionId;
  biome: Biome;
  /** Normalized map coordinates (0..1). */
  x: number;
  y: number;
  /** Population in thousands. */
  pop: number;
  buildings: string[];
  stock: Record<GoodId, number>;
  price: Record<GoodId, number>;
  /** Last N days of prices, newest last (sparklines). */
  history: Record<GoodId, number[]>;
  /** How much the market already absorbed / dispensed today, per good. */
  absorbed: Partial<Record<GoodId, number>>;
  dispensed: Partial<Record<GoodId, number>>;
  law: number; // 0..100
  unrest: number; // 0..100
  garrison: number;
  mods: CityModifiers;
  /** Fences buy contraband here at this fluctuating multiplier. */
  fenceMult: number;
}

export type RoadKind = 'open' | 'pass' | 'river' | 'desert';

export interface Road {
  id: string;
  a: string;
  b: string;
  kind: RoadKind;
  /** Base travel days. */
  days: number;
  /** Base danger 0..100 before dynamic modifiers. */
  dangerBase: number;
  /** Effective danger, recomputed daily. */
  danger: number;
  /** Day until which a bandit confederacy haunts this road. */
  banditsUntil: number;
  banditChief?: string;
  /** Day until which storms add a travel day. */
  stormUntil: number;
  /** Temporary travel-day modifier (washed bridge −, new well +). */
  daysMod: number;
  daysModUntil: number;
  /** A lost caravan's scattered cargo waits here until `until`. */
  salvage?: { until: number; value: number; goods: Partial<Record<GoodId, number>> };
  /** Caravanserai owner: 'player', an agent id, or null. */
  caravanserai: string | null;
  caravanseraiName?: string;
}

export interface FactionIdeology {
  /** Base import tariff rate (fraction of sale value). */
  tariff: number;
  /** Goods illegal to sell openly here. */
  contraband: GoodId[];
  /** 0..1 appetite for war. */
  aggression: number;
  desc: string;
}

export interface War {
  enemy: FactionId;
  started: number;
  battles: number;
  /** Cities captured during this war (chronicle fodder). */
  captures: string[];
}

export interface Faction {
  id: FactionId;
  name: string;
  epithet: string;
  color: string;
  ruler: string;
  capital: string;
  ideology: FactionIdeology;
  treasury: number;
  military: number; // abstract strength points
  relations: Record<FactionId, number>; // -100..100
  wars: War[];
  /** Decayed tracker of trade value exchanged with each faction. */
  tradeFlow: Record<FactionId, number>;
  grievance: Record<FactionId, number>;
}

export type AgentLoc =
  | { kind: 'city'; cityId: string; restUntil: number }
  | { kind: 'road'; roadId: string; from: string; to: string; startDay: number; arriveDay: number };

export interface Agent {
  id: string;
  name: string;
  epithet?: string;
  faction: FactionId;
  home: string;
  gold: number;
  capacity: number;
  cargo: Partial<Record<GoodId, number>>;
  guards: number;
  risk: number; // 0..1 aversion
  greed: number; // 0..1 profit threshold aggressiveness
  loc: AgentLoc;
  /** cityId → last-visited day + the prices witnessed then (agents plan on stale intel, like everyone else). */
  knowledge: Record<string, { day: number; price: Partial<Record<GoodId, number>> }>;
  /** Where the agent is currently headed (if anywhere). Rumors read this. */
  dest: string | null;
  /** Remaining city sequence of the current multi-hop plan. */
  planPath?: string[];
  /** When set, this agent travels with the player under an escort contract. */
  escortFor?: string;
  deeds: { day: number; text: string }[];
  alive: boolean;
  tradeVolume: number;
  /** Player-owned AI caravan when set. */
  owner?: 'player';
  route?: string[]; // AI caravan: ordered city loop
  float?: number; // AI caravan: capital entrusted by player
}

export type PlayerLoc =
  | { kind: 'city'; cityId: string }
  | { kind: 'road'; roadId: string; from: string; to: string; startDay: number; arriveDay: number };

export interface CrewMember {
  id: string;
  name: string;
  role: string; // crew role id
  wage: number;
  hiredDay: number;
  trait?: string;
}

export interface AiCaravanBook {
  agentId: string;
  name: string;
  float: number;
  route: string[];
  hiredDay: number;
  lastReport: number;
  totalProfit: number;
}

export interface PlayerState {
  name: string;
  epithet: string;
  gold: number;
  debt: number;
  debtDueDay: number;
  loc: PlayerLoc;
  pace: Pace;
  cargo: Partial<Record<GoodId, number>>;
  /** Sols invested in the current cargo per good (for honest profit accounting). */
  cargoCost: Partial<Record<GoodId, number>>;
  /** Days of food for the company. */
  provisions: number;
  capacity: number;
  guards: number;
  crew: CrewMember[];
  upgrades: Partial<Record<string, number>>;
  /** cityId → last witnessed true prices + day. */
  intel: Record<string, { day: number; price: Record<GoodId, number> }>;
  /** cityId → warehouse contents (presence of key = warehouse owned). */
  storage: Record<string, Partial<Record<GoodId, number>>>;
  rep: Record<FactionId, number>;
  guildRank: number;
  fame: number;
  /** roadIds owned by the player. */
  caravanserais: string[];
  /** cityIds with a player warehouse (kept in sync with storage keys). */
  warehouses: string[];
  aiCaravans: AiCaravanBook[];
  contractsDone: number;
  contractsFailed: number;
  epithetPool: string[]; // earned epithet candidates
  banned: Partial<Record<FactionId, number>>; // faction → day ban lifts (outlaw)
  luck: number; // hidden 0.8..1.2 modifier, moved by blessings/omens
  /** Faction of the city of your most recent purchase (peace-brokering bookkeeping). */
  lastBuyFaction?: FactionId;
  /** City you set out from on the current/last trip. */
  tripFromCity?: string;
}

export type ContractKind = 'delivery' | 'procurement' | 'escort' | 'smuggle' | 'survey';

export interface Contract {
  id: string;
  kind: ContractKind;
  cityId: string; // board where it hangs (and delivery target for delivery/smuggle)
  patron: string;
  faction?: FactionId;
  good?: GoodId;
  amount?: number;
  fromCity?: string; // procurement hint / survey target
  deadline: number;
  reward: number;
  advance: number;
  repReward: number;
  desc: string;
  state: 'open' | 'active' | 'done' | 'failed';
  takenDay?: number;
  escortAgent?: string;
}

export type NewsKind =
  | 'war' | 'politics' | 'plague' | 'festival' | 'disaster' | 'discovery'
  | 'agent' | 'player' | 'market' | 'crime' | 'omen' | 'caravanserai';

export interface NewsItem {
  id: string;
  day: number;
  kind: NewsKind;
  text: string;
  cityId?: string;
  importance: 1 | 2 | 3;
}

export interface ChronicleIssue {
  day: number;
  headline: string;
  headlineKind: NewsKind;
  sections: { title: string; items: string[] }[];
}

export interface LedgerStats {
  daysPlayed: number;
  distanceTraveled: number;
  tradeProfit: number; // realized buy-low-sell-high profit
  totalBought: number; // sols spent
  totalSold: number; // sols earned
  tariffsPaid: number;
  lostToBandits: number;
  banditsBeaten: number;
  contractsDone: number;
  contractsFailed: number;
  rumorsBought: number;
  caravanseraiIncome: number;
  aiCaravanProfit: number;
  bestSingleTrade: number; // profit of one sale
  goodsMoved: Partial<Record<GoodId, number>>;
  citiesVisited: string[];
  ambushesSurvived: number;
  smuggledRuns: number;
  caughtSmuggling: number;
  chronicleMentions: number;
  warProfits: number; // sols earned selling to besieged cities
}

export interface AmbitionProgress {
  done: boolean;
  day?: number;
}

export interface Settings {
  sound: boolean;
  music: boolean;
  reducedMotion: boolean;
  autosave: boolean;
  confirmTrades: boolean;
  numberTicking: boolean;
}

export interface PendingToast {
  id: string;
  kind: 'ambition' | 'rank' | 'contract' | 'arrival' | 'info' | 'warning' | 'trade' | 'chronicle';
  text: string;
}

export interface GameState {
  version: number;
  seed: string;
  day: number; // day 1 = 1 Spring, Year 1
  rngState: number;
  cities: Record<string, City>;
  cityOrder: string[];
  roads: Record<string, Road>;
  roadOrder: string[];
  factions: Record<FactionId, Faction>;
  agents: Agent[];
  player: PlayerState;
  contracts: Contract[];
  news: NewsItem[];
  chronicles: ChronicleIssue[];
  stats: LedgerStats;
  ambitions: Record<string, AmbitionProgress>;
  /** UI event queue: drained by the shell into toasts. */
  pending: PendingToast[];
  tutorial: number; // onboarding step counter
  flags: Record<string, number>; // misc persistent numeric counters/days
  startCityId: string; // where the inheritance began
  nextAgentNum: number;
  weekly: boolean; // weekly challenge seed run
  settings: Settings;
}

export interface LegendEntry {
  seed: string;
  name: string;
  epitaph: string;
  day: number;
  netWorth: number;
  rank: number;
  ambitions: number;
  weekly?: boolean;
}
