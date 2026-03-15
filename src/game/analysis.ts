import {
  COYOTE_TIME,
  FALL_GRAVITY_MULTIPLIER,
  GRAVITY,
  GROUND_Y,
  HOLD_JUMP_GRAVITY_MULTIPLIER,
  JUMP_VELOCITY,
  LOW_JUMP_GRAVITY_MULTIPLIER,
  PLAYER_RADIUS,
  RUN_SPEED,
} from "./constants";
import type { BeatPoint, CameraMoment, LavaZone, LevelData, Obstacle } from "./types";

const WAVEFORM_BAR_COUNT = 240;
const ENERGY_SAMPLE_COUNT = 320;
const BAR_BEAT_COUNT = 8;
const LAVA_SURFACE_Y = 0.22;
const SIMULATION_STEP = 1 / 180;

interface GridBeat {
  time: number;
  strength: number;
  lane: number;
}

interface GeneratedBar {
  cues: BeatPoint[];
  obstacles: Obstacle[];
  lavaZones: LavaZone[];
  cameraMoments: CameraMoment[];
}

type ObstacleToken = null | "tap" | "hold" | "step" | "bridge";

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
  const beats: GridBeat[] = [];
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

function estimateBeatInterval(beats: GridBeat[]) {
  const gaps: number[] = [];

  for (let index = 1; index < beats.length; index += 1) {
    const gap = beats[index].time - beats[index - 1].time;

    if (gap >= 0.32 && gap <= 0.78) {
      gaps.push(gap);
    }
  }

  return clamp(median(gaps) || 0.52, 0.42, 0.64);
}

