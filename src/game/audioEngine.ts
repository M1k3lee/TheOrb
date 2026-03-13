import { analyzeAudioBuffer } from "./analysis";
import type { AudioFrame, LevelData } from "./types";

const EMPTY_AUDIO_FRAME: AudioFrame = {
  bass: 0,
  mid: 0,
  treble: 0,
  overall: 0,
};

function averageRange(values: ArrayLike<number>, start: number, end: number) {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(values.length, end);

  if (safeStart >= safeEnd) {
    return 0;
  }

  let total = 0;

  for (let index = safeStart; index < safeEnd; index += 1) {
    total += values[index] ?? 0;
  }

  return total / (safeEnd - safeStart) / 255;
}

export class RhythmAudioEngine {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private frequencyData: Uint8Array<ArrayBuffer> | null = null;
  private startTime = 0;
  private stoppedAt = 0;

  async load(audioUrl: string): Promise<LevelData> {
    this.context = this.context ?? new AudioContext();

    const response = await fetch(audioUrl);

    if (!response.ok) {
      throw new Error(`Audio request failed with ${response.status}.`);
    }

    const arrayBuffer = await response.arrayBuffer();
    this.buffer = await this.context.decodeAudioData(arrayBuffer);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.frequencyData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.gainNode = this.context.createGain();
    this.gainNode.gain.value = 0.94;
    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.context.destination);

    return analyzeAudioBuffer(this.buffer);
  }

  async start(offset = 0) {
    if (!this.context || !this.buffer || !this.gainNode) {
      throw new Error("Audio engine is not ready.");
    }

    this.stop(false);
    await this.context.resume();

    const nextSource = this.context.createBufferSource();
    nextSource.buffer = this.buffer;
    nextSource.connect(this.gainNode);
    nextSource.start(0, offset);
    this.startTime = this.context.currentTime - offset;
    this.stoppedAt = offset;
    this.source = nextSource;

    nextSource.onended = () => {
      if (this.source !== nextSource) {
        return;
      }

      this.source.disconnect();
      this.source = null;
      this.stoppedAt = this.buffer?.duration ?? this.stoppedAt;
    };
  }

  stop(rememberPosition = true) {
    if (!this.source || !this.context) {
      return;
    }

    const activeSource = this.source;
    this.source = null;

    if (rememberPosition) {
      this.stoppedAt = Math.max(
        0,
        Math.min(this.buffer?.duration ?? 0, this.context.currentTime - this.startTime),
      );
    }

    activeSource.onended = null;

    try {
      activeSource.stop();
    } catch {
      // The source may already have ended.
    }

    activeSource.disconnect();
  }

  getCurrentTime() {
    if (!this.context || !this.buffer) {
      return 0;
    }

    if (!this.source) {
      return this.stoppedAt;
    }

    return Math.max(
      0,
      Math.min(this.buffer.duration, this.context.currentTime - this.startTime),
    );
  }

  sampleLevels(): AudioFrame {
    if (!this.analyser || !this.frequencyData || !this.source) {
      return EMPTY_AUDIO_FRAME;
    }

    this.analyser.getByteFrequencyData(this.frequencyData);

    const bass = averageRange(this.frequencyData, 0, 10);
    const mid = averageRange(this.frequencyData, 10, 40);
    const treble = averageRange(this.frequencyData, 40, 110);

    return {
      bass,
      mid,
      treble,
      overall: bass * 0.45 + mid * 0.35 + treble * 0.2,
    };
  }

  dispose() {
    this.stop(false);
    this.analyser?.disconnect();
    this.gainNode?.disconnect();
    this.frequencyData = null;
    this.buffer = null;

    if (this.context && this.context.state !== "closed") {
      void this.context.close();
    }

    this.context = null;
    this.analyser = null;
    this.gainNode = null;
  }
}
