import type { BuildingDef, GoodDef, GoodId } from '../sim/types';

/**
 * The twelve goods of Zeravesh. Value density (base/space) rises sharply with
 * tier, but so does capital risk and price flatness: staples only pay off in
 * volume or during crises (siege/winter spikes), luxuries pay off per unit of
 * wagon space. Both niches must stay viable — see elasticity & space below.
 */
export const GOODS: Record<GoodId, GoodDef> = {
  grain: {
    id: 'grain', name: 'Grain', tier: 'staple', base: 5, space: 2,
    perish: 0.002, elasticity: 0.85, volatility: 0.02,
    desc: 'Wheat and millet. Every mouth on the road depends on it. Spikes violently in siege, winter and famine — and rots slowly in damp wagons.',
  },
  salt: {
    id: 'salt', name: 'Salt', tier: 'staple', base: 8, space: 1.5,
    perish: 0, elasticity: 0.7, volatility: 0.02,
    desc: 'White gold of the pan and the sea. Preserves food; demand never truly collapses.',
  },
  timber: {
    id: 'timber', name: 'Timber', tier: 'staple', base: 10, space: 3,
    perish: 0, elasticity: 0.6, volatility: 0.025,
    desc: 'Beams, fuel, wagon spokes. Bulky and humble — until a city burns or a fleet is ordered.',
  },
  iron: {
    id: 'iron', name: 'Iron', tier: 'craft', base: 22, space: 2,
    perish: 0, elasticity: 0.55, volatility: 0.03,
    desc: 'Pig iron and bar stock. Arsenals buy it in war; workshops buy it always.',
  },
  cloth: {
    id: 'cloth', name: 'Cloth', tier: 'craft', base: 28, space: 1,
    perish: 0, elasticity: 0.5, volatility: 0.03,
    desc: 'Bolt upon bolt of linen and wool. The Delta weaves; everyone clothes themselves.',
  },
  tools: {
    id: 'tools', name: 'Tools', tier: 'craft', base: 55, space: 2,
    perish: 0, elasticity: 0.45, volatility: 0.03,
    desc: 'Hammers, ploughshares, fittings. Forged from iron and timber by the Compact — the value lives in the making.',
  },
  wine: {
    id: 'wine', name: 'Wine', tier: 'craft', base: 38, space: 2,
    perish: 0, elasticity: 0.4, volatility: 0.035,
    desc: 'Amphorae of the Delta and the coastal vales. Forbidden in the Celestial Vault — which only raises what sinners pay.',
  },
  horses: {
    id: 'horses', name: 'Horses', tier: 'craft', base: 120, space: 6,
    perish: 0.004, volatility: 0.035, elasticity: 0.4,
    desc: 'Steppe-bred, hardy, loud. Cavalries and caravans compete for the same beasts. They eat, they spook, they die.',
  },
  spice: {
    id: 'spice', name: 'Spice', tier: 'luxury', base: 90, space: 0.5,
    perish: 0, elasticity: 0.35, volatility: 0.04,
    desc: 'Pepper, cassia, saffron — landed at Concord ports from oceans you will never see. Light, dear, endlessly desired.',
  },
  silk: {
    id: 'silk', name: 'Silk', tier: 'luxury', base: 150, space: 0.5,
    perish: 0, elasticity: 0.3, volatility: 0.04,
    desc: 'The Vault guards its sericulture like scripture. Banned by Compact sumptuary law — smugglers disagree with the law.',
  },
  porcelain: {
    id: 'porcelain', name: 'Porcelain', tier: 'luxury', base: 180, space: 1,
    perish: 0.001, elasticity: 0.3, volatility: 0.045,
    desc: 'Pale fired clay from Vault kilns. Exquisite, and it shatters on bad roads. Wrap it well.',
  },
  relics: {
    id: 'relics', name: 'Relics', tier: 'treasure', base: 300, space: 1,
    perish: 0, elasticity: 0.25, volatility: 0.05,
    desc: 'Saints\u2019 bones, old idols, sealed urns. Temples pay fortunes; the Khanate calls them unclean. Handle with care — and discretion.',
  },
};