function sampleStrengthAtTime(beats: GridBeat[], time: number, interval: number) {
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

function createJumpTimeline(beats: GridBeat[], duration: number, interval: number) {
  const timeline: GridBeat[] = [];
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
    let nearestBeat: GridBeat | null = null;
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

function createCue(beat: GridBeat, action: BeatPoint["action"], laneOffset = 0): BeatPoint {
  return {
    time: beat.time,
    strength: beat.strength,
    lane: (beat.lane + laneOffset + 3) % 3,
    action,
  };
}

function createObstacleCenterTime(leadingEdgeTime: number, width: number) {
  return leadingEdgeTime + width / (RUN_SPEED * 2);
}

function createSpikeObstacle(
  beat: GridBeat,
  index: number,
  width: number,
  height: number,
  spikes: number,
  frontDelay: number,
  hueBase: number,
  glow: number,
  baseY = 0,
) {
  return {
    kind: "spike" as const,
    time: createObstacleCenterTime(beat.time + frontDelay, width),
    baseY,
    width,
    height,
    spikes,
    hue: hueBase + ((index * 19) % 76),
    glow,
  };
}

function createBlockObstacle(
  beat: GridBeat,
  index: number,
  width: number,
  height: number,
  frontDelay: number,
  hueBase: number,
  glow: number,
  baseY = 0,
) {
  return {
    kind: "block" as const,
    time: createObstacleCenterTime(beat.time + frontDelay, width),
    baseY,
    width,
    height,
    spikes: 0,
    hue: hueBase + ((index * 13) % 32),
    glow,
  };
}

function createPlatformBlock(
  beat: GridBeat,
  index: number,
  width: number,
  topY: number,
  thickness: number,
  frontDelay: number,
  hueBase: number,
  glow: number,
) {
  const safeThickness = clamp(thickness, 0.32, 1.8);
  const safeTopY = Math.max(safeThickness + 0.16, topY);

  return createBlockObstacle(
    beat,
    index,
    width,
    safeThickness,
    frontDelay,
    hueBase,
    glow,
    safeTopY - safeThickness,
  );
}

function createPlatformSpike(
  beat: GridBeat,
  index: number,
  width: number,
  height: number,
  spikes: number,
  frontDelay: number,
  hueBase: number,
  glow: number,
  baseY: number,
) {
  return createSpikeObstacle(
    beat,
    index,
    width,
    height,
    spikes,
    frontDelay,
    hueBase,
    glow,
    baseY,
  );
}

function buildTokenObstacles(
  token: Exclude<ObstacleToken, null>,
  beat: GridBeat,
  index: number,
  sectionProgress: number,
  barEnergy: number,
) {
  const accent = clamp(beat.strength * 0.72 + barEnergy * 0.28 + sectionProgress * 0.18, 0.34, 1);

  if (token === "tap") {
    const spikes = sectionProgress > 0.58 && accent > 0.78 ? 2 : 1;
    const width = clamp(1.64 + spikes * 0.34 + accent * 0.14, 1.64, 2.28);
    const height = clamp(1.56 + spikes * 0.14 + accent * 0.12, 1.56, 1.98);

    return [
      createSpikeObstacle(beat, index, width, height, spikes, 0.1, 18, 0.58 + accent * 0.18),
    ];
  }

  if (token === "hold") {
    const spikes = sectionProgress > 0.82 && accent > 0.82 ? 3 : 2;
    const width = clamp(3.16 + spikes * 0.3 + accent * 0.24, 3.22, 4.18);
    const height = clamp(1.86 + spikes * 0.14 + accent * 0.16, 1.94, 2.34);

    return [
      createSpikeObstacle(beat, index, width, height, spikes, 0.148, 10, 0.7 + accent * 0.18),
    ];
  }

  if (token === "step") {
    const width = clamp(3.7 + accent * 0.42, 3.7, 4.4);
    const height = clamp(1.18 + accent * 0.18, 1.18, 1.52);

    return [
      createBlockObstacle(beat, index, width, height, 0.16, 178, 0.5 + accent * 0.18),
    ];
  }

  const width = clamp(5.18 + accent * 0.62, 5.18, 6.2);
  const height = clamp(1.2 + accent * 0.14, 1.2, 1.48);

  return [
    createBlockObstacle(beat, index, width, height, 0.18, 194, 0.54 + accent * 0.2),
  ];
}

function getGroundPatternPool(sectionProgress: number, barIndex: number) {
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
      [null, "tap", null, "step", "tap", null, "bridge", null],
    ] satisfies ObstacleToken[][];
  }

  if (sectionProgress < 0.28) {
    return [
      ["tap", null, "step", null, "tap", null, "bridge", null],
      [null, "tap", "step", null, "tap", null, "step", null],
      ["tap", null, "tap", null, "step", null, "bridge", null],
    ] satisfies ObstacleToken[][];
  }

  if (sectionProgress < 0.72) {
    return [
      ["tap", null, "step", null, "hold", null, "bridge", null],
      [null, "tap", "step", null, "hold", null, "step", null],
      ["step", null, "tap", null, "hold", null, "bridge", null],
    ] satisfies ObstacleToken[][];
  }

  return [
    ["tap", null, "hold", null, "step", null, "hold", null],
    ["step", null, "tap", null, "hold", null, "bridge", null],
    ["tap", null, "step", null, "hold", null, "hold", null],
  ] satisfies ObstacleToken[][];
}

function buildGroundBar(
  barBeats: GridBeat[],
  barIndex: number,
  sectionProgress: number,
  barEnergy: number,
) {
  const patternPool = getGroundPatternPool(sectionProgress, barIndex);
  const pattern = patternPool[(barIndex + Math.round(barEnergy * 4)) % patternPool.length];
  const cues: BeatPoint[] = [];
  const obstacles: Obstacle[] = [];

  for (let beatOffset = 0; beatOffset < barBeats.length; beatOffset += 1) {
    const beat = barBeats[beatOffset];
    const token = pattern[beatOffset % pattern.length];

    if (!token) {
      continue;
    }

    cues.push(createCue(beat, token));
    obstacles.push(...buildTokenObstacles(token, beat, barIndex * BAR_BEAT_COUNT + beatOffset, sectionProgress, barEnergy));
  }

  return {
    cues,
    obstacles,
    lavaZones: [],
    cameraMoments: [],
  } satisfies GeneratedBar;
}

