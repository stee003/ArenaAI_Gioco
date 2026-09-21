/**
 * The Map — an antique atlas of Zeravesh rendered live on canvas.
 * Caravan dots actually move along roads as days advance; faction colors,
 * siege rings, caravanserais and salvage marks are drawn from real state.
 * Clicking a city or road opens its dossier in the side panel.
 */
import { game } from '../../sim/game';
import { bus, T } from '../../core/bus';
import { audio } from '../../audio/engine';
import { shell, type Screen } from '../shell';
import { h, rerender, clear, type Child } from '../dom';
import { icon, factionSeal } from '../icons';
import { GOODS, GOOD_IDS, BUILDINGS } from '../../data/goods';
import { findPath } from '../../sim/agents';
import { roadBetween } from '../../sim/economy';
import { effectiveRoadDays } from '../../sim/events';
import { Rng } from '../../core/rng';
import { formatDayShort } from '../../core/calendar';
import type { City, Pace } from '../../sim/types';
import { rankDef } from '../../data/guild';
import type { GameState } from '../../sim/types';

const PAD = 0.07;
let W = 0; let H = 0;

// module-level view state (survives re-render, not reload — fine for a map)
let selectedCity: string | null = null;
let selectedRoad: string | null = null;
let hoverCity: string | null = null;
let hoverRoad: string | null = null;
let intendedDest: string | null = null;

const px = (c: City): number => PAD * W + c.x * (W - 2 * PAD * W);
const py = (c: City): number => PAD * H + c.y * (H - 2 * PAD * H);

// ------------------------------------------------------------------ drawing

let baseCanvas: HTMLCanvasElement | null = null;
let baseDirty = true;
let baseW = 0; let baseH = 0;

function invalidateBase(): void { baseDirty = true; }

