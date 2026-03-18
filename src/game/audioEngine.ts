import { analyzeAudioBuffer } from "./analysis";
import type { AudioFrame, LevelData, TrackId } from "./types";

const EMPTY_AUDIO_FRAME: AudioFrame = {
  bass: 0,
  mid: 0,
  treble: 0,
  overall: 0,
};

const audioDataCache = new Map<string, Promise<ArrayBuffer>>();
const levelCache = new Map<string, Promise<LevelData>>();

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

async function fetchAudioData(audioUrl: string) {
  const cachedData = audioDataCache.get(audioUrl);

  if (cachedData) {
    return cachedData;
  }

  const audioDataPromise = (async () => {
    const response = await fetch(audioUrl);

    if (!response.ok) {
      throw new Error(`Audio request failed with ${response.status}.`);
    }

    return response.arrayBuffer();
  })();

  audioDataCache.set(audioUrl, audioDataPromise);

  try {
    return await audioDataPromise;
  } catch (error) {
    audioDataCache.delete(audioUrl);
    throw error;
  }
}

async function decodeAudioBuffer(audioData: ArrayBuffer) {
  if (typeof OfflineAudioContext !== "undefined") {
    const decodingContext = new OfflineAudioContext(1, 1, 44_100);
    return decodingContext.decodeAudioData(audioData);
  }

  const decodingContext = new AudioContext();

  try {
    return await decodingContext.decodeAudioData(audioData);
  } finally {
    if (decodingContext.state !== "closed") {
      void decodingContext.close();
    }
  }
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
  private startRequestId = 0;
  private playbackLatency = 0;

  private ensureContext() {
    if (this.context && this.analyser && this.gainNode && this.frequencyData) {
      return this.context;
    }

    const context = this.context ?? new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;

    const gainNode = context.createGain();
    gainNode.gain.value = 0.94;
    gainNode.connect(analyser);
    analyser.connect(context.destination);

    this.context = context;
    this.analyser = analyser;
    this.gainNode = gainNode;
    this.frequencyData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    this.updatePlaybackLatency();

    return context;
  }

  private updatePlaybackLatency() {
    if (!this.context) {
      this.playbackLatency = 0;
      return;
    }

    const outputLatency =
      "outputLatency" in this.context && typeof this.context.outputLatency === "number"
        ? this.context.outputLatency
        : 0;
    const baseLatency = typeof this.context.baseLatency === "number" ? this.context.baseLatency : 0;

    this.playbackLatency = Math.min(0.18, Math.max(0, baseLatency + outputLatency));
  }

  async load(audioUrl: string, trackId: TrackId = "default"): Promise<LevelData> {
    const audioData = await fetchAudioData(audioUrl);
    this.buffer = await decodeAudioBuffer(audioData.slice(0));
    const levelCacheKey = `${trackId}:${audioUrl}`;
    const cachedLevel = levelCache.get(levelCacheKey);

    if (cachedLevel) {
      return cachedLevel;
    }

    const levelPromise = Promise.resolve(analyzeAudioBuffer(this.buffer, trackId));
    levelCache.set(levelCacheKey, levelPromise);

    try {
      return await levelPromise;
    } catch (error) {
      levelCache.delete(levelCacheKey);
      throw error;
    }
  }

  async unlock() {
    const context = this.ensureContext();
    await context.resume();
    this.updatePlaybackLatency();
  }

  async start(offset = 0) {
    if (!this.buffer) {
      throw new Error("Audio engine is not ready.");
    }

    const context = this.ensureContext();
    const gainNode = this.gainNode;

    if (!gainNode) {
      throw new Error("Audio engine is not ready.");
    }

    const requestId = ++this.startRequestId;
    this.stop(false, false);
    await context.resume();
    this.updatePlaybackLatency();

    if (requestId !== this.startRequestId) {
      return;
    }

    this.stop(false, false);

    const nextSource = context.createBufferSource();
    nextSource.buffer = this.buffer;
    nextSource.connect(gainNode);
    nextSource.start(0, offset);
    this.startTime = context.currentTime - offset;
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

  stop(rememberPosition = true, cancelPendingStart = true) {
    if (cancelPendingStart) {
      this.startRequestId += 1;
    }

    if (!this.source || !this.context) {
      return;
    }

    const activeSource = this.source;
    this.source = null;

    if (rememberPosition) {
      this.stoppedAt = Math.max(
        0,
        Math.min(this.buffer?.duration ?? 0, this.context.currentTime - this.startTime - this.playbackLatency),
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
      Math.min(this.buffer.duration, this.context.currentTime - this.startTime - this.playbackLatency),
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
