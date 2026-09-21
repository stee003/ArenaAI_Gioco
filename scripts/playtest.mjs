/**
 * UI-driven playtest: boots the real game in jsdom and plays ~120 days the
 * way a human would — clicking the map to select a neighbor, opening the
 * travel modal, departing, advancing days (resolving encounters), then
 * buying via the market's Max/Buy/confirm flow and selling on arrival.
 * Any runtime error, NaN, or stuck state fails the run.
 *
 * Requires jsdom + esbuild resolvable (see scripts/smoke.mjs).
 * Run: node scripts/playtest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const REPO = path.resolve(import.meta.dirname ?? '.', '..');
const require_ = createRequire(import.meta.url);
function resolveFrom(mod, dirs) {
  for (const d of dirs) {
    try { return require_(path.join(d, mod)); } catch { /* next */ }
  }
  try { return require_(mod); } catch { throw new Error(`cannot resolve ${mod}`); }
}
const dirs = [path.join(REPO, 'node_modules'), '/home/user/.pw/node_modules'];
const { build } = resolveFrom('esbuild', dirs);
const { JSDOM, VirtualConsole } = resolveFrom('jsdom', dirs);

const errors = [];
const failures = [];

await build({
  entryPoints: [`${REPO}/src/main.ts`],
  outfile: '/tmp/game-bundle.js',
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020',
  loader: { '.css': 'empty' }, logLevel: 'warning',
});

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`.slice(0, 300)));
vc.on('warn', () => {});

const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`, {
  url: 'http://localhost:5173/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
});
const { window } = dom;

const gradient = { addColorStop() {} };
function checkFinite(name, args) {
  for (const a of args) {
    if (typeof a === 'number' && !Number.isFinite(a)) {
      errors.push(`canvas ${name} non-finite: ${args.join(',')}`);
      return;
    }
  }
}
function ctxMock() {
  const target = {
    canvas: null,
    createRadialGradient: (...a) => { checkFinite('createRadialGradient', a); return gradient; },
    createLinearGradient: (...a) => { checkFinite('createLinearGradient', a); return gradient; },
    measureText: () => ({ width: 8 }),
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return (...args) => checkFinite(String(prop), args);
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}
window.HTMLCanvasElement.prototype.getContext = function () { return ctxMock(); };
Object.defineProperty(window.HTMLCanvasElement.prototype, 'clientWidth', { get() { return 1200; }, configurable: true });
Object.defineProperty(window.HTMLCanvasElement.prototype, 'clientHeight', { get() { return 800; }, configurable: true });
window.HTMLCanvasElement.prototype.getBoundingClientRect = () =>
  ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, x: 0, y: 0 });

window.addEventListener('error', (e) => errors.push(`window.error: ${(e.error?.stack ?? e.message).split('\n')[0]}`));

const script = window.document.createElement('script');
script.textContent = fs.readFileSync('/tmp/game-bundle.js', 'utf8');
window.document.body.appendChild(script);

const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const byText = (sel, text) => $$(sel).find((e) => (e.textContent ?? '').includes(text)) ?? null;

await wait(120);

// start a game with a fixed seed
$('.seed-field input').value = 'playtest-seed';
click(byText('button', 'Begin a journey'));
await wait(150);
click(byText('.modal .btn', 'Take up the ledger'));
await wait(80);

const api = window.__caravanserai;
const PAD = 0.07, W = 1200, H = 800;
const cityXY = (c) => [PAD * W + c.x * (W - 2 * PAD * W), PAD * H + c.y * (H - 2 * PAD * H)];

async function resolveEncounter() {
  let guard = 0;
  while ($('.modal.encounter') && guard++ < 5) {
    console.log('  ENCOUNTER:', ($('.modal.encounter h2')?.textContent ?? '?').trim());
    // Cautious-human policy: read the labels. Never fight without 2+ guards,
    // never confess/forfeit/rob/push-through-storms if a tame option exists.
    const enabled = $$('.modal.encounter .enc-choice').filter((b) => !b.disabled);
    if (!enabled.length) break;
    const guards = api.game.state?.player.guards ?? 0;
    const reckless = /fight|rob them|confess|forfeit|push through|take what|whip the team/i;
    const label = (b) => b.querySelector('b')?.textContent ?? b.textContent ?? '';
    const pay = enabled.find((b) => /^(pay|bribe)/i.test(label(b).trim()));
    const tame = enabled.filter((b) => !reckless.test(label(b)));
    const choice = (guards >= 2 ? enabled[0] : undefined) ?? pay ?? tame[0] ?? enabled[enabled.length - 1];
    click(choice);
    await wait(30);
    click(byText('.modal .btn', 'Continue'));
    await wait(30);
  }
}

