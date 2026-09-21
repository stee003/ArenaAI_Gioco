/**
 * The app shell: top bar (date, coin, location, advance-day), nav rail,
 * screen host, toast queue, modal system, tooltips, news ticker.
 * Screens register themselves; the shell owns navigation and the day loop.
 */
import { bus, T } from '../core/bus';
import { audio } from '../audio/engine';
import { game, loadSettings, persistSettings, type SavedSettings } from '../sim/game';
import type { Encounter } from '../sim/encounters';
import { icon } from './icons';
import { h, clear, rerender, tweenNumber, type Child } from './dom';
import { formatDay, seasonOfDay } from '../core/calendar';
import { rankDef } from '../data/guild';

// ---------------------------------------------------------------------------
// Screen contract
// ---------------------------------------------------------------------------

export interface Screen {
  id: string;
  label: string;
  icon: string;
  /** Only meaningful when the caravan is parked in a city. */
  inCityOnly?: boolean;
  /** Red notification pip. */
  pip?: () => boolean;
  mount(host: HTMLElement): void;
  unmount?(): void;
}

const SEASON_ICON: Record<string, string> = { spring: 'bloom', summer: 'sun', autumn: 'leaf', winter: 'snow' };

class Shell {
  constructor() {
    // Overlay hosts exist from module load so modals/toasts work even on
    // the title screen, before init() builds the shell chrome.
    this.toastHost = h('div', { class: 'toast-host', 'aria-live': 'polite' });
    this.modalHost = h('div', { class: 'modal-host' });
    this.tooltipEl = h('div', { class: 'tooltip', role: 'tooltip' });
    document.body.append(this.toastHost, this.modalHost, this.tooltipEl);
  }

  private topEl!: HTMLElement;
  private railEl!: HTMLElement;
  private mainEl!: HTMLElement;
  private toastHost!: HTMLElement;
  private modalHost!: HTMLElement;
  private tooltipEl!: HTMLElement;
  private tickerEl!: HTMLElement;
  private advanceBtn!: HTMLElement;

  private bound = false;
  private screens: Screen[] = [];
  private current: Screen | null = null;
  private unsubs: (() => void)[] = [];
  private tickerTimer = 0;
  private tickerIdx = 0;
  private activeModal: { veil: HTMLElement; persistent: boolean } | null = null;
  private encounterOpen = false;
  settings: SavedSettings = loadSettings();

  /** Notes from the most recent advanceDay, shown in the road journal. */
  lastNotes: string[] = [];
  lastDay = 0;

  // ---------------------------------------------------------------- bootstrap

  init(root: HTMLElement, screens: Screen[]): void {
    this.screens = screens;
    this.applySettings();

    clear(root);
    root.appendChild(
      h('div', { class: 'shell' },
        (this.topEl = h('header', { class: 'topbar' })),
        (this.railEl = h('nav', { class: 'rail', 'aria-label': 'Navigation' })),
        (this.mainEl = h('main', { class: 'main' })),
      ),
    );
    this.adoptStateSettings();
    this.buildTop();
    this.buildRail();
    if (!this.bound) {
      this.bound = true;
      this.bindBus();
      this.bindAudioGate();
      this.bindTooltips();
      this.startTicker();
    }
    this.refreshTop();
    this.showScreen(screens[0]?.id ?? 'map');
  }

  private applySettings(): void {
    document.body.classList.toggle('reduced-motion', this.settings.reducedMotion);
    audio.setSound(this.settings.sound);
    audio.setMusic(this.settings.music);
  }

  saveSettings(patch: Partial<SavedSettings>): void {
    this.settings = { ...this.settings, ...patch };
    persistSettings(this.settings);
    // The save carries its own settings so a resumed life keeps its choices.
    if (game.state) Object.assign(game.state.settings, this.settings);
    this.applySettings();
  }

