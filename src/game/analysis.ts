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
import type {
  BeatPoint,
  CameraMoment,
  LavaZone,
  LevelData,
  Obstacle,
  TrackId,
} from "./types";

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
type SectionType = "ground" | "climb" | "drop" | "bridge" | "gauntlet" | "floating" | "tower";

interface GroundPatternPhase {
  untilProgress: number;
  patterns: ObstacleToken[][];
}

interface SectionPhase {
  untilProgress: number;
  cycle: SectionType[];
  accentCycle: SectionType[];
  lavaFloor: number;
  accentEnergy: number;
}

interface TrackProfile {
  id: TrackId;
  introGroundPatterns: ObstacleToken[][][];
  groundPatternPhases: GroundPatternPhase[];
  sectionPhases: SectionPhase[];
  energyCameraStyles: CameraMoment["style"][];
}

const DOWNBOY_PROFILE: TrackProfile = {
  id: "downboy",
  introGroundPatterns: [
    [
      [null, "tap", null, null, "tap", null, "step", null],
      [null, "tap", null, "tap", null, null, "step", null],
    ],
    [
      ["tap", null, "tap", null, "step", null, "bridge", null],
      [null, "tap", "step", null, "tap", null, "bridge", null],
    ],
    [
      ["tap", null, "step", null, "tap", null, "hold", null],
      [null, "tap", "step", null, "bridge", null, "tap", null],
    ],
  ],
  groundPatternPhases: [
    {
      untilProgress: 0.24,
      patterns: [
        ["tap", null, "step", null, "tap", null, "bridge", null],
        [null, "tap", "step", null, "tap", null, "step", null],
        ["tap", null, "tap", null, "step", null, "bridge", null],
      ],
    },
    {
      untilProgress: 0.7,
      patterns: [
        ["tap", null, "step", null, "hold", null, "bridge", null],
        [null, "tap", "step", null, "hold", null, "step", null],
        ["step", null, "tap", null, "hold", null, "bridge", null],
      ],
    },
    {
      untilProgress: 1.01,
      patterns: [
        ["tap", null, "hold", null, "step", null, "hold", null],
        ["step", null, "tap", null, "hold", null, "bridge", null],
        ["tap", null, "step", null, "hold", null, "hold", null],
      ],
    },
  ],
  sectionPhases: [
    {
      untilProgress: 0.2,
      cycle: ["ground", "ground", "climb", "ground", "bridge"],
      accentCycle: ["climb", "bridge"],
      lavaFloor: 1,
      accentEnergy: 0.72,
    },
    {
      untilProgress: 0.48,
      cycle: ["ground", "climb", "bridge", "ground", "drop"],
      accentCycle: ["climb", "bridge", "tower"],
      lavaFloor: 0.3,
      accentEnergy: 0.7,
    },
    {
      untilProgress: 0.78,
      cycle: ["climb", "bridge", "drop", "ground", "tower"],
      accentCycle: ["tower", "gauntlet", "bridge"],
      lavaFloor: 0.36,
      accentEnergy: 0.74,
    },
    {
      untilProgress: 1.01,
      cycle: ["tower", "gauntlet", "drop", "floating", "bridge"],
      accentCycle: ["tower", "gauntlet", "floating"],
      lavaFloor: 0.28,
      accentEnergy: 0.76,
    },
  ],
  energyCameraStyles: ["rear", "rush", "sweep", "hero"],
};

