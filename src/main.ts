/**
 * CARAVANSERAI — boot: title screen, new/continue/weekly flows, the
 * inheritance letter that opens every life, and the shell assembly.
 */
import './styles.css';
import { game, loadSavedGame, hasSavedGame, saveGame, loadLegend } from './sim/game';
import { randomSeedPhrase, Rng } from './core/rng';
import { weeklySeedPhrase, formatDay } from './core/calendar';
import { shell } from './ui/shell';
import { h, rerender } from './ui/dom';
import { icon, factionSeal } from './ui/icons';
import { audio } from './audio/engine';
import { priceTargetOf } from './sim/economy';
import { mapScreen } from './ui/screens/map';
import { marketScreen } from './ui/screens/market';
import { caravanScreen } from './ui/screens/caravan';
import { tavernScreen } from './ui/screens/tavern';
import { contractsScreen } from './ui/screens/contracts';
import { chronicleScreen } from './ui/screens/chronicle';
import { guildScreen } from './ui/screens/guild';
import { almanacScreen } from './ui/screens/almanac';
import { menuScreen } from './ui/screens/menu';
import { PERSON_NAMES } from './data/names';
import { rankDef } from './data/guild';

const SCREENS = [
  mapScreen, marketScreen, caravanScreen, tavernScreen,
  contractsScreen, chronicleScreen, guildScreen, almanacScreen, menuScreen,
];

const root = document.getElementById('app')!;

function suggestedName(): string {
  const rng = new Rng(Date.now() % 99991);
  const banks = Object.values(PERSON_NAMES);
  const bank = rng.pick(banks);
  return `${rng.pick(bank.first)} ${rng.pick(bank.last)}`;
}

// ------------------------------------------------------------------- letter

function showInheritanceLetter(): void {
  const s = game.need();
  const close = shell.openModal({
    persistent: true,
    wide: true,
    body: [
      h('div', { class: 'letter', style: { margin: '0 auto' } },
        h('div', { class: 'salutation' }, 'To my blood, who kept the ledger last —'),
        h('p', null, 'If the Guild clerk handed you this, then I am somewhere the roads do not go, and the wagon, the mules, and three hundred honest sols are yours.'),
        h('p', null, 'You will hear the trade explained badly a hundred times. Here is the whole of it, once: ', h('b', null, 'buy where a thing is common and sell where it is wanted.'), ' The continent will do the rest — it has been doing it without our family for four hundred years.'),
        h('p', null, 'Three things I wish I had known on the first road:'),
        h('div', { class: 'goals' },
          h('b', null, 'I.'), ' Prices are only true where you stand. Everywhere else you are trading on memory and gossip — the tavern sells certainty, and it is worth what it costs.',
          h('br'),
          h('b', null, 'II.'), ' The world does not wait. While you deliberate, rival wagons take the margin, thrones declare wars, and the grain you meant to buy is on someone else’s cart. Advance the day when you are ready — or press ', h('b', null, 'Space'), '.',
          h('br'),
          h('b', null, 'III.'), ' Keep the company fed. A merchant with no provisions has a cargo, and then has nothing.'),
        h('p', null, `The Guild will start you at ${s.cities[s.startCityId].name}, which was always my kind of town: cheap grain, expensive everything else, and a fence who pretends not to know me.`),
        h('p', null, 'Be better than me at the arithmetic, and worse at the drinking. The road remembers both.'),
        h('div', { class: 'signature' }, '— Merivan, called the Late, of the Merchants’ Guild'),
      ),
    ],
    actions: [
      h('button', {
        class: 'btn primary xl',
        onclick: () => {
          audio.play('stamp');
          close();
          shell.showScreen('market');
          shell.toast('info', `You inherit 300 sols and a wagon at ${s.cities[s.startCityId].name}. The market is open — the first margin is waiting.`);
        },
      }, 'Take up the ledger'),
    ],
  });
}

// ------------------------------------------------------------------- title