  /** Adopt settings from the loaded game (called once a state exists). */
  adoptStateSettings(): void {
    if (!game.state) return;
    this.settings = { ...this.settings, ...game.state.settings };
    persistSettings(this.settings);
    this.applySettings();
  }

  // ------------------------------------------------------------------ topbar

  private buildTop(): void {
    rerender(this.topEl,
      h('div', {
        class: 'brand',
        onclick: () => { audio.play('click'); this.showScreen('menu'); },
        'data-tip': 'Menu & settings',
      }, h('b', null, 'CARAVANSERAI'), h('span', null, 'the road remembers')),
      h('div', { class: 'topstats' },
        h('div', { class: 'stat date', id: 'top-date' }),
        h('div', { class: 'stat money', id: 'top-money' }),
        h('div', { class: 'stat worth', id: 'top-worth' }),
        h('div', { class: 'stat loc', id: 'top-loc' }),
      ),
      (this.tickerEl = h('div', { class: 'ticker', 'aria-hidden': 'true' })),
      (this.advanceBtn = h('button', {
        class: 'btn-advance',
        onclick: () => this.advanceDay(),
        'data-tip': 'Let the world turn one day. Markets move, armies march, your caravan travels.',
      })),
    );
  }

  refreshTop(): void {
    const s = game.state;
    if (!s) return;
    const season = seasonOfDay(s.day);

    rerender(this.topEl.querySelector('#top-date')!,
      h('span', { class: 'iconwrap', html: icon(SEASON_ICON[season], 16) }),
      h('b', null, formatDay(s.day)),
    );

    const moneyEl = this.topEl.querySelector<HTMLElement>('#top-money')!;
    const gold = Math.floor(s.player.gold);
    const prev = moneyEl.dataset.v ? Number(moneyEl.dataset.v) : gold;
    moneyEl.dataset.v = String(gold);
    const delta = gold - prev;
    const b = h('b', null, String(gold));
    rerender(moneyEl,
      h('span', { html: icon('coin', 16), 'data-tip': 'Sols — the coin of the whole continent.' }),
      b,
      s.player.debt > 0 ? h('small', { class: 'bad', 'data-tip': `Debt: ${Math.round(s.player.debt)} sols, due day ${s.player.debtDueDay}` }, `−${Math.round(s.player.debt)}`) : null,
    );
    if (this.settings.numberTicking && prev !== gold) tweenNumber(b, prev, gold, (n) => String(Math.floor(n)));
    if (Math.abs(delta) >= 5 && moneyEl.isConnected) {
      const float = h('span', { class: `gold-float ${delta > 0 ? 'up' : 'down'}` },
        `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`);
      moneyEl.style.position = 'relative';
      moneyEl.appendChild(float);
      setTimeout(() => float.remove(), 1100);
    }

    const worthEl = this.topEl.querySelector<HTMLElement>('#top-worth')!;
    rerender(worthEl,
      h('span', { html: icon('box', 16), 'data-tip': 'Net worth: coin + cargo + estates − debt.' }),
      h('b', null, String(Math.floor(game.netWorth()))),
    );

    const locEl = this.topEl.querySelector<HTMLElement>('#top-loc')!;
    if (s.player.loc.kind === 'city') {
      const c = s.cities[s.player.loc.cityId];
      rerender(locEl,
        h('span', { html: icon('map', 16), style: { color: s.factions[c.faction].color } }),
        h('b', null, c.name),
      );
    } else {
      const p = game.travelProgress();
      rerender(locEl,
        h('span', { html: icon('road', 16) }),
        h('b', null, `On the road · day ${p ? p.day : '?'}/${p ? p.ofDays : '?'}`),
      );
    }

    // Advance button label reflects context.
    const rank = rankDef(s.player.guildRank);
    this.advanceBtn.dataset.tip = `${rank.name} · fame ${s.player.fame.toFixed(0)}`;
    let label = 'Advance Day';
    let ic = SEASON_ICON[season];
    if (s.player.loc.kind === 'road') {
      const p = game.travelProgress();
      label = p ? `March · Day ${p.day} of ${p.ofDays}` : 'March On';
      ic = 'road';
    }
    rerender(this.advanceBtn,
      h('span', { class: 'sun', html: icon(ic, 17) }),
      h('span', null, label),
    );
  }

