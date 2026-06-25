import { Injectable, signal, inject, effect } from '@angular/core';
import { P2pService } from './p2p.service';

@Injectable({
  providedIn: 'root'
})
export class AudioService {
  private p2pService = inject(P2pService);
  private audioCtx: AudioContext | null = null;

  // Question-specific audio player state
  private currentAudioUrl: string | null = null;
  private audioStart = 0;
  private audioEnd = 10;
  private audioSpeed = 1.0;
  private audioPitch = 0;
  questionAudioPlaying = signal<boolean>(false);

  // Web Audio Nodes for Altered Playback
  private decodedBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private jungleNode: any = null;
  private gainNode: GainNode | null = null;
  
  // Web Audio Nodes for Solution Playback (Unaltered)
  private solutionSourceNode: AudioBufferSourceNode | null = null;
  private solutionGainNode: GainNode | null = null;

  private playStartTime = 0;
  private elapsedOffset = 0; // Offset in seconds from audioStart
  private isCurrentlyPlaying = false;
  private isSolutionPlaying = false;
  private manualStop = false;

  // Local settings signals
  volume = signal<number>(0.5);
  muted = signal<boolean>(false);

  // Tracking state to avoid duplicate triggers
  private lastBuzzedId: string | null = null;
  private lastResultId: string | null = null;
  private lastPhase: string = 'LOBBY';
  private lastTimerSeconds: number | null = null;
  private lastQuestionBuzzedId: string | null = null;
  private lastAudioPlayingState = false;
  private hasFinishedPlaying = false;

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

