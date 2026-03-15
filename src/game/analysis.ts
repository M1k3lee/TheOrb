import {
  COYOTE_TIME,
  FALL_GRAVITY_MULTIPLIER,
  GRAVITY,
  GROUND_Y,
  HOLD_JUMP_GRAVITY_MULTIPLIER,
  JUMP_VELOCITY,
  LOW_JUMP_GRAVITY_MULTIPLIER,
  PLAYER_COLLISION_RADIUS,
  RUN_SPEED,
} from "./constants";
import type {
  BeatPoint,
  CameraMoment,
  LavaZone,
  LevelData,
  LevelSection,
  LevelSectionKind,
  LevelSectionTheme,
  Obstacle,
  TrackId,
} from "./types";

const WAVEFORM_BAR_COUNT = 240;
const ENERGY_SAMPLE_COUNT = 320;
const BAR_BEAT_COUNT = 8;
const LAVA_SURFACE_Y = 0.22;
const SIMULATION_STEP = 1 / 180;
const PLAYER_COLLISION_HEIGHT = PLAYER_COLLISION_RADIUS * (0.84 + 0.72);
const MIN_STACK_PASSAGE_HEIGHT = PLAYER_COLLISION_HEIGHT + 0.14;
const OVERHEAD_ESCAPE_TIME = 0.11;
const OVERHEAD_JUMP_ASCENT =
  JUMP_VELOCITY * OVERHEAD_ESCAPE_TIME -
  0.5 * GRAVITY * HOLD_JUMP_GRAVITY_MULTIPLIER * OVERHEAD_ESCAPE_TIME * OVERHEAD_ESCAPE_TIME;
const TARGET_OVERHEAD_PASSAGE_HEIGHT = PLAYER_COLLISION_HEIGHT + OVERHEAD_JUMP_ASCENT + 0.12;
const MAX_DECEPTIVE_PLATFORM_TOP_Y = GROUND_Y + PLAYER_COLLISION_RADIUS * 0.72 + 0.14;

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
type SectionType = LevelSectionKind;

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
  obstacleLeadBias: number;
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
      cycle: ["ground", "climb", "bridge", "ground", "drop", "floating"],
      accentCycle: ["climb", "bridge", "tower"],
      lavaFloor: 0.3,
      accentEnergy: 0.7,
    },
    {
      untilProgress: 0.78,
      cycle: ["climb", "bridge", "drop", "ground", "tower", "descent"],
      accentCycle: ["tower", "gauntlet", "space"],
      lavaFloor: 0.36,
      accentEnergy: 0.74,
    },
    {
      untilProgress: 1.01,
      cycle: ["tower", "gauntlet", "drop", "floating", "bridge", "space", "descent"],
      accentCycle: ["tower", "gauntlet", "space", "descent"],
      lavaFloor: 0.28,
      accentEnergy: 0.76,
    },
  ],
  energyCameraStyles: ["rear", "rush", "sweep", "hero"],
  obstacleLeadBias: 0.042,
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
      cycle: ["climb", "floating", "ground", "drop", "bridge", "descent"],
      accentCycle: ["tower", "floating", "drop"],
      lavaFloor: 0.34,
      accentEnergy: 0.7,
    },
    {
      untilProgress: 0.74,
      cycle: ["tower", "drop", "climb", "bridge", "ground", "floating", "space"],
      accentCycle: ["tower", "gauntlet", "drop", "space"],
      lavaFloor: 0.26,
      accentEnergy: 0.74,
    },
    {
      untilProgress: 1.01,
      cycle: ["tower", "gauntlet", "tower", "floating", "drop", "bridge", "space", "descent"],
      accentCycle: ["tower", "gauntlet", "floating", "space"],
      lavaFloor: 0.22,
      accentEnergy: 0.76,
    },
  ],
  energyCameraStyles: ["hero", "sweep", "rear", "rush"],
  obstacleLeadBias: 0.026,
};