  // ------------------------------------------------------------------- rail

  private buildRail(): void {
    rerender(this.railEl,
      this.screens.map((sc) => {
        const btn = h('button', {
          class: 'rail-btn',
          dataset: { screen: sc.id },
          onclick: () => {
            audio.play('click');
            if (sc.inCityOnly && game.state?.player.loc.kind === 'road') {
              this.toast('info', `The ${sc.label.toLowerCase()} waits for you in a city. The road offers only miles.`);
              return;
            }
            this.showScreen(sc.id);
          },
        },
          h('span', { html: icon(sc.icon, 21) }),
          h('span', null, sc.label),
          sc.pip ? h('span', { class: 'pip', style: { display: 'none' } }) : null,
        );
        return btn;
      }),
      h('div', { class: 'rail-sep' }),
      h('div', { class: 'grow' }),
    );
    this.updatePips();
  }

  private updatePips(): void {
    for (const sc of this.screens) {
      const btn = this.railEl.querySelector<HTMLElement>(`[data-screen="${sc.id}"]`);
      if (!btn) continue;
      btn.classList.toggle('active', this.current?.id === sc.id);
      const pip = btn.querySelector<HTMLElement>('.pip');
      if (pip && sc.pip) pip.style.display = sc.id !== this.current?.id && sc.pip() ? '' : 'none';
    }
  }

  showScreen(id: string): void {
    const sc = this.screens.find((x) => x.id === id);
    if (!sc) return;
    if (this.current?.unmount) this.current.unmount();
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.current = sc;
    rerender(this.mainEl);
    const host = h('div', { class: 'screen', dataset: { screen: sc.id } });
    this.mainEl.appendChild(host);
    sc.mount(host);
    this.updatePips();
    bus.emit(T.SCREEN);
  }

  currentScreen(): string | null { return this.current?.id ?? null; }

  /** Subscribe for the lifetime of the current screen (auto-unsubscribed). */
  sub(topic: string, fn: () => void): void {
    bus.on(topic, fn);
    this.unsubs.push(() => bus.off(topic, fn));
  }

  // ------------------------------------------------------------- day loop

  advanceDay(): void {
    const s = game.state;
    if (!s || this.encounterOpen || this.activeModal) return;
    audio.ensure();
    audio.play(s.player.loc.kind === 'road' ? 'click' : 'page');
    this.advanceBtn.classList.add('spin');
    setTimeout(() => this.advanceBtn.classList.remove('spin'), 550);

    const beforeWar = Object.values(s.factions).some((f) => f.wars.length > 0);
    const out = game.advanceDay();
    this.lastNotes = out.notes;
    this.lastDay = out.day;
    bus.emit(T.DAY);
    if (out.arrived) audio.play('arrive');
    const nowWar = Object.values(s.factions).some((f) => f.wars.length > 0);
    if (!beforeWar && nowWar) audio.play('war');
    audio.setMood(nowWar ? 'war' : 'calm');

    if (out.encounter) {
      this.openEncounter(out.encounter);
    }
    for (const t of game.drainToasts()) this.showToast(t.kind, t.text);
    this.refreshTop();
    this.updatePips();
  }

  // ---------------------------------------------------------------- toasts