function createLavaZoneForObstacles(
  obstacles: Obstacle[],
  intensity: number,
  hue: number,
  leadTrim: number,
  trailTrim: number,
) {
  const firstObstacle = obstacles[0];
  const lastObstacle = obstacles[obstacles.length - 1];

  if (!firstObstacle || !lastObstacle) {
    return null;
  }

  return {
    startTime: Math.max(0, obstacleStartTime(firstObstacle) + leadTrim),
    endTime: obstacleEndTime(lastObstacle) - trailTrim,
    intensity,
    hue,
  } satisfies LavaZone;
}

function buildClimbBar(
  barBeats: GridBeat[],
  barIndex: number,
  sectionProgress: number,
  barEnergy: number,
) {
  const cueOffsets = [0, 2, 4, 6];
  const topHeights = [
    1.22,
    clamp(1.66 + barEnergy * 0.16, 1.66, 1.92),
    clamp(2.06 + barEnergy * 0.2, 2.06, 2.36),
    1.26 + sectionProgress * 0.08,
  ];
  const widths = [3.9, 3.55, 3.35, 4.8];
  const thicknesses = [1.22, 0.42, 0.42, 1.26];
  const cues = cueOffsets.map((offset, index) =>
    createCue(barBeats[offset], index === cueOffsets.length - 1 ? "step" : "climb", index - 1),
  );
  const obstacles = cueOffsets.map((offset, index) =>
    createPlatformBlock(
      barBeats[offset],
      barIndex * BAR_BEAT_COUNT + offset,
      widths[index],
      topHeights[index],
      thicknesses[index],
      0.17 + index * 0.01,
      164,
      0.64 + barEnergy * 0.18,
    ),
  );
  const lavaZone = createLavaZoneForObstacles(
    obstacles,
    0.68 + barEnergy * 0.22,
    12 + ((barIndex * 9) % 22),
    0.1,
    0.46,
  );

  return {
    cues,
    obstacles,
    lavaZones: lavaZone ? [lavaZone] : [],
    cameraMoments: [
      {
        time: barBeats[1]?.time ?? barBeats[0].time,
        duration: 0.9,
        strength: 0.74 + barEnergy * 0.16,
        style: "rear",
      },
    ],
  } satisfies GeneratedBar;
}

function buildDropBar(
  barBeats: GridBeat[],
  barIndex: number,
  barEnergy: number,
) {
  const cueOffsets = [0, 2, 4, 6];
  const topHeights = [
    clamp(2.1 + barEnergy * 0.16, 2.1, 2.36),
    clamp(1.84 + barEnergy * 0.12, 1.84, 2.06),
    1.48,
    1.22,
  ];
  const widths = [3.3, 3.2, 3.55, 4.6];
  const thicknesses = [0.42, 0.4, 0.38, 1.22];
  const cues = cueOffsets.map((offset, index) =>
    createCue(barBeats[offset], index < 2 ? "climb" : "step", 1 - index),
  );
  const obstacles = cueOffsets.map((offset, index) =>
    createPlatformBlock(
      barBeats[offset],
      barIndex * BAR_BEAT_COUNT + offset,
      widths[index],
      topHeights[index],
      thicknesses[index],
      0.16 + index * 0.012,
      202,
      0.54 + barEnergy * 0.16,
    ),
  );
  const lavaZone = createLavaZoneForObstacles(
    obstacles,
    0.58 + barEnergy * 0.16,
    18 + ((barIndex * 7) % 18),
    0.08,
    0.42,
  );

  return {
    cues,
    obstacles,
    lavaZones: lavaZone ? [lavaZone] : [],
    cameraMoments: [
      {
        time: barBeats[2]?.time ?? barBeats[0].time,
        duration: 0.7,
        strength: 0.64 + barEnergy * 0.14,
        style: "hero",
      },
    ],
  } satisfies GeneratedBar;
}

