import { RUN_SPEED } from "./constants";
import type { BeatPoint, LevelData, Obstacle } from "./types";

const WAVEFORM_BAR_COUNT = 240;
const ENERGY_SAMPLE_COUNT = 320;
const BAR_BEAT_COUNT = 8;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalize(values: number[]) {
  const peak = values.reduce((currentPeak, value) => Math.max(currentPeak, value), 0.0001);
  return values.map((value) => value / peak);
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function smooth(values: number[], radius: number) {
  const result = new Array<number>(values.length);

  for (let index = 0; index < values.length; index += 1) {
    let total = 0;
    let count = 0;

    for (let offset = -radius; offset <= radius; offset += 1) {
      const sample = values[index + offset];

      if (sample === undefined) {
        continue;
      }

      total += sample;
      count += 1;
    }

    result[index] = count > 0 ? total / count : values[index] ?? 0;
  }

  return result;
}

function createMonoBuffer(buffer: AudioBuffer) {
  const mono = new Float32Array(buffer.length);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);

    for (let index = 0; index < buffer.length; index += 1) {
      mono[index] += samples[index] / buffer.numberOfChannels;
    }
  }

  return mono;
}

function sampleBuckets(values: ArrayLike<number>, count: number) {
  const buckets = new Array<number>(count).fill(0);
  const bucketSize = Math.floor(values.length / count) || 1;

  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = bucket * bucketSize;
    const end = bucket === count - 1 ? values.length : Math.min(values.length, start + bucketSize);
    let total = 0;

    for (let index = start; index < end; index += 1) {
      total += Math.abs(values[index] ?? 0);
    }

    buckets[bucket] = end > start ? total / (end - start) : 0;
  }

  return normalize(buckets);
}

function detectBeats(
  energyEnvelope: number[],
  rmsEnvelope: number[],
  frameDuration: number,
) {
  const beats: BeatPoint[] = [];
  const localRadius = Math.max(8, Math.round(0.44 / frameDuration));
  const minGapFrames = Math.max(1, Math.round(0.36 / frameDuration));
  let lastBeatFrame = -minGapFrames;

  for (let index = localRadius; index < energyEnvelope.length - localRadius; index += 1) {
    const current = energyEnvelope[index] ?? 0;

    if (current <= (energyEnvelope[index - 1] ?? 0) || current < (energyEnvelope[index + 1] ?? 0)) {
      continue;
    }

    if (index - lastBeatFrame < minGapFrames) {
      continue;
    }

    let localTotal = 0;

    for (let sampleIndex = index - localRadius; sampleIndex <= index + localRadius; sampleIndex += 1) {
      localTotal += energyEnvelope[sampleIndex] ?? 0;
    }

    const localAverage = localTotal / (localRadius * 2 + 1);
    const threshold = localAverage * 1.32 + 0.028;

    if (current < threshold) {
      continue;
    }

    const strength = clamp((current - localAverage) * 3.5 + (rmsEnvelope[index] ?? 0) * 0.55, 0, 1);

    beats.push({
      time: index * frameDuration,
      strength,
      lane: beats.length % 3,
    });

    lastBeatFrame = index;
  }

  return beats;
}

function estimateBeatInterval(beats: BeatPoint[]) {
  const gaps: number[] = [];

  for (let index = 1; index < beats.length; index += 1) {
    const gap = beats[index].time - beats[index - 1].time;

    if (gap >= 0.32 && gap <= 0.78) {
      gaps.push(gap);
    }
  }

  return clamp(median(gaps) || 0.52, 0.42, 0.64);
}

function sampleStrengthAtTime(beats: BeatPoint[], time: number, interval: number) {
  let total = 0;
  let weightTotal = 0;

  for (const beat of beats) {
    const distance = Math.abs(beat.time - time);

    if (distance > interval * 0.72) {
      continue;
    }

    const weight = 1 - distance / (interval * 0.72);
    total += beat.strength * weight;
    weightTotal += weight;
  }

  return clamp(weightTotal > 0 ? total / weightTotal : 0.52, 0.32, 1);
}