  showToast(kind: string, text: string): void {
    const iconName =
      kind === 'ambition' ? 'star' : kind === 'rank' ? 'crown' : kind === 'contract' ? 'scroll' :
      kind === 'warning' ? 'warn' : kind === 'trade' ? 'coin' : kind === 'arrival' ? 'map' :
      kind === 'chronicle' ? 'quill' : 'info';
    const el = h('div', {
      class: `toast ${kind}`,
      onclick: () => dismiss(),
      html: icon(iconName, 17),
    }, h('div', { html: text }));
    const dismiss = (): void => {
      if (!el.isConnected) return;
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    };
    this.toastHost.appendChild(el);
    if (kind === 'rank' || kind === 'ambition') audio.play('rank');
    else if (kind === 'chronicle') audio.play('page');
    else if (kind === 'warning') audio.play('thud');
    while (this.toastHost.children.length > 5) this.toastHost.firstElementChild?.remove();
    setTimeout(dismiss, kind === 'rank' || kind === 'ambition' ? 11000 : 7000);
  }

  toast(kind: string, text: string): void { this.showToast(kind, text); }

  // ---------------------------------------------------------------- modals

  openModal(opts: {
    title?: string; icon?: string; body: Child[]; actions?: Child[];
    cls?: string; wide?: boolean; persistent?: boolean; onClose?: () => void;
  }): () => void {
    this.closeModal();
    const veil = h('div', {
      class: 'modal-veil',
      onclick: (e) => { if (e.target === veil && !opts.persistent) close(); },
    });
    const modal = h('div', { class: `modal ${opts.cls ?? ''} ${opts.wide ? 'wide' : ''}` },
      opts.title ? h('div', { class: 'h2' }, opts.icon ? h('span', { html: icon(opts.icon, 20) }) : null, opts.title) : null,
      ...opts.body,
      opts.actions?.length ? h('div', { class: 'modal-actions' }, ...opts.actions) : null,
    );
    veil.appendChild(modal);
    this.modalHost.appendChild(veil);
    this.activeModal = { veil, persistent: opts.persistent ?? false };

    const close = (): void => {
      if (this.activeModal?.veil !== veil) return;
      veil.remove();
      this.activeModal = null;
      opts.onClose?.();
    };
    return close;
  }

  closeModal(): void {
    if (this.activeModal && !this.activeModal.persistent) {
      this.activeModal.veil.remove();
      this.activeModal = null;
    }
  }

  confirm(opts: { title: string; text: Child; confirmLabel?: string; danger?: boolean; onConfirm: () => void }): void {
    const close = this.openModal({
      title: opts.title,
      body: [h('p', { class: 'dim', style: { margin: '0 0 6px', lineHeight: '1.6' } }, opts.text)],
      actions: [
        h('button', { class: 'btn ghost', onclick: () => { audio.play('click'); close(); } }, 'Cancel'),
        h('button', {
          class: `btn ${opts.danger ? 'danger' : 'primary'}`,
          onclick: () => { audio.play('stamp'); close(); opts.onConfirm(); },
        }, opts.confirmLabel ?? 'Confirm'),
      ],
    });
  }

  /** The road-encounter modal: a parchment scene card with branching choices. */
  openEncounter(enc: Encounter): void {
    this.encounterOpen = true;
    const bodyHost = h('div');
    const close = this.openModal({
      cls: 'encounter',
      persistent: true,
      body: [
        h('div', { class: 'enc-kicker', html: `${icon('warn', 13)} something happens on the road` }),
        h('h2', null, enc.title),
        bodyHost,
      ],
      onClose: () => { this.encounterOpen = false; },
    });

    const renderChoices = (): void => {
      rerender(bodyHost,
        h('div', { class: 'enc-text', html: enc.text }),
        h('div', { class: 'enc-choices' },
          ...enc.choices.map((c, i) =>
            h('button', {
              class: 'enc-choice',
              disabled: !!c.disabled,
              onclick: () => {
                audio.play('stamp');
                const outcome = game.resolveChoiceText(enc, i);
                rerender(bodyHost,
                  h('div', { class: 'enc-outcome', html: outcome }),
                  h('div', { class: 'center' }, h('span', { class: 'enc-stamp' }, 'resolved')),
                  h('div', { class: 'modal-actions', style: { 'justify-content': 'center' } },
                    h('button', {
                      class: 'btn primary',
                      onclick: () => {
                        audio.play('click');
                        close();
                        for (const t of game.drainToasts()) this.showToast(t.kind, t.text);
                        this.refreshTop();
                        bus.emit(T.PLAYER);
                        bus.emit(T.MARKET);
                      },
                    }, 'Continue'),
                  ),
                );
              },
            },
              h('b', null, c.label),
              c.hint ? h('span', { class: 'why' }, c.hint) : null,
              c.disabled ? h('span', { class: 'why no' }, c.disabled) : null,
            ),
          ),
        ),
      );
    };
    renderChoices();
  }

