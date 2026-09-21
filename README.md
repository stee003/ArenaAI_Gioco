# CARAVANSERAI — *The Road Remembers*

A living trade-world game for the browser. You inherit a wagon, 300 sols and
your late uncle's ledger on a continent where **every price is earned, not
scripted**: rival merchants really haul goods between sixteen simulated
cities, five thrones really go to war over trade grievances, and the newspaper
really prints whatever the world did while you were deciding.

**No assets, no servers, no runtime dependencies.** The map is painted on a
canvas, the icons are hand-authored SVG, the newspaper is compiled from world
events, and the music is an oud improvising in Maqam Hijaz over synthesized
desert wind — all generated at runtime from a single seeded random stream.
The same seed replays the same world exactly.

## Run it

```bash
npm install
npm run dev        # → http://localhost:5173
```

Other scripts:

| script              | what it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `npm run build`     | production bundle (vite)                                             |
| `npm run typecheck` | strict TypeScript pass                                               |
| `npm run balance`   | headless 720-day simulation harness + greedy trading bot (balance CI)|
| `node scripts/smoke.mjs` | headless UI smoke test (jsdom; requires jsdom+esbuild resolvable) |
| `node scripts/playtest.mjs` | UI-driven playtest: a bot plays ~120 days through real DOM clicks (map → travel modal → market buy/sell), asserting no runtime errors and a growing net worth |

## What's in the box

- **Economy** — 12 goods with production chains (iron + timber → tools),
  per-city stocks, scarcity pricing with elasticity, daily liquidity caps,
  spoilage, tariffs that feed faction treasuries, contraband, fences,
  wartime embargoes, and ~40 autonomous rival merchants who scout, trade,
  reinvest, grow rich and retire.
- **Politics** — relations warmed by trade flow and cooled by grievances and
  border raids; war declared when hatred outruns treasury; sieges, city
  captures, capitulations; each power's signature goods embargoed in war
  (smuggling becomes the most profitable crime on the continent).
- **The road** — leg-by-leg travel with provisions, wages, pace, named bandit
  confederacies, salvage, storms, ~20 branching encounters with real
  consequences, and caravanserais you can eventually build yourself.
- **Progression** — guild ranks (Peddler → Prince of the Road) gating credit,
  warehouses, AI caravans of your own and caravanserai permits; 24 ambitions
  paying in coin, fame and epithets; fame that literally softens bandit
  appetite; standing per faction from tariffs paid, gifts, fed sieges — and
  outlawry from getting caught.
- **Information as gameplay** — you only truly know prices where you stand;
  elsewhere you trade on aging intel and tavern rumors that write fresh truth
  into your ledger.
- **The Chronicle** — a ten-day procedural broadsheet with real headlines,
  plus a live dispatch feed and a powers board of relations, wars and coffers.
- **Persistence** — versioned localStorage saves, export/import as text (a
  run can travel between browsers), weekly shared-seed challenge, Hall of
  Legend for retired lives.

## Architecture

```
src/
  core/      rng (serialized world stream), event bus, calendar, format utils
  data/      goods, buildings, factions, names, crew, upgrades, guild, ambitions
  sim/       types, worldgen, economy, agents, factions, events, encounters,
             contracts, news, chronicle, game (facade + persistence)
  audio/     generative WebAudio engine (Karplus-flavoured plucks, drone, wind)
  ui/        dom helpers, icons (SVG), shell (chrome/toasts/modals/tooltips),
             screens/ map, market, caravan, tavern, contracts, chronicle,
                      guild, almanac, menu
  main.ts    boot: title screen, inheritance letter, shell assembly
scripts/
  balance.ts headless long-run balance harness
  smoke.mjs  jsdom UI smoke test
  playtest.mjs  UI-driven 120-day bot playthrough
docs/
  DESIGN.md  the full design document
```

The simulation never touches the DOM; the UI never mutates state except
through the `Game` facade, which emits bus events that re-render targeted
screens. The balance harness drives the same facade headlessly.

## Design pillars

1. **The world runs without you.** Advance a day and rivals trade, wars
   start, cities starve or boom — you are one wagon in traffic.
2. **Every number is honest.** Fair-value comparison, real cost-basis profit,
   tariffs shown before you sell, stale intel marked with a `~`.
3. **Depth by disclosure.** First margin in five minutes; smuggling rings,
   siege profiteering, caravan fleets and caravanserai estates at fifty hours.
4. **No fake features.** Every button on every screen does something real.