function buildBridgeBar(
  barBeats: GridBeat[],
  barIndex: number,
  barEnergy: number,
) {
  const cueOffsets = [1, 3, 5];
  const topHeights = [1.4, 1.52, 1.24];
  const widths = [5.25, 5.45, 4.9];
  const thicknesses = [0.42, 0.42, 1.24];
  const cues = [
    createCue(barBeats[1], "bridge", 0),
    createCue(barBeats[3], "tap", 1),
    createCue(barBeats[5], "step", 2),
  ];
  const platformOne = createPlatformBlock(
    barBeats[1],
    barIndex * BAR_BEAT_COUNT + 1,
    widths[0],
    topHeights[0],
    thicknesses[0],
    0.18,
    188,
    0.58 + barEnergy * 0.18,
  );
  const platformTwo = createPlatformBlock(
    barBeats[3],
    barIndex * BAR_BEAT_COUNT + 3,
    widths[1],
    topHeights[1],
    thicknesses[1],
    0.18,
    196,
    0.6 + barEnergy * 0.18,
  );
  const exitPlatform = createPlatformBlock(
    barBeats[5],
    barIndex * BAR_BEAT_COUNT + 5,
    widths[2],
    topHeights[2],
    thicknesses[2],
    0.16,
    202,
    0.52 + barEnergy * 0.16,
  );
  const platformSpike = createPlatformSpike(
    barBeats[3],
    barIndex * BAR_BEAT_COUNT + 103,
    1.22,
    0.96,
    1,
    0.11,
    16,
    0.72 + barEnergy * 0.16,
    topHeights[1],
  );
  const obstacles = [
    platformOne,
    platformTwo,
    exitPlatform,
    platformSpike,
  ];
  const lavaZone = createLavaZoneForObstacles(
    [platformOne, platformTwo, exitPlatform],
    0.58 + barEnergy * 0.18,
    18 + ((barIndex * 11) % 18),
    0.08,
    0.4,
  );

  return {
    cues,
    obstacles,
    lavaZones: lavaZone ? [lavaZone] : [],
    cameraMoments: [
      {
        time: barBeats[3]?.time ?? barBeats[0].time,
        duration: 0.72,
        strength: 0.66 + barEnergy * 0.12,
        style: "sweep",
      },
    ],
  } satisfies GeneratedBar;
}

function buildGauntletBar(
  barBeats: GridBeat[],
  barIndex: number,
  barEnergy: number,
) {
  const platformOne = createPlatformBlock(
    barBeats[0],
    barIndex * BAR_BEAT_COUNT,
    5.8,
    1.56,
    0.42,
    0.16,
    172,
    0.62 + barEnergy * 0.18,
  );
  const platformSpike = createPlatformSpike(
    barBeats[2],
    barIndex * BAR_BEAT_COUNT + 102,
    1.28,
    0.98,
    1,
    0.1,
    14,
    0.74 + barEnergy * 0.18,
    1.56,
  );
  const midStep = createPlatformBlock(
    barBeats[4],
    barIndex * BAR_BEAT_COUNT + 4,
    3.1,
    1.94,
    0.38,
    0.16,
    184,
    0.56 + barEnergy * 0.16,
  );
  const exitPlatform = createPlatformBlock(
    barBeats[6],
    barIndex * BAR_BEAT_COUNT + 6,
    4.45,
    1.26,
    1.26,
    0.16,
    196,
    0.52 + barEnergy * 0.14,
  );
  const lavaZone = createLavaZoneForObstacles(
    [platformOne, midStep, exitPlatform],
    0.7 + barEnergy * 0.16,
    10 + ((barIndex * 5) % 26),
    0.08,
    0.44,
  );

  return {
    cues: [
      createCue(barBeats[0], "bridge", 0),
      createCue(barBeats[2], "tap", 1),
      createCue(barBeats[4], "climb", 2),
      createCue(barBeats[6], "step", 0),
    ],
    obstacles: [platformOne, platformSpike, midStep, exitPlatform],
    lavaZones: lavaZone ? [lavaZone] : [],
    cameraMoments: [
      {
        time: barBeats[2]?.time ?? barBeats[0].time,
        duration: 0.78,
        strength: 0.72 + barEnergy * 0.14,
        style: "rush",
      },
    ],
  } satisfies GeneratedBar;
}

