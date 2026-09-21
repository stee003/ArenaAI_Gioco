import type { Rng } from '../core/rng';
import { GOOD_IDS, GOODS } from '../data/goods';
import { agentDisplayName } from './agents';
import type { ChronicleIssue, GameState, NewsItem } from './types';

/**
 * The Zeravesh Chronicle: a ten-day newspaper compiled from what the
 * simulation actually did. Headlines rank themselves by importance; markets
 * are computed from real price histories; gossip is lifted from agents' real
 * deeds. When the player becomes part of the world's story, the world prints it.
 */

export function compileChronicle(s: GameState, rng: Rng): ChronicleIssue {
  const since = s.day - 10;
  const period = s.news.filter((n) => n.day > since);

  const headlineItem =
    [...period].sort((a, b) => b.importance - a.importance || b.day - a.day)[0] ?? null;

  const warItems = period.filter((n) => n.kind === 'war' || n.kind === 'politics');
  const marketLines = marketReport(s, rng);
  const roadLines = roadReport(s, rng);
  const merchantLines = merchantGossip(s, rng);
  const playerLines = playerReport(s, since);
  const colorLines = period
    .filter((n) => n.kind === 'omen' || n.kind === 'festival' || n.kind === 'discovery')
    .slice(-3)
    .map((n) => n.text);

  // Player mentions count toward the "Ink on Your Name" ambition.
  if (playerLines.length > 0) s.stats.chronicleMentions += playerLines.length;

  const sections: ChronicleIssue['sections'] = [];
  if (warItems.length) sections.push({ title: 'Of Wars & Thrones', items: warItems.slice(-4).map((n) => n.text) });
  if (marketLines.length) sections.push({ title: 'The Markets', items: marketLines });
  if (roadLines.length) sections.push({ title: 'The Roads', items: roadLines });
  if (merchantLines.length) sections.push({ title: 'Merchants We Watch', items: merchantLines });
  if (playerLines.length) sections.push({ title: `Concerning ${s.player.name}`, items: playerLines });
  if (colorLines.length) sections.push({ title: 'Omens, Feasts & Curiosities', items: colorLines });
  if (!sections.length) sections.push({ title: 'A Quiet Ten Days', items: ['Nothing worthy of ink. The Chronicle reminds its readers that quiet roads fill granaries and empty graveyards. Advertisements on the reverse.'] });

  return {
    day: s.day,
    headline: headlineItem ? headlineItem.text : 'A Quiet Fortnight on the Amber Roads',
    headlineKind: headlineItem?.kind ?? 'market',
    sections,
  };
}

/** Biggest price movers of the last week, computed from real histories. */
function marketReport(s: GameState, rng: Rng): string[] {
  interface Move { text: string; size: number }
  const moves: Move[] = [];
  for (const cityId of s.cityOrder) {
    const c = s.cities[cityId];
    for (const g of GOOD_IDS) {
      const hist = c.history[g];
      if (hist.length < 8) continue;
      const now = hist[hist.length - 1];
      const then = hist[Math.max(0, hist.length - 8)];
      const change = (now - then) / Math.max(then, 0.01);
      if (Math.abs(change) < 0.09) continue;
      const dir = change > 0 ? 'rises' : 'falls';
      moves.push({
        size: Math.abs(change) * (GOODS[g].tier === 'staple' ? 1.4 : 1), // staples newsworthy: people eat
        text: `${GOODS[g].name} ${dir} in ${c.name}: ${then.toFixed(1)} → ${now.toFixed(1)} sols (${change > 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(0)}%). ${priceQuip(rng, g, change)}`,
      });
    }
  }
  return moves.sort((a, b) => b.size - a.size).slice(0, 5).map((m) => m.text);
}

function priceQuip(rng: Rng, good: string, change: number): string {
  const up = change > 0;
  const quips = up
    ? [
        'Households are inventive with substitutes.',
        'Factors call it a correction; widows call it a robbery.',
        'Wagons are being turned around as this is printed.',
        'Somebody, somewhere, is having a very good week.',
      ]
    : [
        'Buyers stroll; sellers sweat.',
        'Glut, says the exchange — with feeling.',
        'Warehouses groan and margins weep.',
        'A fine week to be poor and hungry, relatively.',
      ];
  void good;
  return rng.pick(quips);
}