export const GOOD_IDS = Object.keys(GOODS) as GoodId[];

/** Buildings: the production/consumption machinery of cities. */
export const BUILDINGS: Record<string, BuildingDef> = {
  farm: {
    id: 'farm', name: 'Farmsteads', desc: 'Fields of wheat and millet beyond the walls.',
    produces: { grain: 8 },
  },
  orchard: {
    id: 'orchard', name: 'Vineyards & Orchards', desc: 'Sun on south slopes, pressed into wine.',
    produces: { wine: 2.4 },
  },
  saltworks: {
    id: 'saltworks', name: 'Saltworks', desc: 'Evaporation pans by pan, raked under open sky.',
    produces: { salt: 4 },
  },
  fishery: {
    id: 'fishery', name: 'Fishery', desc: 'Boats, nets, and drying racks — food from the water.',
    produces: { grain: 4 },
  },
  sawmill: {
    id: 'sawmill', name: 'Sawmills', desc: 'Water-driven saws biting through river raft timber.',
    produces: { timber: 5 },
  },
  ironmine: {
    id: 'ironmine', name: 'Iron Mine', desc: 'Shafts into red rock; ore raised by windlass and stubbornness.',
    produces: { iron: 3 },
  },
  workshop: {
    id: 'workshop', name: 'Smith Workshops', desc: 'Iron and timber enter; tools leave. Stops when inputs run out.',
    consumes: { iron: 1.2, timber: 0.8 }, produces: { tools: 1.6 },
  },
  weavery: {
    id: 'weavery', name: 'Weavery', desc: 'Loom-clatter from dawn; Delta flax becomes honest cloth.',
    produces: { cloth: 2 },
  },
  stud: {
    id: 'stud', name: 'Horse Stud', desc: 'Steppe studs: small horses, immense endurance.',
    produces: { horses: 1.0 },
  },
  sericulture: {
    id: 'sericulture', name: 'Silk Terraces', desc: 'Mulberry groves and hushed worms, guarded by the Vault.',
    produces: { silk: 1.0 },
  },
  kiln: {
    id: 'kiln', name: 'Porcelain Kilns', desc: 'Wood-fired kilns producing pale, perfect, fragile things.',
    consumes: { timber: 0.8 }, produces: { porcelain: 0.85 },
  },
  spice_docks: {
    id: 'spice_docks', name: 'Spice Docks', desc: 'Ocean dhows discharge pepper and cassia onto Concord quays.',
    produces: { spice: 1.3 },
  },
  temple: {
    id: 'temple', name: 'Great Temple', desc: 'Pilgrims, rites, and a vault of consecrated relics.',
    produces: { relics: 0.3 },
  },
  ruins: {
    id: 'ruins', name: 'Old Ruins', desc: 'A dead city\u2019s bones. Grave-robbers call it harvest.',
    produces: { relics: 0.45 },
  },
  walls: {
    id: 'walls', name: 'Walls & Garrisons', desc: 'Stone, spears, and discipline.',
    garrison: 60,
  },
  market_house: {
    id: 'market_house', name: 'Market House', desc: 'Weighing halls and money changers widen what the market can absorb in a day.',
    liquidity: 1.8,
  },
  granary: {
    id: 'granary', name: 'Granary', desc: 'Deep bins keep grain cheaper in plenty and steadier in famine.',
    granary: true,
  },
};

/** Per-1000-population daily consumption. Grain is life; everything else is comfort. */
export const CONSUMPTION_PER_K: Partial<Record<GoodId, number>> = {
  grain: 1.0,
  salt: 0.14,
  timber: 0.07,
  cloth: 0.11,
  wine: 0.055,
  tools: 0.04,
  iron: 0.02,
  spice: 0.009,
  silk: 0.006,
  porcelain: 0.0045,
  relics: 0.003,
  horses: 0.001,
};

/** Target stock = this many days of consumption (before granary/event bonuses). */
export const STOCK_BUFFER_DAYS = 28;

/** Max history length kept per good per city. */
export const HISTORY_LEN = 60;