const FOUND_DA_PROFILE: TrackProfile = {
  id: "found-da",
  introGroundPatterns: [
    [
      [null, "tap", null, "step", null, "tap", null, "step"],
      [null, "tap", null, null, "step", null, "tap", null],
    ],
    [
      ["step", null, "tap", null, "step", null, "bridge", null],
      [null, "tap", "step", null, "bridge", null, "tap", null],
    ],
    [
      ["tap", null, "step", null, "bridge", null, "tap", null],
      [null, "step", null, "tap", null, "step", null, "bridge"],
    ],
  ],
  groundPatternPhases: [
    {
      untilProgress: 0.22,
      patterns: [
        ["tap", null, "step", null, "bridge", null, "tap", null],
        [null, "tap", "step", null, "step", null, "bridge", null],
        ["step", null, "tap", null, "bridge", null, "tap", null],
      ],
    },
    {
      untilProgress: 0.68,
      patterns: [
        ["step", null, "tap", null, "bridge", null, "hold", null],
        [null, "tap", "bridge", null, "step", null, "hold", null],
        ["tap", null, "step", null, "bridge", null, "step", null],
      ],
    },
    {
      untilProgress: 1.01,
      patterns: [
        ["bridge", null, "hold", null, "step", null, "hold", null],
        ["step", null, "bridge", null, "hold", null, "tap", null],
        ["tap", null, "bridge", null, "hold", null, "step", null],
      ],
    },
  ],
  sectionPhases: [
    {
      untilProgress: 0.18,
      cycle: ["ground", "ground", "climb", "drop"],
      accentCycle: ["climb"],
      lavaFloor: 1,
      accentEnergy: 0.7,
    },
    {
      untilProgress: 0.42,
      cycle: ["climb", "floating", "ground", "drop", "bridge"],
      accentCycle: ["tower", "floating", "drop"],
      lavaFloor: 0.34,
      accentEnergy: 0.7,
    },
    {
      untilProgress: 0.74,
      cycle: ["tower", "drop", "climb", "bridge", "ground", "floating"],
      accentCycle: ["tower", "gauntlet", "drop"],
      lavaFloor: 0.26,
      accentEnergy: 0.74,
    },
    {
      untilProgress: 1.01,
      cycle: ["tower", "gauntlet", "tower", "floating", "drop", "bridge"],
      accentCycle: ["tower", "gauntlet", "floating"],
      lavaFloor: 0.22,
      accentEnergy: 0.76,
    },
  ],
  energyCameraStyles: ["hero", "sweep", "rear", "rush"],
};

function getTrackProfile(trackId: TrackId): TrackProfile {
  if (trackId === "found-da") {
    return FOUND_DA_PROFILE;
  }

  if (trackId === "downboy") {
    return DOWNBOY_PROFILE;
  }

  return DOWNBOY_PROFILE;
}

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

function getGroundPatternPool(profile: TrackProfile, sectionProgress: number, barIndex: number) {
  if (barIndex < profile.introGroundPatterns.length) {
    return profile.introGroundPatterns[barIndex];
  }

  return (
    profile.groundPatternPhases.find((phase) => sectionProgress < phase.untilProgress)?.patterns ??
    profile.groundPatternPhases[profile.groundPatternPhases.length - 1]?.patterns ??
    [[]]
  );
}