function createJumpTimeline(beats: BeatPoint[], duration: number, interval: number) {
  const timeline: BeatPoint[] = [];
  const start = 0.82;
  const end = duration - 1.55;
  let cursor = start;
  const firstBeat = beats.find((beat) => beat.time >= start - interval * 0.35);

  if (firstBeat) {
    cursor = firstBeat.time;

    while (cursor - interval > start - 0.08) {
      cursor -= interval;
    }
  }

  while (cursor <= end) {
    let nearestBeat: BeatPoint | null = null;
    let nearestDistance = interval * 0.26;

    for (const beat of beats) {
      const distance = Math.abs(beat.time - cursor);

      if (distance < nearestDistance) {
        nearestBeat = beat;
        nearestDistance = distance;
      }
    }

    const resolvedTime = nearestBeat?.time ?? cursor;
    const interpolatedStrength = sampleStrengthAtTime(beats, resolvedTime, interval);
    const strength = clamp(
      (nearestBeat?.strength ?? 0.48) * 0.78 + interpolatedStrength * 0.36,
      0.34,
      1,
    );
    const lastBeat = timeline[timeline.length - 1];

    if (!lastBeat || resolvedTime - lastBeat.time > interval * 0.45) {
      timeline.push({
        time: resolvedTime,
        strength,
        lane: timeline.length % 3,
      });
    }

    cursor += interval;
  }

  return timeline;
}

type ObstacleToken =
  | null
  | "tap"
  | "hold"
  | "step"
  | "bridge"
  | "pop";

function createObstacleCenterTime(leadingEdgeTime: number, width: number) {
  return leadingEdgeTime + width / (RUN_SPEED * 2);
}

function createSpikeObstacle(
  jumpBeat: BeatPoint,
  index: number,
  width: number,
  height: number,
  spikes: number,
  frontDelay: number,
  hueBase: number,
  glow: number,
) {
  return {
    kind: "spike" as const,
    time: createObstacleCenterTime(jumpBeat.time + frontDelay, width),
    width,
    height,
    spikes,
    hue: hueBase + ((index * 19) % 76),
    glow,
  };
}

function createBlockObstacle(
  jumpBeat: BeatPoint,
  index: number,
  width: number,
  height: number,
  frontDelay: number,
  hueBase: number,
  glow: number,
) {
  return {
    kind: "block" as const,
    time: createObstacleCenterTime(jumpBeat.time + frontDelay, width),
    width,
    height,
    spikes: 0,
    hue: hueBase + ((index * 13) % 32),
    glow,
  };
}

