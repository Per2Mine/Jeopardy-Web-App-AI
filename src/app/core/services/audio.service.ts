import { Injectable, signal, inject, effect } from '@angular/core';
import { P2pService } from './p2p.service';

@Injectable({
  providedIn: 'root'
})
export class AudioService {
  private p2pService = inject(P2pService);
  private audioCtx: AudioContext | null = null;

  // Local settings signals
  volume = signal<number>(0.5);
  muted = signal<boolean>(false);

  // Tracking state to avoid duplicate triggers
  private lastBuzzedId: string | null = null;
  private lastResultId: string | null = null;
  private lastPhase: string = 'LOBBY';
  private lastTimerSeconds: number | null = null;

  constructor() {
    // Load settings from localStorage
    const savedVol = localStorage.getItem('jeopardy_audio_volume');
    const savedMute = localStorage.getItem('jeopardy_audio_muted');

    if (savedVol !== null) {
      this.volume.set(parseFloat(savedVol));
    }
    if (savedMute !== null) {
      this.muted.set(savedMute === 'true');
    }

    // Persist volume settings changes
    effect(() => {
      localStorage.setItem('jeopardy_audio_volume', this.volume().toString());
    });
    effect(() => {
      localStorage.setItem('jeopardy_audio_muted', this.muted().toString());
    });

    // Auto-unlock AudioContext on first click or keypress
    const unlock = () => {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      } else {
        this.getAudioContext();
      }
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('click', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true });

    // Reactive listener to trigger sounds based on game state changes
    effect(() => {
      const state = this.p2pService.gameState();
      if (!state) return;

      // 1. Buzzer Trigger
      if (state.buzzedPlayerId && state.buzzedPlayerId !== this.lastBuzzedId) {
        this.playBuzzer();
      }
      this.lastBuzzedId = state.buzzedPlayerId;

      // 2. Correct / Incorrect Result Trigger
      if (state.lastAnswerResult) {
        const resultKey = `${state.lastAnswerResult.playerName}-${state.lastAnswerResult.value}-${state.lastAnswerResult.correct}`;
        if (resultKey !== this.lastResultId) {
          if (state.lastAnswerResult.correct) {
            this.playCorrect();
          } else {
            this.playIncorrect();
          }
        }
        this.lastResultId = resultKey;
      } else {
        this.lastResultId = null;
      }

      // 3. Phase Transition Trigger
      if (state.phase !== this.lastPhase) {
        if (state.phase === 'QUESTION' || state.phase === 'BOARD') {
          this.playTransition();
        }
      }
      this.lastPhase = state.phase;

      // 4. Timer Countdown Tick Trigger
      if (state.timerSeconds !== null && state.timerSeconds !== this.lastTimerSeconds) {
        if (this.lastTimerSeconds !== null && state.timerSeconds < this.lastTimerSeconds && state.timerSeconds >= 0) {
          // Play a tick for every second during countdown, but make it higher pitch on final 3 seconds
          this.playTick(state.timerSeconds <= 3);
        }
      }
      this.lastTimerSeconds = state.timerSeconds;
    });
  }

  /**
   * Lazy-initialize AudioContext to comply with browser gesture policies
   */
  private getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Create gain node mapping to volume and mute preferences
   */
  private createVolumeNode(ctx: AudioContext, duration: number): GainNode {
    const gainNode = ctx.createGain();
    const finalVolume = this.muted() ? 0 : this.volume();
    gainNode.gain.setValueAtTime(finalVolume, ctx.currentTime);
    return gainNode;
  }

  /**
   * Sound effect 1: Buzzer Sound (Sawtooth wave with rapid decay)
   */
  playBuzzer() {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = this.createVolumeNode(ctx, 0.5);

      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(130, now);
      osc1.frequency.linearRampToValueAtTime(110, now + 0.5);

      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(133, now); // slightly detuned for physical buzzer vibration effect
      osc2.frequency.linearRampToValueAtTime(113, now + 0.5);

      gainNode.gain.setValueAtTime(this.muted() ? 0 : this.volume() * 0.35, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      // Low-pass filter to make the buzzer sound punchy but not harsh
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(750, now);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.5);
      osc2.stop(now + 0.5);
    } catch (e) {
      console.warn('Failed to play buzzer sound:', e);
    }
  }

  /**
   * Sound effect 2: Correct answer chime (Ascending major chord chimes)
   */
  playCorrect() {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const baseVol = this.muted() ? 0 : this.volume() * 0.25;

      const playNote = (freq: number, startOffset: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + startOffset);

        gainNode.gain.setValueAtTime(0, now + startOffset);
        gainNode.gain.linearRampToValueAtTime(baseVol, now + startOffset + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(now + startOffset);
        osc.stop(now + startOffset + duration);
      };

      // C-E-G-C ascending major chord chimes
      playNote(523.25, 0.0, 0.45);      // C5
      playNote(659.25, 0.08, 0.45);     // E5
      playNote(783.99, 0.16, 0.45);     // G5
      playNote(1046.50, 0.24, 0.65);    // C6
    } catch (e) {
      console.warn('Failed to play correct chime:', e);
    }
  }

  /**
   * Sound effect 3: Incorrect answer buzzer (Dissonant descending tones)
   */
  playIncorrect() {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const baseVol = this.muted() ? 0 : this.volume() * 0.3;

      const playTone = (freqStart: number, freqEnd: number, detune: number) => {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freqStart + detune, now);
        osc.frequency.linearRampToValueAtTime(freqEnd + detune, now + 0.5);

        gainNode.gain.setValueAtTime(baseVol, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, now);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.5);
      };

      // Two detuned low tones played simultaneously for a retro game failure feel
      playTone(160, 110, 0);
      playTone(160, 110, 4); // Slightly detuned by 4Hz
    } catch (e) {
      console.warn('Failed to play incorrect sound:', e);
    }
  }

  /**
   * Sound effect 4: Countdown Tick (Short high-pitched sine click)
   */
  playTick(isFinalSeconds = false) {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gainNode = this.createVolumeNode(ctx, 0.05);

      osc.type = 'sine';
      // Final 3 seconds have a higher pitch to sound warning/tense
      osc.frequency.setValueAtTime(isFinalSeconds ? 1200 : 800, now);

      gainNode.gain.setValueAtTime(this.muted() ? 0 : this.volume() * 0.1, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {
      console.warn('Failed to play tick sound:', e);
    }
  }

  /**
   * Sound effect 5: Phase Transition Sound (Whoosh/sweep synth effect)
   */
  playTransition() {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gainNode = this.createVolumeNode(ctx, 0.4);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now); // A3
      osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.4); // C5 sweep

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(this.muted() ? 0 : this.volume() * 0.2, now + 0.08);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) {
      console.warn('Failed to play transition sound:', e);
    }
  }
}