async function advance(n = 1) {
  for (let i = 0; i < n; i++) {
    if ($('.modal-veil')) return false; // modal in the way
    click($('.btn-advance'));
    await wait(40);
    await resolveEncounter();
    for (const n of api.shell.lastNotes ?? []) console.log(`  note d${api.game.state.day}: ${n}`);
    const garbage = ($('#app')?.innerHTML ?? '');
    if (/\bNaN\b|\bundefined\b|\[object Object\]/.test(garbage)) errors.push('garbage token rendered in #app: ' + (garbage.match(/.{0,60}(\bNaN\b|\bundefined\b|\[object Object\]).{0,60}/)?.[0] ?? ''));
  }
  return true;
}

function netWorth() { return api.game.netWorth(); }
const startWorth = netWorth();
let trips = 0;
let trades = 0;
function cargoUnits(st) { return Object.values(st.player.cargo).reduce((a, b) => a + b, 0); }
function logCycle(c, tag) {
  const st = api.game.state;
  console.log(`c${c} d${st.day} ${tag} loc=${st.player.loc.kind}${st.player.loc.kind === 'city' ? ':' + st.player.loc.cityId : ''} gold=${Math.round(st.player.gold)} cargo=${cargoUnits(st).toFixed(0)} prov=${st.player.provisions.toFixed(1)} worth=${Math.round(netWorth())}`);
}
const worthLog = [Math.round(startWorth)];

