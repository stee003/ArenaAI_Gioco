import type { Rng } from '../core/rng';
import { clamp } from '../core/util';
import { GOODS, GOOD_IDS } from '../data/goods';
import { CREW_TRAITS } from '../data/crew';
import { seasonOfDay } from '../core/calendar';
import { agentDisplayName } from './agents';
import { SIGNATURE_GOODS, crewBonus } from './economy';
import { addNews } from './news';
import type { Agent, GameState, GoodId, Road } from './types';

/**
 * Road encounters. Each encounter is a small data-driven scene: title, prose,
 * and choices whose `resolve` functions mutate real state and return outcome
 * text. Encounters read the same simulation everything else does — bandit
 * strength from road danger, patrol interest from your actual contraband,
 * rival caravans from agents who are *literally on that road right now*.
 */

export interface EncounterChoice {
  label: string;
  hint?: string;
  disabled?: string;
  resolve: (s: GameState, rng: Rng) => string;
}

export interface Encounter {
  kind: string;
  title: string;
  text: string;
  choices: EncounterChoice[];
}

// ---------------------------------------------------------------------------
// Helpers over player state
// ---------------------------------------------------------------------------

export function playerCargoValue(s: GameState): number {
  const ref = referenceCity(s);
  let v = 0;
  for (const g of GOOD_IDS) v += (s.player.cargo[g] ?? 0) * ref.price[g];
  return v;
}

function referenceCity(s: GameState) {
  if (s.player.loc.kind === 'city') return s.cities[s.player.loc.cityId];
  return s.cities[s.player.loc.from];
}

function playerFightPower(s: GameState, rng: Rng): number {
  let p = s.player.guards * 12;
  if (crewBonus(s, 'bodyguard') > 0) p = p * 1.4 + 15;
  p += Math.min(s.player.fame, 60) * 0.25;
  if (crewBonus(s, 'herald') > 0) p *= 1.1;
  return p * s.player.luck * rng.range(0.75, 1.3);
}

/** Severe crimes against a power can earn banishment: patrols then treat
 *  your wagon as fair game until the ban lifts. Driven by real standing. */
export function outlawCheck(s: GameState, fid: string): void {
  const f = fid as keyof GameState['player']['banned'];
  if ((s.player.rep[f] ?? 0) < -40 && (s.player.banned[f] ?? 0) <= s.day) {
    s.player.banned[f] = s.day + 120;
    addNews(s, {
      kind: 'crime', importance: 2,
      text: `${s.factions[f].name} declares ${s.player.name} ${s.player.epithet} banished from its lands until day ${s.player.banned[f]}. Gate guards have been given a description of the wagon, and of the merchant, and of the merchant's habits.`,
    });
    s.pending.push({ id: `ol${s.day}${Math.floor(s.rngState % 997)}`, kind: 'warning', text: `You are BANISHED from ${s.factions[f].name} lands until day ${s.player.banned[f]}. Their patrols will inspect, fine and confiscate whenever you enter their cities. Standing below −40 did this; gifts and honest tariffs can climb it back.` });
  }
}

export function addFame(s: GameState, n: number): void {
  s.player.fame = clamp(s.player.fame + n * (crewBonus(s, 'herald') > 0 ? 1.25 : 1), 0, 200);
}

/** Lose a fraction of cargo; bandits take the densest value first (they know goods). */
export function loseCargo(s: GameState, rng: Rng, fraction: number, smart = true): { value: number; lines: string[] } {
  const ref = referenceCity(s);
  const lines: string[] = [];
  let value = 0;
  const order = GOOD_IDS.filter((g) => (s.player.cargo[g] ?? 0) > 0);
  order.sort((a, b) =>
    smart
      ? (ref.price[b] * (s.player.cargo[b] ?? 0)) - (ref.price[a] * (s.player.cargo[a] ?? 0))
      : rng.float() - 0.5,
  );
  let emptiedAll = true;
  for (const g of order) {
    const qty = s.player.cargo[g] ?? 0;
    const lost = Math.ceil(qty * fraction * rng.range(0.8, 1.2));
    const take = Math.min(lost, qty);
    if (take > 0) {
      s.player.cargo[g] = qty - take;
      if (s.player.cargo[g]! <= 0) delete s.player.cargo[g];
      value += take * ref.price[g];
      lines.push(`${take} × ${GOODS[g].name.toLowerCase()}`);
    }
    if ((s.player.cargo[g] ?? 0) > 0) emptiedAll = false;
  }
  if (emptiedAll && Object.keys(s.player.cargo).length === 0 && value > 0) {
    s.flags.robbedEmpty = 1;
  }
  s.stats.lostToBandits += value;
  return { value, lines };
}

function loseGold(s: GameState, amount: number): number {
  const lost = Math.min(s.player.gold, amount);
  s.player.gold -= lost;
  return lost;
}

function woundGuard(s: GameState, rng: Rng): string {
  if (crewBonus(s, 'physician') > 0 && rng.chance(0.7)) return ' Your physician stitches the worst of it; nobody is lost.';
  if (s.player.guards > 0) {
    s.player.guards -= 1;
    return ' One of your guards is carried to the wagon, bleeding — they will not hold a spear again this season.';  }
  const fighter = s.player.crew.find((m) => m.role === 'bodyguard');
  if (fighter && rng.chance(0.4)) {
    s.player.crew = s.player.crew.filter((m) => m !== fighter);
    addNews(s, { kind: 'player', importance: 2, text: `${fighter.name} fell defending your wagon. The road took the finest blade you ever hired. It does not apologize.` });
    return ` ${fighter.name} went down swinging, and did not get up. You will hear yourself saying their name for years.`;
  }
  s.player.luck = clamp(s.player.luck - 0.03, 0.7, 1.3);
  return ' You take a cut across the ribs — nothing mortal, everything memorable.';
}