function createChallengeObstacles(
  token: Exclude<ObstacleToken, null>,
  jumpBeat: BeatPoint,
  index: number,
  sectionProgress: number,
  barEnergy: number,
) {
  const accent = clamp(jumpBeat.strength * 0.72 + barEnergy * 0.28 + sectionProgress * 0.22, 0.34, 1);

  if (token === "tap") {
    const spikes = accent > 0.78 && index % 4 === 1 ? 2 : 1;
    const width = clamp(1.74 + spikes * 0.44 + accent * 0.22, 1.72, 2.68);
    const height = clamp(1.72 + spikes * 0.18 + accent * 0.18, 1.74, 2.26);
    const frontDelay = 0.085 + spikes * 0.012;

    return [
      createSpikeObstacle(
        jumpBeat,
        index,
        width,
        height,
        spikes,
        frontDelay,
        20,
        0.62 + accent * 0.24,
      ),
    ];
  }

  if (token === "hold") {
    const spikes = accent > 0.74 || sectionProgress > 0.7 ? 3 : 2;
    const width = clamp(2.92 + spikes * 0.48 + accent * 0.34, 3.48, 4.74);
    const height = clamp(2.02 + spikes * 0.16 + accent * 0.22, 2.16, 2.94);
    const frontDelay = 0.118 + spikes * 0.01;

    return [
      createSpikeObstacle(
        jumpBeat,
        index,
        width,
        height,
        spikes,
        frontDelay,
        12,
        0.72 + accent * 0.24,
      ),
    ];
  }

  if (token === "step") {
    const width = clamp(3.34 + accent * 0.72, 3.34, 4.44);
    const height = clamp(1.24 + accent * 0.22 + (index % 6 === 0 ? 0.08 : 0), 1.22, 1.72);

    return [
      createBlockObstacle(jumpBeat, index, width, height, 0.14, 176, 0.52 + accent * 0.2),
    ];
  }

  if (token === "bridge") {
    const width = clamp(4.82 + accent * 0.96, 4.82, 5.96);
    const height = clamp(1.3 + accent * 0.18, 1.3, 1.66);

    return [
      createBlockObstacle(jumpBeat, index, width, height, 0.16, 190, 0.56 + accent * 0.22),
    ];
  }

  const spikeWidth = clamp(1.62 + accent * 0.2, 1.62, 1.96);
  const spikeHeight = clamp(1.8 + accent * 0.14, 1.8, 2.08);
  const blockWidth = clamp(3.68 + accent * 0.64, 3.68, 4.5);
  const blockHeight = clamp(1.24 + accent * 0.18, 1.24, 1.62);

  return [
    createSpikeObstacle(
      jumpBeat,
      index,
      spikeWidth,
      spikeHeight,
      1,
      0.1,
      18,
      0.68 + accent * 0.18,
    ),
    createBlockObstacle(jumpBeat, index + 1, blockWidth, blockHeight, 0.22, 184, 0.58 + accent * 0.18),
  ];
}

function getPatternPool(sectionProgress: number, barIndex: number) {
  if (barIndex === 0) {
    return [
      [null, "tap", null, null, "tap", null, "step", null],
      [null, "tap", null, "tap", null, null, "step", null],
    ] satisfies ObstacleToken[][];
  }

  if (barIndex === 1) {
    return [
      ["tap", null, "tap", null, "step", null, "tap", null],
      [null, "tap", "step", null, "tap", null, "tap", null],
    ] satisfies ObstacleToken[][];
  }

  if (barIndex === 2) {
    return [
      ["tap", null, "step", null, "tap", null, "bridge", null],
      ["tap", null, "tap", "step", null, "tap", null, "bridge"],
    ] satisfies ObstacleToken[][];
  }

  if (barIndex === 3) {
    return [
      ["tap", "tap", null, "step", null, "tap", null, "hold"],
      ["tap", null, "step", "tap", null, "tap", null, "hold"],
    ] satisfies ObstacleToken[][];
  }

  if (sectionProgress < 0.24) {
    return [
      ["tap", null, "tap", "step", "tap", null, "hold", "step"],
      ["tap", "tap", null, "step", "hold", null, "tap", "bridge"],
      ["tap", null, "hold", "tap", "step", null, "tap", "step"],
    ] satisfies ObstacleToken[][];
  }

  if (sectionProgress < 0.76) {
    return [
      ["tap", "hold", "step", "tap", "pop", null, "hold", "bridge"],
      ["step", "tap", "hold", null, "bridge", "tap", "step", "hold"],
      ["tap", "step", "hold", "tap", "pop", "hold", null, "bridge"],
    ] satisfies ObstacleToken[][];
  }

  return [
    ["hold", "tap", "pop", "hold", "step", "hold", "bridge", "tap"],
    ["tap", "hold", "step", "pop", "hold", "tap", "bridge", "hold"],
    ["hold", "step", "tap", "hold", "pop", "hold", "step", "tap"],
  ] satisfies ObstacleToken[][];
}

function obstacleStartTime(obstacle: Obstacle) {
  return obstacle.time - obstacle.width / (RUN_SPEED * 2);
}

function obstacleEndTime(obstacle: Obstacle) {
  return obstacle.time + obstacle.width / (RUN_SPEED * 2);
}