function drawBase(s: GameState, scale: number): void {
  if (!baseCanvas) baseCanvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  baseCanvas.width = W * dpr;
  baseCanvas.height = H * dpr;
  const bctx = baseCanvas.getContext('2d');
  if (!bctx) return;
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // ---- sea
  const sea = bctx.createRadialGradient(W * 0.5, H * 0.4, 40, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
  sea.addColorStop(0, '#16283a');
  sea.addColorStop(1, '#0c1520');
  bctx.fillStyle = sea;
  bctx.fillRect(0, 0, W, H);

  // faint sea waves
  bctx.strokeStyle = 'rgba(122,160,190,0.07)';
  bctx.lineWidth = 1;
  const wrng = new Rng(99);
  for (let i = 0; i < 26; i++) {
    const x = wrng.float() * W; const y = wrng.float() * H; const w = 10 + wrng.float() * 26;
    bctx.beginPath();
    bctx.arc(x, y, w, 0.15 * Math.PI, 0.85 * Math.PI);
    bctx.stroke();
  }

  // ---- landmass: two blurred passes = watercolour coast
  const landPass = (blur: number, color: string, rMul: number, roadW: number): void => {
    bctx.save();
    bctx.filter = `blur(${blur}px)`;
    bctx.fillStyle = color;
    bctx.strokeStyle = color;
    bctx.lineCap = 'round';
    for (const cid of s.cityOrder) {
      const c = s.cities[cid];
      bctx.beginPath();
      bctx.arc(px(c), py(c), (34 + c.pop * 0.9) * scale * rMul, 0, Math.PI * 2);
      bctx.fill();
    }
    bctx.lineWidth = roadW * scale;
    for (const rid of s.roadOrder) {
      const r = s.roads[rid];
      const a = s.cities[r.a]; const b = s.cities[r.b];
      bctx.beginPath();
      bctx.moveTo(px(a), py(a));
      bctx.lineTo(px(b), py(b));
      bctx.stroke();
    }
    bctx.restore();
  };
  landPass(34 * scale + 10, 'rgba(168,140,94,0.5)', 1.35, 44);
  landPass(16 * scale + 4, 'rgba(214,190,142,0.85)', 1.0, 30);
  bctx.save();
  bctx.filter = 'blur(2px)';
  bctx.fillStyle = 'rgba(236,220,186,0.5)';
  for (const cid of s.cityOrder) {
    const c = s.cities[cid];
    bctx.beginPath();
    bctx.arc(px(c), py(c), (20 + c.pop * 0.5) * scale, 0, Math.PI * 2);
    bctx.fill();
  }
  bctx.restore();

  // ---- terrain glyphs
  bctx.lineWidth = 1.1;
  for (const cid of s.cityOrder) {
    const c = s.cities[cid];
    const rng = new Rng(`${s.seed}|glyphs|${cid}`);
    const n = 5 + Math.floor(rng.float() * 5);
    const rr = (52 + c.pop) * scale;
    bctx.strokeStyle = 'rgba(70,52,28,0.3)';
    for (let i = 0; i < n; i++) {
      const ang = rng.float() * Math.PI * 2;
      const d = rr * (0.55 + rng.float() * 0.9);
      const gx = px(c) + Math.cos(ang) * d;
      const gy = py(c) + Math.sin(ang) * d * 0.75;
      const sz = (4 + rng.float() * 4) * Math.max(0.75, scale);
      drawGlyph(bctx, c.biome, gx, gy, sz, rng);
    }
  }
  baseW = W; baseH = H;
  baseDirty = false;
}

function drawMap(canvas: HTMLCanvasElement, animT: number): void {
  const s = game.need();
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    baseDirty = true;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const scale = Math.min(W, H) / 620;
  if (baseDirty || baseW !== W || baseH !== H || !baseCanvas) drawBase(s, scale);
  if (baseCanvas) ctx.drawImage(baseCanvas, 0, 0, W, H);

  // ---- roads
  for (const rid of s.roadOrder) {
    const r = s.roads[rid];
    const a = s.cities[r.a]; const b = s.cities[r.b];
    const x1 = px(a); const y1 = py(a); const x2 = px(b); const y2 = py(b);
    const sel = rid === selectedRoad;
    const hov = rid === hoverRoad;
    ctx.save();
    ctx.lineWidth = sel ? 3 : hov ? 2.4 : 1.7;
    const dangerK = Math.min(1, r.danger / 90);
    if (sel) ctx.strokeStyle = '#d9a441';
    else if (r.danger > 55) ctx.strokeStyle = `rgba(${140 + dangerK * 60},${70 - dangerK * 20},50,0.75)`;
    else ctx.strokeStyle = 'rgba(58,44,26,0.72)';
    if (r.kind === 'pass') ctx.setLineDash([7, 5]);
    else if (r.kind === 'desert') ctx.setLineDash([2, 5]);
    else if (r.kind === 'river') ctx.strokeStyle = sel ? '#d9a441' : 'rgba(60,92,128,0.8)';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();

    // caravanserai marker at midpoint
    if (r.caravanserai) {
      const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2;
      const own = r.caravanserai === 'player';
      ctx.save();
      ctx.fillStyle = own ? '#d9a441' : 'rgba(50,38,22,0.9)';
      ctx.strokeStyle = own ? '#f0c060' : 'rgba(236,220,186,0.7)';
      ctx.lineWidth = 1;
      const hs = 4.4 * Math.max(0.8, scale);
      ctx.beginPath();
      ctx.moveTo(mx - hs, my); ctx.lineTo(mx, my - hs); ctx.lineTo(mx + hs, my);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillRect(mx - hs * 0.8, my, hs * 1.6, hs * 1.1);
      ctx.strokeRect(mx - hs * 0.8, my, hs * 1.6, hs * 1.1);
      ctx.restore();
    }
    // salvage glint
    if (r.salvage && r.salvage.until > s.day) {
      const mx = x1 + (x2 - x1) * 0.62; const my = y1 + (y2 - y1) * 0.62;
      ctx.save();
      ctx.strokeStyle = 'rgba(240,192,96,0.9)';
      ctx.lineWidth = 1.4;
      const g = 4 * Math.max(0.8, scale);
      ctx.beginPath();
      ctx.moveTo(mx - g, my); ctx.lineTo(mx + g, my);
      ctx.moveTo(mx, my - g); ctx.lineTo(mx, my + g);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- moving caravans (agents on roads + player)
  const dayF = s.day - 1 + animT;
  ctx.save();
  for (const a of s.agents) {
    if (!a.alive || a.loc.kind !== 'road') continue;
    const p = clamp01((dayF - a.loc.startDay) / Math.max(1, a.loc.arriveDay - a.loc.startDay));
    if (!s.roads[a.loc.roadId]) continue;
    const from = s.cities[a.loc.from]; const to = s.cities[a.loc.to];
    const x = px(from) + (px(to) - px(from)) * p;
    const y = py(from) + (py(to) - py(from)) * p;
    ctx.fillStyle = a.owner ? '#f0c060' : 'rgba(74,58,38,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, a.owner ? 3.4 : 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ---- cities
  for (const cid of s.cityOrder) {
    const c = s.cities[cid];
    const x = px(c); const y = py(c);
    const fac = s.factions[c.faction];
    const rr = (4.2 + Math.sqrt(c.pop) * 0.85) * Math.max(0.8, scale);
    const sel = cid === selectedCity;
    const hov = cid === hoverCity;

    const reduced = document.body.classList.contains('reduced-motion');
    if (c.mods.besiegedBy) {
      ctx.save();
      ctx.strokeStyle = `rgba(176,74,50,${reduced ? 0.7 : 0.55 + 0.35 * Math.sin(performance.now() / 260)})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(x, y, rr + 5.5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (c.mods.fairUntil > s.day) {
      ctx.save();
      ctx.strokeStyle = 'rgba(240,192,96,0.75)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x, y, rr + 8, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (sel || hov) {
      ctx.save();
      ctx.strokeStyle = sel ? '#f0c060' : 'rgba(240,192,96,0.5)';
      ctx.lineWidth = sel ? 2 : 1.4;
      ctx.beginPath(); ctx.arc(x, y, rr + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fillStyle = fac.color;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(236,220,186,0.9)';
    ctx.stroke();
    if (fac.capital === cid) {
      ctx.save();
      ctx.fillStyle = '#f0c060';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a1 = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const a2 = a1 + Math.PI / 5;
        ctx.lineTo(x + Math.cos(a1) * (rr + 6), y + Math.sin(a1) * (rr + 6));
        ctx.lineTo(x + Math.cos(a2) * (rr + 2.6), y + Math.sin(a2) * (rr + 2.6));
      }
      ctx.closePath();
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.restore();
    }
    ctx.font = `${Math.max(11, 13 * scale)}px 'Cormorant Garamond', Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(20,14,6,0.55)';
    ctx.fillText(c.name, x + 1, y + rr + 15);
    ctx.fillStyle = '#2a2114';
    ctx.fillText(c.name, x, y + rr + 14);
  }

  // ---- player caravan
  const ploc = s.player.loc;
  if (ploc.kind === 'road') {
    const p = clamp01((dayF - ploc.startDay) / Math.max(1, ploc.arriveDay - ploc.startDay));
    const from = s.cities[ploc.from]; const to = s.cities[ploc.to];
    const x = px(from) + (px(to) - px(from)) * p;
    const y = py(from) + (py(to) - py(from)) * p;
    ctx.save();
    ctx.shadowColor = 'rgba(240,192,96,0.9)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#f0c060';
    ctx.beginPath(); ctx.arc(x, y, 4.6, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#7a5a1e'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, 4.6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  } else {
    const c = s.cities[ploc.cityId];
    ctx.save();
    ctx.strokeStyle = `rgba(240,192,96,${document.body.classList.contains('reduced-motion') ? 0.7 : 0.5 + 0.4 * Math.sin(performance.now() / 400)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px(c), py(c), (4.2 + Math.sqrt(c.pop) * 0.85) * Math.max(0.8, scale) + 8, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // ---- frame + compass
  drawFrame(ctx, W, H);
  drawCompass(ctx, 56, 58, 30 * Math.max(0.8, scale));
}

function drawGlyph(
  ctx: CanvasRenderingContext2D, biome: string,
  x: number, y: number, sz: number, rng: Rng,
): void {
  ctx.beginPath();
  switch (biome) {
    case 'mountain':
    case 'highland':
      ctx.moveTo(x - sz, y + sz * 0.6);
      ctx.lineTo(x - sz * 0.2, y - sz * 0.7);
      ctx.lineTo(x + sz * 0.35, y + sz * 0.1);
      ctx.lineTo(x + sz * 0.7, y - sz * 0.3);
      ctx.lineTo(x + sz * 1.2, y + sz * 0.6);
      break;
    case 'forest':
      ctx.moveTo(x, y + sz); ctx.lineTo(x, y - sz);
      ctx.moveTo(x - sz * 0.6, y + sz * 0.2); ctx.lineTo(x, y - sz * 0.5); ctx.lineTo(x + sz * 0.6, y + sz * 0.2);
      break;
    case 'steppe':
      ctx.moveTo(x - sz, y + sz * 0.3);
      ctx.quadraticCurveTo(x - sz * 0.3, y - sz * 0.5, x + sz * 0.4, y + sz * 0.1);
      ctx.quadraticCurveTo(x + sz * 0.8, y + sz * 0.4, x + sz * 1.1, y - sz * 0.1);
      break;
    case 'delta':
      ctx.moveTo(x, y + sz * 0.7); ctx.lineTo(x - sz * 0.5, y - sz * 0.6);
      ctx.moveTo(x, y + sz * 0.7); ctx.lineTo(x, y - sz * 0.8);
      ctx.moveTo(x, y + sz * 0.7); ctx.lineTo(x + sz * 0.5, y - sz * 0.6);
      break;
    case 'coast':
      ctx.arc(x, y, sz * 0.8, 0.1 * Math.PI, 0.9 * Math.PI);
      if (rng.chance(0.5)) { ctx.moveTo(x + sz * 0.4, y + sz * 0.7); ctx.arc(x + sz * 0.9, y + sz * 0.7, sz * 0.5, 0.1 * Math.PI, 0.9 * Math.PI); }
      break;
  }
  ctx.stroke();
}

function drawFrame(ctx: CanvasRenderingContext2D, w: number, hgt: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(217,164,65,0.28)';
  ctx.lineWidth = 1;
  const m = 10;
  ctx.strokeRect(m, m, w - 2 * m, hgt - 2 * m);
  ctx.strokeStyle = 'rgba(217,164,65,0.14)';
  ctx.strokeRect(m + 4, m + 4, w - 2 * m - 8, hgt - 2 * m - 8);
  // corner florets
  ctx.fillStyle = 'rgba(217,164,65,0.3)';
  for (const [cx, cy] of [[m, m], [w - m, m], [m, hgt - m], [w - m, hgt - m]]) {
    ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawCompass(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(217,164,65,0.5)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(240,192,96,0.85)';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.95); ctx.lineTo(r * 0.16, 0); ctx.lineTo(0, r * 0.3); ctx.lineTo(-r * 0.16, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(42,33,20,0.7)';
  ctx.beginPath();
  ctx.moveTo(0, r * 0.95); ctx.lineTo(r * 0.16, 0); ctx.lineTo(0, -r * 0.3); ctx.lineTo(-r * 0.16, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(240,192,96,0.8)';
  ctx.font = `700 ${Math.round(r * 0.42)}px 'Cormorant Garamond', Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.fillText('N', 0, -r - 6);
  ctx.restore();
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

// ------------------------------------------------------------------ hit test

function hitTest(s: GameState, mx: number, my: number): { city?: string; road?: string } {
  let bestCity: string | null = null;
  let bestD = 16;
  for (const cid of s.cityOrder) {
    const c = s.cities[cid];
    const d = Math.hypot(px(c) - mx, py(c) - my);
    if (d < bestD) { bestD = d; bestCity = cid; }
  }
  if (bestCity) return { city: bestCity };
  let bestRoad: string | null = null;
  bestD = 7;
  for (const rid of s.roadOrder) {
    const r = s.roads[rid];
    const a = s.cities[r.a]; const b = s.cities[r.b];
    const d = distToSeg(mx, my, px(a), py(a), px(b), py(b));
    if (d < bestD) { bestD = d; bestRoad = rid; }
  }
  return bestRoad ? { road: bestRoad } : {};
}

function distToSeg(px0: number, py0: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1; const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px0 - x1) * dx + (py0 - y1) * dy) / l2;
  t = Math.max(0.08, Math.min(0.92, t));
  return Math.hypot(px0 - (x1 + t * dx), py0 - (y1 + t * dy));
}

// ------------------------------------------------------------------ panels

function statusBadges(c: City, s: GameState): Child {
  const out: Child[] = [];
  if (c.mods.besiegedBy) out.push(h('span', { class: 'badge bad' }, `Besieged by ${s.factions[c.mods.besiegedBy].name}`));
  if (c.mods.plagueUntil > s.day) out.push(h('span', { class: 'badge bad' }, 'Plague'));
  if (c.mods.festivalUntil > s.day) out.push(h('span', { class: 'badge good' }, 'Festival'));
  if (c.mods.fairUntil > s.day) out.push(h('span', { class: 'badge gold' }, 'Trade fair — no tariffs'));
  if (c.mods.droughtUntil > s.day) out.push(h('span', { class: 'badge dim' }, 'Drought'));
  if (c.mods.boomUntil > s.day) out.push(h('span', { class: 'badge gold' }, 'Boom'));
  if (c.mods.fireUntil > s.day) out.push(h('span', { class: 'badge dim' }, 'After fire'));
  if (c.unrest > 45) out.push(h('span', { class: 'badge bad' }, `Unrest ${Math.round(c.unrest)}`));
  const ban = (s.player.banned[c.faction] ?? 0);
  if (ban > s.day) out.push(h('span', { class: 'badge bad' }, `you are banished here until day ${ban}`));
  return out.length ? h('div', { class: 'row wrap', style: { 'margin-bottom': '8px' } }, ...out) : null;
}

function cityPanel(host: HTMLElement, cityId: string): void {
  const s = game.need();
  const c = s.cities[cityId];
  const fac = s.factions[c.faction];
  const here = game.currentCityId();
  const contraband = fac.ideology.contraband;

  const intel = game.knownPrices(cityId);
  const priceLines: Child[] = GOOD_IDS
    .map((g) => ({ g, p: intel.price[g] }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p / GOODS[b.g].base - a.p / GOODS[a.g].base)
    .slice(0, 6)
    .map(({ g, p }) => {
      const ratio = p / GOODS[g].base;
      const banned = contraband.includes(g);
      return h('div', { class: 'kv' },
        h('dt', null,
          h('span', { html: icon(g, 13), style: { color: 'var(--gold)', 'margin-right': '6px', 'vertical-align': '-2px' } }),
          GOODS[g].name,
          banned ? h('span', { class: 'badge bad', style: { 'margin-left': '6px' } }, 'banned') : null,
        ),
        h('dd', { class: ratio > 1.25 ? 'bad' : ratio < 0.8 ? 'good' : '' },
          intel.exact ? '' : '~', p.toFixed(1),
          h('span', { class: 'faint small', style: { 'margin-left': '6px' } }, `${Math.round(ratio * 100)}%`),
        ),
      );
    });

  const route = here && here !== cityId ? findPath(s, here, cityId) : null;
  const adjacent = here ? !!roadBetween(s, here, cityId) : false;
  const legs: Child[] = [];
  if (route && route.length > 1) {
    for (let i = 0; i < route.length - 1; i++) {
      const r = roadBetween(s, route[i], route[i + 1])!;
      legs.push(h('div', { class: 'kv' },
        h('dt', null, `${s.cities[route[i]].name} → ${s.cities[route[i + 1]].name}`),
        h('dd', null,
          `${effectiveRoadDays(s, r)}d `,
          h('span', {
            class: r.danger > 55 ? 'bad' : r.danger > 30 ? 'warn' : 'dim',
            'data-tip': `Road danger ${Math.round(r.danger)}/100${r.banditsUntil > s.day ? ` — the confederacy of ${r.banditChief ?? 'nameless outlaws'} haunts this road` : ''}`,
          }, r.danger > 55 ? '⚠ perilous' : r.danger > 30 ? 'risky' : 'fair road'),
        ),
      ));
    }
  }

  rerender(host,
    h('div', { class: 'panel gold-edge travel-card' },
      h('div', { class: 'row', style: { 'margin-bottom': '2px' } },
        h('span', { style: { color: fac.color, display: 'flex' }, html: factionSeal(c.faction, 30) }),
        h('div', { class: 'grow' },
          h('div', { class: 'h2', style: { margin: '0' } }, c.name),
          h('div', { class: 'tiny dim' }, `${fac.name} · ${(c.pop).toFixed(1)}k souls · ${c.biome}`),
        ),
        here === cityId ? h('span', { class: 'badge gold' }, 'you are here') : null,
      ),
      statusBadges(c, s),
      h('div', { class: 'kv' }, h('dt', null, 'Order'),
        h('dd', { style: { flex: '1', 'max-width': '150px' } },
          h('div', { class: `meter ${c.law > 55 ? 'green' : c.law > 35 ? '' : 'red'}` },
            h('i', { style: { width: `${c.law}%` } })),
        )),
      h('div', { class: 'small dim', style: { margin: '4px 0 8px' } },
        `Known for: ${c.buildings.slice(0, 4).map((b) => BUILDINGS[b]?.name ?? b).join(', ')}${c.buildings.length > 4 ? '…' : ''}`),
      h('div', { class: 'h3' }, intel.exact ? 'Today’s prices' : intel.day === 0 ? 'Rumoured prices (never visited)' : `Prices as of ${formatDayShort(intel.day)}`),
      ...priceLines,
      s.player.warehouses.includes(cityId)
        ? h('div', { class: 'chip', style: { 'margin-top': '8px' }, html: `${icon('house', 13)} your warehouse — ${game.warehouseSpaceLeft(cityId)} space free` })
        : here === cityId && s.player.guildRank >= 3
          ? h('button', {
              class: 'btn sm', style: { 'margin-top': '10px' },
              disabled: s.player.gold < 500,
              'data-tip': '300 units of space, nothing spoils, and a courier refreshes your price intel here every 5 days — even while you are away.',
              onclick: () => {
                const res = game.buyWarehouse(cityId);
                audio.play(res.ok ? 'stamp' : 'thud');
                if (!res.ok) shell.toast('warning', res.why ?? 'Cannot buy.');
                bus.emit(T.PLAYER);
                renderSide();
              },
            }, 'Buy a warehouse here — 500 ⛁')
          : here === cityId
            ? h('div', { class: 'tiny faint', style: { 'margin-top': '8px' } }, 'Warehouses become available at guild rank 3 (Merchant).')
            : null,
      here && here !== cityId
        ? h('div', { style: { 'margin-top': '12px' } },
            legs.length > 1 ? h('div', { class: 'tiny faint', style: { 'margin-bottom': '4px' } }, 'The journey, leg by leg:') : null,
            ...legs,
            adjacent
              ? h('button', { class: 'btn primary', style: { 'margin-top': '10px', width: '100%' }, onclick: () => openTravelModal(cityId) },
                  h('span', { html: icon('wagon', 16) }), `Travel to ${c.name}`)
              : h('button', { class: 'btn primary', style: { 'margin-top': '10px', width: '100%' }, onclick: () => openTravelModal(cityId) },
                  h('span', { html: icon('wagon', 16) }), `Set out for ${s.cities[route![1]].name} (first leg)`),
          )
        : null,
      here === cityId
        ? h('div', { class: 'row', style: { 'margin-top': '12px' } },
            h('button', { class: 'btn primary grow', onclick: () => shell.showScreen('market') }, h('span', { html: icon('market', 15) }), 'Open the market'),
            h('button', { class: 'btn ghost grow', onclick: () => shell.showScreen('tavern') }, h('span', { html: icon('lantern', 15) }), 'Tavern'),
          )
        : null,
    ),
  );
}

function roadPanel(host: HTMLElement, roadId: string): void {
  const s = game.need();
  const r = s.roads[roadId];
  const a = s.cities[r.a]; const b = s.cities[r.b];
  const canBuild = rankDef(s.player.guildRank).canBuildCaravanserai;
  const cost = game.caravanseraiCost(roadId);
  const ownedByPlayer = r.caravanserai === 'player';

  rerender(host,
    h('div', { class: 'panel gold-edge travel-card' },
      h('div', { class: 'h2' }, `${a.name} — ${b.name}`),
      h('div', { class: 'tiny dim', style: { 'margin-bottom': '10px' } },
        `${r.kind} road · ${effectiveRoadDays(s, r)} day${effectiveRoadDays(s, r) > 1 ? 's' : ''}${r.daysMod !== 0 && r.daysModUntil > s.day ? (r.daysMod > 0 ? ' (washed bridge: slower)' : ' (new well: faster)') : ''}`),
      h('div', { class: 'kv' }, h('dt', null, 'Danger'),
        h('dd', { style: { flex: '1', 'max-width': '170px' } },
          h('div', { class: `meter ${r.danger > 55 ? 'red' : r.danger > 30 ? '' : 'green'}` }, h('i', { style: { width: `${Math.min(100, r.danger)}%` } })))),
      r.banditsUntil > s.day
        ? h('div', { class: 'small bad', style: { margin: '6px 0' }, html: `${icon('sword', 14)} The confederacy of <b>${r.banditChief ?? 'outlaws'}</b> works this road until ~day ${r.banditsUntil}.` })
        : null,
      r.stormUntil > s.day
        ? h('div', { class: 'small dim', style: { margin: '6px 0' } }, 'Storms blow along the route — travel is slower.')
        : null,
      r.salvage && r.salvage.until > s.day
        ? h('div', { class: 'small gold', style: { margin: '6px 0' } }, `✦ A lost caravan’s cargo lies scattered here — worth roughly ${Math.round(r.salvage.value)} sols to whoever finds it first (before day ${r.salvage.until}).`)
        : null,
      h('div', { style: { 'margin-top': '10px' } },
        r.caravanserai
          ? ownedByPlayer
            ? h('div', { class: 'chip', html: `${icon('house', 13)} <b>${r.caravanseraiName}</b> — yours. Lodging income flows to your ledger.` })
            : h('div', { class: 'chip', html: `${icon('house', 13)} A caravanserai stands here, kept by rival merchants.` })
          : canBuild
            ? h('div', { class: 'stack' },
                h('div', { class: 'small dim' }, 'No caravanserai on this road. Build one to lodge travelers, take a cut, calm the road, and sleep safely when you pass.'),
                h('button', {
                  class: 'btn primary',
                  disabled: s.player.gold < cost,
                  onclick: () => {
                    const res = game.buildCaravanserai(roadId);
                    shell.toast(res.ok ? 'info' : 'warning', res.ok ? `${s.roads[roadId].caravanseraiName} raises its lamp on the ${a.name}–${b.name} road.` : res.why ?? 'Cannot build.');
                    bus.emit(T.PLAYER);
                    renderSide();
                  },
                }, `Build caravanserai — ${cost} sols`),
              )
            : h('div', { class: 'small faint' }, `Guild rank 5 (Magnate) may raise a caravanserai here — and both roads' ends must trust you (standing 30+). Current permit cost would be ${cost} sols.`)
        ,
      ),
    ),
  );
}

function worldPanel(host: HTMLElement): void {
  const s = game.need();
  const wars: Child[] = [];
  for (const f of Object.values(s.factions)) {
    for (const w of f.wars) {
      if (f.id < w.enemy) {
        wars.push(h('div', { class: 'kv' },
          h('dt', { class: 'bad' }, `${f.name} ⚔ ${s.factions[w.enemy].name}`),
          h('dd', null, `${s.day - w.started}d · ${w.battles} battles${w.captures.length ? ` · ${w.captures.length} taken` : ''}`),
        ));
      }
    }
  }
  const bigNews = s.news.filter((n) => n.importance >= 2).slice(-6).reverse();
  rerender(host,
    h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, h('span', { html: icon('map', 18) }), 'The Continent',
        h('small', null, `${s.cityOrder.length} cities · ${s.agents.filter((a) => a.alive).length} caravans`)),
      wars.length
        ? h('div', { style: { 'margin-bottom': '10px' } }, h('div', { class: 'h3 bad' }, 'Wars being fought'), ...wars)
        : h('div', { class: 'small dim', style: { 'margin-bottom': '10px' } }, 'The powers are at peace — for now. Treaties are only pauses that keep accounts.'),
      h('div', { class: 'h3' }, 'Talk of the roads'),
      ...bigNews.map((n) => h('div', { class: 'small dim', style: { padding: '4px 0', 'border-bottom': '1px solid rgba(233,223,198,0.06)' }, html: n.text })),
    ),
    s.tutorial < 2 && s.player.loc.kind === 'city'
      ? h('div', { class: 'panel', style: { 'border-color': 'rgba(217,164,65,0.4)' } },
          h('div', { class: 'h3 gold' }, 'Your first road'),
          h('p', { class: 'small dim', style: { margin: '4px 0 0' } },
            'Click a nearby city, compare its prices with the market here, then set out. Buy low in one town, sell high in the next — the whole art begins there.'),
        )
      : null,
  );
}

function renderSide(): void {
  const host = document.querySelector<HTMLElement>('.map-side');
  if (!host) return;
  const s = game.state;
  if (!s) return;
  clear(host);
  if (selectedCity && s.cities[selectedCity]) cityPanel(host, selectedCity);
  else if (selectedRoad && s.roads[selectedRoad]) roadPanel(host, selectedRoad);
  else worldPanel(host);

  // journey bar while on the road
  if (s.player.loc.kind === 'road') host.appendChild(journeyBar(s));
}

function journeyBar(s: GameState): HTMLElement {
  if (s.player.loc.kind !== 'road') return h('div');
  const loc = s.player.loc;
  const total = Math.max(1, loc.arriveDay - loc.startDay);
  const done = Math.min(total, s.day - loc.startDay);
  const road = s.roads[loc.roadId];
  const steps: Child[] = [];
  for (let i = 0; i <= total; i++) {
    steps.push(h('div', { class: `jstep ${i < done ? 'done' : i === done ? 'done' : ''}` },
      h('span', { class: 'dotc' }),
      i < total ? h('span', { class: 'bar' }) : null,
    ));
  }
  const paceBtn = (p: Pace, label: string, tip: string): Child =>
    h('button', {
      class: `btn sm ${s.player.pace === p ? 'primary' : 'ghost'}`,
      'data-tip': tip,
      onclick: () => { game.setPace(p); audio.play('click'); renderSide(); },
    }, label);

  return h('div', { class: 'journey-bar' },
    h('div', { class: 'spread' },
      h('div', null,
        h('div', { class: 'h3' }, `Bound for ${s.cities[loc.to].name}`),
        h('div', { class: 'tiny dim' },
          `via the ${road ? road.kind : ''} road from ${s.cities[loc.from].name} · day ${done} of ${total}` +
          (intendedDest && intendedDest !== loc.to ? ` · onward to ${s.cities[intendedDest].name}` : '')),
      ),
      h('div', { class: 'row' },
        h('span', {
          class: 'chip',
          'data-tip': 'Days of food for the whole company. Run out and the company eats your cargo — or deserts.',
          html: `${icon('sack', 13)} ${Math.floor(s.player.provisions)}d food`,
        }),
        h('span', {
          class: `chip ${road && road.danger > 55 ? 'bad' : ''}`,
          html: `${icon('sword', 13)} danger ${road ? Math.round(road.danger) : '?'}`,
        }),
      ),
    ),
    h('div', { class: 'journey-steps' }, ...steps),
    h('div', { class: 'spread', style: { 'margin-top': '4px' } },
      h('div', { class: 'row' },
        h('span', { class: 'tiny faint' }, 'Pace:'),
        paceBtn('cautious', 'Cautious', 'Fewer encounters (takes effect at once). Leg length is fixed at departure.'),
        paceBtn('steady', 'Steady', 'The honest road speed.'),
        paceBtn('hard', 'Hard', 'More encounters, chosen at departure for speed & provisions. Changing pace now alters only encounter risk.'),
      ),
      h('span', { class: 'tiny faint' }, 'Space = advance day'),
    ),
    shell.lastNotes.length && shell.lastDay === s.day
      ? h('div', { class: 'tiny dim', style: { 'margin-top': '8px', 'border-top': '1px solid rgba(233,223,198,0.08)', 'padding-top': '6px' } },
          ...shell.lastNotes.map((n) => h('div', null, `· ${n}`)))
      : null,
  );
}

// ------------------------------------------------------------------ travel modal

function paceSelector(onChange: () => void): Child {
  const s = game.need();
  return h('div', { class: 'row', style: { 'margin-bottom': '10px' } },
    h('span', { class: 'tiny faint' }, 'Pace:'),
    ...(['cautious', 'steady', 'hard'] as const).map((p) =>
      h('button', {
        class: `btn sm ${s.player.pace === p ? 'primary' : 'ghost'}`,
        'data-tip': p === 'cautious' ? '25% longer legs, 28% fewer encounters.'
          : p === 'hard' ? '25% shorter legs, 30% more encounters, provisions burn faster.'
          : 'The honest road speed.',
        onclick: () => { game.setPace(p); audio.play('click'); onChange(); },
      }, p[0].toUpperCase() + p.slice(1))),
  );
}

function openTravelModal(destId: string): void {
  const s = game.need();
  const here = game.currentCityId();
  if (!here) return;
  const route = findPath(s, here, destId);
  if (!route || route.length < 2) {
    shell.toast('warning', 'No road leads there.');
    return;
  }
  const firstHop = route[1];
  const plan = game.travelDaysTo(firstHop);
  if (!plan) return;
  intendedDest = destId;

  const legs: Child[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const r = roadBetween(s, route[i], route[i + 1])!;
    legs.push(h('div', { class: 'kv' },
      h('dt', null, `${s.cities[route[i]].name} → ${s.cities[route[i + 1]].name}`),
      h('dd', null, `${effectiveRoadDays(s, r)}d · `,
        h('span', { class: r.danger > 55 ? 'bad' : r.danger > 30 ? 'dim' : 'good' }, `${Math.round(r.danger)} danger`)),
    ));
  }

  const needed = game.provisionsNeededFor(plan.days);
  const have = Math.floor(s.player.provisions);
  const short = Math.max(0, needed - have);

  let close: () => void = () => {};
  const body: Child[] = [
    h('p', { class: 'lede' }, route.length > 2
      ? `The road to ${s.cities[destId].name} runs through ${route.length - 2} stopover${route.length > 3 ? 's' : ''}. You set out one leg at a time — at each stop you may trade, reprovision, or turn back. The world will not wait at any of them.`
      : `A single road runs to ${s.cities[destId].name}. ${plan.days} day${plan.days > 1 ? 's' : ''} at your current pace.`),
    paceSelector(() => { close(); openTravelModal(destId); }),
    ...legs,
    h('div', { class: 'kv' }, h('dt', null, 'Provisions'),
      h('dd', { class: short > 0 ? 'bad' : 'good' }, `${have} / ${needed} days${short > 0 ? ` — ${short} short` : ''}`)),
  ];

  if (short > 0) {
    body.push(h('button', {
      class: 'btn',
      onclick: () => {
        const res = game.buyProvisions(short);
        audio.play(res.ok ? 'buy' : 'thud');
        shell.toast(res.ok ? 'info' : 'warning', res.ok ? `Bought ${short} days of provisions.` : res.why ?? 'Cannot buy.');
        if (res.ok) { close(); openTravelModal(destId); }
      },
    }, `Buy ${short} days of provisions at the market stalls`));
  }

  close = shell.openModal({
    title: `Set out for ${s.cities[destId].name}`,
    icon: 'wagon',
    body,
    actions: [
      h('button', { class: 'btn ghost', onclick: () => { audio.play('click'); close(); } }, 'Not yet'),
      h('button', {
        class: 'btn primary',
        disabled: short > 0,
        onclick: () => {
          const res = game.departTo(firstHop);
          if (res.ok) {
            audio.play('depart');
            close();
            renderSide();
            markDirty();
          } else {
            shell.toast('warning', res.why ?? 'You cannot set out.');
          }
        },
      }, short > 0 ? 'Provisions short' : `Depart — first leg to ${s.cities[firstHop].name}`),
    ],
  });
}

// ------------------------------------------------------------------ screen

let canvas: HTMLCanvasElement | null = null;
let raf = 0;
let dirty = true;
let animStart = 0;
let lastPulse = 0;

function markDirty(): void { dirty = true; }

export const mapScreen: Screen = {
  id: 'map',
  label: 'Map',
  icon: 'map',

  mount(host) {
    const wrap = h('div', { class: 'map-wrap' });
    canvas = h('canvas', { class: 'map-canvas' }) as HTMLCanvasElement;
    const tip = h('div', { class: 'tooltip', style: { display: 'none' } });
    const side = h('div', { class: 'map-side' });
    const legend = h('div', { class: 'map-legend' },
      h('span', null, h('span', { class: 'swatch', style: { background: '#f0c060' } }), 'you'),
      ...Object.values(game.need().factions).map((f) =>
        h('span', { 'data-tip': f.epithet }, h('span', { class: 'swatch', style: { background: f.color } }), f.name.replace(/^The /, ''))),
    );
    wrap.append(canvas, side, legend, tip);
    host.appendChild(wrap);
    renderSide();

    let animT = 1;
    const loop = (): void => {
      if (!canvas) return;
      if (animStart > 0) {
        animT = Math.min(1, (performance.now() - animStart) / 900);
        dirty = true;
        if (animT >= 1) animStart = 0;
      }
      // pulse effects (siege rings, player halo) redraw at ~7fps, not 60
      const st = game.state;
      const now = performance.now();
      if (st && now - lastPulse > 140 &&
          (st.player.loc.kind === 'city' || Object.values(st.cities).some((c) => c.mods.besiegedBy))) {
        lastPulse = now;
        dirty = true;
      }
      if (dirty) {
        dirty = false;
        drawMap(canvas, animT);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onResize = (): void => { invalidateBase(); markDirty(); };
    window.addEventListener('resize', onResize);

    const pos = (e: MouseEvent): { x: number; y: number } => {
      const r = canvas!.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('mousemove', (e) => {
      const s = game.state;
      if (!s || !canvas) return;
      const { x, y } = pos(e);
      const hit = hitTest(s, x, y);
      const changed = hit.city !== hoverCity || hit.road !== hoverRoad;
      hoverCity = hit.city ?? null;
      hoverRoad = hit.road ?? null;
      if (changed) markDirty();
      canvas.style.cursor = hit.city || hit.road ? 'pointer' : 'default';
      if (hit.city) {
        const c = s.cities[hit.city];
        tip.innerHTML = `<b>${c.name}</b><br>${s.factions[c.faction].name} · ${c.pop.toFixed(1)}k`;
        tip.style.display = '';
        tip.classList.add('show');
        tip.style.left = `${e.clientX + 14}px`;
        tip.style.top = `${e.clientY + 10}px`;
      } else if (hit.road) {
        const r = s.roads[hit.road];
        tip.innerHTML = `<b>${s.cities[r.a].name} — ${s.cities[r.b].name}</b><br>${r.kind} road · danger ${Math.round(r.danger)}${r.caravanserai ? ' · caravanserai' : ''}`;
        tip.style.display = '';
        tip.classList.add('show');
        tip.style.left = `${e.clientX + 14}px`;
        tip.style.top = `${e.clientY + 10}px`;
      } else {
        tip.style.display = 'none';
        tip.classList.remove('show');
      }
    });

    canvas.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
      hoverCity = hoverRoad = null;
      markDirty();
    });

    canvas.addEventListener('click', (e) => {
      const s = game.state;
      if (!s || !canvas) return;
      const { x, y } = pos(e);
      const hit = hitTest(s, x, y);
      audio.play('click');
      if (hit.city) {
        selectedCity = hit.city;
        selectedRoad = null;
      } else if (hit.road) {
        selectedRoad = hit.road;
        selectedCity = null;
      } else {
        selectedCity = selectedRoad = null;
      }
      renderSide();
      markDirty();
    });

    shell.sub(T.DAY, () => { animStart = performance.now(); renderSide(); markDirty(); });
    shell.sub(T.STATE, () => { renderSide(); markDirty(); });
    shell.sub(T.TRAVEL, () => { renderSide(); markDirty(); });
    shell.sub(T.PLAYER, () => renderSide());

    this.unmount = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      tip.remove();
      canvas = null;
    };
  },
};