function showTitle(): void {
  shell.stopTicker();
  const legends = loadLegend();
  const nameInput = h('input', {
    type: 'text', value: suggestedName(), maxlength: '40', 'aria-label': 'Your name',
  }) as HTMLInputElement;
  const seedInput = h('input', {
    type: 'text', value: randomSeedPhrase(), maxlength: '40', placeholder: 'world seed', 'aria-label': 'World seed',
  }) as HTMLInputElement;

  const startNew = (weekly: boolean): void => {
    const name = nameInput.value.trim() || suggestedName();
    const seed = weekly ? weeklySeedPhrase() : (seedInput.value.trim() || randomSeedPhrase());
    audio.play('stamp');
    game.newGame(seed, name, weekly);
    launchShell();
    showInheritanceLetter();
  };

  rerender(root,
    h('div', { class: 'title-screen' },
      h('div', { class: 'title-emblem', html: factionSeal('vault', 64) }),
      h('h1', { class: 'title-name' }, 'CARAVANSERAI'),
      h('div', { class: 'title-tag' }, 'The road remembers — a living trade world where every rival is real'),
      h('div', { class: 'girih', style: { width: '240px', 'margin-bottom': '34px' } }),
      h('div', { class: 'title-actions' },
        hasSavedGame()
          ? h('button', {
              class: 'btn primary xl',
              onclick: () => {
                const st = loadSavedGame();
                if (!st) return; // unreadable save: the title stays, nothing breaks
                audio.play('page');
                game.attach(st);
                launchShell();
              },
            }, h('span', { html: icon('book', 18) }), 'Resume your journey')
          : null,
        h('div', { class: 'name-field' }, nameInput),
        h('div', { class: 'seed-field' },
          seedInput,
          h('button', {
            class: 'btn', 'data-tip': 'A new random seed — a new world.',
            onclick: () => { seedInput.value = randomSeedPhrase(); audio.play('click'); },
          }, h('span', { html: icon('star', 16) })),
        ),
        h('button', { class: 'btn primary xl', onclick: () => startNew(false) },
          h('span', { html: icon('wagon', 18) }), 'Begin a journey'),
        h('button', {
          class: 'btn',
          'data-tip': `This week's shared world: every merchant playing this seed this week walks the same roads, under the same wars. ${weeklySeedPhrase()}`,
          onclick: () => startNew(true),
        }, h('span', { html: icon('sun', 16) }), `Weekly challenge — ${weeklySeedPhrase()}`),
        h('button', { class: 'btn ghost', onclick: showLegendHall },
          h('span', { html: icon('seal', 16) }), `Hall of Legend${legends.length ? ` (${legends.length})` : ''}`),
      ),
      h('div', { class: 'title-foot' },
        'one seed · sixteen cities · five thrones · twelve goods · every price earned, none scripted',
      ),
    ),
  );
}

function showLegendHall(): void {
  const legends = loadLegend();
  shell.openModal({
    title: 'Hall of Legend',
    icon: 'star',
    wide: true,
    body: legends.length
      ? [h('div', { class: 'stack' },
          ...legends.map((l) => h('div', { class: 'legend-row' },
            h('div', null, h('b', null, l.name), h('div', { class: 'tiny dim' }, l.epitaph)),
            h('span', { class: 'tiny dim' }, formatDay(l.day)),
            h('span', { class: 'tiny gold' }, `${rankDef(l.rank).name} · ${Math.round(l.netWorth)} ⛁`),
            h('span', { class: 'tiny faint' }, `${l.ambitions} ambitions${l.weekly ? ' · weekly' : ''}`),
          )))]
      : [h('p', { class: 'dim' }, 'No retired merchants yet. The shelves keep one line per life — begin one worth shelving.')],
    actions: [h('button', { class: 'btn ghost', onclick: () => shell.closeModal() }, 'Close')],
  });
}

// -------------------------------------------------------------------- shell

function launchShell(): void {
  shell.onExit = () => showTitle();
  shell.init(root, SCREENS);
  window.addEventListener('beforeunload', () => {
    const s = game.state;
    if (s && shell.settings.autosave) saveGame(s);
  });
}

showTitle();

// expose for debugging in dev
(window as unknown as Record<string, unknown>).__caravanserai = { game, shell, audio, priceTargetOf };