function normalizeObstacles(obstacles: Obstacle[], duration: number) {
  const sorted = [...obstacles].sort((left, right) => left.time - right.time);
  const normalized: Obstacle[] = [];

  for (const obstacle of sorted) {
    if (obstacleStartTime(obstacle) >= duration - 0.95) {
      break;
    }

    let nextObstacle = obstacle;
    const previousObstacle = normalized[normalized.length - 1];

    if (previousObstacle) {
      const previousEnd = obstacleEndTime(previousObstacle);
      const currentStart = obstacleStartTime(obstacle);

      if (currentStart < previousEnd - 0.02) {
        const adjustedStart = previousEnd + 0.02;

        nextObstacle = {
          ...obstacle,
          time: createObstacleCenterTime(adjustedStart, obstacle.width),
        };
      }
    }

    if (obstacleStartTime(nextObstacle) >= duration - 0.95) {
      continue;
    }

    normalized.push(nextObstacle);
  }

  return normalized;
}

function createObstacles(jumpBeats: BeatPoint[], duration: number) {
  const obstacles: Obstacle[] = [];

  for (let barStart = 0; barStart < jumpBeats.length; barStart += BAR_BEAT_COUNT) {
    const barBeats = jumpBeats.slice(barStart, barStart + BAR_BEAT_COUNT);
    const barIndex = Math.floor(barStart / BAR_BEAT_COUNT);
    const sectionProgress = barStart / Math.max(1, jumpBeats.length - 1);
    const barEnergy =
      barBeats.reduce((total, beat) => total + beat.strength, 0) / Math.max(1, barBeats.length);
    const patternPool = getPatternPool(sectionProgress, barIndex);
    const pattern = patternPool[(barIndex + Math.round(barEnergy * 5)) % patternPool.length];

    for (let beatOffset = 0; beatOffset < barBeats.length; beatOffset += 1) {
      const jumpBeat = barBeats[beatOffset];
      const token = pattern[beatOffset % pattern.length];

      if (!token) {
        continue;
      }

      obstacles.push(
        ...createChallengeObstacles(
          token,
          jumpBeat,
          barStart + beatOffset,
          sectionProgress,
          barEnergy,
        ),
      );
    }
  }

  return normalizeObstacles(obstacles, duration);
}

export function analyzeAudioBuffer(buffer: AudioBuffer): LevelData {
  const mono = createMonoBuffer(buffer);
  const frameSize = 2048;
  const hopSize = 1024;
  const frameCount = Math.max(1, Math.floor((mono.length - frameSize) / hopSize));
  const rmsValues = new Array<number>(frameCount);
  const fluxValues = new Array<number>(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    let rmsTotal = 0;
    let fluxTotal = 0;

    for (let offset = 0; offset < frameSize; offset += 1) {
      const sampleIndex = start + offset;
      const sample = mono[sampleIndex] ?? 0;
      const previous = mono[sampleIndex - 1] ?? 0;

      rmsTotal += sample * sample;
      fluxTotal += Math.abs(sample - previous);
    }

    rmsValues[frame] = Math.sqrt(rmsTotal / frameSize);
    fluxValues[frame] = fluxTotal / frameSize;
  }

  const normalizedRms = normalize(rmsValues);
  const normalizedFlux = normalize(fluxValues);
  const combinedEnergy = normalizedRms.map(
    (value, index) => value * 0.62 + (normalizedFlux[index] ?? 0) * 0.38,
  );
  const smoothedEnergy = smooth(combinedEnergy, 4);
  const frameDuration = hopSize / buffer.sampleRate;
  const detectedBeats = detectBeats(smoothedEnergy, normalizedRms, frameDuration);
  const beatInterval = estimateBeatInterval(detectedBeats);
  const jumpBeats = createJumpTimeline(detectedBeats, buffer.duration, beatInterval);
  const obstacles = createObstacles(jumpBeats, buffer.duration);

  return {
    duration: buffer.duration,
    beatInterval,
    waveform: sampleBuckets(mono, WAVEFORM_BAR_COUNT),
    energyCurve: sampleBuckets(smoothedEnergy, ENERGY_SAMPLE_COUNT),
    beats: jumpBeats,
    obstacles,
  };
}