function buildFloatingStepsBar(
  barBeats: GridBeat[],
  barIndex: number,
  barEnergy: number,
) {
  const cueOffsets = [0, 2, 4, 6];
  const topHeights = [1.48, 1.92, 1.68, 1.24];
  const widths = [2.9, 2.8, 2.9, 4.6];
  const thicknesses = [0.36, 0.36, 0.36, 1.24];
  const obstacles = cueOffsets.map((offset, index) =>
    createPlatformBlock(
      barBeats[offset],
      barIndex * BAR_BEAT_COUNT + offset,
      widths[index],
      topHeights[index],
      thicknesses[index],
      0.16 + index * 0.01,
      204,
      0.5 + barEnergy * 0.14,
    ),
  );
  const lavaZone = createLavaZoneForObstacles(
    obstacles,
    0.62 + barEnergy * 0.14,
    20 + ((barIndex * 9) % 14),
    0.08,
    0.42,
  );

  return {
    cues: cueOffsets.map((offset, index) =>
      createCue(barBeats[offset], index === cueOffsets.length - 1 ? "step" : "climb", 1 - index),
    ),
    obstacles,
    lavaZones: lavaZone ? [lavaZone] : [],
    cameraMoments: [
      {
        time: barBeats[4]?.time ?? barBeats[0].time,
        duration: 0.68,
        strength: 0.62 + barEnergy * 0.12,
        style: "hero",
      },
    ],
  } satisfies GeneratedBar;
}

function createEnergyCameraMoment(
  barBeats: GridBeat[],
  currentEnergy: number,
  previousEnergy: number,
) {
  if (currentEnergy < 0.72 || currentEnergy < previousEnergy + 0.08) {
    return null;
  }

  return {
    time: barBeats[2]?.time ?? barBeats[0].time,
    duration: 0.62,
    strength: clamp(currentEnergy * 0.92, 0.68, 1),
    style: currentEnergy > previousEnergy + 0.16 ? "rush" : "hero",
  } satisfies CameraMoment;
}

function obstacleStartTime(obstacle: Obstacle) {
  return obstacle.time - obstacle.width / (RUN_SPEED * 2);
}

function obstacleEndTime(obstacle: Obstacle) {
  return obstacle.time + obstacle.width / (RUN_SPEED * 2);
}

function obstacleBottom(obstacle: Obstacle) {
  return obstacle.baseY;
}

function obstacleTop(obstacle: Obstacle) {
  return obstacle.baseY + obstacle.height;
}