function roadReport(s: GameState, rng: Rng): string[] {
  const lines: string[] = [];
  const hot = [...s.roadOrder]
    .map((id) => s.roads[id])
    .filter((r) => r.danger > 30)
    .sort((a, b) => b.danger - a.danger)
    .slice(0, 3);
  for (const r of hot) {
    const chief = r.banditsUntil > s.day && r.banditChief ? ` ${r.banditChief} collects tolls that are not taxes.` : '';
    lines.push(`The ${s.cities[r.a].name}–${s.cities[r.b].name} road rates ${dangerWord(r.danger)}${chief ? ' ' : ''}(${r.danger}).${chief}`);
  }
  const serais = s.player.caravanserais.map((id) => s.roads[id]).filter((r) => r.caravanseraiName);
  if (serais.length) {
    const r = rng.pick(serais);
    lines.push(`${r.caravanseraiName} on the ${s.cities[r.a].name}–${s.cities[r.b].name} road reports a full courtyard and honest beds — the Chronicle's correspondent confirms the lamb.`);
  }
  const closed = s.roadOrder.map((id) => s.roads[id]).filter((r) => r.stormUntil > s.day || r.daysModUntil > s.day);
  if (closed.length) {
    const r = rng.pick(closed);
    lines.push(`${r.stormUntil > s.day ? 'Weather' : 'A ruined crossing'} continues to tax the ${s.cities[r.a].name}–${s.cities[r.b].name} run with extra days.`);
  }
  return lines.slice(0, 4);
}

function dangerWord(d: number): string {
  if (d > 70) return 'an open invitation to die';
  if (d > 50) return 'frankly murderous';
  if (d > 35) return 'troubled';
  return 'restless';
}

function merchantGossip(s: GameState, rng: Rng): string[] {
  const lines: string[] = [];
  const alive = s.agents.filter((a) => a.alive && !a.owner);
  // The richest, the most-traveled, and someone with fresh deeds.
  const rich = [...alive].sort((a, b) => b.gold - a.gold)[0];
  if (rich && rich.gold > 1500) {
    lines.push(`${agentDisplayName(rich)} is reckoned the richest independent on the exchange (${Math.round(rich.gold)} sols liquid) and ${rng.pick(['still haggles over tea', 'still drives their own first wagon', 'trusts exactly two people, both family', 'sleeps with the strongbox chained to the bedpost'])}.`);
  }
  const deeders = alive.filter((a) => a.deeds.length > 0);
  if (deeders.length) {
    const a = rng.pick(deeders);
    const deed = a.deeds[a.deeds.length - 1];
    lines.push(`${agentDisplayName(a)} ${deed.text} (day ${deed.day}).`);
  }
  const poor = alive.filter((a) => a.gold < 80);
  if (poor.length && rng.chance(0.4)) {
    lines.push(`The exchange extends its sympathies to ${poor.length} houses currently thinner than their ledgers. The road is long; fortunes turn.`);
  }
  return lines.slice(0, 3);
}

function playerReport(s: GameState, since: number): string[] {
  const items: NewsItem[] = s.news.filter((n) => n.day > since && (n.kind === 'player' || (n.kind === 'crime' && n.text.includes(s.player.name))));
  const lines = items.slice(-3).map((n) => n.text);
  // Standing flavor based on fame/rank so the player is *seen* even in quiet weeks.
  if (lines.length === 0 && s.player.fame >= 20) {
    lines.push(`${s.player.name}${s.player.epithet && s.player.epithet !== 'the Young' ? ' ' + s.player.epithet : ''} passed through the exchange's attention this tenday without incident — which regulars note, because on these roads, incident is the weather and ${s.player.name.split(' ')[0]} has been carrying an umbrella.`);
  }
  return lines;
}