  // ---------------------------------------------------------------- ticker

  private startTicker(): void {
    const rotate = (): void => {
      const s = game.state;
      if (!s || !this.tickerEl.isConnected) return;
      const items = s.news.slice(-14).filter((n) => n.importance >= 2).slice(-5);
      if (!items.length) return;
      const item = items[this.tickerIdx % items.length];
      this.tickerIdx++;
      const cls = item.kind === 'war' ? 'war' : item.kind === 'player' ? 'player' : '';
      rerender(this.tickerEl, h('div', { class: `ticker-item ${cls}` },
        h('span', { class: 'dot' }),
        h('span', { style: { overflow: 'hidden', 'text-overflow': 'ellipsis' } }, item.text),
      ));
    };
    rotate();
    this.tickerTimer = window.setInterval(rotate, 9000);
  }

  stopTicker(): void { clearInterval(this.tickerTimer); }

  // -------------------------------------------------------------- tooltips

  private bindTooltips(): void {
    // Tooltips need a hover device; on touch screens data-tip is inert.
    if (typeof window.matchMedia === 'function' && !window.matchMedia('(pointer: fine)').matches) return;
    let target: Element | null = null;
    document.addEventListener('mouseover', (e) => {
      const el = (e.target as Element).closest?.('[data-tip]') ?? null;
      if (el === target) return;
      target = el;
      if (!el) {
        this.tooltipEl.classList.remove('show');
        return;
      }
      this.tooltipEl.innerHTML = String(el.getAttribute('data-tip'));
      this.tooltipEl.classList.add('show');
      const r = el.getBoundingClientRect();
      const tr = this.tooltipEl.getBoundingClientRect();
      let left = r.left + r.width / 2 - tr.width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
      let top = r.bottom + 8;
      if (top + tr.height > window.innerHeight - 8) top = Math.max(8, r.top - tr.height - 8);
      this.tooltipEl.style.left = `${left}px`;
      this.tooltipEl.style.top = `${top}px`;
    });
    document.addEventListener('click', () => {
      target = null;
      this.tooltipEl.classList.remove('show');
    });
  }

  // ---------------------------------------------------------- bus & audio

  private bindBus(): void {
    const refresh = (): void => { this.refreshTop(); this.updatePips(); };
    bus.on(T.PLAYER, refresh);
    bus.on(T.DAY, refresh);
    bus.on(T.STATE, refresh);
    bus.on(T.MARKET, refresh);
    bus.on(T.TOAST, () => { for (const t of game.drainToasts()) this.showToast(t.kind, t.text); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeModal();
      if (e.key === ' ' && !this.encounterOpen && !this.activeModal &&
          !(document.activeElement instanceof HTMLInputElement) &&
          !(document.activeElement instanceof HTMLButtonElement)) {
        e.preventDefault();
        this.advanceDay();
      }
    });
  }

  private bindAudioGate(): void {
    const unlock = (): void => {
      audio.ensure();
      const s = game.state;
      if (s) audio.setMood(Object.values(s.factions).some((f) => f.wars.length > 0) ? 'war' : 'calm');
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }
}

export const shell = new Shell();