    // Update active question audio volume/mute settings
    effect(() => {
      const finalVolume = this.muted() ? 0 : this.volume();
      if (this.gainNode) {
        this.gainNode.gain.setValueAtTime(finalVolume, this.getAudioContext().currentTime);
      }
      if (this.solutionGainNode) {
        this.solutionGainNode.gain.setValueAtTime(finalVolume, this.getAudioContext().currentTime);
      }
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
        if (this.lastPhase === 'LOBBY' && state.phase === 'BOARD') {
          this.playGameStart();
        } else if (state.phase === 'SUMMARY') {
          this.playGameEnd();
        } else if (state.phase === 'QUESTION' || state.phase === 'BOARD') {
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

      // 5. Custom Audio Question Playback
      const activeQ = state.activeQuestion;
      if (state.phase === 'QUESTION' && activeQ && activeQ.audio) {
        if (this.currentAudioUrl !== activeQ.audio) {
          this.setupQuestionAudio(activeQ.audio, activeQ.audioStart, activeQ.audioEnd, activeQ.audioSpeed, activeQ.audioPitch);
          this.lastQuestionBuzzedId = state.buzzedPlayerId;
          this.hasFinishedPlaying = false;
        }

        // Reset offset if the buzzed player changed (meaning someone new buzzed)
        if (state.buzzedPlayerId !== this.lastQuestionBuzzedId) {
          if (state.buzzedPlayerId !== null) {
            // Someone buzzed (or initial turn started) - reset offset to play from beginning!
            this.elapsedOffset = 0;
            this.hasFinishedPlaying = false;
          }
          this.lastQuestionBuzzedId = state.buzzedPlayerId;
        }

        // Reset finished flag if host manually toggled audioPlaying to true
        if (!!state.audioPlaying && !this.lastAudioPlayingState) {
          this.hasFinishedPlaying = false;
        }
        this.lastAudioPlayingState = !!state.audioPlaying;

        const showAnswer = state.showAnswer;

        if (showAnswer) {
          this.playSolutionAudio();
        } else if (!state.audioPlaying || this.hasFinishedPlaying) {
          this.pauseQuestionAudio();
        } else {
          this.playQuestionAudio();
        }
      } else {
        this.stopQuestionAudio();
        this.lastQuestionBuzzedId = null;
        this.lastAudioPlayingState = false;
        this.hasFinishedPlaying = false;
      }
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

  /**
   * Question audio playback helper methods
   */
  private async decodeBase64Audio(base64: string): Promise<AudioBuffer> {
    const ctx = this.getAudioContext();
    const base64Data = base64.split(',')[1];
    const binaryStr = window.atob(base64Data);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return await ctx.decodeAudioData(bytes.buffer);
  }

  async setupQuestionAudio(base64Url: string, start?: number, end?: number, speed?: number, pitch?: number) {
    this.stopQuestionAudio();
    this.currentAudioUrl = base64Url;
    this.audioStart = start !== undefined ? start : 0;
    this.audioEnd = end !== undefined ? end : 10;
    this.audioSpeed = speed !== undefined ? speed : 1.0;
    this.audioPitch = pitch !== undefined ? pitch : 0;

    try {
      const buffer = await this.decodeBase64Audio(base64Url);
      if (this.currentAudioUrl === base64Url) {
        this.decodedBuffer = buffer;

        // Auto-start playback if game is still in the correct phase and audioPlaying is true
        const state = this.p2pService.gameState();
        if (state && state.phase === 'QUESTION' && state.activeQuestion?.audio === base64Url) {
          const showAnswer = state.showAnswer;

          if (showAnswer) {
            this.playSolutionAudio();
          } else if (!state.audioPlaying || this.hasFinishedPlaying) {
            this.pauseQuestionAudio();
          } else {
            this.playQuestionAudio();
          }
        }
      }
    } catch (e) {
      console.warn('Failed to decode question audio buffer:', e);
    }
  }

  playQuestionAudio() {
    if (!this.decodedBuffer) return;
    if (this.isCurrentlyPlaying || this.isSolutionPlaying) return;

    this.isCurrentlyPlaying = true;
    this.questionAudioPlaying.set(true);
    this.manualStop = false;

    const ctx = this.getAudioContext();
    this.playStartTime = ctx.currentTime;

    // Calculate remaining duration
    const durationLimit = this.audioEnd - this.audioStart;
    const remainingDuration = durationLimit - this.elapsedOffset;

    if (remainingDuration <= 0) {
      this.elapsedOffset = 0;
      this.playQuestionAudio();
      return;
    }

    // 1. Source Node
    this.sourceNode = ctx.createBufferSource();
    this.sourceNode.buffer = this.decodedBuffer;
    this.sourceNode.playbackRate.value = this.audioSpeed;

    // 2. Volume Gain Node
    this.gainNode = ctx.createGain();
    const finalVolume = this.muted() ? 0 : this.volume();
    this.gainNode.gain.setValueAtTime(finalVolume, ctx.currentTime);

    // 3. Pitch Shifter Node (Jungle)
    this.jungleNode = new Jungle(ctx);
    
    // Connect nodes: source -> jungle -> gain -> destination
    this.sourceNode.connect(this.jungleNode.input);
    this.jungleNode.output.connect(this.gainNode);
    this.gainNode.connect(ctx.destination);

    // Apply Pitch shift.
    // Calculate the compensation offset for speed changes:
    // If playbackRate = S, it shifts the pitch by 12 * log2(S) semitones.
    // We adjust setPitchTranspose to target exactly this.audioPitch semitones.
    const speedPitchShift = 12 * Math.log2(this.audioSpeed);
    const targetTranspose = this.audioPitch - speedPitchShift;
    this.jungleNode.setPitchTranspose(targetTranspose);

    // Start playback
    const startPositionInFile = this.audioStart + this.elapsedOffset;
    this.sourceNode.start(0, startPositionInFile, remainingDuration);

    this.sourceNode.onended = () => {
      if (!this.manualStop) {
        this.questionAudioPlaying.set(false);
        this.isCurrentlyPlaying = false;
        this.elapsedOffset = 0; // reset
        this.hasFinishedPlaying = true;
      }
    };
  }

  pauseQuestionAudio() {
    if (!this.isCurrentlyPlaying) return;
    this.manualStop = true;

    const ctx = this.getAudioContext();
    const playedSeconds = (ctx.currentTime - this.playStartTime) * this.audioSpeed;
    this.elapsedOffset += playedSeconds;

    this.stopQuestionAudioPlayback();
  }

  playSolutionAudio() {
    if (!this.decodedBuffer) return;
    if (this.isSolutionPlaying) return;

    this.stopQuestionAudioPlayback();
    this.stopSolutionAudioPlayback();

    this.isSolutionPlaying = true;
    this.questionAudioPlaying.set(true);

    const ctx = this.getAudioContext();
    this.solutionSourceNode = ctx.createBufferSource();
    this.solutionSourceNode.buffer = this.decodedBuffer;
    this.solutionSourceNode.playbackRate.value = 1.0; // Unmodified speed

    this.solutionGainNode = ctx.createGain();
    const finalVolume = this.muted() ? 0 : this.volume();
    this.solutionGainNode.gain.setValueAtTime(finalVolume, ctx.currentTime);

    // Bypasses pitch shifter to play original unmodified sound
    this.solutionSourceNode.connect(this.solutionGainNode);
    this.solutionGainNode.connect(ctx.destination);

    const playDuration = this.audioEnd - this.audioStart;
    this.solutionSourceNode.start(0, this.audioStart, playDuration);

    this.solutionSourceNode.onended = () => {
      this.questionAudioPlaying.set(false);
      this.isSolutionPlaying = false;
    };
  }

  stopQuestionAudio() {
    this.stopQuestionAudioPlayback();
    this.stopSolutionAudioPlayback();
    this.currentAudioUrl = null;
    this.decodedBuffer = null;
    this.elapsedOffset = 0;
    this.questionAudioPlaying.set(false);
  }

  private stopQuestionAudioPlayback() {
    this.manualStop = true;
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
      } catch (e) {}
      this.sourceNode = null;
    }
    if (this.jungleNode) {
      this.jungleNode.disconnect();
      this.jungleNode = null;
    }
    this.gainNode = null;
    this.isCurrentlyPlaying = false;
    this.questionAudioPlaying.set(false);
  }

  private stopSolutionAudioPlayback() {
    if (this.solutionSourceNode) {
      try {
        this.solutionSourceNode.onended = null;
        this.solutionSourceNode.stop();
      } catch (e) {}
      this.solutionSourceNode = null;
    }
    this.solutionGainNode = null;
    this.isSolutionPlaying = false;
  }

  // Preview properties
  private previewSourceNode: AudioBufferSourceNode | null = null;
  private previewJungleNode: any = null;
  private previewGainNode: GainNode | null = null;
  private isPreviewPlaying = false;

  async playPreview(base64Url: string, start: number, end: number, speed: number, pitch: number, onEndedCallback: () => void) {
    this.stopPreview();
    this.isPreviewPlaying = true;

    try {
      const buffer = await this.decodeBase64Audio(base64Url);
      if (!this.isPreviewPlaying) return; // stopped while decoding

      const ctx = this.getAudioContext();
      this.previewSourceNode = ctx.createBufferSource();
      this.previewSourceNode.buffer = buffer;
      this.previewSourceNode.playbackRate.value = speed;

      this.previewGainNode = ctx.createGain();
      this.previewGainNode.gain.setValueAtTime(0.5, ctx.currentTime); // default preview volume

      this.previewJungleNode = new Jungle(ctx);

      this.previewSourceNode.connect(this.previewJungleNode.input);
      this.previewJungleNode.output.connect(this.previewGainNode);
      this.previewGainNode.connect(ctx.destination);

      const speedPitchShift = 12 * Math.log2(speed);
      const targetTranspose = pitch - speedPitchShift;
      this.previewJungleNode.setPitchTranspose(targetTranspose);

      const duration = end - start;
      this.previewSourceNode.start(0, start, duration);

      this.previewSourceNode.onended = () => {
        this.isPreviewPlaying = false;
        onEndedCallback();
      };
    } catch (e) {
      console.warn('Preview playback failed:', e);
      this.isPreviewPlaying = false;
      onEndedCallback();
    }
  }

  stopPreview() {
    this.isPreviewPlaying = false;
    if (this.previewSourceNode) {
      try {
        this.previewSourceNode.onended = null;
        this.previewSourceNode.stop();
      } catch (e) {}
      this.previewSourceNode = null;
    }
    if (this.previewJungleNode) {
      this.previewJungleNode.disconnect();
      this.previewJungleNode = null;
    }
    this.previewGainNode = null;
  }
}

/**
 * Jungle.js pitch shifter helper utilities and classes (Web Audio delay line synthesis)
 */
function createFadeBuffer(context: AudioContext, activeTime: number, fadeTime: number): AudioBuffer {
  const length1 = activeTime * context.sampleRate;
  const length2 = (activeTime - 2 * fadeTime) * context.sampleRate;
  const length = length1 + length2;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const p = buffer.getChannelData(0);
  const fadeLength = fadeTime * context.sampleRate;
  const fadeIndex1 = fadeLength;
  const fadeIndex2 = length1 - fadeLength;

  for (let i = 0; i < length1; ++i) {
    let value;
    if (i < fadeIndex1) {
      value = Math.sqrt(i / fadeLength);
    } else if (i >= fadeIndex2) {
      value = Math.sqrt(1 - (i - fadeIndex2) / fadeLength);
    } else {
      value = 1;
    }
    p[i] = value;
  }

  for (let i = length1; i < length; ++i) {
    p[i] = 0;
  }

  return buffer;
}

function createDelayTimeBuffer(context: AudioContext, activeTime: number, fadeTime: number, shiftUp: boolean): AudioBuffer {
  const length1 = activeTime * context.sampleRate;
  const length2 = (activeTime - 2 * fadeTime) * context.sampleRate;
  const length = length1 + length2;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const p = buffer.getChannelData(0);

  for (let i = 0; i < length1; ++i) {
    if (shiftUp) {
      p[i] = (length1 - i) / length;
    } else {
      p[i] = i / length1;
    }
  }

  for (let i = length1; i < length; ++i) {
    p[i] = 0;
  }

  return buffer;
}

const delayTimeConst = 0.100;
const fadeTimeConst = 0.050;
const bufferTimeConst = 0.100;

class Jungle {
  context: AudioContext;
  input: GainNode;
  output: GainNode;
  shiftDownBuffer: AudioBuffer;
  shiftUpBuffer: AudioBuffer;
  mod1: AudioBufferSourceNode;
  mod2: AudioBufferSourceNode;
  mod3: AudioBufferSourceNode;
  mod4: AudioBufferSourceNode;
  mod1Gain: GainNode;
  mod2Gain: GainNode;
  mod3Gain: GainNode;
  mod4Gain: GainNode;
  modGain1: GainNode;
  modGain2: GainNode;
  delay1: DelayNode;
  delay2: DelayNode;
  fade1: AudioBufferSourceNode;
  fade2: AudioBufferSourceNode;
  mix1: GainNode;
  mix2: GainNode;

  constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();

    this.mod1 = context.createBufferSource();
    this.mod2 = context.createBufferSource();
    this.mod3 = context.createBufferSource();
    this.mod4 = context.createBufferSource();
    this.shiftDownBuffer = createDelayTimeBuffer(context, bufferTimeConst, fadeTimeConst, false);
    this.shiftUpBuffer = createDelayTimeBuffer(context, bufferTimeConst, fadeTimeConst, true);
    this.mod1.buffer = this.shiftDownBuffer;
    this.mod2.buffer = this.shiftDownBuffer;
    this.mod3.buffer = this.shiftUpBuffer;
    this.mod4.buffer = this.shiftUpBuffer;
    this.mod1.loop = true;
    this.mod2.loop = true;
    this.mod3.loop = true;
    this.mod4.loop = true;

    this.mod1Gain = context.createGain();
    this.mod2Gain = context.createGain();
    this.mod3Gain = context.createGain();
    this.mod3Gain.gain.value = 0;
    this.mod4Gain = context.createGain();
    this.mod4Gain.gain.value = 0;

    this.mod1.connect(this.mod1Gain);
    this.mod2.connect(this.mod2Gain);
    this.mod3.connect(this.mod3Gain);
    this.mod4.connect(this.mod4Gain);

    this.modGain1 = context.createGain();
    this.modGain2 = context.createGain();