function contrabandOnBoard(s: GameState): { good: GoodId; qty: number; faction: string }[] {
  const loc = s.player.loc;
  const road = loc.kind === 'road' ? s.roads[loc.roadId] : null;
  if (!road) return [];
  const factions = [s.cities[road.a].faction, s.cities[road.b].faction];
  const out: { good: GoodId; qty: number; faction: string }[] = [];
  for (const fid of factions) {
    const fac = s.factions[fid];
    const embargoed: GoodId[] = [];
    for (const w of fac.wars) embargoed.push(...SIGNATURE_GOODS[w.enemy]);
    for (const g of GOOD_IDS) {
      const qty = s.player.cargo[g] ?? 0;
      if (qty <= 0) continue;
      if (fac.ideology.contraband.includes(g) || embargoed.includes(g)) out.push({ good: g, qty, faction: fid });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Encounter generation
// ---------------------------------------------------------------------------

export function rollEncounter(s: GameState, rng: Rng, road: Road): Encounter | null {
  const winter = seasonOfDay(s.day) === 'winter';
  const hasSalvage = road.salvage && road.salvage.until > s.day;

  // Your own caravanserai: a safe, generous night (and no predators).
  if (road.caravanserai === 'player' && rng.chance(0.28)) return caravanseraiNight(s, rng, road);
  if (road.caravanserai === 'player') return null;

  const contraband = contrabandOnBoard(s);
  const pace = s.player.pace;
  let base = 0.06 + (road.danger / 100) * 0.5;
  if (pace === 'hard') base *= 1.3;
  if (pace === 'cautious') base *= 0.72;
  if (crewBonus(s, 'pathfinder') > 0) base *= 0.8;
  if ((s.player.upgrades.lantern ?? 0) > 0) base *= 0.92;
  base *= 1 - Math.min(s.player.fame, 60) / 220;
  if ((s.flags.paidTolls ?? 0) >= 3) base += 0.07; // word travels: an easy mark
  if ((s.flags.crime ?? 0) >= 3) base += 0.06; // patrols know your face
  if ((s.flags.banditToken ?? 0) > s.day) base *= 0.55;
  if (!rng.chance(clamp(base, 0.02, 0.75)) && !hasSalvage) return null;

  // Scheduled tutorial encounter.
  if (s.flags.scheduledEncounter === 1) {
    s.flags.scheduledEncounter = 0;
    const rival = rivalCaravan(s, rng, road);
    if (rival) return rival;
  }

  const agentsOnRoad = s.agents.filter((a) => a.alive && a.loc.kind === 'road' && a.loc.roadId === road.id);
  const weights: [string, number][] = [
    ['bandits', road.danger * 1.2 + (road.banditsUntil > s.day ? 14 : 0)],
    ['patrol', 5 + (contraband.length > 0 ? 11 : 0) + (s.factions[s.cities[road.a].faction].wars.length ? 5 : 0)],
    ['storm', road.stormUntil > s.day || (winter && road.kind === 'pass') ? 10 : 1.5],
    ['rival', agentsOnRoad.length ? 9 : 2.5],
    ['stranded', 3],
    ['pilgrims', s.cities[road.a].faction === 'vault' || s.cities[road.b].faction === 'vault' ? 4.5 : 2],
    ['wolves', winter && (road.kind === 'open' || s.cities[road.a].biome === 'forest') ? 4.5 : 0],
    ['salvage', hasSalvage ? 200 : 0],
    ['stranger', 1.6],
    ['toll', road.kind === 'river' ? 3.2 : 0],
  ];
  const kind = rng.weighted(weights, (w) => w[1])?.[0] ?? 'rival';
  switch (kind) {
    case 'bandits': return bandits(s, rng, road);
    case 'patrol': return patrol(s, rng, road, contraband);
    case 'storm': return storm(rng);
    case 'rival': return rivalCaravan(s, rng, road) ?? stranded(s, rng);
    case 'stranded': return stranded(s, rng);
    case 'pilgrims': return pilgrims(s, rng, road);
    case 'wolves': return wolves(s, rng);
    case 'salvage': return salvage(rng, road);
    case 'stranger': return stranger(s, rng);
    case 'toll': return tollBridge(s, rng);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Individual encounters
// ---------------------------------------------------------------------------

function bandits(s: GameState, rng: Rng, road: Road): Encounter {
  const chief = road.banditsUntil > s.day ? road.banditChief : undefined;
  const enemyPower = road.danger * (chief ? 0.75 : 0.55) + rng.range(8, 30) + (s.player.luck < 0.95 ? 8 : 0);
  const cargoVal = playerCargoValue(s);
  const toll = Math.round(50 + cargoVal * rng.range(0.1, 0.2));
  const canBluff = s.player.fame >= 15 || crewBonus(s, 'herald') > 0 ||
    s.player.rep[s.cities[road.a].faction] >= 60 || s.player.rep[s.cities[road.b].faction] >= 60;

  return {
    kind: 'bandits',
    title: chief ? `${chief}'s Riders` : 'Riders on the Road',
    text: chief
      ? `Dust, then hooves, then the banners of ${chief} — the confederacy that has been bleeding this road all season. ${rng.int(6, 18)} riders fan out across the track. They are not hurrying. They do not need to.`
      : `${rng.int(4, 12)} riders rise out of the ${rng.pick(['scrub', 'treeline', 'dry riverbed', 'rocks', 'dusk'])} like they were always part of it. One lifts an empty hand: the universal road-greeting, meaning *stop, and maybe live*.`,
    choices: [
      {
        label: 'Form up and fight',
        hint: `Your strength: ${s.player.guards} guard${s.player.guards === 1 ? '' : 's'}${crewBonus(s, 'bodyguard') ? ' + bodyguard' : ''}. Theirs: unknown, but the road is ${road.danger > 40 ? 'theirs' : 'nobody\u2019s'}.`,
        resolve: (st, r) => {
          const mine = playerFightPower(st, r);
          if (mine > enemyPower) {
            const lootGold = Math.round(30 + road.danger * 2.2 * r.range(0.6, 1.5));
            const lootGood = r.pick(GOOD_IDS.filter((g) => GOODS[g].tier !== 'treasure'));
            const lootQty = r.int(4, 30);
            st.player.gold += lootGold;
            st.player.cargo[lootGood] = (st.player.cargo[lootGood] ?? 0) + lootQty;
            st.stats.banditsBeaten++;
            addFame(st, 3);
            for (const cid of [road.a, road.b]) {
              const fid = st.cities[cid].faction;
              st.player.rep[fid] = clamp(st.player.rep[fid] + 1, -100, 100);
            }
            let extra = '';
            if (chief && r.chance(0.35)) {
              road.banditsUntil = st.day;
              st.player.rep[st.cities[road.a].faction] = clamp(st.player.rep[st.cities[road.a].faction] + 3, -100, 100);
              addFame(st, 4);
              extra = ` And in the rout, ${chief} himself is run down and bound. The confederacy scatters — this road will breathe easier for a season. Songs, inevitably. You hate songs.`;
              addNews(st, { kind: 'crime', importance: 2, text: `${chief} taken or killed by a merchant's guards on the ${st.cities[road.a].name}–${st.cities[road.b].name} road. Magistrates claim credit; the road knows better.` });
            }
            return `The fight is short and loud. Your line holds — ${st.player.guards > 0 ? 'your guards earn every copper you pay them' : 'you fight like a cornered mule-keeper, which is what you are'} — and the riders melt back into the country they came from.${extra} In their camp: ${lootGold} sols in mixed coin and ${lootQty} units of ${GOODS[lootGood].name.toLowerCase()} some poorer merchant will mourn.`;
          }
          const { value, lines } = loseCargo(st, r, r.range(0.35, 0.6));
          const gold = loseGold(st, r.range(0.15, 0.3) * st.player.gold + 20);
          const wound = woundGuard(st, r);
          addFame(st, -1);
          st.flags.ambushedLately = st.day;
          return `It goes badly. They are more, meaner, and know exactly which boxes are heavy.${wound} They take ${Math.round(gold)} sols of coin${lines.length ? ` and ${lines.join(', ')}` : ''} — roughly ${Math.round(value)} sols of cargo — and ride off arguing about the split, which tells you it could have been worse. It was bad enough.`;
        },
      },
      {
        label: `Pay their “toll” (${toll} sols)`,
        hint: 'Safe passage, at a price. Paid marks travel: pay often enough and every petty robber on the steppe will hear you are generous.',
        disabled: s.player.gold < toll ? 'You cannot even afford robbery.' : undefined,
        resolve: (st, r) => {
          const paid = loseGold(st, toll);
          st.flags.paidTolls = (st.flags.paidTolls ?? 0) + 1;
          const courtesy = (st.flags.crime ?? 0) >= 3 && r.chance(0.4);
          if (courtesy) return `You count out ${paid} sols into a filthy palm. One of the riders squints at you: “${r.pick(['You\u2019re the one from the ferry toll.', 'The wagon with the patched canvas. Again.', 'You pay like a man who has learned.'])}” They take half and wave you on. Professionally, almost warmly.`;
          return `You count out ${paid} sols. They count it twice — robbers are, above all, careful men — and wave you through. Nothing was lost but money.${(st.flags.paidTolls ?? 0) >= 3 ? ' Somewhere behind you, a reputation is being written: *pays. does not fight.*' : ''}`;
        },
      },
      {
        label: 'Whip the team and run',
        hint: 'Half a chance to break clean; the rest you pay in dropped crates and time.',
        resolve: (st, r) => {
          let p = 0.5 + (st.player.pace === 'cautious' ? -0.05 : 0) + (st.player.pace === 'hard' ? 0.1 : 0);
          if (crewBonus(st, 'pathfinder') > 0) p += 0.15;
          if ((st.player.upgrades.horses ?? 0) > 0) p += 0.08 * (st.player.upgrades.horses ?? 0);
          if (r.chance(clamp(p, 0.2, 0.9) * st.player.luck)) {
            if (st.player.loc.kind === 'road') st.player.loc.arriveDay += 1;
            return 'You cut the traces on the lead pair and the wagon leaps. Arrows argue with the dust behind you and lose. An hour of hard driving later, the road is empty and your heart is not. You will camp off-track tonight — a day late, entirely alive.';
          }
          const { value, lines } = loseCargo(st, r, 0.3);
          const gold = loseGold(st, 30 + r.range(0, 60));
          const wound = r.chance(0.3) ? woundGuard(st, r) : '';
          if (st.player.loc.kind === 'road') st.player.loc.arriveDay += 1;
          return `A thrown shoe, a screaming mule, a crate bouncing away into the dark — the escape goes to pieces halfway.${wound} They help themselves to ${Math.round(gold)} sols of coin${lines.length ? ` and ${lines.join(', ')} (~${Math.round(value)} sols)` : ''} before you limber up and crawl away under a bruised sky.`;
        },
      },
      {
        label: 'Stand in the road and bluff',
        hint: 'Fame, banners and reputation are weapons too.',
        disabled: canBluff ? undefined : 'You are nobody. That is the problem.',
        resolve: (st, r) => {
          const p = clamp(0.35 + st.player.fame / 300 + (crewBonus(st, 'herald') > 0 ? 0.2 : 0) + (st.player.rep[st.cities[road.a].faction] >= 60 ? 0.15 : 0), 0.2, 0.85) * st.player.luck;
          if (r.chance(p)) {
            addFame(st, 1);
            if (r.chance(0.3)) {
              st.flags.banditToken = st.day + 60;
              return `You do not reach for a weapon. You reach for your *name* — and it turns out to be longer than their rope. “${st.player.name}${st.player.epithet && st.player.epithet !== 'the Young' ? ' ' + st.player.epithet : ''},” says the eldest rider, slowly, like reading a coin. They lower their bows. Before they go, the eldest presses a notched copper disc into your hand: “Show this on the ${st.cities[road.a].name} road. It means you are expensive to rob.”`;
            }
            return `You stand in the middle of the road like a milestone with opinions, and say your name in the voice your uncle used for tax collectors. It works. They actually confer. Then they ride off, and you discover your shirt is wet through.`;
          }
          const mine = playerFightPower(st, r) * 0.75;
          if (mine > enemyPower) return `The bluff fails gloriously — and then the fight that follows goes your way anyway, because ${r.pick(['they expected bluster, not steel', 'your guards were lying in the cargo all along', 'their horses spooked at the worst moment'])}. They scatter empty-handed.`;
          const { value, lines } = loseCargo(st, r, 0.3);
          return `The bluff dies in the air. “A talker,” says the eldest rider, disappointed, and they take ${lines.join(', ') || 'what they can carry'} (~${Math.round(value)} sols) to prove a point about talking.`;
        },
      },
    ],
  };
}

function patrol(
  s: GameState, rng: Rng, road: Road,
  contraband: { good: GoodId; qty: number; faction: string }[],
): Encounter {
  const facId = (contraband[0]?.faction ?? s.cities[road.a].faction) as keyof GameState['factions'];
  const fac = s.factions[facId];
  const hasContraband = contraband.length > 0;
  // Concealment roll before the scene even starts.
  let found = hasContraband;
  let concealedText = '';
  if (hasContraband) {
    let detect = 0.62;
    detect -= 0.22 * (s.player.upgrades.compartment ?? 0);
    if (crewBonus(s, 'smuggler') > 0) detect -= 0.18;
    if (crewBonus(s, 'spy') > 0) detect -= 0.1;
    detect *= s.player.luck;
    found = rng.chance(clamp(detect, 0.06, 0.9));
    if (!found) {
      const listed = contraband.map((c) => `${c.qty} × ${GOODS[c.good].name.toLowerCase()}`).join(', ');
      concealedText = ` The false floor holds. Your heart does its best to hammer a hole through your ribs while the sergeant's lance idly taps the very boards hiding ${listed}. “Empty,” he announces, and the world resumes turning.`;
    }
  }
  const contrabandValue = contraband.reduce((v, c) => v + c.qty * GOODS[c.good].base, 0);
  const bribe = Math.round(contrabandValue * 0.55 * (crewBonus(s, 'spy') > 0 ? 0.7 : 1) * (crewBonus(s, 'smuggler') > 0 ? 0.85 : 1));

  if (!found) {
    const war = fac.wars.length > 0;
    return {
      kind: 'patrol',
      title: `${fac.name.replace(/^The /, '')} Road Wardens`,
      text: `A patrol of ${rng.int(4, 9)} rides up under ${fac.epithet} colors — lance-tips worn bright, which means bored, which means thorough. They check your papers, poke the cargo, count your mules.${hasContraband ? concealedText : ''}`,
      choices: [
        {
          label: war ? `Pay the war-escort levy (${Math.max(20, Math.round(playerCargoValue(s) * 0.02))} sols)` : 'Show papers and pass',
          hint: war ? 'Wartime roads are taxed by the spear.' : 'Nothing to hide. Almost.',
          resolve: (st) => {
            if (war) {
              const levy = Math.max(20, Math.round(playerCargoValue(st) * 0.02));
              const paid = loseGold(st, levy);
              return `The sergeant writes a receipt with real ink and real spelling: ${paid} sols for "escort of the realm." You have met this receipt before. It has never once escorted anything.`;
            }
            const rumorRoll = rng.chance(0.3);
            if (rumorRoll) {
              const c = st.cities[road.a];
              st.player.intel[c.id] = { day: st.day - 1, price: { ...c.price } };
              return `Papers in order. The sergeant, satisfied, leans from the saddle: “Since you asked nothing — ${c.name} pays ${c.price.iron.toFixed(0)} for iron and pretends it isn't stocking a war-hoarde. Drive safe.” Useful men, wardens.`;
            }
            return 'Papers in order, seals unbroken, cargo boring. The sergeant waves you on with the weary generosity of men who have searched four hundred wagons this month.';
          },
        },
      ],
    };
  }

  return {
    kind: 'patrol',
    title: `${fac.name.replace(/^The /, '')} Road Wardens`,
    text: `The sergeant's lance comes up under the oilcloth and stops. What it stops against is ${GOODS[contraband[0].good].name.toLowerCase()} — forbidden in ${fac.name} by ${fac.ideology.contraband.includes(contraband[0].good) ? 'law and scripture both' : 'wartime edict'}. Twelve lances. One very slow moment. “Interesting wagon,” says the sergeant.`,
    choices: [
      {
        label: `Bribe the sergeant (${bribe} sols)`,
        hint: 'Every lance has a price; this one has a family.',
        disabled: s.player.gold < bribe ? 'Not enough coin. Ironic.' : undefined,
        resolve: (st) => {
          const paid = loseGold(st, bribe);
          st.player.rep[facId] = clamp(st.player.rep[facId] - 2, -100, 100);
          return `${paid} sols change hands inside a folded cloak, the old way. The sergeant's face performs surprise. “A false bottom. Full of *nothing*,” he announces to nobody, and the patrol rides on. You are sweating in weather that does not warrant it.`;
        },
      },
      {
        label: 'Confess and forfeit the goods',
        hint: 'Lose the cargo, keep the record mostly clean.',
        resolve: (st) => {
          const lines: string[] = [];
          for (const c of contraband) {
            lines.push(`${c.qty} × ${GOODS[c.good].name.toLowerCase()}`);
            delete st.player.cargo[c.good];
          }
          const fine = loseGold(st, rng.range(60, 130));
          st.player.rep[facId] = clamp(st.player.rep[facId] - 4, -100, 100);
          st.stats.caughtSmuggling++;
          return `You talk them out of the wagon and into a neat confiscation pile: ${lines.join(', ')} plus a fine of ${fine} sols, receipted with infuriating bureaucracy. “Honesty,” the sergeant says, pocketing the fine, “is cheaper than smuggling. Usually.”`;
        },
      },
      {
        label: 'Fight your way out',
        hint: 'Against the law itself. Your reputation will not enjoy this.',
        resolve: (st, r) => {
          const mine = playerFightPower(st, r);
          const theirs = 30 + s.cities[road.a].law * 0.35 + r.range(0, 25);
          st.flags.crime = (st.flags.crime ?? 0) + 1;
          if (mine > theirs) {
            st.player.rep[facId] = clamp(st.player.rep[facId] - 12, -100, 100);
            outlawCheck(st, facId);
            addFame(st, 2);
            if (st.player.loc.kind === 'road') st.player.loc.arriveDay += 1;
            addNews(st, { kind: 'crime', importance: 1, text: `Wardens of ${fac.name} were fired upon by a merchant wagon on the ${st.cities[road.a].name}–${st.cities[road.b].name} road and lived to describe the banners. The description is going places.` });
            return `You flip the cook-pot into the nearest horse and the world becomes noise. When the dust settles you are a quarter-mile on, lighter by dignity, heavier by outlawry — ${fac.name} will remember this, and so will every patrol after it. But the cargo rides.`;
          }
          for (const c of contraband) delete st.player.cargo[c.good];
          const fine = loseGold(st, rng.range(150, 320));
          const wound = woundGuard(st, r);
          st.player.rep[facId] = clamp(st.player.rep[facId] - 18, -100, 100);
          st.stats.caughtSmuggling++;
          outlawCheck(st, facId);
          return `Twelve lances answer. It is not a fight; it is an administrative action with hooves.${wound} The contraband is confiscated, a fine of ${fine} sols is extracted on the spot, and the sergeant reads your name into a ledger that ${fac.name} keeps forever.`;
        },
      },
    ],
  };
}

function storm(rng: Rng): Encounter {
  return {
    kind: 'storm',
    title: 'The Sky Falls Down',
    text: `${rng.pick([
      'A wall of black cloud arrives from the west with gravel in its fists, and the road turns to running water within the hour.',
      'The wind gets up like something released from a jar. The mules know before you do: this is a hunker-down night.',
      'Snow — at the wrong altitude, in the wrong month, in entirely the wrong place for a loaded wagon.',
    ])}`,
    choices: [
      {
        label: 'Push through it',
        hint: 'Fragile and perishable cargo suffers; porcelain prays.',
        resolve: (st) => {
          const covered = (st.player.upgrades.oilskin ?? 0) > 0;
          const lines: string[] = [];
          if ((st.player.cargo.porcelain ?? 0) > 0) {
            const broke = Math.ceil((st.player.cargo.porcelain ?? 0) * (covered ? 0.08 : 0.25));
            st.player.cargo.porcelain! -= broke;
            if (st.player.cargo.porcelain! <= 0) delete st.player.cargo.porcelain;
            lines.push(`${broke} porcelain pieces ${covered ? 'chipped despite the oilskins' : 'shattered — a fortune in dust'}`);
          }
          for (const g of GOOD_IDS) {
            if (GOODS[g].perish <= 0 || g === 'porcelain') continue;
            const qty = st.player.cargo[g] ?? 0;
            if (qty <= 0) continue;
            const lost = Math.ceil(qty * (covered ? 0.02 : 0.06));
            if (lost > 0) {
              st.player.cargo[g] = qty - lost;
              if (st.player.cargo[g]! <= 0) delete st.player.cargo[g];
              lines.push(`${lost} ${GOODS[g].name.toLowerCase()} spoiled`);
            }
          }
          if (st.player.loc.kind === 'road') st.player.loc.arriveDay += 0; // pushed through on time
          return lines.length
            ? `You drive blind through screaming weather and arrive on schedule — mostly. ${lines.join('; ')}. The mules will discuss this for weeks.`
            : `You drive blind through screaming weather, arrive soaked and entirely on schedule, and discover you have become the sort of person who enjoys complaining about it.`;
        },
      },
      {
        label: 'Shelter and wait it out',
        hint: 'Lose up to two days; lose nothing else.',
        resolve: (st) => {
          const lost = rng.int(1, 2);
          if (st.player.loc.kind === 'road') st.player.loc.arriveDay += lost;
          st.player.provisions = Math.max(0, st.player.provisions - lost);
          return `You get the wagons off the track under ${rng.pick(['an overhang', 'a stand of black poplars', 'a dead man\u2019s bridge', 'the lea of a granite outcrop'])} and wait out ${lost} day${lost > 1 ? 's' : ''} of apocalypse, boiling tea and counting cargo. Everything survives. So do you. The road, when it reappears, is rearranged in small unimportant ways.`;
        },
      },
    ],
  };
}

function rivalCaravan(s: GameState, rng: Rng, road: Road): Encounter | null {
  const onRoad = s.agents.filter((a) => a.alive && a.loc.kind === 'road' && a.loc.roadId === road.id && a.id !== undefined);
  const candidate = onRoad.length
    ? rng.pick(onRoad)
    : rng.pick(s.agents.filter((a) => a.alive && !a.owner));
  if (!candidate) return null;
  const a = candidate;
  const theirGoods = GOOD_IDS.filter((g) => (a.cargo[g] ?? 0) > 0);
  const shown = theirGoods.length ? rng.pick(theirGoods) : rng.pick(GOOD_IDS);
  const yourGoods = GOOD_IDS.filter((g) => (s.player.cargo[g] ?? 0) > 0);
  const ref = s.player.loc.kind === 'road' ? s.cities[s.player.loc.from] : s.cities[s.player.loc.cityId];
  const midPrice = (g: GoodId) => {
    const known = a.knowledge[a.loc.kind === 'road' ? a.loc.to : a.loc.cityId];
    const their = known?.price[g] ?? GOODS[g].base;
    return (ref.price[g] + their) / 2;
  };
  const dest = a.dest ? s.cities[a.dest].name : 'somewhere east';
  const canRob = s.player.guards >= a.guards + 2;

  return {
    kind: 'rival',
    title: 'Another Wagon, Another Life',
    text: `Coming the other way: a ${rng.pick(['dust-caked', 'well-painted', 'overladen', 'lean'])} caravan under ${s.factions[a.faction].name.replace(/^The /, '')} colors. You recognize the master — ${agentDisplayName(a)}, ${rng.pick(['reputed careful with coin', 'known to talk through the night', 'three ventures from rich or ruined', 'hauling for a house older than the road'])}. Teams slow as wagons pass. This is the part of the road where news is currency. You glimpse ${shown !== undefined ? GOODS[shown].name.toLowerCase() : 'tarps'} under their lashings, headed, it seems, for ${dest}.`,
    choices: [
      {
        label: 'Trade on the road',
        hint: `They'll swap at the midpoint of what you both know — no tariffs, no market, no witnesses.`,
        disabled: yourGoods.length === 0 && theirGoods.length === 0 ? 'Neither wagon has anything to say.' : undefined,
        resolve: (st) => {
          const lines: string[] = [];
          // Sell your best good at midpoint price (up to a third of it).
          if (yourGoods.length) {
            const g = yourGoods.sort((x, y) => (st.player.cargo[y] ?? 0) * midPrice(y) - (st.player.cargo[x] ?? 0) * midPrice(x))[0];
            const qty = Math.min(Math.ceil((st.player.cargo[g] ?? 0) * 0.4), Math.floor(a.gold / Math.max(midPrice(g), 1)));
            if (qty > 0) {
              const unit = midPrice(g);
              const gross = qty * unit;
              a.gold -= gross * 0.9; // they haggle
              a.cargo[g] = (a.cargo[g] ?? 0) + qty;
              st.player.cargo[g] = (st.player.cargo[g] ?? 0) - qty;
              if (st.player.cargo[g]! <= 0) delete st.player.cargo[g];
              st.player.gold += gross;
              st.stats.totalSold += gross;
              lines.push(`sold ${qty} × ${GOODS[g].name.toLowerCase()} @ ${unit.toFixed(1)}`);
            }
          }
          // Buy their shown good at midpoint price (up to a third).
          const bg = theirGoods.length ? theirGoods[0] : undefined;
          if (bg && a.cargo[bg]! > 0) {
            const space = st.player.capacity - cargoSpaceNow(st);
            const qty = Math.min(Math.floor(a.cargo[bg]! * 0.4), Math.floor(st.player.gold / Math.max(midPrice(bg), 1)), Math.floor(space / GOODS[bg].space));
            if (qty > 0) {
              const unit = midPrice(bg);
              st.player.gold -= qty * unit;
              a.gold += qty * unit;
              a.cargo[bg] = a.cargo[bg]! - qty;
              if (a.cargo[bg]! <= 0) delete a.cargo[bg];
              st.player.cargo[bg] = (st.player.cargo[bg] ?? 0) + qty;
              st.stats.totalBought += qty * unit;
              lines.push(`bought ${qty} × ${GOODS[bg].name.toLowerCase()} @ ${unit.toFixed(1)}`);
            }
          }
          return lines.length
            ? `Two wagons, one tarp between them, scales hanging from a branch: you ${lines.join(' and ')}. No tariff-taker within a day's ride. ${a.name.split(' ')[0]} counts your coin twice and calls it fair, which from ${s.factions[a.faction].epithet.toLowerCase().replace(/^/, 'a merchant of the ')} is practically a love letter.`
            : `You spread tarps and compare ledgers, but neither of you can afford what the other is selling. An hour of prices, anyway — prices are always useful.`;
        },
      },
      {
        label: 'Share the evening fire',
        hint: 'Free gossip. Gossip is intel. Intel is money.',
        resolve: (st, r) => {
          // Learn prices from a city they visited recently.
          const fresh = Object.entries(a.knowledge)
            .sort((x, y) => y[1].day - x[1].day)
            .find(([cid]) => cid !== (st.player.loc.kind === 'road' ? st.player.loc.from : st.player.loc.cityId));
          let gained = '';
          if (fresh && r.chance(0.75)) {
            st.player.intel[fresh[0]] = { day: fresh[1].day, price: { ...st.cities[fresh[0]].price } };
            gained = ` Before the tea is finished they have talked themselves through ${st.cities[fresh[0]].name}'s entire price board, as of ${st.day - fresh[1].day} days back — you write it down under the stars. Your map of prices just grew.`;
          }
          const rumor = r.pick([
            `${a.name.split(' ')[0]} swears ${dest} is paying double for anything on two legs and four wheels.`,
            `“Wardens on the ${st.cities[road.a].name} road are searching every wagon. Every. Wagon.”`,
            `“Half the exchange in ${st.cities[a.home].name} is long on ${GOODS[r.pick(GOOD_IDS)].name.toLowerCase()}. When everyone is long, friend —” they draw a finger across a throat, grinning.`,
            `“${agentDisplayName(r.pick(st.agents.filter((x) => x.alive && x.id !== a.id)) ?? a)} lost a whole load to ${r.pick(['flood', 'fever', 'a magistrate with a grudge'])}. Watch the ${GOODS[r.pick(GOOD_IDS)].name.toLowerCase()} price jump.”`,
          ]);
          return `You camp together, because the road is long and nights are longer. ${rumor}${gained}`;
        },
      },
      {
        label: 'Hire their spare guards (60 sols)',
        hint: '+2 guards until your next city.',
        disabled: s.player.gold < 60 ? 'They can smell an empty purse.' : undefined,
        resolve: (st) => {
          loseGold(st, 60);
          st.flags.tempGuards = (st.flags.tempGuards ?? 0) + 2;
          return `Two of ${a.name.split(' ')[0]}'s escorts — bored cousins of somebody important, by their account of themselves — transfer to your payroll for 60 sols and the promise of soup. They ride until your next gates. You sleep better anyway.`;
        },
      },
      {
        label: 'Rob them',
        hint: `${a.guards} guards against your ${s.player.guards}. The road remembers this kind of thing. So will ${s.factions[a.faction].name}.`,
        disabled: canRob ? undefined : 'Your muscle does not out-argue theirs.',
        resolve: (st, r) => {
          const stolen: string[] = [];
          let value = 0;
          for (const g of GOOD_IDS) {
            const qty = a.cargo[g] ?? 0;
            if (qty <= 0) continue;
            const take = Math.ceil(qty * r.range(0.5, 0.9));
            a.cargo[g] = qty - take;
            if (a.cargo[g]! <= 0) delete a.cargo[g];
            st.player.cargo[g] = (st.player.cargo[g] ?? 0) + take;
            value += take * ref.price[g];
            stolen.push(`${take} × ${GOODS[g].name.toLowerCase()}`);
          }
          const goldTaken = Math.min(a.gold * 0.5, 200);
          a.gold -= goldTaken;
          st.player.gold += goldTaken;
          st.player.rep[a.faction] = clamp(st.player.rep[a.faction] - 15, -100, 100);
          outlawCheck(st, a.faction);
          st.flags.crime = (st.flags.crime ?? 0) + 1;
          addFame(st, 1);
          recordAgentDeed(a, st.day, `was robbed by ${st.player.name} on the open road`);
          if (r.chance(0.45)) {
            addNews(st, { kind: 'crime', importance: 2, text: `${agentDisplayName(a)} was stripped of ${Math.round(value + goldTaken)} sols of goods and coin by a merchant flying no colors — on the ${st.cities[road.a].name} road, in ${st.factions[a.faction].name} country. The exchange is asking questions.` });
          }
          return `You turn your own wagon across theirs — the oldest trap on the steppe — and with ${st.player.guards} armed reasons behind you, take ${stolen.length ? stolen.join(', ') : 'everything there is: nothing'} plus ${Math.round(goldTaken)} sols. ${a.name.split(' ')[0]} does not fight. ${a.name.split(' ')[0]} watches, memorizes your banners, and says one sentence before you part: “${r.pick(['The road is a small room.', 'We will meet, you and I.', 'I have a long memory and a short ledger.'])}”`;
        },
      },
    ],
  };
}

function recordAgentDeed(a: Agent, day: number, text: string): void {
  a.deeds.push({ day, text });
  if (a.deeds.length > 5) a.deeds.shift();
}

function cargoSpaceNow(s: GameState): number {
  let sp = 0;
  for (const g of GOOD_IDS) sp += (s.player.cargo[g] ?? 0) * GOODS[g].space;
  return sp;
}

function stranded(s: GameState, rng: Rng): Encounter {
  const victim = rng.pick(s.agents.filter((a) => a.alive && !a.owner)) ?? null;
  const name = victim ? agentDisplayName(victim) : 'a grain factor from the south';
  return {
    kind: 'stranded',
    title: 'A Broken Axle',
    text: `Off the track, wagon tilted like a dying bird: ${name}, axle snapped clean, cargo spread across the scrub. ${victim ? 'They have been waving at dust for what looks like a day.' : 'The wheelwright of the party is arguing with physics and losing.'} They spot you and wave with the specific enthusiasm of the stranded.`,
    choices: [
      {
        label: 'Stop and help (costs a day)',
        hint: 'The road runs on favors. This is a deposit.',
        resolve: (st, r) => {
          if (st.player.loc.kind === 'road') st.player.loc.arriveDay += 1;
          const reward = r.int(50, 150);
          st.player.gold += reward;
          if (victim) {
            st.player.rep[victim.faction] = clamp(st.player.rep[victim.faction] + 2, -100, 100);
            recordAgentDeed(victim, st.day, `was pulled off the road by ${st.player.name} — owes a favor`);
          }
          addFame(st, 1);
          const extra = r.chance(0.3) ? ` Before you go, ${victim ? victim.name.split(' ')[0] : 'the factor'} presses a folded paper into your hand: a price list from ${st.cities[r.pick(st.cityOrder)].name}, three days fresh. “For the axle,” they say. “Not for the money.”` : '';
          return `A day of jacks, spare timber, and language nobody's grandmother would recognize — but the wagon stands, the axle holds, and ${victim ? victim.name.split(' ')[0] : 'the factor'} pays you ${reward} sols in coin that smells of gratitude.${extra}`;
        },
      },
      {
        label: 'Take what they cannot defend',
        hint: 'Their remaining cargo, minus any illusion people might keep about you.',
        resolve: (st, r) => {
          let value = 0;
          const lines: string[] = [];
          const goods = victim ? GOOD_IDS.filter((g) => (victim.cargo[g] ?? 0) > 0) : [r.pick(GOOD_IDS)];
          for (const g of goods.slice(0, 2)) {
            const qty = victim ? Math.ceil((victim.cargo[g] ?? 0) * 0.6) : r.int(5, 20);
            if (qty <= 0) continue;
            if (victim) {
              victim.cargo[g] = (victim.cargo[g] ?? 0) - qty;
              if (victim.cargo[g]! <= 0) delete victim.cargo[g];
              recordAgentDeed(victim, st.day, `was picked clean by ${st.player.name} at their worst moment`);
              st.player.rep[victim.faction] = clamp(st.player.rep[victim.faction] - 8, -100, 100);
            }
            st.player.cargo[g] = (st.player.cargo[g] ?? 0) + qty;
            value += qty * GOODS[g].base;
            lines.push(`${qty} × ${GOODS[g].name.toLowerCase()}`);
          }
          st.flags.crime = (st.flags.crime ?? 0) + 1;
          if (victim && r.chance(0.5)) {
            addNews(st, { kind: 'crime', importance: 1, text: `A stranded wagon near the ${r.pick(['salt flats', 'old ford', 'black pines'])} was relieved of its remaining cargo — not by bandits, witnesses say, but by another merchant. The exchange has a word for this. The word is short.` });
          }
          return `You help yourself to ${lines.join(', ') || 'what little they had'} (~${Math.round(value)} sols) while ${victim ? victim.name.split(' ')[0] : 'the factor'} watches, saying nothing, memorizing your banners. ${r.chance(0.5) ? 'Somewhere tonight, this story will be told in a tea-house, and your name will be in it.' : 'They do not curse you. Somehow that is worse.'}`;
        },
      },
      {
        label: 'Wish them luck and drive on',
        resolve: () => 'You call out something encouraging about axles and drive on. By nightfall you have mostly stopped thinking about their face. Mostly.',
      },
    ],
  };
}

function pilgrims(s: GameState, rng: Rng, road: Road): Encounter {
  const fid = s.cities[road.a].faction === 'vault' ? s.cities[road.a].faction : s.cities[road.b].faction;
  const sellable = GOOD_IDS.filter((g) => (s.player.cargo[g] ?? 0) > 0 && ['wine', 'relics', 'spice'].includes(g));
  return {
    kind: 'pilgrims',
    title: 'Pilgrims of the High Road',
    text: `A column of ${rng.int(30, 200)} pilgrims in undyed robes walks the road's edge toward ${fid === 'vault' ? 'the shrines of the Vault' : rng.pick(['the river shrines', 'the old temple at the ford', 'a saint\u2019s footprint in the rock'])}, singing in shifts. Their almoner — practical as a quartermaster, robes or no robes — eyes your wagon with professional interest.`,
    choices: [
      {
        label: sellable.length ? `Trade with the almoner (${sellable.map((g) => GOODS[g].name.toLowerCase()).join(', ')})` : 'Trade with the almoner',
        hint: 'Pilgrims pay above fair for wine, relics and spice. Devotion is inelastic.',
        disabled: sellable.length ? undefined : 'They want wine, relics or spice. You carry none.',
        resolve: (st) => {
          let earned = 0;
          const lines: string[] = [];
          for (const g of sellable) {
            const qty = Math.min(st.player.cargo[g] ?? 0, 10);
            if (qty <= 0) continue;
            const unit = GOODS[g].base * 1.45;
            st.player.cargo[g] = (st.player.cargo[g] ?? 0) - qty;
            if (st.player.cargo[g]! <= 0) delete st.player.cargo[g];
            earned += qty * unit;
            lines.push(`${qty} × ${GOODS[g].name.toLowerCase()} @ ${unit.toFixed(0)}`);
          }
          st.player.gold += earned;
          st.stats.totalSold += earned;
          return `The almoner pays ${Math.round(earned)} sols without haggling — ${lines.join(', ')} — and blesses the transaction twice, which is either piety or a receipt. The pilgrims sing your wagon past their column.`;
        },
      },
      {
        label: 'Receive their blessing',
        hint: 'The road runs on luck too. This refills a little.',
        resolve: (st) => {
          st.player.luck = clamp(st.player.luck + 0.04, 0.7, 1.3);
          return `An old pilgrim takes your both hands in hers, says a prayer older than the factions, and ties a blue thread around your wagon-brake. Luck is not a number you can keep in a ledger — but for the next while, the dice will sit a little straighter.`;
        },
      },
      {
        label: 'Share your provisions (−2 days of food)',
        hint: 'Fame among the faithful; the Vault hears everything eventually.',
        disabled: s.player.provisions < 3 ? 'You cannot feed anyone, including yourself, much longer.' : undefined,
        resolve: (st) => {
          st.player.provisions -= 2;
          st.player.rep[fid] = clamp(st.player.rep[fid] + 2, -100, 100);
          addFame(st, 1);
          return `Two days of your food becomes one evening of theirs, multiplied through a hundred small bowls. The almoner writes your name in a book they carry for exactly this purpose. ${fid === 'vault' ? 'The Vault keeps its own ledgers, and this one is not of coin.' : 'Word of the wagon that fed the column walks ahead of you now.'}`;
        },
      },
    ],
  };
}

function wolves(s: GameState, rng: Rng): Encounter {
  return {
    kind: 'wolves',
    title: 'Eyes at the Fire\u2019s Edge',
    text: `Cold night, thin moon, and a patience in the dark that breathes. Wolves — ${rng.int(4, 11)} of them, steppe-grey, working the edge of the firelight with the coordination of a guild. The mules have stopped being horses and started being problems.`,
    choices: [
      {
        label: s.player.guards >= 2 ? 'Stand watch and drive them off' : 'Build the fire huge',
        hint: s.player.guards >= 2 ? 'Spears, torches, shouting: the classic triangle.' : 'Costs an evening of provisions as fuel. Wolves hate accounting.',
        resolve: (st) => {
          if (st.player.guards >= 2) {
            const pelts = rng.int(1, 3);
            st.player.gold += pelts * 12;
            return `Your guards form the old triangle — fire, spear-line, noise — and by midnight the pack has spent its courage and gone elsewhere. In the morning: ${pelts} pelts, worth ${pelts * 12} sols to the right hatter, and one very smug guard.`;
          }
          st.player.provisions = Math.max(0, st.player.provisions - 2);
          return `You feed the fire with crates, rope, two days of provisions and one spare wagon-bow until it is a bonfire visible from the moon. The pack concludes the economics are against them and fades into the dark. Expensive warmth.`;
        },
      },
      {
        label: 'Keep the herd calm and ride it out',
        hint: 'Horses in cargo are the obvious target. So are the mules.',
        resolve: (st, r) => {
          const horseCargo = st.player.cargo.horses ?? 0;
          if (horseCargo > 0 && r.chance(0.5)) {
            const lost = Math.min(horseCargo, r.int(1, 2));
            st.player.cargo.horses = horseCargo - lost;
            if (st.player.cargo.horses! <= 0) delete st.player.cargo.horses;
            return `You walk the perimeter till dawn singing every song you know. It nearly works — nearly. ${lost} of your cargo horses go screaming into the dark, and the pack goes with them, which is one way to be saved. The mules will not look at you for a day.`;
          }
          st.player.provisions = Math.max(0, st.player.provisions - 1);
          return `You walk the perimeter till dawn, sing every song you know, and lose one sack of provisions to a very bold individual wolf. The team is intact. Your voice is not.`;
        },
      },
    ],
  };
}

function salvage(rng: Rng, road: Road): Encounter {
  const sal = road.salvage!;
  return {
    kind: 'salvage',
    title: 'What the Road Kept',
    text: `The wreck the scavengers talked about is real: a wagon on its side in the ${rng.pick(['shingle', 'reed-beds', 'scree'])}, spokes gone green, cargo scattered a hundred paces in every direction. By the old custom of the road — first honest finder — it is arguably, mostly, legally yours.`,
    choices: [
      {
        label: 'Recover everything (costs a day)',
        hint: `Worth roughly ${Math.round(sal.value)} sols if you are thorough. Thorough takes time.`,
        resolve: (st) => {
          for (const [g, q] of Object.entries(sal.goods)) {
            const good = g as GoodId;
            st.player.cargo[good] = (st.player.cargo[good] ?? 0) + (q as number);
          }
          const coin = Math.round(sal.value * 0.25);
          st.player.gold += coin;
          delete road.salvage;
          if (st.player.loc.kind === 'road') st.player.loc.arriveDay += 1;
          return `A full day of crawling the scrub on your hands and knees produces: ${Object.entries(sal.goods).map(([g, q]) => `${q} × ${GOODS[g as GoodId].name.toLowerCase()}`).join(', ') || 'dignity'}, plus ${coin} sols hammered out of a strongbox under the driver's bench. The road gives; the road takes; tonight the road gave.`;
        },
      },
      {
        label: 'Grab the obvious and go',
        hint: 'Sixty percent of it, no day lost, no crawling.',
        resolve: (st) => {
          for (const [g, q] of Object.entries(sal.goods)) {
            const good = g as GoodId;
            const take = Math.ceil((q as number) * 0.6);
            if (take > 0) st.player.cargo[good] = (st.player.cargo[good] ?? 0) + take;
          }
          delete road.salvage;
          return `You take the visible sixty percent — the crates, the strongbox's lighter cousin, anything a single trip can carry — and are back on the track within the hour. Behind you the wreck settles deeper into the scrub, keeping its secrets and its splinters.`;
        },
      },
    ],
  };
}

function stranger(s: GameState, rng: Rng): Encounter {
  return {
    kind: 'stranger',
    title: 'A Stranger Walks the Road',
    text: `A figure on foot — which on this road is already strange — falls in beside your wagon without asking. ${rng.pick([
      'They wear a sword the way other people wear a name.',
      'Their boots are good. Everything else about them is a rumor.',
      'They have the calm of someone who has been robbed before and intends never to repeat the experiment.',
    ])} After a mile, they speak: “I walk faster than bandits and slower than taxes. Either is a service.”`,
    choices: [
      {
        label: `Hire them as a bodyguard (${rng.int(45, 80)} sols, wages after)`,
        hint: 'A veteran blade, no questions asked on either side.',
        disabled: s.player.gold < 45 ? 'They glance at your purse and you both do the arithmetic.' : undefined,
        resolve: (st) => {
          const hire = rng.int(45, 80);
          loseGold(st, hire);
          st.player.crew.push({
            id: `crew_${st.nextAgentNum++}`, name: rng.pick(['Vash', 'Ilmari', 'Grey Nura', 'Halric', 'Sable', 'Old Tobin']),
            role: 'bodyguard', wage: Math.round(CREW_TRAITS.veteran.wageMult * 5), hiredDay: st.day, trait: 'veteran',
          });
          return `${hire} sols changes hands. They walk beside your wagon that evening, and something in the geometry of the road changes: shadows keep their distance, and the mules — who are excellent judges of character — step out sharper. You have hired ${st.player.crew[st.player.crew.length - 1].name}, bodyguard. No questions asked, as advertised.`;
        },
      },
      {
        label: 'Buy their road-knowledge (90 sols)',
        hint: 'Two cities\u2019 true prices, three days fresh. Walkers see everything.',
        disabled: s.player.gold < 90 ? 'Their knowledge is not sold on credit.' : undefined,
        resolve: (st) => {
          loseGold(st, 90);
          const picks = rng.shuffled(st.cityOrder).slice(0, 2);
          for (const cid of picks) st.player.intel[cid] = { day: st.day - 3, price: { ...st.cities[cid].price } };
          return `Ninety sols buys you an hour of a walker's memory: ${picks.map((c) => st.cities[c].name).join(' and ')}, price by price, three days fresh, delivered in the flat voice of someone who reads markets the way hawks read fields. You write until your hand cramps.`;
        },
      },
      {
        label: 'Share bread, take no service',
        resolve: (st, r) => {
          if (r.chance(0.4)) {
            st.player.luck = clamp(st.player.luck + 0.02, 0.7, 1.3);
            return 'You break bread at the milestone. They tell you one true thing — “the well past the fork is bitter; use the second” — and vanish around a bend. Small kindnesses have compound interest on the road.';
          }
          return 'You break bread at the milestone. They say nothing worth remembering, eat everything worth eating, and walk on. The road contains multitudes.';
        },
      },
    ],
  };
}

function tollBridge(s: GameState, rng: Rng): Encounter {
  const toll = rng.int(12, 35);
  return {
    kind: 'toll',
    title: 'The Bridge Keeps Its Own Books',
    text: `The ford is running high and brown — and the old bridge beside it now has a boom, a hut, and a toll-keeper with the serene unreasonableness of a man who owns the only dry crossing for a day in either direction. “${toll} sols,” says the hut. “Or the river. The river is free.”`,
    choices: [
      {
        label: `Pay the toll (${toll} sols)`,
        disabled: s.player.gold < toll ? 'The river, then.' : undefined,
        resolve: (st) => {
          loseGold(st, toll);
          return `${toll} sols later the boom rises. The keeper writes it in a book with the same gravity a Ledger-Lord would, which is somehow the funniest thing you have seen all week.`;
        },
      },
      {
        label: 'Take the ford',
        hint: 'Free. Wet. Perishables and porcelain will have opinions.',
        resolve: (st, r) => {
          if (st.player.loc.kind === 'road') st.player.loc.arriveDay += 1;
          const lines: string[] = [];
          const covered = (st.player.upgrades.oilskin ?? 0) > 0;
          for (const g of GOOD_IDS) {
            const qty = st.player.cargo[g] ?? 0;
            if (qty <= 0) continue;
            if (GOODS[g].perish > 0 || g === 'porcelain') {
              const lost = Math.ceil(qty * (covered ? 0.03 : r.range(0.08, 0.2)));
              if (lost > 0) {
                st.player.cargo[g] = qty - lost;
                if (st.player.cargo[g]! <= 0) delete st.player.cargo[g];
                lines.push(`${lost} ${GOODS[g].name.toLowerCase()}`);
              }
            }
          }
          return `The ford takes the wagon to the axles and every oath you own. An hour of misery and a day of drying later you are across${lines.length ? `, minus ${lines.join(', ')} to the river's fee` : ' with the cargo intact'}. The keeper watches from his bridge like a small, satisfied god.`;
        },
      },
    ],
  };
}

function caravanseraiNight(s: GameState, rng: Rng, road: Road): Encounter {
  const name = road.caravanseraiName ?? 'Your Caravanserai';
  const residents = s.agents.filter((a) => a.alive && a.loc.kind === 'road' && a.loc.roadId === road.id);
  return {
    kind: 'caravanserai',
    title: `Night at ${name}`,
    text: `Your lamps, your well, your roof — ${rng.int(3, 9)} wagons of strangers pay you for the privilege of all three. The courtyard smells of dung-fire and cardamom. ${residents.length ? `Among tonight's guests you recognize ${agentDisplayName(rng.pick(residents))}.` : 'The common room hums with the one industry that never sleeps: talk.'}`,
    choices: [
      {
        label: 'Rest in your own bed (free)',
        hint: 'Provisions refreshed, a safe night guaranteed.',
        resolve: (st) => {
          st.player.provisions += 3;
          return `You sleep in a room with a door. It is a smaller luxury than it sounds. In the morning the cook sends you off with three days of bread and dried apricots “for the house's own,” and the road ahead is, for once, just a road.`;
        },
      },
      {
        label: 'Work the common room (free rumor)',
        hint: 'Your courtyard, your guests, their news.',
        resolve: (st) => {
          const target = st.cities[rng.pick(st.cityOrder)];
          st.player.intel[target.id] = { day: st.day, price: { ...target.price } };
          return `You buy a round — the cheapest information network ever built — and by the second pot, a factor from ${target.name} has recited its entire price board to anyone who'll listen, which is you. Your ledger records it as: cost of one round, value of a fortune.`;
        },
      },
      {
        label: 'Feast the courtyard (20 sols)',
        hint: 'Fame among teamsters; your crews talk about you for a season.',
        disabled: s.player.gold < 20 ? 'Even hospitality runs on coin.' : undefined,
        resolve: (st) => {
          loseGold(st, 20);
          addFame(st, 1);
          st.flags.moraleUntil = st.day + 12;
          return `Twenty sols of lamb and onions becomes a hundred sols of morale. Your crew and guards walk out singing in the morning, and by next week, half the teamsters between here and ${st.cities[road.b].name} will call you “the open-handed one,” which is worth exactly what it costs.`;
        },
      },
    ],
  };
}

export function tempGuardsNote(s: GameState): void {
  // Temp guards expire on arrival at a city.
  if (s.flags.tempGuards) {
    s.flags.tempGuards = 0;
  }
}