const SECTION_THEME_POOLS: Record<SectionType, LevelSectionTheme[]> = {
  ground: ["pulse", "solar"],
  climb: ["prism", "citadel"],
  drop: ["void", "solar"],
  bridge: ["sky", "pulse"],
  gauntlet: ["forge", "void"],
  floating: ["sky", "prism"],
  tower: ["citadel", "forge"],
  space: ["void", "sky"],
  descent: ["solar", "forge"],
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

function getTrackThemeOffset(profile: TrackProfile) {
  return profile.id === "found-da" ? 1 : 0;
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

function findBestGridPhase(
  beats: GridBeat[],
  duration: number,
  interval: number,
  startTime: number,
  endTime: number,
) {
  const phaseStepCount = 24;
  const phaseStep = interval / phaseStepCount;
  const scoringWindow = interval * 0.18;
  let bestPhase = startTime % interval;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let phaseIndex = 0; phaseIndex < phaseStepCount; phaseIndex += 1) {
    const phase = phaseIndex * phaseStep;
    let score = 0;

    for (const beat of beats) {
      if (beat.time < startTime - interval || beat.time > endTime + interval) {
        continue;
      }

      const nearestGridIndex = Math.round((beat.time - phase) / interval);
      const alignedTime = phase + nearestGridIndex * interval;
      const distance = Math.abs(beat.time - alignedTime);

      if (distance > scoringWindow) {
        continue;
      }

      const centeredBonus = beat.time >= startTime && beat.time <= endTime ? 0.22 : 0.08;
      score += beat.strength * (1 - distance / scoringWindow) + centeredBonus;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  return bestPhase;
}

function createJumpTimeline(beats: GridBeat[], duration: number, interval: number) {
  const timeline: GridBeat[] = [];
  const start = 0.82;
  const end = duration - 1.55;
  const bestPhase = findBestGridPhase(beats, duration, interval, start, end);
  let cursor = bestPhase;

  while (cursor + interval < start - 0.02) {
    cursor += interval;
  }

  while (cursor > start + 0.02) {
    cursor -= interval;
  }

  if (cursor < start - interval * 0.4) {
    cursor += interval;
  }

  while (cursor <= end) {
    let nearestBeat: GridBeat | null = null;
    let nearestDistance = interval * 0.18;

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
  leadBias = 0,
) {
  return {
    kind: "spike" as const,
    time: createObstacleCenterTime(beat.time + frontDelay + leadBias, width),
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
  leadBias = 0,
) {
  return {
    kind: "block" as const,
    time: createObstacleCenterTime(beat.time + frontDelay + leadBias, width),
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
  leadBias = 0,
) {
  const safeThickness = clamp(thickness, 0.32, 1.8);
  const safeTopY = Math.max(safeThickness + 0.16, topY);
  const baseY =
    safeTopY <= MAX_DECEPTIVE_PLATFORM_TOP_Y
      ? 0
      : safeTopY - safeThickness;

  return createBlockObstacle(
    beat,
    index,
    width,
    safeThickness,
    frontDelay,
    hueBase,
    glow,
    baseY,
    leadBias,
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
  leadBias = 0,
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
    leadBias,
  );
}

function createCeilingBeamObstacle(
  beat: GridBeat,
  index: number,
  width: number,
  height: number,
  baseY: number,
  frontDelay: number,
  hueBase: number,
  glow: number,
  leadBias = 0,
) {
  return createBlockObstacle(
    beat,
    index,
    clamp(width, 2.2, 6.8),
    clamp(height, 0.34, 0.82),
    frontDelay,
    hueBase,
    glow,
    clamp(baseY, 2.42, 6.8),
    leadBias,
  );
}

function buildVaultGateObstacles(
  beat: GridBeat,
  index: number,
  accent: number,
  leadBias: number,
) {
  const blockWidth = clamp(2.24 + accent * 0.36, 2.24, 2.86);
  const blockHeight = clamp(1.18 + accent * 0.12, 1.18, 1.42);
  const beamWidth = clamp(3.16 + accent * 0.46, 3.16, 3.88);
  const beamBaseY = blockHeight + TARGET_OVERHEAD_PASSAGE_HEIGHT;

  return [
    createBlockObstacle(beat, index, blockWidth, blockHeight, 0.148, 168, 0.58 + accent * 0.14, 0, leadBias),
    createCeilingBeamObstacle(beat, index + 4000, beamWidth, 0.42, beamBaseY, 0.17, 206, 0.48 + accent * 0.14, leadBias),
  ];
}

function buildTokenObstacles(
  token: Exclude<ObstacleToken, null>,
  beat: GridBeat,
  index: number,
  sectionProgress: number,
  barEnergy: number,
  leadBias: number,
) {
  const accent = clamp(beat.strength * 0.72 + barEnergy * 0.28 + sectionProgress * 0.18, 0.34, 1);

  if (token === "tap") {
    const spikes = sectionProgress > 0.58 && accent > 0.78 ? 2 : 1;
    const width = clamp(1.64 + spikes * 0.34 + accent * 0.14, 1.64, 2.28);
    const height = clamp(1.56 + spikes * 0.14 + accent * 0.12, 1.56, 1.98);

    return [
      createSpikeObstacle(beat, index, width, height, spikes, 0.1, 18, 0.58 + accent * 0.18, 0, leadBias),
    ];
  }

  if (token === "hold") {
    const spikes = sectionProgress > 0.82 && accent > 0.82 ? 3 : 2;
    const width = clamp(3.16 + spikes * 0.3 + accent * 0.24, 3.22, 4.18);
    const height = clamp(1.86 + spikes * 0.14 + accent * 0.16, 1.94, 2.34);

    return [
      createSpikeObstacle(beat, index, width, height, spikes, 0.148, 10, 0.7 + accent * 0.18, 0, leadBias),
    ];
  }

  if (token === "step") {
    if (sectionProgress > 0.34 && accent > 0.7 && index % 7 === 3) {
      return buildVaultGateObstacles(beat, index, accent, leadBias);
    }

    const width = clamp(3.7 + accent * 0.42, 3.7, 4.4);
    const height = clamp(1.18 + accent * 0.18, 1.18, 1.52);

    return [
      createBlockObstacle(beat, index, width, height, 0.16, 178, 0.5 + accent * 0.18, 0, leadBias),
    ];
  }

  const width = clamp(5.18 + accent * 0.62, 5.18, 6.2);
  const height = clamp(1.2 + accent * 0.14, 1.2, 1.48);

  return [
    createBlockObstacle(beat, index, width, height, 0.18, 194, 0.54 + accent * 0.2, 0, leadBias),
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
  leadBias: number,
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
    obstacles.push(
      ...buildTokenObstacles(
        token,
        beat,
        barIndex * BAR_BEAT_COUNT + beatOffset,
        sectionProgress,
        barEnergy,
        leadBias,
      ),
    );
  }

  return {
    cues,
    obstacles,
    lavaZones: [],
    cameraMoments: [],
  } satisfies GeneratedBar;
}

function createHazardZoneForObstacles(
  obstacles: Obstacle[],
  intensity: number,
  hue: number,
  leadTrim: number,
  trailTrim: number,
  surface: LavaZone["surface"] = "lava",
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
    surface,
  } satisfies LavaZone;
}

function buildClimbBar(
  barBeats: GridBeat[],
  barIndex: number,
  sectionProgress: number,
  barEnergy: number,
  useLava: boolean,
  leadBias: number,
) {
  const cueOffsets = [0, 1, 2, 3, 4];
  const topHeights = [
    1.28,
    clamp(2.16 + barEnergy * 0.14, 2.16, 2.44),
    clamp(3.04 + barEnergy * 0.16, 3.04, 3.36),
    clamp(4.04 + sectionProgress * 0.24 + barEnergy * 0.14, 4.04, 4.56),
    1.44 + sectionProgress * 0.08,
  ];
  const widths = [5.9, 4.8, 4.4, 4.0, 6.1];
  const thicknesses = [1.18, 0.42, 0.38, 0.34, 1.12];
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
      leadBias,
    ),
  );
  const lavaZone = useLava
    ? createHazardZoneForObstacles(
        obstacles,
        0.68 + barEnergy * 0.22,
        12 + ((barIndex * 9) % 22),
        0.1,
        0.46,
        sectionProgress > 0.62 ? "void" : "lava",
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
  sectionProgress: number,
  barEnergy: number,
  useLava: boolean,
  leadBias: number,
) {
  const cueOffsets = [0, 1, 2, 3, 4];
  const topHeights = [
    1.4,
    clamp(3.18 + barEnergy * 0.18, 3.18, 3.5),
    clamp(2.68 + barEnergy * 0.12, 2.68, 2.94),
    clamp(1.92 + sectionProgress * 0.12, 1.92, 2.16),
    1.24,
  ];
  const widths = [6.0, 4.4, 4.2, 4.6, 6.2];
  const thicknesses = [1.08, 0.38, 0.36, 0.36, 1.18];
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
      leadBias,
    ),
  );
  const lavaZone = useLava
    ? createHazardZoneForObstacles(
        obstacles,
        0.58 + barEnergy * 0.16,
        18 + ((barIndex * 7) % 18),
        0.08,
        0.42,
        barEnergy > 0.7 ? "void" : "lava",
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
  leadBias: number,
) {
  const topHeights = [1.46, 3.02, 1.34];
  const widths = [5.8, 4.1, 6.4];
  const thicknesses = [1.06, 0.34, 1.14];
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
    leadBias,
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
    leadBias,
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
    leadBias,
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
    leadBias,
  );
  const overheadGate = createCeilingBeamObstacle(
    barBeats[1],
    barIndex * BAR_BEAT_COUNT + 152,
    4.36,
    0.42,
    topHeights[1] + TARGET_OVERHEAD_PASSAGE_HEIGHT,
    0.16,
    228,
    0.46 + barEnergy * 0.14,
    leadBias,
  );
  const obstacles = [
    platformOne,
    platformTwo,
    overheadGate,
    exitPlatform,
    platformSpike,
  ];
  const lavaZone = useLava
    ? createHazardZoneForObstacles(
        [platformOne, platformTwo, exitPlatform],
        0.58 + barEnergy * 0.18,
        18 + ((barIndex * 11) % 18),
        0.08,
        0.4,
        "void",
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
  leadBias: number,
) {
  const platformOne = createPlatformBlock(
    barBeats[0],
    barIndex * BAR_BEAT_COUNT,
    6.2,
    1.48,
    1.02,
    0.14,
    172,
    0.62 + barEnergy * 0.18,
    leadBias,
  );
  const midStep = createPlatformBlock(
    barBeats[1],
    barIndex * BAR_BEAT_COUNT + 1,
    4.8,
    2.74,
    0.36,
    0.14,
    184,
    0.56 + barEnergy * 0.16,
    leadBias,
  );
  const highStep = createPlatformBlock(
    barBeats[2],
    barIndex * BAR_BEAT_COUNT + 2,
    4.1,
    3.78,
    0.34,
    0.14,
    190,
    0.58 + barEnergy * 0.16,
    leadBias,
  );
  const platformSpike = createPlatformSpike(
    barBeats[3],
    barIndex * BAR_BEAT_COUNT + 103,
    1.24,
    1.04,
    1,
    0.08,
    14,
    0.74 + barEnergy * 0.18,
    3.76,
    leadBias,
  );
  const exitPlatform = createPlatformBlock(
    barBeats[4],
    barIndex * BAR_BEAT_COUNT + 4,
    6.3,
    1.42,
    1.16,
    0.14,
    196,
    0.52 + barEnergy * 0.14,
    leadBias,
  );
  const chokeBeam = createCeilingBeamObstacle(
    barBeats[1],
    barIndex * BAR_BEAT_COUNT + 153,
    4.08,
    0.4,
    2.74 + TARGET_OVERHEAD_PASSAGE_HEIGHT,
    0.15,
    214,
    0.44 + barEnergy * 0.14,
    leadBias,
  );
  const lavaZone = useLava
    ? createHazardZoneForObstacles(
        [platformOne, midStep, highStep, exitPlatform],
        0.7 + barEnergy * 0.16,
        10 + ((barIndex * 5) % 26),
        0.08,
        0.44,
        barEnergy > 0.68 ? "void" : "lava",
      )
    : null;

  return {
    cues: [
      createCue(barBeats[0], "step", 0),
      createCue(barBeats[1], "climb", 1),
      createCue(barBeats[2], "climb", 2),
      createCue(barBeats[3], "tap", 1),
    ],
    obstacles: [platformOne, midStep, chokeBeam, highStep, platformSpike, exitPlatform],
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
  leadBias: number,
) {
  const cueOffsets = [0, 1, 2, 3, 4];
  const topHeights = [1.58, 3.02, 4.18, 3.42, 1.42];
  const widths = [5.4, 4.2, 3.7, 4.0, 6.1];
  const thicknesses = [1.0, 0.34, 0.3, 0.32, 1.14];
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
      leadBias,
    ),
  );
  const lavaZone = useLava
    ? createHazardZoneForObstacles(
        obstacles,
        0.62 + barEnergy * 0.14,
        20 + ((barIndex * 9) % 14),
        0.08,
        0.42,
        "void",
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
  leadBias: number,
) {
  const cueOffsets = [0, 1, 2, 3, 4, 5];
  const topHeights = [
    1.32,
    clamp(2.34 + barEnergy * 0.14, 2.34, 2.64),
    clamp(3.28 + barEnergy * 0.16, 3.28, 3.6),
    clamp(4.18 + sectionProgress * 0.24 + barEnergy * 0.12, 4.18, 4.68),
    clamp(4.94 + sectionProgress * 0.28 + barEnergy * 0.14, 4.94, 5.42),
    1.48,
  ];
  const widths = [6.0, 4.7, 4.2, 3.8, 3.4, 6.2];
  const thicknesses = [1.16, 0.38, 0.34, 0.32, 0.28, 1.12];
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
      leadBias,
    ),
  );
  const crestSpike = createPlatformSpike(
    barBeats[5],
    barIndex * BAR_BEAT_COUNT + 105,
    1.04,
    0.88,
    1,
    0.08,
    16,
    0.72 + barEnergy * 0.16,
    topHeights[4] - 0.02,
    leadBias,
  );
  const lavaZone = useLava
    ? createHazardZoneForObstacles(
        obstacles,
        0.72 + barEnergy * 0.18,
        14 + ((barIndex * 13) % 18),
        0.1,
        0.48,
        "void",
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

function buildSpaceBar(
  barBeats: GridBeat[],
  barIndex: number,
  sectionProgress: number,
  barEnergy: number,
  leadBias: number,
) {
  const cueOffsets = [0, 1, 2, 3, 4, 5];
  const topHeights = [
    1.36,
    clamp(2.48 + barEnergy * 0.16, 2.48, 2.8),
    clamp(3.54 + barEnergy * 0.18, 3.54, 3.88),
    clamp(4.52 + sectionProgress * 0.2 + barEnergy * 0.16, 4.52, 4.96),
    clamp(5.18 + sectionProgress * 0.24 + barEnergy * 0.14, 5.18, 5.62),
    1.62,
  ];
  const widths = [5.9, 4.6, 4.0, 3.6, 3.2, 6.2];
  const thicknesses = [1.04, 0.34, 0.32, 0.28, 0.26, 1.1];
  const obstacles = cueOffsets.map((offset, index) =>
    createPlatformBlock(
      barBeats[offset],
      barIndex * BAR_BEAT_COUNT + offset,
      widths[index],
      topHeights[index],
      thicknesses[index],
      0.14 + index * 0.004,
      224,
      0.6 + barEnergy * 0.18,
      leadBias,
    ),
  );
  const crestBeam = createCeilingBeamObstacle(
    barBeats[2],
    barIndex * BAR_BEAT_COUNT + 252,
    3.88,
    0.38,
    topHeights[2] + TARGET_OVERHEAD_PASSAGE_HEIGHT,
    0.15,
    244,
    0.48 + barEnergy * 0.14,
    leadBias,
  );
  const crestSpike = createPlatformSpike(
    barBeats[4],
    barIndex * BAR_BEAT_COUNT + 204,
    0.96,
    0.82,
    1,
    0.08,
    340,
    0.76 + barEnergy * 0.12,
    topHeights[4] - 0.02,
    leadBias,
  );
  const descentSpike = createPlatformSpike(
    barBeats[5],
    barIndex * BAR_BEAT_COUNT + 205,
    1.04,
    0.86,
    1,
    0.08,
    330,
    0.7 + barEnergy * 0.1,
    topHeights[4] - 0.04,
    leadBias,
  );
  const voidZone = createHazardZoneForObstacles(
    obstacles,
    0.74 + barEnergy * 0.18,
    236 + ((barIndex * 7) % 36),
    0.08,
    0.46,
    "void",
  );

  return {
    cues: cueOffsets.map((offset, index) =>
      createCue(
        barBeats[offset],
        index === cueOffsets.length - 1 ? "step" : index < 2 ? "step" : "climb",
        2 - index,
      ),
    ),
    obstacles: [...obstacles, crestBeam, crestSpike, descentSpike],
    lavaZones: voidZone ? [voidZone] : [],
    cameraMoments: [
      {
        time: barBeats[3]?.time ?? barBeats[2].time,
        duration: 1.02,
        strength: 0.78 + barEnergy * 0.12,
        style: "hero",
      },
      {
        time: barBeats[4]?.time ?? barBeats[3].time,
        duration: 0.8,
        strength: 0.74 + barEnergy * 0.12,
        style: "rush",
      },
    ],
  } satisfies GeneratedBar;
}

function buildDescentBar(
  barBeats: GridBeat[],
  barIndex: number,
  sectionProgress: number,
  barEnergy: number,
  leadBias: number,
) {
  const cueOffsets = [0, 1, 2, 3, 4, 5];
  const topHeights = [
    1.42,
    clamp(2.96 + barEnergy * 0.16, 2.96, 3.28),
    clamp(4.12 + sectionProgress * 0.18 + barEnergy * 0.14, 4.12, 4.56),
    clamp(3.18 + barEnergy * 0.12, 3.18, 3.42),
    clamp(2.16 + sectionProgress * 0.1, 2.16, 2.42),
    1.26,
  ];
  const widths = [5.8, 4.6, 4.1, 4.2, 4.9, 6.2];
  const thicknesses = [1.04, 0.36, 0.32, 0.34, 0.36, 1.1];
  const obstacles = cueOffsets.map((offset, index) =>
    createPlatformBlock(
      barBeats[offset],
      barIndex * BAR_BEAT_COUNT + offset,
      widths[index],
      topHeights[index],
      thicknesses[index],
      0.14 + index * 0.004,
      24,
      0.56 + barEnergy * 0.16,
      leadBias,
    ),
  );
  const edgeSpike = createPlatformSpike(
    barBeats[2],
    barIndex * BAR_BEAT_COUNT + 302,
    1.08,
    0.92,
    1,
    0.08,
    18,
    0.72 + barEnergy * 0.14,
    topHeights[2] - 0.02,
    leadBias,
  );
  const descentBeam = createCeilingBeamObstacle(
    barBeats[3],
    barIndex * BAR_BEAT_COUNT + 352,
    4.14,
    0.4,
    topHeights[3] + TARGET_OVERHEAD_PASSAGE_HEIGHT,
    0.15,
    208,
    0.46 + barEnergy * 0.14,
    leadBias,
  );
  const voidZone = createHazardZoneForObstacles(
    obstacles,
    0.7 + barEnergy * 0.16,
    18 + ((barIndex * 9) % 26),
    0.08,
    0.44,
    "void",
  );

  return {
    cues: cueOffsets.map((offset, index) =>
      createCue(
        barBeats[offset],
        index === 0 || index >= 4 ? "step" : index === 2 ? "climb" : "bridge",
        2 - index,
      ),
    ),
    obstacles: [...obstacles, descentBeam, edgeSpike],
    lavaZones: voidZone ? [voidZone] : [],
    cameraMoments: [
      {
        time: barBeats[2]?.time ?? barBeats[1].time,
        duration: 0.94,
        strength: 0.72 + barEnergy * 0.12,
        style: "sweep",
      },
      {
        time: barBeats[4]?.time ?? barBeats[3].time,
        duration: 0.72,
        strength: 0.68 + barEnergy * 0.1,
        style: "hero",
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

function obstaclesOverlapInTime(left: Obstacle, right: Obstacle) {
  return (
    obstacleStartTime(left) < obstacleEndTime(right) - 0.02 &&
    obstacleStartTime(right) < obstacleEndTime(left) - 0.02
  );
}

function obstacleVerticalGap(left: Obstacle, right: Obstacle) {
  if (obstacleBottom(right) >= obstacleTop(left) - 0.04) {
    return obstacleBottom(right) - obstacleTop(left);
  }

  if (obstacleBottom(left) >= obstacleTop(right) - 0.04) {
    return obstacleBottom(left) - obstacleTop(right);
  }

  return Number.NEGATIVE_INFINITY;
}

function isCeilingBeamObstacle(obstacle: Obstacle) {
  return obstacle.kind === "block" && obstacle.baseY > 2.4 && obstacle.height <= 0.82;
}

function obstaclesCanOverlap(previousObstacle: Obstacle, currentObstacle: Obstacle) {
  return obstacleVerticalGap(previousObstacle, currentObstacle) >= MIN_STACK_PASSAGE_HEIGHT;
}

function minimumObstacleWidth(obstacle: Obstacle) {
  return obstacle.kind === "spike"
    ? Math.max(1.16, obstacle.spikes * 0.56)
    : 2.3;
}

function normalizeOverheadBeamClearance(obstacles: Obstacle[]) {
  return obstacles.map((obstacle, obstacleIndex) => {
    if (!isCeilingBeamObstacle(obstacle)) {
      return obstacle;
    }

    let requiredBaseY = obstacle.baseY;

    for (let index = 0; index < obstacles.length; index += 1) {
      if (index === obstacleIndex) {
        continue;
      }

      const candidate = obstacles[index];

      if (
        !obstaclesOverlapInTime(obstacle, candidate) ||
        obstacleBottom(candidate) >= obstacleBottom(obstacle)
      ) {
        continue;
      }

      requiredBaseY = Math.max(requiredBaseY, obstacleTop(candidate) + TARGET_OVERHEAD_PASSAGE_HEIGHT);
    }

    if (requiredBaseY <= obstacle.baseY + 0.001) {
      return obstacle;
    }

    return {
      ...obstacle,
      baseY: requiredBaseY,
    };
  });
}

function normalizeObstacles(obstacles: Obstacle[], duration: number) {
  const sorted = [...obstacles].sort((left, right) => left.time - right.time);
  const normalized: Obstacle[] = [];

  for (const obstacle of sorted) {
    if (obstacleStartTime(obstacle) >= duration - 0.95) {
      break;
    }

    let nextObstacle: Obstacle | null = obstacle;

    for (let index = normalized.length - 1; index >= 0; index -= 1) {
      if (!nextObstacle) {
        break;
      }

      const previousObstacle = normalized[index];
      const previousEnd = obstacleEndTime(previousObstacle);
      const currentStart = obstacleStartTime(nextObstacle);

      if (currentStart >= previousEnd - 0.02) {
        break;
      }

      if (!obstaclesCanOverlap(previousObstacle, nextObstacle)) {
        const maxAllowedWidth: number = (nextObstacle.time - (previousEnd + 0.02)) * RUN_SPEED * 2;
        const minimumWidth = minimumObstacleWidth(nextObstacle);

        if (maxAllowedWidth < minimumWidth) {
          nextObstacle = null;
          break;
        }

        nextObstacle = {
          ...nextObstacle,
          width: Math.min(nextObstacle.width, maxAllowedWidth),
        };
      }
    }

    if (!nextObstacle || obstacleStartTime(nextObstacle) >= duration - 0.95) {
      continue;
    }

    normalized.push(nextObstacle);
  }

  return normalizeOverheadBeamClearance(normalized);
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

    if (
      !previous ||
      zone.surface !== previous.surface ||
      zone.startTime > previous.endTime + 0.12
    ) {
      merged.push(zone);
      continue;
    }

    previous.endTime = Math.max(previous.endTime, zone.endTime);
    previous.intensity = Math.max(previous.intensity, zone.intensity);
    previous.hue = (previous.hue + zone.hue) * 0.5;
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

  if (
    sectionProgress < 0.26 &&
    (candidate === "gauntlet" || candidate === "tower" || candidate === "space")
  ) {
    candidate = "climb";
  }

  if (sectionProgress < 0.18 && (candidate === "floating" || candidate === "descent")) {
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

function chooseSectionTheme(
  profile: TrackProfile,
  sectionType: SectionType,
  barIndex: number,
  sectionProgress: number,
  barEnergy: number,
  recentThemes: LevelSectionTheme[],
) {
  const themePool = SECTION_THEME_POOLS[sectionType] ?? ["pulse"];
  const seed =
    barIndex +
    Math.round(sectionProgress * 9) +
    Math.round(barEnergy * 12) +
    getTrackThemeOffset(profile);
  let candidate = themePool[seed % themePool.length] ?? themePool[0] ?? "pulse";

  if (themePool.length > 1 && recentThemes[recentThemes.length - 1] === candidate) {
    candidate = themePool[(seed + 1) % themePool.length] ?? candidate;
  }

  return candidate;
}

function createLevelSection(
  barBeats: GridBeat[],
  duration: number,
  kind: SectionType,
  theme: LevelSectionTheme,
  intensity: number,
  variant: number,
): LevelSection {
  const firstBeat = barBeats[0];
  const secondBeat = barBeats[1] ?? firstBeat;
  const lastBeat = barBeats[barBeats.length - 1] ?? firstBeat;
  const fallbackGap = Math.max(0.42, (lastBeat.time - firstBeat.time) / Math.max(1, barBeats.length - 1));
  const beatGap = Math.max(fallbackGap, secondBeat.time - firstBeat.time || 0);

  return {
    startTime: clamp(firstBeat.time - beatGap * 0.5, 0, duration),
    endTime: clamp(lastBeat.time + beatGap * 0.95, 0, duration),
    kind,
    theme,
    intensity: clamp(intensity, 0.38, 1),
    variant,
  };
}

function normalizeSections(sections: LevelSection[], duration: number) {
  const merged: LevelSection[] = [];

  for (const section of [...sections]
    .map((item) => ({
      ...item,
      startTime: clamp(item.startTime, 0, duration),
      endTime: clamp(item.endTime, 0, duration),
    }))
    .filter((item) => item.endTime - item.startTime > 0.24)
    .sort((left, right) => left.startTime - right.startTime)) {
    const previous = merged[merged.length - 1];

    if (
      previous &&
      previous.kind === section.kind &&
      previous.theme === section.theme &&
      previous.variant === section.variant &&
      section.startTime <= previous.endTime + 0.12
    ) {
      previous.endTime = Math.max(previous.endTime, section.endTime);
      previous.intensity = clamp((previous.intensity + section.intensity) * 0.5, 0.38, 1);
      continue;
    }

    merged.push({ ...section });
  }

  if (merged.length === 0) {
    return [
      {
        startTime: 0,
        endTime: duration,
        kind: "ground",
        theme: "pulse",
        intensity: 0.5,
        variant: 0,
      },
    ] satisfies LevelSection[];
  }

  merged[0].startTime = 0;
  merged[merged.length - 1].endTime = duration;

  for (let index = 0; index < merged.length - 1; index += 1) {
    const current = merged[index];
    const next = merged[index + 1];
    const midpoint = clamp(
      (current.endTime + next.startTime) * 0.5,
      current.startTime + 0.18,
      next.endTime - 0.18,
    );

    current.endTime = midpoint;
    next.startTime = midpoint;
  }

  return merged.filter((section) => section.endTime - section.startTime > 0.24);
}

function buildLevelLayout(gridBeats: GridBeat[], duration: number, trackId: TrackId) {
  const profile = getTrackProfile(trackId);
  const cues: BeatPoint[] = [];
  const obstacles: Obstacle[] = [];
  const lavaZones: LavaZone[] = [];
  const cameraMoments: CameraMoment[] = [];
  const sections: LevelSection[] = [];
  let previousBarEnergy = 0.4;
  const recentSections: SectionType[] = [];
  const recentThemes: LevelSectionTheme[] = [];

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
    const sectionTheme = chooseSectionTheme(
      profile,
      sectionType,
      barIndex,
      sectionProgress,
      barEnergy,
      recentThemes,
    );
    const useLava = sectionProgress >= sectionPhase.lavaFloor && sectionType !== "ground";
    const leadBias = profile.obstacleLeadBias;
    const sectionVariant =
      (barIndex + Math.round(barEnergy * 10) + Math.round(sectionProgress * 12) + getTrackThemeOffset(profile)) %
      3;
    const generatedBar =
      sectionType === "climb"
        ? buildClimbBar(barBeats, barIndex, sectionProgress, barEnergy, useLava, leadBias)
        : sectionType === "drop"
          ? buildDropBar(barBeats, barIndex, sectionProgress, barEnergy, useLava, leadBias)
          : sectionType === "gauntlet"
            ? buildGauntletBar(barBeats, barIndex, barEnergy, true, leadBias)
            : sectionType === "bridge"
              ? buildBridgeBar(barBeats, barIndex, barEnergy, useLava, leadBias)
              : sectionType === "floating"
                ? buildFloatingStepsBar(barBeats, barIndex, barEnergy, useLava, leadBias)
                : sectionType === "tower"
                  ? buildTowerBar(barBeats, barIndex, sectionProgress, barEnergy, useLava, leadBias)
                  : sectionType === "space"
                    ? buildSpaceBar(barBeats, barIndex, sectionProgress, barEnergy, leadBias)
                    : sectionType === "descent"
                      ? buildDescentBar(barBeats, barIndex, sectionProgress, barEnergy, leadBias)
                      : buildGroundBar(profile, barBeats, barIndex, sectionProgress, barEnergy, leadBias);
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
    sections.push(
      createLevelSection(
        barBeats,
        duration,
        sectionType,
        sectionTheme,
        barEnergy * 0.72 + sectionProgress * 0.16 + (useLava ? 0.08 : 0),
        sectionVariant,
      ),
    );

    if (energyMoment) {
      cameraMoments.push(energyMoment);
    }

    recentSections.push(sectionType);
    recentThemes.push(sectionTheme);

    if (recentSections.length > 3) {
      recentSections.shift();
    }

    if (recentThemes.length > 3) {
      recentThemes.shift();
    }

    previousBarEnergy = barEnergy;
  }

  return {
    cues,
    obstacles: normalizeObstacles(obstacles, duration),
    lavaZones: normalizeLavaZones(lavaZones, duration),
    cameraMoments: normalizeCameraMoments(cameraMoments),
    sections: normalizeSections(sections, duration),
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
  const bottomOffset = PLAYER_COLLISION_RADIUS * 0.84;
  const topOffset = PLAYER_COLLISION_RADIUS * 0.72;
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
    const horizontalReach = obstacle.width / 2 + PLAYER_COLLISION_RADIUS;

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
    const withinTop = Math.abs(relativeX) < halfWidth + PLAYER_COLLISION_RADIUS * 0.62;
    const withinBody = Math.abs(relativeX) < Math.max(0.12, halfWidth - PLAYER_COLLISION_RADIUS * 0.16);
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

    if (isCeilingBeamObstacle(obstacle)) {
      return {
        ...obstacle,
        baseY: obstacle.baseY + 0.42,
        width: clamp(obstacle.width * 0.94, 2.4, 6.4),
      };
    }

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
    sections: layout.sections,
  };
}