    this.delay1 = context.createDelay();
    this.delay2 = context.createDelay();
    this.mod1Gain.connect(this.modGain1);
    this.mod2Gain.connect(this.modGain2);
    this.mod3Gain.connect(this.modGain1);
    this.mod4Gain.connect(this.modGain2);
    this.modGain1.connect(this.delay1.delayTime);
    this.modGain2.connect(this.delay2.delayTime);

    this.fade1 = context.createBufferSource();
    this.fade2 = context.createBufferSource();
    const fadeBuffer = createFadeBuffer(context, bufferTimeConst, fadeTimeConst);
    this.fade1.buffer = fadeBuffer;
    this.fade2.buffer = fadeBuffer;
    this.fade1.loop = true;
    this.fade2.loop = true;

    this.mix1 = context.createGain();
    this.mix2 = context.createGain();
    this.mix1.gain.value = 0;
    this.mix2.gain.value = 0;

    this.fade1.connect(this.mix1.gain);
    this.fade2.connect(this.mix2.gain);

    this.input.connect(this.delay1);
    this.input.connect(this.delay2);
    this.delay1.connect(this.mix1);
    this.delay2.connect(this.mix2);
    this.mix1.connect(this.output);
    this.mix2.connect(this.output);

    const t = context.currentTime + 0.050;
    const t2 = t + bufferTimeConst - fadeTimeConst;
    this.mod1.start(t);
    this.mod2.start(t2);
    this.mod3.start(t);
    this.mod4.start(t2);
    this.fade1.start(t);
    this.fade2.start(t2);

