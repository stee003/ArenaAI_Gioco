/**
 * Minimal pub-sub bus. UI panels subscribe to topics and re-render when the
 * simulation publishes changes. Keeps the DOM layer decoupled from sim code.
 */
type Handler = () => void;

class Bus {
  private handlers = new Map<string, Set<Handler>>();

  on(topic: string, fn: Handler): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }
    set.add(fn);
    return () => this.off(topic, fn);
  }

  off(topic: string, fn: Handler): void {
    this.handlers.get(topic)?.delete(fn);
  }

  emit(topic: string): void {
    this.handlers.get(topic)?.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error(`bus handler failed for "${topic}"`, err);
      }
    });
  }

  /** Emit a topic and every prefix of it ("market.silk" also emits "market"). */
  emitTree(topic: string): void {
    this.emit(topic);
    const parts = topic.split('.');
    while (parts.length > 1) {
      parts.pop();
      this.emit(parts.join('.'));
    }
  }
}

export const bus = new Bus();

/** Canonical topics. */
export const T = {
  STATE: 'state', // any game state change
  DAY: 'day', // a day advanced
  SCREEN: 'screen', // active screen changed
  MARKET: 'market', // prices/stocks changed
  PLAYER: 'player', // player money/cargo/crew changed
  NEWS: 'news', // chronicle/ticker additions
  TOAST: 'toast',
  TRAVEL: 'travel', // travel state changed
  SETTINGS: 'settings',
} as const;
