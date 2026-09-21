/**
 * Generative audio — no samples, no assets, all synthesized at runtime.
 *
 * Voice of the game: a solo oud-like plucked string (Karplus-Strong flavoured
 * additive synthesis) improvising short phrases in Maqam Hijaz over a low
 * drone and desert wind. SFX are drawn from the same palette so music and
 * interface feel like one instrument.
 *
 * Everything is gesture-gated: the AudioContext is created on the first user
 * interaction, and silence is a valid, supported state.
 */

type Sfx =
  | 'click' | 'page' | 'coin' | 'stamp' | 'bell' | 'thud'
  | 'war' | 'rank' | 'depart' | 'arrive' | 'buy' | 'sell' | 'rumor';

/** Maqam Hijaz on D — the augmented-second color of the silk roads. */
const SCALE = [293.66, 311.13, 369.99, 392.0, 440.0, 466.16, 523.25, 587.33];
const DRONE = [73.42, 110.0]; // D2, A2

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private droneNodes: OscillatorNode[] = [];
  private windGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private mood: 'calm' | 'war' = 'calm';

  soundOn = true;
  musicOn = true;

  /** Must be called from (or after) a user gesture. Idempotent. */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 1 : 0;
    this.musicBus.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.soundOn ? 1 : 0;
    this.sfxBus.connect(this.master);

    // Two seconds of filtered noise — the raw material for wind, pages, thuds.
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown-ish
      data[i] = last * 3.2;
    }

    this.startDrone();
    this.startWind();
    this.schedulePhrase();
  }

  private now(): number { return this.ctx ? this.ctx.currentTime : 0; }

  // ------------------------------------------------------------ layers

  private startDrone(): void {
    if (!this.ctx) return;
    const t = this.now();
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 220;
    filt.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.03, t + 6); // fade in over a minute-ish feel
    filt.connect(g).connect(this.musicBus);

    for (const [i, f] of DRONE.entries()) {
      const o = this.ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f * (i === 1 ? 1.002 : 1); // faint beat between fifths
      const og = this.ctx.createGain();
      og.gain.value = i === 0 ? 1 : 0.4;
      o.connect(og).connect(filt);
      o.start(t);
      this.droneNodes.push(o);
    }
    // Slow filter breath.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 70;
    lfo.connect(lfoG).connect(filt.frequency);
    lfo.start(t);
    this.droneNodes.push(lfo);
  }

  private startWind(): void {
    if (!this.ctx) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.value = 0.014;
    src.connect(bp).connect(g).connect(this.musicBus);
    src.start(t);
    // Gust LFO.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.01;
    lfo.connect(lfoG).connect(g.gain);
    lfo.start(t);
    this.windGain = g;
  }

  // ------------------------------------------------------------ plucked voice

  /** Oud-flavoured pluck: fundamental + inharmonic upper + noise attack. */
  private pluck(freq: number, when: number, gain = 0.1, decay = 1.1, bus?: GainNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const out = bus ?? this.musicBus;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(Math.min(9000, freq * 9), when);
    filt.frequency.exponentialRampToValueAtTime(Math.max(300, freq * 2.4), when + decay * 0.8);
    filt.Q.value = 0.8;
    filt.connect(g).connect(out);

    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = freq;
    const g1 = ctx.createGain(); g1.gain.value = 1;
    o1.connect(g1).connect(filt);

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.01; // slightly inharmonic octave = string body
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.5, when);
    g2.gain.exponentialRampToValueAtTime(0.05, when + decay * 0.45);
    o2.connect(g2).connect(filt);

    const o3 = ctx.createOscillator();
    o3.type = 'sine';
    o3.frequency.value = freq * 3.02;
    const g3 = ctx.createGain();
    g3.gain.setValueAtTime(0.18, when);
    g3.gain.exponentialRampToValueAtTime(0.001, when + decay * 0.25);
    o3.connect(g3).connect(filt);

    // Plectrum attack.
    const nz = ctx.createBufferSource();
    nz.buffer = this.noiseBuf;
    nz.loop = true;
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = Math.min(6000, freq * 5);
    nbp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.5, when);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
    nz.connect(nbp).connect(ng).connect(out);

    o1.start(when); o2.start(when); o3.start(when); nz.start(when);
    const stop = when + decay + 0.1;
    o1.stop(stop); o2.stop(stop); o3.stop(stop); nz.stop(stop);
  }

  // ------------------------------------------------------------ generative music

  private schedulePhrase(): void {
    if (!this.ctx) return;
    const base = this.mood === 'war' ? 2600 : 4200;
    const wait = base + Math.random() * (this.mood === 'war' ? 2400 : 4800);
    if (this.musicTimer !== null) clearTimeout(this.musicTimer);
    this.musicTimer = window.setTimeout(() => {
      this.playPhrase();
      this.schedulePhrase();
    }, wait);
  }

  private playPhrase(): void {
    if (!this.ctx || !this.musicOn) return;
    const t0 = this.now() + 0.05;
    const n = 2 + Math.floor(Math.random() * (this.mood === 'war' ? 6 : 5));
    let degree = Math.floor(Math.random() * 4); // start low-mid
    let t = t0;
    for (let i = 0; i < n; i++) {
      // Random walk biased toward the tonic and the Hijaz tension tone (deg 1).
      degree += Math.random() < 0.55 ? (Math.random() < 0.5 ? 1 : -1) : 0;
      if (Math.random() < 0.18) degree = Math.random() < 0.5 ? 0 : 4;
      degree = Math.max(0, Math.min(SCALE.length - 1, degree));
      const octave = Math.random() < 0.15 ? 2 : Math.random() < 0.2 ? 0.5 : 1;
      if (Math.random() < 0.16) { // rest — negative space is part of the maqam
        t += 0.35 + Math.random() * 0.4;
        continue;
      }
      this.pluck(SCALE[degree] * octave, t, 0.045 + Math.random() * 0.035, 1.0 + Math.random() * 1.1);
      t += 0.22 + Math.random() * (this.mood === 'war' ? 0.22 : 0.5);
      if (Math.random() < 0.12) { // grace note
        this.pluck(SCALE[Math.max(0, degree - 1)] * octave, t - 0.09, 0.02, 0.4);
      }
    }
    // Occasionally land on the drone.
    if (Math.random() < 0.3) this.pluck(SCALE[0] / 2, t + 0.1, 0.05, 2.2);
  }

  /** World mood feeds the music: wars darken and quicken the improvisation. */
  setMood(mood: 'calm' | 'war'): void {
    if (this.mood === mood || !this.ctx) return;
    this.mood = mood;
    const filt = 220; // drone filter base
    for (const o of this.droneNodes) {
      if (o.frequency.value > 60 && o.frequency.value < 130) o.frequency.setTargetAtTime(o.frequency.value * (mood === 'war' ? 1.01 : 0.9901), this.now(), 2);
    }
    if (this.windGain) this.windGain.gain.setTargetAtTime(mood === 'war' ? 0.024 : 0.014, this.now(), 3);
    void filt;
  }

  // ------------------------------------------------------------ sfx

  play(name: Sfx): void {
    if (!this.ctx || !this.soundOn) return;
    const t = this.now();
    const sfx = this.sfxBus;
    const noise = (dur: number, type: BiquadFilterType, freq: number, gain: number, freq2?: number): void => {
      if (!this.ctx) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq, t);
      if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t + dur);
      f.Q.value = 1;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(sfx);
      src.start(t);
      src.stop(t + dur + 0.05);
    };
    const tone = (freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slide?: number): void => {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(sfx);
      o.start(t);
      o.stop(t + dur + 0.05);
    };

    switch (name) {
      case 'click':
        noise(0.03, 'highpass', 2200, 0.05);
        break;
      case 'page':
        noise(0.22, 'bandpass', 700, 0.09, 2600);
        break;
      case 'coin':
        tone(1318, 0.14, 0.06);
        tone(1760, 0.22, 0.05);
        noise(0.02, 'highpass', 4000, 0.03);
        break;
      case 'buy':
        this.pluck(SCALE[2], t, 0.09, 0.5, sfx);
        break;
      case 'sell':
        this.pluck(SCALE[4], t, 0.09, 0.5, sfx);
        tone(1760, 0.18, 0.045);
        break;
      case 'stamp':
        tone(95, 0.28, 0.16, 'sine', 48);
        noise(0.09, 'lowpass', 900, 0.12);
        break;
      case 'bell':
        tone(880, 0.5, 0.05);
        tone(1320, 0.42, 0.032);
        break;
      case 'thud':
        tone(150, 0.16, 0.09, 'square', 70);
        break;
      case 'rumor':
        noise(0.4, 'bandpass', 400, 0.05, 1500);
        this.pluck(SCALE[1] * 2, t + 0.05, 0.05, 0.7, sfx);
        break;
      case 'war':
        for (let i = 0; i < 3; i++) {
          const dt = t + i * 0.34;
          if (!this.ctx) break;
          const o = this.ctx.createOscillator();
          o.type = 'sine';
          o.frequency.setValueAtTime(120, dt);
          o.frequency.exponentialRampToValueAtTime(44, dt + 0.3);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.0001, dt);
          g.gain.exponentialRampToValueAtTime(i === 2 ? 0.22 : 0.15, dt + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0001, dt + 0.55);
          o.connect(g).connect(sfx);
          o.start(dt); o.stop(dt + 0.6);
        }
        break;
      case 'rank': {
        const seq = [0, 2, 4, 7 % SCALE.length, 4]; // triumphant Hijaz run
        const freqs = [SCALE[0], SCALE[2], SCALE[4], SCALE[7], SCALE[4] * 2];
        seq.forEach((_, i) => this.pluck(freqs[i], t + i * 0.11, 0.1, 1.4, sfx));
        tone(SCALE[0] * 4, 1.4, 0.02);
        break;
      }
      case 'depart':
        this.pluck(SCALE[0] / 2, t, 0.1, 0.9, sfx);
        this.pluck(SCALE[4] / 2, t + 0.14, 0.09, 1.0, sfx);
        break;
      case 'arrive':
        this.pluck(SCALE[4], t, 0.09, 0.9, sfx);
        this.pluck(SCALE[0], t + 0.13, 0.1, 1.3, sfx);
        break;
    }
  }

  // ------------------------------------------------------------ controls

  setSound(on: boolean): void {
    this.soundOn = on;
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 1 : 0, this.now(), 0.05);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 1 : 0, this.now(), 0.4);
  }
}

export const audio = new AudioEngine();
export type { Sfx };