    this.setDelay(delayTimeConst);
  }

  setDelay(delayTime: number) {
    this.modGain1.gain.setTargetAtTime(0.5 * delayTime, this.context.currentTime, 0.010);
    this.modGain2.gain.setTargetAtTime(0.5 * delayTime, this.context.currentTime, 0.010);
  }

  setPitchOffset(mult: number) {
    if (mult > 0) {
      this.mod1Gain.gain.value = 0;
      this.mod2Gain.gain.value = 0;
      this.mod3Gain.gain.value = 1;
      this.mod4Gain.gain.value = 1;
    } else {
      this.mod1Gain.gain.value = 1;
      this.mod2Gain.gain.value = 1;
      this.mod3Gain.gain.value = 0;
      this.mod4Gain.gain.value = 0;
    }
    this.setDelay(delayTimeConst * Math.abs(mult));
  }

  mapPitchFromSemitone(semitones: number): number {
    return semitones / 12;
  }

  setPitchTranspose(semitones: number) {
    const pitchOffset = this.mapPitchFromSemitone(semitones);
    this.setPitchOffset(pitchOffset);
  }

  disconnect() {
    try { this.mod1.stop(); } catch (e) {}
    try { this.mod2.stop(); } catch (e) {}
    try { this.mod3.stop(); } catch (e) {}
    try { this.mod4.stop(); } catch (e) {}
    try { this.fade1.stop(); } catch (e) {}
    try { this.fade2.stop(); } catch (e) {}

    try { this.input.disconnect(); } catch (e) {}
    try { this.output.disconnect(); } catch (e) {}
  }