function buildGroundBar(
  profile: TrackProfile,
  barBeats: GridBeat[],
  barIndex: number,
  sectionProgress: number,
  barEnergy: number,
) {
  const patternPool = getGroundPatternPool(profile, sectionProgress, barIndex);
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
  useLava: boolean,
) {
  const cueOffsets = [0, 1, 2, 3, 4];
  const topHeights = [
    1.24,
    clamp(1.82 + barEnergy * 0.12, 1.82, 2.02),
    clamp(2.34 + barEnergy * 0.15, 2.34, 2.58),
    clamp(2.88 + sectionProgress * 0.16 + barEnergy * 0.1, 2.88, 3.24),
    1.32 + sectionProgress * 0.06,
  ];
  const widths = [6.1, 5.6, 5.3, 5.1, 6.2];
  const thicknesses = [1.24, 0.46, 0.42, 0.38, 1.24];
  const cues = cueOffsets.map((offset, index) =>
    createCue(
      barBeats[offset],
      index === 0 || index === cueOffsets.length - 1 ? "step" : "climb",
      index - 2,
    ),
  );
  const obstacles = cueOffsets.map((offset, index) =>
    createPlatformBlock(
      barBeats[offset],
      barIndex * BAR_BEAT_COUNT + offset,
      widths[index],
      topHeights[index],
      thicknesses[index],
      0.14 + index * 0.006,
      164,
      0.64 + barEnergy * 0.18,
    ),
  );
  const lavaZone = useLava
    ? createLavaZoneForObstacles(
        obstacles,
        0.68 + barEnergy * 0.22,
        12 + ((barIndex * 9) % 22),
        0.1,
        0.46,
      )
    : null;

  return {
    cues,
    obstacles,
    lavaZones: lavaZone ? [lavaZone] : [],
    cameraMoments: [
      {
        time: barBeats[2]?.time ?? barBeats[0].time,
        duration: 1.0,
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
  useLava: boolean,
) {
  const cueOffsets = [0, 1, 2, 3, 4];
  const topHeights = [
    1.38,
    clamp(2.48 + barEnergy * 0.14, 2.48, 2.72),
    clamp(2.06 + barEnergy * 0.1, 2.06, 2.24),
    1.62,
    1.22,
  ];
  const widths = [5.9, 5.0, 4.9, 5.2, 6.1];
  const thicknesses = [1.08, 0.42, 0.4, 0.4, 1.22];
  const cues = cueOffsets.map((offset, index) =>
    createCue(
      barBeats[offset],
      index === 1 ? "climb" : "step",
      2 - index,
    ),
  );
  const obstacles = cueOffsets.map((offset, index) =>
    createPlatformBlock(
      barBeats[offset],
      barIndex * BAR_BEAT_COUNT + offset,
      widths[index],
      topHeights[index],
      thicknesses[index],
      0.14 + index * 0.006,
      202,
      0.54 + barEnergy * 0.16,
    ),
  );
  const lavaZone = useLava
    ? createLavaZoneForObstacles(
        obstacles,
        0.58 + barEnergy * 0.16,
        18 + ((barIndex * 7) % 18),
        0.08,
        0.42,
      )
    : null;

  return {
    cues,
    obstacles,
    lavaZones: lavaZone ? [lavaZone] : [],
    cameraMoments: [
      {
        time: barBeats[1]?.time ?? barBeats[0].time,
        duration: 0.86,
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
  useLava: boolean,
) {
  const topHeights = [1.34, 1.94, 1.28];
  const widths = [6.3, 5.4, 6.2];
  const thicknesses = [1.12, 0.42, 1.18];
  const cues = [
    createCue(barBeats[0], "bridge", 0),
    createCue(barBeats[1], "climb", 1),
    createCue(barBeats[2], "tap", 2),
  ];
  const platformOne = createPlatformBlock(
    barBeats[0],
    barIndex * BAR_BEAT_COUNT,
    widths[0],
    topHeights[0],
    thicknesses[0],
    0.14,
    188,
    0.58 + barEnergy * 0.18,
  );
  const platformTwo = createPlatformBlock(
    barBeats[1],
    barIndex * BAR_BEAT_COUNT + 1,
    widths[1],
    topHeights[1],
    thicknesses[1],
    0.14,
    196,
    0.6 + barEnergy * 0.18,
  );
  const exitPlatform = createPlatformBlock(
    barBeats[2],
    barIndex * BAR_BEAT_COUNT + 2,
    widths[2],
    topHeights[2],
    thicknesses[2],
    0.14,
    202,
    0.52 + barEnergy * 0.16,
  );
  const platformSpike = createPlatformSpike(
    barBeats[2],
    barIndex * BAR_BEAT_COUNT + 102,
    1.22,
    0.96,
    1,
    0.08,
    16,
    0.72 + barEnergy * 0.16,
    topHeights[1] - 0.02,
  );
  const obstacles = [
    platformOne,
    platformTwo,
    exitPlatform,
    platformSpike,
  ];
  const lavaZone = useLava
    ? createLavaZoneForObstacles(
        [platformOne, platformTwo, exitPlatform],
        0.58 + barEnergy * 0.18,
        18 + ((barIndex * 11) % 18),
        0.08,
        0.4,
      )
    : null;

  return {
    cues,
    obstacles,
    lavaZones: lavaZone ? [lavaZone] : [],
    cameraMoments: [
      {
        time: barBeats[1]?.time ?? barBeats[0].time,
        duration: 0.82,
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
  useLava: boolean,
) {
  const platformOne = createPlatformBlock(
    barBeats[0],
    barIndex * BAR_BEAT_COUNT,
    6.6,
    1.42,
    1.04,
    0.14,
    172,
    0.62 + barEnergy * 0.18,
  );
  const midStep = createPlatformBlock(
    barBeats[1],
    barIndex * BAR_BEAT_COUNT + 1,
    5.2,
    2.46,
    0.38,
    0.14,
    184,
    0.56 + barEnergy * 0.16,
  );
  const highStep = createPlatformBlock(
    barBeats[2],
    barIndex * BAR_BEAT_COUNT + 2,
    5.0,
    3.04,
    0.36,
    0.14,
    190,
    0.58 + barEnergy * 0.16,
  );
  const platformSpike = createPlatformSpike(
    barBeats[3],
    barIndex * BAR_BEAT_COUNT + 103,
    1.24,
    0.98,
    1,
    0.08,
    14,
    0.74 + barEnergy * 0.18,
    3.04,
  );
  const exitPlatform = createPlatformBlock(
    barBeats[4],
    barIndex * BAR_BEAT_COUNT + 4,
    6.0,
    1.26,
    1.26,
    0.14,
    196,
    0.52 + barEnergy * 0.14,
  );
  const lavaZone = useLava
    ? createLavaZoneForObstacles(
        [platformOne, midStep, highStep, exitPlatform],
        0.7 + barEnergy * 0.16,
        10 + ((barIndex * 5) % 26),
        0.08,
        0.44,
      )
    : null;

  return {
    cues: [
      createCue(barBeats[0], "step", 0),
      createCue(barBeats[1], "climb", 1),
      createCue(barBeats[2], "climb", 2),
      createCue(barBeats[3], "tap", 1),
    ],
    obstacles: [platformOne, midStep, highStep, platformSpike, exitPlatform],
    lavaZones: lavaZone ? [lavaZone] : [],
    cameraMoments: [
      {
        time: barBeats[2]?.time ?? barBeats[0].time,
        duration: 0.92,
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
  useLava: boolean,
) {
  const cueOffsets = [0, 1, 2, 3, 4];
  const topHeights = [1.4, 2.04, 2.62, 2.18, 1.28];
  const widths = [5.7, 5.0, 4.8, 4.9, 6.0];
  const thicknesses = [1.04, 0.36, 0.34, 0.34, 1.18];
  const obstacles = cueOffsets.map((offset, index) =>
    createPlatformBlock(
      barBeats[offset],
      barIndex * BAR_BEAT_COUNT + offset,
      widths[index],
      topHeights[index],
      thicknesses[index],
      0.14 + index * 0.006,
      204,
      0.5 + barEnergy * 0.14,
    ),
  );
  const lavaZone = useLava
    ? createLavaZoneForObstacles(
        obstacles,
        0.62 + barEnergy * 0.14,
        20 + ((barIndex * 9) % 14),
        0.08,
        0.42,
      )
    : null;

  return {
    cues: cueOffsets.map((offset, index) =>
      createCue(
        barBeats[offset],
        index === 0 || index === cueOffsets.length - 1 ? "step" : "climb",
        2 - index,
      ),
    ),
    obstacles,
    lavaZones: lavaZone ? [lavaZone] : [],
    cameraMoments: [
      {
        time: barBeats[2]?.time ?? barBeats[0].time,
        duration: 0.82,
        strength: 0.62 + barEnergy * 0.12,
        style: "hero",
      },
    ],
  } satisfies GeneratedBar;
}

function buildTowerBar(
  barBeats: GridBeat[],
  barIndex: number,
  sectionProgress: number,
  barEnergy: number,
  useLava: boolean,
) {
  const cueOffsets = [0, 1, 2, 3, 4, 5];
  const topHeights = [
    1.26,
    clamp(1.96 + barEnergy * 0.12, 1.96, 2.14),
    clamp(2.52 + barEnergy * 0.14, 2.52, 2.72),
    clamp(3.02 + sectionProgress * 0.18 + barEnergy * 0.1, 3.02, 3.32),
    clamp(3.34 + sectionProgress * 0.2 + barEnergy * 0.1, 3.34, 3.58),
    1.36,
  ];
  const widths = [6.2, 5.6, 5.2, 4.9, 4.7, 6.3];
  const thicknesses = [1.22, 0.44, 0.4, 0.36, 0.34, 1.2];
  const obstacles = cueOffsets.map((offset, index) =>
    createPlatformBlock(
      barBeats[offset],
      barIndex * BAR_BEAT_COUNT + offset,
      widths[index],
      topHeights[index],
      thicknesses[index],
      0.14 + index * 0.004,
      176,
      0.56 + barEnergy * 0.16,
    ),
  );
  const crestSpike = createPlatformSpike(
    barBeats[5],
    barIndex * BAR_BEAT_COUNT + 105,
    1.16,
    0.9,
    1,
    0.08,
    16,
    0.72 + barEnergy * 0.16,
    topHeights[4] - 0.02,
  );
  const lavaZone = useLava
    ? createLavaZoneForObstacles(
        obstacles,
        0.72 + barEnergy * 0.18,
        14 + ((barIndex * 13) % 18),
        0.1,
        0.48,
      )
    : null;

  return {
    cues: cueOffsets.map((offset, index) =>
      createCue(
        barBeats[offset],
        index === cueOffsets.length - 1 ? "tap" : index < 2 ? "step" : "climb",
        2 - index,
      ),
    ),
    obstacles: [...obstacles, crestSpike],
    lavaZones: lavaZone ? [lavaZone] : [],
    cameraMoments: [
      {
        time: barBeats[3]?.time ?? barBeats[0].time,
        duration: 1.08,
        strength: 0.72 + barEnergy * 0.14,
        style: "rear",
      },
      {
        time: barBeats[5]?.time ?? barBeats[4].time,
        duration: 0.74,
        strength: 0.7 + barEnergy * 0.12,
        style: "rush",
      },
    ],
  } satisfies GeneratedBar;
}

function createEnergyCameraMoment(
  profile: TrackProfile,
  barBeats: GridBeat[],
  barIndex: number,
  sectionProgress: number,
  currentEnergy: number,
  previousEnergy: number,
) {
  const threshold = clamp(0.68 + sectionProgress * 0.1, 0.68, 0.8);

  if (currentEnergy < threshold || currentEnergy < previousEnergy + 0.06) {
    return null;
  }

  return {
    time: barBeats[2]?.time ?? barBeats[0].time,
    duration: clamp(0.58 + sectionProgress * 0.24, 0.58, 0.86),
    strength: clamp(currentEnergy * 0.92, 0.68, 1),
    style:
      profile.energyCameraStyles[(barIndex + Math.round(sectionProgress * 10)) % profile.energyCameraStyles.length] ??
      "hero",
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

function minimumObstacleWidth(obstacle: Obstacle) {
  return obstacle.kind === "spike"
    ? Math.max(1.16, obstacle.spikes * 0.56)
    : 2.3;
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
        const maxAllowedWidth = (obstacle.time - (previousEnd + 0.02)) * RUN_SPEED * 2;
        const minimumWidth = minimumObstacleWidth(obstacle);

        if (maxAllowedWidth < minimumWidth) {
          continue;
        }

        nextObstacle = {
          ...obstacle,
          width: Math.min(obstacle.width, maxAllowedWidth),
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

function getSectionPhase(profile: TrackProfile, sectionProgress: number) {
  return (
    profile.sectionPhases.find((phase) => sectionProgress < phase.untilProgress) ??
    profile.sectionPhases[profile.sectionPhases.length - 1]
  );
}

function chooseSectionType(
  profile: TrackProfile,
  barIndex: number,
  sectionProgress: number,
  barEnergy: number,
  previousBarEnergy: number,
  recentSections: SectionType[],
) {
  if (barIndex < 2) {
    return "ground";
  }

  const phase = getSectionPhase(profile, sectionProgress);
  const candidatePool =
    phase.accentCycle.length > 0 && barEnergy >= phase.accentEnergy && barEnergy >= previousBarEnergy - 0.02
      ? phase.accentCycle
      : phase.cycle;
  const seed = barIndex + Math.round(barEnergy * 8) + Math.round(sectionProgress * 5);
  let candidate = candidatePool[seed % candidatePool.length] ?? "ground";

  if (sectionProgress < 0.2 && (candidate === "gauntlet" || candidate === "tower")) {
    candidate = "climb";
  }

  if (sectionProgress < 0.14 && candidate === "floating") {
    candidate = "ground";
  }

  if (
    candidate !== "ground" &&
    recentSections.length >= 2 &&
    recentSections.slice(-2).every((section) => section === candidate)
  ) {
    const fallbackPool = [...phase.cycle, ...phase.accentCycle];
    const alternative = fallbackPool.find((section) => section !== candidate);

    if (alternative) {
      candidate = alternative;
    }
  }

  return candidate;
}

function buildLevelLayout(gridBeats: GridBeat[], duration: number, trackId: TrackId) {
  const profile = getTrackProfile(trackId);
  const cues: BeatPoint[] = [];
  const obstacles: Obstacle[] = [];
  const lavaZones: LavaZone[] = [];
  const cameraMoments: CameraMoment[] = [];
  let previousBarEnergy = 0.4;
  const recentSections: SectionType[] = [];

  for (let barStart = 0; barStart < gridBeats.length; barStart += BAR_BEAT_COUNT) {
    const barBeats = gridBeats.slice(barStart, barStart + BAR_BEAT_COUNT);

    if (barBeats.length < BAR_BEAT_COUNT) {
      break;
    }

    const barIndex = Math.floor(barStart / BAR_BEAT_COUNT);
    const sectionProgress = barStart / Math.max(1, gridBeats.length - 1);
    const barEnergy =
      barBeats.reduce((total, beat) => total + beat.strength, 0) / Math.max(1, barBeats.length);
    const sectionPhase = getSectionPhase(profile, sectionProgress);
    const sectionType = chooseSectionType(
      profile,
      barIndex,
      sectionProgress,
      barEnergy,
      previousBarEnergy,
      recentSections,
    );
    const useLava = sectionProgress >= sectionPhase.lavaFloor && sectionType !== "ground";
    const generatedBar =
      sectionType === "climb"
        ? buildClimbBar(barBeats, barIndex, sectionProgress, barEnergy, useLava)
        : sectionType === "drop"
          ? buildDropBar(barBeats, barIndex, barEnergy, useLava)
          : sectionType === "gauntlet"
            ? buildGauntletBar(barBeats, barIndex, barEnergy, true)
            : sectionType === "bridge"
              ? buildBridgeBar(barBeats, barIndex, barEnergy, useLava)
              : sectionType === "floating"
                ? buildFloatingStepsBar(barBeats, barIndex, barEnergy, useLava)
                : sectionType === "tower"
                  ? buildTowerBar(barBeats, barIndex, sectionProgress, barEnergy, useLava)
                  : buildGroundBar(profile, barBeats, barIndex, sectionProgress, barEnergy);
    const energyMoment = createEnergyCameraMoment(
      profile,
      barBeats,
      barIndex,
      sectionProgress,
      barEnergy,
      previousBarEnergy,
    );

    cues.push(...generatedBar.cues);
    obstacles.push(...generatedBar.obstacles);
    lavaZones.push(...generatedBar.lavaZones);
    cameraMoments.push(...generatedBar.cameraMoments);

    if (energyMoment) {
      cameraMoments.push(energyMoment);
    }

    recentSections.push(sectionType);

    if (recentSections.length > 3) {
      recentSections.shift();
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

export function analyzeAudioBuffer(buffer: AudioBuffer, trackId: TrackId = "default"): LevelData {
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
  const layout = buildLevelLayout(gridBeats, buffer.duration, trackId);
  const repairedLayout = repairLayout(
    layout.cues,
    layout.obstacles,
    layout.lavaZones,
    buffer.duration,
  );

  return {
    trackId,
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