// ------------------------------------------------------------ play ~120 days
for (let cycle = 0; cycle < 16; cycle++) {
  const s = api.game.state;
  if (s.day > 130) break;
  const here = api.game.currentCityId();
  if (!here) { await advance(3); continue; }

  // 1) MARKET: play informed — pick the good with the best margin to a known
  //    neighbor (what a rumor-reading human sees on the map panel), then buy
  //    through the real UI: row max → Buy → confirm.
  const adj = Object.values(s.roads).filter((r) => r.a === here || r.b === here)
    .map((r) => (r.a === here ? r.b : r.a));
  let bestGood = null, bestMargin = 0;
  for (const g of Object.keys(s.cities[here].price)) {
    if (s.factions[s.cities[here].faction].ideology.contraband.includes(g)) continue;
    const buyP = s.cities[here].price[g];
    for (const d of adj) {
      const m = api.priceTargetOf(s, s.cities[d], g) - buyP;
      if (m > bestMargin && m / buyP > 0.15) { bestMargin = m; bestGood = g; }
    }
  }
  logCycle(cycle, `pre-buy best=${bestGood ?? 'none'} margin=${bestMargin.toFixed(1)}`);

  // 0) A broke merchant does what the market hint tells them to: take a
  //    Guild survey contract (20 sols up front, settles on arrival).
  if (s.player.gold < 100 && !Object.values(s.player.cargo).some((n) => n > 0)) {
    click($('.rail-btn[data-screen="contracts"]'));
    await wait(60);
    const take = $('.btn.primary.sm');
    if (take && !take.disabled) { click(take); await wait(60); }
  }

  click($('.rail-btn[data-screen="market"]'));
  await wait(60);
  if (bestGood) {
    const row = $(`.market-good[data-good="${bestGood}"]`);
    const maxBtn = row && [...row.querySelectorAll('.btn')].find((b) => b.textContent.trim() === 'max' && !b.disabled);
    if (maxBtn) {
      click(maxBtn);
      await wait(30);
      const buyBtn = [...row.querySelectorAll('.trade-cell .btn')].find((b) => b.textContent.includes('Buy') && !b.disabled);
      if (buyBtn) {
        click(buyBtn);
        await wait(40);
        const confirmBuy = $('.modal-veil .btn.primary');
        if (confirmBuy) { click(confirmBuy); await wait(40); }
        trades++;
      }
    }
  }

  logCycle(cycle, 'post-buy');
  // 2) MAP: click a neighbor city, open travel modal, depart
  click($('.rail-btn[data-screen="map"]'));
  await wait(70);
  // travel toward the best margin for the cargo aboard (informed play)
  const cargoIds = Object.keys(s.player.cargo).filter((g) => (s.player.cargo[g] ?? 0) > 0);
  const roadTo = (cid) => Object.values(s.roads).find((r) => (r.a === here && r.b === cid) || (r.b === here && r.a === cid));
  const score = (c) => {
    const margin = cargoIds.length
      ? Math.max(0, ...cargoIds.map((g) => api.priceTargetOf(s, c, g) - s.cities[here].price[g]))
      : 0;
    // Danger costs: tolls run ~50 + 10-20% of cargo value per encounter, and
    // encounter odds scale with danger. A map-reading human prices that in.
    const danger = roadTo(c.id)?.danger ?? 20;
    return margin - danger * (cargoIds.length ? 4 : 1.5);
  };
  const neighbor = Object.values(s.roads)
    .filter((r) => r.a === here || r.b === here)
    .map((r) => s.cities[r.a === here ? r.b : r.a])
    .sort((cA, cB) => score(cB) - score(cA))[0];
  if (neighbor) {
    const [cx, cy] = cityXY(neighbor);
    $('.map-canvas').dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy }));
    await wait(60);
    const travelBtn = byText('.map-side .btn', 'Travel to') ?? byText('.map-side .btn', 'Set out for');
    if (travelBtn) {
      click(travelBtn);
      await wait(60);
      // buy provisions inside the modal if offered
      const provBtn = byText('.modal .btn', 'days of provisions');
      if (provBtn && !provBtn.disabled) { click(provBtn); await wait(60); }
      const depart = byText('.modal .btn', 'Depart');
      if (depart && !depart.disabled) {
        click(depart);
        await wait(60);
        trips++;
      } else {
        // could not afford/whatever — close and just wait in city
        click(byText('.modal .btn', 'Not yet'));
        await wait(40);
      }
    }
  }

  logCycle(cycle, 'post-depart');
  // 3) advance until arrival (or a few idle days if we didn't depart)
  let guard = 0;
  while (api.game.state.player.loc.kind === 'road' && guard++ < 15) {
    if (!await advance(1)) break;
  }
  if (api.game.state.player.loc.kind === 'city') await advance(1 + (cycle % 3));
  logCycle(cycle, 'post-advance');

  // 4) SELL everything on arrival via the market UI
  if (api.game.state.player.loc.kind === 'city') {
    click($('.rail-btn[data-screen="market"]'));
    await wait(60);
    const sellBtns = $$('.market-good .trade-cell .btn').filter((b) => b.textContent.trim().startsWith('Sell') && !b.disabled);
    for (const sb of sellBtns) {
      click(sb);
      await wait(40);
      const confirmSell = $('.modal-veil .btn.primary');
      if (confirmSell) { click(confirmSell); await wait(40); }
    }
    // fence anything forbidden
    const fenceBtns = $$('.market-good .trade-cell .btn').filter((b) => b.textContent.includes('Fence') && !b.disabled);
    if (fenceBtns.length) {
      click($('.rail-btn[data-screen="tavern"]'));
      await wait(60);
      for (const fb of $$('.cargo-row .btn.danger')) { click(fb); await wait(40); }
    }
  }
  logCycle(cycle, 'post-sell');
  worthLog.push(Math.round(netWorth()));
}

// ------------------------------------------------------------- verdict
const finalWorth = netWorth();
const s = api.game.state;
console.log(`\n================ PLAYTEST RESULTS ================`);
console.log(`days played: ${s.day} | trips: ${trips} | buy actions: ${trades}`);
console.log(`net worth: ${Math.round(startWorth)} → ${Math.round(finalWorth)}`);
console.log(`worth log: ${worthLog.join(' → ')}`);
console.log(`rank: ${s.player.guildRank} | contracts done: ${s.stats.contractsDone} | profit: ${Math.round(s.stats.tradeProfit)}`);
console.log(`errors: ${errors.length} | failures: ${failures.length}`);
for (const e of errors.slice(0, 10)) console.log('ERROR:', e);
// Growth is proven by balance.ts (optimal play); this harness proves the UI
// plumbing survives a long honest session: no errors, real trips, survival,
// and no death spiral (recovery systems keep a broke merchant above water).
if (trips < 4) failures.push(`too few completed trips (${trips})`);
if (finalWorth < 100) failures.push(`death spiral: final worth ${Math.round(finalWorth)} < 100`);
if (Math.min(...worthLog) < 1) failures.push('went broke mid-run');
for (const f of failures) console.log('FAIL:', f);
process.exit(failures.length || errors.length ? 1 : 0);
