# CARAVANSERAI — Design Document

> *"The road remembers every merchant."*

A trade-world roguelite for the browser. You inherit your late uncle's wagon,
300 sols, and a letter. The continent of **Zeravesh** runs a fully simulated
silk-road economy: 16 cities, 5 factions, ~40 rival merchants who live, trade,
go bankrupt, get robbed and die — using the exact same rules you play by.
Wars erupt from faction grievances. Plagues, harvests and festivals move real
supply and demand. Prices are never scripted: they emerge.

## 1. The Hook

**You are not special. You are one agent among many — and that is why the world
feels real.** Most economy games fake prices with curves. Here, if you buy
every sack of grain in a city about to be besieged, the price spikes, the siege
fails or succeeds because of *you*, refugees flee to the neighbor city, and
grain demand there surges next season. The chronicle will write about it.

Three pillars:

1. **Systemic economy** — production chains (Delta grain feeds the continent,
   Vault silk and Compact tools flow out), seasonal modifiers, war
   requisitions, market liquidity limits. Nothing is a decoration number.
2. **Information as gameplay** — you only see prices you've *witnessed*.
   Elsewhere you see stale intel with growing uncertainty. Taverns sell
   rumors that leak true hidden state ("the Khanate is buying horses" = war
   is coming). Couriers, spies and caravanserais expand your knowledge web.
3. **You can automate yourself out of the grind** — late game you hire AI
   captains to run caravans on your routes and build caravanserais that tax
   the world's traffic, keep roads safe, and whisper gossip to you. The title
   of the game is the endgame.

## 2. Core Loop

- **In a city:** read the market (true prices here, intel elsewhere), buy low
  within your wagon's capacity, check the contract board, drink at the tavern
  (rumors, crew, guards), pay tariffs, provision the caravan.
- **On the road:** choose destination and pace; each travel day the whole world
  simulates; roll encounters (bandits, storms, rival caravans you can trade
  with or rob, tax patrols checking for contraband). Resolve with choices,
  not stats screens.
- **Arrive:** sell into real demand (the market only absorbs so much per day),
  watch prices move under your trades, gain faction rep from tariffs paid and
  contracts kept, read the Chronicle every ten days.
- **Grow:** guild ranks (Peddler → Prince of the Road) unlock loans, permits,
  AI caravans, caravanserai construction. Ambitions track long arcs.

Turn = one day. No real-time waiting; every click advances a simulated world.

## 3. Systems Map (how everything interlocks)

```
seasons ──────────────┐
                      v
production ──> city stocks ──> PRICES <── tariffs/war/plague/festival
                      ^            |
agents (NPC) ── arbitrage ─────────┤  (their trades move prices too)
player ─────── arbitrage ──────────┘
   |                                    |
   +─ contracts ─ faction reputation    +─ smuggling ─ gets caught ─┐
                      |                                            v
              trade volume between factions ──> relations ──> WAR ──> sieges,
                      ^                                  requisitions,
                      └────── war destroys trade ◄──────── road danger
```

Feedback loops that matter:
- **Peace loop:** cross-faction trade raises relations → safer roads → more trade.
- **War spiral:** war kills trade → relations worsen → longer wars. Player can
  feed either side (war profiteering: huge margins, reputation costs).
- **Knowledge loop:** caravanserais earn from agent traffic AND leak their
  gossip → better intel → better trades → more money → more caravanserais.
- **Depletion loop:** dumping goods saturates a market (liquidity caps);
  buying empties it (price spikes against you). No infinite money glitches.

## 4. World

- **Zeravesh**, procedurally arranged from hand-authored faction/city pools per
  seed: coastline, steppe, mountains, river delta, forests. Roads = graph over
  cities (MST + extra edges), each with distance (days) and danger.
- **Factions:** Serene Concord (coastal merchant league — spice, amber, free
  trade), Ashen Khanate (steppe — horses, raiders, relics are taboo),
  Celestial Vault (mountain theocracy — silk, porcelain, iron; wine forbidden),
  Iron Compact (forest/mine confederation — iron, tools, timber; silk banned by
  sumptuary law), Ninefold Delta (river breadbasket — grain, salt, cloth, wine;
  politically unstable).
- **Goods (12):** grain, salt, timber, iron, cloth, tools, wine, horses, spice,
  silk, porcelain, relics. Each: base value, wagon space, perishability,
  elasticity (staples spike hard in shortage; luxuries are flatter), legal
  status that varies per faction (contraband → smuggling gameplay).