  /**
   * Sound effect 6: Game Start Fanfare (Triumphant ascending arpeggio with retro synth warmth)
   */
  playGameStart() {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const baseVol = this.muted() ? 0 : this.volume() * 0.22;

      // Soft ascending warm major chord leading to a rich, pleasant C-dur chord:
      const notes = [
        { freq: 196.00, time: 0.0, dur: 0.22 },   // G3
        { freq: 261.63, time: 0.08, dur: 0.22 },  // C4
        { freq: 329.63, time: 0.16, dur: 0.22 },  // E4
        { freq: 392.00, time: 0.24, dur: 0.22 },  // G4
        { freq: 523.25, time: 0.32, dur: 0.9 }    // C5 (final soft root tone)
      ];

      // Soft harmonies to round out the final chord (no high-pitched piercing frequencies)
      const harmonies = [
        { freq: 261.63, time: 0.32, dur: 0.9 },   // C4
        { freq: 329.63, time: 0.32, dur: 0.9 },   // E4
        { freq: 392.00, time: 0.32, dur: 0.9 }    // G4
      ];

      const playFanfareNote = (freq: number, startOffset: number, duration: number, isFinal = false) => {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        // Use pure sine waves for all notes to keep the sound clean, smooth, and free of harsh harmonics
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + startOffset);

        gainNode.gain.setValueAtTime(0, now + startOffset);
        gainNode.gain.linearRampToValueAtTime(baseVol * (isFinal ? 0.75 : 1.0), now + startOffset + 0.04);
        
        // Gentle fade-out curve
        gainNode.gain.setValueAtTime(baseVol * (isFinal ? 0.75 : 1.0), now + startOffset + duration - 0.25);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(now + startOffset);
        osc.stop(now + startOffset + duration);
      };

      notes.forEach((n, idx) => {
        playFanfareNote(n.freq, n.time, n.dur, idx === notes.length - 1);
      });

      harmonies.forEach((h) => {
        playFanfareNote(h.freq, h.time, h.dur, true);
      });
    } catch (e) {
      console.warn('Failed to play game start fanfare:', e);
    }
  }

  /**
   * Sound effect 7: Game End Victory Fanfare (Celebratory chord progression with retro wave warmth)
   */
  playGameEnd() {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const baseVol = this.muted() ? 0 : this.volume() * 0.18;

      const playChord = (freqs: number[], timeOffset: number, duration: number) => {
        freqs.forEach((freq) => {
          const osc = ctx.createOscillator();
          const gainNode = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + timeOffset);

          gainNode.gain.setValueAtTime(0, now + timeOffset);
          gainNode.gain.linearRampToValueAtTime(baseVol, now + timeOffset + 0.05);
          gainNode.gain.exponentialRampToValueAtTime(0.001, now + timeOffset + duration);

          osc.connect(gainNode);
          gainNode.connect(ctx.destination);

          osc.start(now + timeOffset);
          osc.stop(now + timeOffset + duration);
        });
      };

      // Celebratory chord cadence:
      // 1. C4 Major: C4 (261.63), E4 (329.63), G4 (392.00), C5 (523.25)
      playChord([261.63, 329.63, 392.00, 523.25], 0.0, 0.45);

      // 2. F4 Major: F4 (349.23), A4 (440.00), C5 (523.25), F5 (698.46)
      playChord([349.23, 440.00, 523.25, 698.46], 0.35, 0.45);

      // 3. G4 Major: G4 (392.00), B4 (493.88), D5 (587.33), G5 (783.99)
      playChord([392.00, 493.88, 587.33, 783.99], 0.7, 0.45);

      // 4. C5 Major (Resolving and sustained): C4 (261.63), G4 (392.00), C5 (523.25), E5 (659.25), G5 (783.99)
      playChord([261.63, 392.00, 523.25, 659.25, 783.99], 1.05, 1.6);

    } catch (e) {
      console.warn('Failed to play game end fanfare:', e);
    }
  }
}