function obstaclesCanOverlap(previousObstacle: Obstacle, currentObstacle: Obstacle) {
  return (
    obstacleBottom(currentObstacle) >= obstacleTop(previousObstacle) - 0.04 ||
    obstacleBottom(previousObstacle) >= obstacleTop(currentObstacle) - 0.04
  );
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

      if (currentStart < previousEnd - 0.02 && !obstaclesCanOverlap(previousObstacle, obstacle)) {
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

function normalizeLavaZones(lavaZones: LavaZone[], duration: number) {
  const sorted = [...lavaZones]
    .map((zone) => ({
      ...zone,
      startTime: clamp(zone.startTime, 0.2, duration - 1.4),
      endTime: clamp(zone.endTime, 0.4, duration - 1.0),
    }))
    .filter((zone) => zone.endTime - zone.startTime > 0.35)
    .sort((left, right) => left.startTime - right.startTime);
  const merged: LavaZone[] = [];

  for (const zone of sorted) {
    const previous = merged[merged.length - 1];

    if (!previous || zone.startTime > previous.endTime + 0.12) {
      merged.push(zone);
      continue;
    }

    previous.endTime = Math.max(previous.endTime, zone.endTime);
    previous.intensity = Math.max(previous.intensity, zone.intensity);
  }

  return merged;
}

function normalizeCameraMoments(cameraMoments: CameraMoment[]) {
  return [...cameraMoments]
    .sort((left, right) => left.time - right.time)
    .filter((moment, index, list) => index === 0 || moment.time - list[index - 1].time > 0.8);
}

function buildLevelLayout(gridBeats: GridBeat[], duration: number) {
  const cues: BeatPoint[] = [];
  const obstacles: Obstacle[] = [];
  const lavaZones: LavaZone[] = [];
  const cameraMoments: CameraMoment[] = [];
  let previousBarEnergy = 0.4;

  for (let barStart = 0; barStart < gridBeats.length; barStart += BAR_BEAT_COUNT) {
    const barBeats = gridBeats.slice(barStart, barStart + BAR_BEAT_COUNT);

    if (barBeats.length < BAR_BEAT_COUNT) {
      break;
    }

    const barIndex = Math.floor(barStart / BAR_BEAT_COUNT);
    const sectionProgress = barStart / Math.max(1, gridBeats.length - 1);
    const barEnergy =
      barBeats.reduce((total, beat) => total + beat.strength, 0) / Math.max(1, barBeats.length);
    const useClimb = barIndex > 2 && (barIndex % 9 === 3 || (barIndex % 7 === 1 && barEnergy > 0.66));
    const useDrop = !useClimb && barIndex > 4 && (barIndex % 9 === 5 || (barIndex % 8 === 2 && sectionProgress > 0.24));
    const useGauntlet = !useClimb && !useDrop && barIndex > 5 && (barIndex % 10 === 7 || (barEnergy > 0.74 && sectionProgress > 0.34));
    const useBridge = !useClimb && !useDrop && !useGauntlet && barIndex > 4 && (barIndex % 8 === 5 || (barEnergy > 0.76 && sectionProgress > 0.38));
    const useFloatingSteps = !useClimb && !useDrop && !useGauntlet && !useBridge && barIndex > 6 && (barIndex % 11 === 9 || sectionProgress > 0.58);
    const generatedBar = useClimb
      ? buildClimbBar(barBeats, barIndex, sectionProgress, barEnergy)
      : useDrop
        ? buildDropBar(barBeats, barIndex, barEnergy)
        : useGauntlet
          ? buildGauntletBar(barBeats, barIndex, barEnergy)
          : useBridge
            ? buildBridgeBar(barBeats, barIndex, barEnergy)
            : useFloatingSteps
              ? buildFloatingStepsBar(barBeats, barIndex, barEnergy)
              : buildGroundBar(barBeats, barIndex, sectionProgress, barEnergy);
    const energyMoment = createEnergyCameraMoment(barBeats, barEnergy, previousBarEnergy);

    cues.push(...generatedBar.cues);
    obstacles.push(...generatedBar.obstacles);
    lavaZones.push(...generatedBar.lavaZones);
    cameraMoments.push(...generatedBar.cameraMoments);

    if (energyMoment) {
      cameraMoments.push(energyMoment);
    }

    previousBarEnergy = barEnergy;
  }

  return {
    cues,
    obstacles: normalizeObstacles(obstacles, duration),
    lavaZones: normalizeLavaZones(lavaZones, duration),
    cameraMoments: normalizeCameraMoments(cameraMoments),
  };
}

function sampleObstacleHeight(obstacle: Obstacle, relativeX: number) {
  const halfWidth = obstacle.width / 2;

  if (Math.abs(relativeX) >= halfWidth) {
    return obstacle.baseY;
  }

  const spikeWidth = obstacle.width / obstacle.spikes;
  const wrappedX = ((relativeX + halfWidth) % spikeWidth + spikeWidth) % spikeWidth;
  const triangle = 1 - Math.abs((wrappedX / spikeWidth) * 2 - 1);

  return obstacle.baseY + obstacle.height * triangle;
}

function isOverLava(lavaZones: LavaZone[], time: number) {
  for (const zone of lavaZones) {
    if (time < zone.startTime) {
      return false;
    }

    if (time <= zone.endTime) {
      return true;
    }
  }

  return false;
}

function resolveSimulatedCollisions(
  obstacles: Obstacle[],
  lavaZones: LavaZone[],
  time: number,
  previousY: number,
  nextY: number,
  nextVelocity: number,
) {
  const overLava = isOverLava(lavaZones, time);
  const bottomOffset = PLAYER_RADIUS * 0.84;
  const topOffset = PLAYER_RADIUS * 0.72;
  const previousBottom = previousY - bottomOffset;
  const playerBottom = nextY - bottomOffset;
  const playerTop = nextY + topOffset;
  let supportY = overLava ? Number.NEGATIVE_INFINITY : GROUND_Y;
  let grounded = !overLava && nextY <= GROUND_Y;

  if (overLava && playerBottom < LAVA_SURFACE_Y) {
    return {
      crashed: true,
      grounded: false,
      playerY: nextY,
      playerVelocity: nextVelocity,
    };
  }

  for (const obstacle of obstacles) {
    const relativeX = (obstacle.time - time) * RUN_SPEED;
    const horizontalReach = obstacle.width / 2 + PLAYER_RADIUS;

    if (relativeX < -horizontalReach) {
      continue;
    }

    if (relativeX > horizontalReach + 4) {
      break;
    }

    if (obstacle.kind === "spike") {
      if (playerBottom < sampleObstacleHeight(obstacle, relativeX)) {
        return {
          crashed: true,
          grounded: false,
          playerY: nextY,
          playerVelocity: nextVelocity,
        };
      }

      continue;
    }

    const halfWidth = obstacle.width / 2;
    const withinTop = Math.abs(relativeX) < halfWidth + PLAYER_RADIUS * 0.62;
    const withinBody = Math.abs(relativeX) < Math.max(0.12, halfWidth - PLAYER_RADIUS * 0.16);
    const topSurface = obstacle.baseY + obstacle.height;
    const canLand =
      withinTop &&
      nextVelocity <= 0 &&
      previousBottom >= topSurface - 0.06 &&
      playerBottom <= topSurface + 0.18;
    const isStanding =
      withinTop &&
      nextVelocity <= 0.18 &&
      Math.abs(playerBottom - topSurface) <= 0.16;

    if (canLand || isStanding) {
      const candidateY = topSurface + bottomOffset;

      if (candidateY > supportY) {
        supportY = candidateY;
        grounded = true;
      }

      continue;
    }

    if (withinBody && playerBottom < topSurface - 0.04 && playerTop > obstacle.baseY + 0.08) {
      return {
        crashed: true,
        grounded: false,
        playerY: nextY,
        playerVelocity: nextVelocity,
      };
    }
  }

  if (grounded) {
    return {
      crashed: false,
      grounded: true,
      playerY: supportY,
      playerVelocity: 0,
    };
  }

  return {
    crashed: false,
    grounded: false,
    playerY: nextY,
    playerVelocity: nextVelocity,
  };
}

function getCueHoldDuration(action: BeatPoint["action"]) {
  if (action === "hold") {
    return 0.14;
  }

  if (action === "climb") {
    return 0.115;
  }

  if (action === "step") {
    return 0.085;
  }

  if (action === "bridge") {
    return 0.07;
  }

  return 0.036;
}

function simulateLayout(
  cues: BeatPoint[],
  obstacles: Obstacle[],
  lavaZones: LavaZone[],
  duration: number,
) {
  let time = 0;
  let playerY = GROUND_Y;
  let playerVelocity = 0;
  let grounded = true;
  let holdTime = 0;
  let cueIndex = 0;
  let coyoteTime = COYOTE_TIME;

  while (time < duration - 0.08) {
    while (cueIndex < cues.length && cues[cueIndex].time <= time + SIMULATION_STEP * 0.5) {
      if (grounded || coyoteTime > 0) {
        grounded = false;
        playerVelocity = JUMP_VELOCITY;
        holdTime = getCueHoldDuration(cues[cueIndex].action);
        coyoteTime = 0;
      }

      cueIndex += 1;
    }

    const previousY = playerY;

    if (!grounded) {
      let gravity = GRAVITY;

      if (playerVelocity > 0) {
        if (holdTime > 0) {
          gravity *= HOLD_JUMP_GRAVITY_MULTIPLIER;
          holdTime = Math.max(0, holdTime - SIMULATION_STEP);
        } else {
          gravity *= LOW_JUMP_GRAVITY_MULTIPLIER;
        }
      } else {
        gravity *= FALL_GRAVITY_MULTIPLIER;
      }

      playerVelocity -= gravity * SIMULATION_STEP;
      playerY += playerVelocity * SIMULATION_STEP;
    } else if (playerY <= GROUND_Y + 0.001) {
      playerY = GROUND_Y;
      playerVelocity = 0;
      holdTime = 0;
    }

    const collisionResult = resolveSimulatedCollisions(
      obstacles,
      lavaZones,
      time,
      previousY,
      playerY,
      playerVelocity,
    );

    playerY = collisionResult.playerY;
    playerVelocity = collisionResult.playerVelocity;
    grounded = collisionResult.grounded;
    coyoteTime = grounded ? COYOTE_TIME : Math.max(0, coyoteTime - SIMULATION_STEP);

    if (collisionResult.crashed) {
      return {
        time,
        obstacleWindowStart: Math.max(0, time - 0.28),
        obstacleWindowEnd: time + 0.48,
      };
    }

    time += SIMULATION_STEP;
  }

  return null;
}

function repairObstaclesNearCrash(obstacles: Obstacle[], crashWindowStart: number, crashWindowEnd: number) {
  let changed = false;
  const nextObstacles = obstacles.map((obstacle) => {
    if (obstacleEndTime(obstacle) < crashWindowStart || obstacleStartTime(obstacle) > crashWindowEnd) {
      return obstacle;
    }

    changed = true;

    if (obstacle.kind === "spike") {
      return {
        ...obstacle,
        width: clamp(obstacle.width * 0.92, 1.48, 4.02),
        height: clamp(obstacle.height * 0.88, 1.36, 2.12),
        spikes: Math.max(1, obstacle.spikes - (obstacle.spikes > 1 ? 1 : 0)),
        time: obstacle.time + 0.028,
      };
    }

    return {
      ...obstacle,
      width: clamp(obstacle.width + 0.38, 3.8, 6.8),
      height: clamp(obstacle.height - 0.18, 1.06, 2.24),
    };
  });

  return {
    obstacles: nextObstacles,
    changed,
  };
}

function repairLavaZonesNearCrash(lavaZones: LavaZone[], crashTime: number) {
  let changed = false;
  const nextZones = lavaZones.map((zone) => {
    if (crashTime < zone.startTime - 0.2 || crashTime > zone.endTime + 0.2) {
      return zone;
    }

    changed = true;

    return {
      ...zone,
      startTime: zone.startTime + 0.05,
      endTime: zone.endTime - 0.06,
    };
  });

  return {
    lavaZones: nextZones,
    changed,
  };
}

function repairLayout(
  cues: BeatPoint[],
  obstacles: Obstacle[],
  lavaZones: LavaZone[],
  duration: number,
) {
  let repairedObstacles = [...obstacles];
  let repairedLavaZones = [...lavaZones];

  for (let iteration = 0; iteration < 24; iteration += 1) {
    const crash = simulateLayout(cues, repairedObstacles, repairedLavaZones, duration);

    if (!crash) {
      return {
        obstacles: normalizeObstacles(repairedObstacles, duration),
        lavaZones: normalizeLavaZones(repairedLavaZones, duration),
      };
    }

    const obstacleRepair = repairObstaclesNearCrash(
      repairedObstacles,
      crash.obstacleWindowStart,
      crash.obstacleWindowEnd,
    );
    const lavaRepair = repairLavaZonesNearCrash(repairedLavaZones, crash.time);

    repairedObstacles = obstacleRepair.obstacles;
    repairedLavaZones = lavaRepair.lavaZones;

    if (!obstacleRepair.changed && !lavaRepair.changed) {
      break;
    }
  }

  return {
    obstacles: normalizeObstacles(repairedObstacles, duration),
    lavaZones: normalizeLavaZones(repairedLavaZones, duration),
  };
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
  const gridBeats = createJumpTimeline(detectedBeats, buffer.duration, beatInterval);
  const layout = buildLevelLayout(gridBeats, buffer.duration);
  const repairedLayout = repairLayout(
    layout.cues,
    layout.obstacles,
    layout.lavaZones,
    buffer.duration,
  );

  return {
    duration: buffer.duration,
    beatInterval,
    waveform: sampleBuckets(mono, WAVEFORM_BAR_COUNT),
    energyCurve: sampleBuckets(smoothedEnergy, ENERGY_SAMPLE_COUNT),
    beats: layout.cues,
    obstacles: repairedLayout.obstacles,
    lavaZones: repairedLayout.lavaZones,
    cameraMoments: layout.cameraMoments,
  };
}