- **Characters:** procedural names per faction culture, epithets earned by
  deeds ("Yusuf the Lucky", "Aldous Twice-Robbed"). The Chronicle turns the
  simulation into story.

## 5. Progression & Retention

- **Guild ranks** by net worth + contracts + fame. Each rank = real unlocks
  (capacity, loans, board access, AI caravans, caravanserai permits).
- **Crew collection:** named specialists (navigator, quartermaster, bodyguard,
  linguist, spy, accountant…) with traits and wages; hired/fired/lost.
- **Ambitions:** ~24 authored goals (corner a market, survive an ambush
  unscathed, own 3 caravanserais, broker peace through trade…).
- **Ledger:** lifetime statistics page — the player's own history book.
- **Replayability:** every world is seeded; Weekly Challenge = fixed seed of
  the week, compete against your own ghosts; Hall of Legends stores past runs.
- **No energy, no timers, no ads.** Sessions are self-paced.

## 6. Onboarding Arc

- **0:00–0:30** — The letter (uncle's inheritance). One city, one market.
  Buy grain — prices show "fair value" so every deal reads instantly.
- **0:30–5:00** — First short trip with the mentor's guidance; first sale;
  first profit toast; Chronicle teaser after day 10.
- **5–30 min** — Second city, contract board, tavern rumors, first bandit
  encounter choice. Intel staleness starts to matter.
- **30 min–2 h** — Guild rank 2–3, crew hiring, contraband temptation, first
  war breaks out somewhere and reshapes prices continent-wide.
- **2–10 h** — AI caravans, first caravanserai, market cornering attempts,
  faction politics you influence on purpose.
- **10 h+** — Multi-caravanserai network, war profiteering vs peace-brokering
  strategies, ambition hunting, new seeds, weekly challenge.

## 7. Art Direction — "Illuminated Ledger"

Antique atlas by lamplight. Parchment map with ink coastline and hand-drawn
mountain glyphs; deep indigo-teal night UI chrome; gold-leaf accents; madder
red and verdigris as signal colors. Display serif (Cormorant Garamond) over a
humanist UI face. Girih-inspired geometric borders generated in SVG/CSS — no
external art assets. All good icons are custom-drawn inline SVG glyphs.
Animation language: ink stamps, ledger flips, coin shimmers, sun-sweep day
advance. Everything respects `prefers-reduced-motion`.

## 8. Audio — Generative Silk Road

Zero audio assets: a WebAudio engine with Karplus-Strong plucked strings (an
oud-like timbre), a slow generative melody over Hijaz-maqam scales with a
drone, wind noise ambience, and diegetic SFX (coin chime on sale, drum on war
news, pluck on UI). Starts only after first user gesture; fully mutable.

## 9. Technical Architecture

- **Vite + TypeScript, zero runtime dependencies.** One `GameState` object;
  commands mutate through sim functions; a tiny pub-sub re-renders subscribed
  DOM panels. Canvas only for the world map (redraw-on-dirty + light rAF for
  caravan motion).
- **Determinism:** seeded RNG (mulberry32) everywhere; same seed + same
  actions ⇒ same world. Required for Weekly Challenge and future async PvP.
- **Persistence:** versioned JSON save in localStorage, autosaved each day;
  export/import as text; migration hooks per schema version.
- **Balance harness:** `scripts/balance.ts` runs headless year-long sims to
  verify price stability, agent survival and war frequency before shipping.
- **Performance target:** daily tick < 2 ms for 16 cities × 12 goods × ~40
  agents; UI updates are localized; mobile layout from 360 px wide.
- **Backend:** none required (honest scope). The deterministic seed + result
  share-code design leaves a clean path to async leaderboards later.

## 10. MVP → Full Vision Path

**MVP (this build):** complete sim (economy, agents, factions, war, events,
contracts, encounters, chronicle), full player loop (travel, markets, intel,
crew, guards, provisions, tariffs, smuggling), guild ranks, ambitions,
caravanserais, AI caravans, save system, onboarding, audio, responsive UI.

**Next (post-MVP, by priority):** async leaderboards + ghost rivals for weekly
seeds; more biomes/regions as expansions; diplomacy screen (player ambassadors,
treaties); naval routes; a hand-authored story campaign layered on the sim;
cosmetic themes marketplace; mod support via seed strings.
