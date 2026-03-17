import {
  COYOTE_TIME,
  FALL_GRAVITY_MULTIPLIER,
  FLIGHT_DRAG,
  FLIGHT_FALL_ACCELERATION,
  FLIGHT_LANE_HEIGHTS,
  FLIGHT_MAX_SPEED,
  FLIGHT_THRUST_ACCELERATION,
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
const MIN_PULSE_INTERVAL = 0.28;
const MAX_PULSE_INTERVAL = 0.72;
const GRID_SNAP_WINDOW_RATIO = 0.22;
const OBSTACLE_SYNC_OFFSET_SCALE = 0.22;
const PLAYER_COLLISION_HEIGHT = PLAYER_COLLISION_RADIUS * (0.84 + 0.72);
const MIN_STACK_PASSAGE_HEIGHT = PLAYER_COLLISION_HEIGHT + 0.14;
const OVERHEAD_ESCAPE_TIME = 0.11;
const MIN_CEILING_BEAM_BASE_Y = 4.8;
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
      cycle: ["ground", "ground", "climb", "ground", "ground"],
      accentCycle: ["climb"],
      lavaFloor: 1,
      accentEnergy: 0.72,
    },
    {
      untilProgress: 0.48,
      cycle: ["ground", "climb", "bridge", "ground", "drop", "floating"],
      accentCycle: ["climb", "bridge", "tower", "flight"],
      lavaFloor: 0.3,
      accentEnergy: 0.7,
    },
    {
      untilProgress: 0.78,
      cycle: ["climb", "bridge", "drop", "ground", "tower", "descent"],
      accentCycle: ["tower", "gauntlet", "space", "flight"],
      lavaFloor: 0.36,
      accentEnergy: 0.74,
    },
    {
      untilProgress: 1.01,
      cycle: ["tower", "gauntlet", "drop", "floating", "bridge", "space", "flight", "descent"],
      accentCycle: ["tower", "gauntlet", "space", "flight", "descent"],
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
      accentCycle: ["tower", "floating", "drop", "flight"],
      lavaFloor: 0.34,
      accentEnergy: 0.7,
    },
    {
      untilProgress: 0.74,
      cycle: ["tower", "drop", "climb", "bridge", "ground", "floating", "space"],
      accentCycle: ["tower", "gauntlet", "drop", "space", "flight"],
      lavaFloor: 0.26,
      accentEnergy: 0.74,
    },
    {
      untilProgress: 1.01,
      cycle: ["tower", "gauntlet", "tower", "floating", "drop", "bridge", "space", "flight", "descent"],
      accentCycle: ["tower", "gauntlet", "floating", "space", "flight"],
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
  flight: ["sky", "void"],
  tower: ["citadel", "forge"],
  space: ["void", "sky"],
  descent: ["solar", "forge"],
};

const SECTION_DIFFICULTY: Record<SectionType, number> = {
  ground: 1,
  climb: 1.8,
  bridge: 2.2,
  drop: 2.5,
  floating: 2.9,
  flight: 3.8,
  tower: 3.5,
  descent: 3.7,
  gauntlet: 4.2,
  space: 4.5,
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

function estimateBeatIntervalFromGaps(beats: GridBeat[]) {
  const gaps: number[] = [];

  for (let index = 1; index < beats.length; index += 1) {
    const gap = beats[index].time - beats[index - 1].time;

    if (gap >= MIN_PULSE_INTERVAL && gap <= MAX_PULSE_INTERVAL) {
      gaps.push(gap);
    }

    const halvedGap = gap * 0.5;

    if (halvedGap >= MIN_PULSE_INTERVAL && halvedGap <= MAX_PULSE_INTERVAL) {
      gaps.push(halvedGap);
    }
  }

  return clamp(median(gaps) || 0.48, MIN_PULSE_INTERVAL, MAX_PULSE_INTERVAL);
}

function calculateLagCorrelation(values: number[], lag: number) {
  let total = 0;

  for (let index = lag; index < values.length; index += 1) {
    total += (values[index] ?? 0) * (values[index - lag] ?? 0);
  }

  return total / Math.max(1, values.length - lag);
}

function refineLagInterval(scores: number[], lag: number, frameDuration: number) {
  const left = scores[lag - 1] ?? scores[lag] ?? 0;
  const center = scores[lag] ?? 0;
  const right = scores[lag + 1] ?? scores[lag] ?? 0;
  const denominator = left - 2 * center + right;
  const offset =
    Math.abs(denominator) > 0.000001
      ? clamp(0.5 * (left - right) / denominator, -0.5, 0.5)
      : 0;

  return (lag + offset) * frameDuration;
}

function evaluateBeatInterval(beats: GridBeat[], duration: number, interval: number) {
  if (beats.length === 0) {
    return 0;
  }

  const start = Math.max(0.6, Math.min(duration * 0.12, interval * 2.4));
  const end = Math.max(start + interval * 24, duration - Math.max(1.2, interval * 3));
  const phase = findBestGridPhase(beats, duration, interval, start, end);
  const snapWindow = interval * GRID_SNAP_WINDOW_RATIO;
  let score = 0;
  let matches = 0;

  for (const beat of beats) {
    if (beat.time < start - interval || beat.time > end + interval) {
      continue;
    }

    const nearestGridIndex = Math.round((beat.time - phase) / interval);
    const alignedTime = phase + nearestGridIndex * interval;
    const distance = Math.abs(beat.time - alignedTime);

    if (distance > snapWindow) {
      continue;
    }

    const closeness = 1 - distance / snapWindow;
    score += beat.strength * (0.42 + closeness * 0.58);
    matches += 1;
  }

  return score / Math.sqrt(Math.max(1, (end - start) / interval)) + matches * 0.018;
}

function detectBeats(
  energyEnvelope: number[],
  rmsEnvelope: number[],
  frameDuration: number,
) {
  const beats: GridBeat[] = [];
  const peakRadius = Math.max(1, Math.round(0.055 / frameDuration));
  const thresholdRadius = Math.max(6, Math.round(0.24 / frameDuration));
  const minGapFrames = Math.max(1, Math.round(0.14 / frameDuration));
  let lastBeatFrame = -minGapFrames;

  for (let index = thresholdRadius; index < energyEnvelope.length - thresholdRadius; index += 1) {
    const current = energyEnvelope[index] ?? 0;

    if (current <= 0.01 || index - lastBeatFrame < minGapFrames) {
      continue;
    }

    let isLocalPeak = true;

    for (let offset = 1; offset <= peakRadius; offset += 1) {
      if (
        current < (energyEnvelope[index - offset] ?? 0) ||
        current < (energyEnvelope[index + offset] ?? 0)
      ) {
        isLocalPeak = false;
        break;
      }
    }

    if (!isLocalPeak) {
      continue;
    }

    let localTotal = 0;
    let localSquares = 0;
    let localCount = 0;

    for (let sampleIndex = index - thresholdRadius; sampleIndex <= index + thresholdRadius; sampleIndex += 1) {
      const sample = energyEnvelope[sampleIndex] ?? 0;
      localTotal += sample;
      localSquares += sample * sample;
      localCount += 1;
    }

    const localAverage = localTotal / Math.max(1, localCount);
    const variance = Math.max(0, localSquares / Math.max(1, localCount) - localAverage * localAverage);
    const localDeviation = Math.sqrt(variance);
    const prominence = current - localAverage;
    const threshold = localAverage + localDeviation * 0.4 + 0.01;

    if (current < threshold || prominence < 0.012) {
      continue;
    }

    const strength = clamp(
      current * 0.74 + (rmsEnvelope[index] ?? 0) * 0.26 + prominence * 0.65,
      0.18,
      1,
    );

    beats.push({
      time: index * frameDuration,
      strength,
      lane: beats.length % 3,
    });

    lastBeatFrame = index;
  }

  return beats;
}

function estimateBeatInterval(
  beats: GridBeat[],
  energyEnvelope: number[],
  frameDuration: number,
  duration: number,
) {
  if (beats.length < 8) {
    return estimateBeatIntervalFromGaps(beats);
  }

  const minLag = Math.max(1, Math.round(MIN_PULSE_INTERVAL / frameDuration));
  const maxLag = Math.max(minLag + 1, Math.round(MAX_PULSE_INTERVAL / frameDuration));
  const lagScores = new Array<number>(maxLag + 1).fill(0);

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    lagScores[lag] = calculateLagCorrelation(energyEnvelope, lag);
  }

  const smoothedLagScores = lagScores.map((_, index) => {
    if (index < minLag || index > maxLag) {
      return 0;
    }

    let total = 0;
    let count = 0;

    for (let offset = -1; offset <= 1; offset += 1) {
      const sample = lagScores[index + offset];

      if (sample === undefined) {
        continue;
      }

      total += sample;
      count += 1;
    }

    return count > 0 ? total / count : lagScores[index] ?? 0;
  });
  const strongestCorrelation = smoothedLagScores.reduce(
    (currentPeak, value, index) => index >= minLag && index <= maxLag ? Math.max(currentPeak, value) : currentPeak,
    0.0001,
  );
  const candidateLags: number[] = [];

  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    const current = smoothedLagScores[lag] ?? 0;

    if (current <= (smoothedLagScores[lag - 1] ?? 0) || current < (smoothedLagScores[lag + 1] ?? 0)) {
      continue;
    }

    candidateLags.push(lag);
  }

  const rankedCandidates = candidateLags
    .sort((left, right) => (smoothedLagScores[right] ?? 0) - (smoothedLagScores[left] ?? 0))
    .slice(0, 10)
    .map((lag) => {
      const interval = refineLagInterval(smoothedLagScores, lag, frameDuration);
      const alignmentScore = evaluateBeatInterval(beats, duration, interval);
      const correlationScore = (smoothedLagScores[lag] ?? 0) / strongestCorrelation;

      return {
        interval,
        score: alignmentScore + correlationScore * 0.24,
      };
    })
    .sort((left, right) => right.score - left.score);

  let bestInterval = rankedCandidates[0]?.interval ?? estimateBeatIntervalFromGaps(beats);
  let bestScore = rankedCandidates[0]?.score ?? 0;

  for (const candidate of rankedCandidates) {
    const ratio = bestInterval / candidate.interval;

    if (
      candidate.interval < bestInterval &&
      bestInterval >= 0.46 &&
      candidate.interval <= 0.42 &&
      Math.abs(ratio - 2) < 0.28 &&
      candidate.score >= bestScore * 0.8
    ) {
      bestInterval = candidate.interval;
      bestScore = candidate.score;
    }
  }

  return clamp(bestInterval, MIN_PULSE_INTERVAL, MAX_PULSE_INTERVAL);
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
  const start = Math.max(0.68, interval * 2.4);
  const end = duration - Math.max(1.15, interval * 3);
  const bestPhase = findBestGridPhase(beats, duration, interval, start, end);
  let cursor = bestPhase;
  let searchIndex = 0;

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
    while (searchIndex < beats.length && beats[searchIndex].time < cursor - interval * 0.28) {
      searchIndex += 1;
    }

    let nearestBeat: GridBeat | null = null;
    let nearestDistance = interval * GRID_SNAP_WINDOW_RATIO;

    for (let beatIndex = searchIndex; beatIndex < beats.length; beatIndex += 1) {
      const beat = beats[beatIndex];

      if (beat.time > cursor + interval * 0.28) {
        break;
      }

      const distance = Math.abs(beat.time - cursor);

      if (distance < nearestDistance) {
        nearestBeat = beat;
        nearestDistance = distance;
      }
    }

    const resolvedTime = nearestBeat
      ? clamp(
          cursor + (nearestBeat.time - cursor) * 0.84,
          cursor - interval * 0.12,
          cursor + interval * 0.12,
        )
      : cursor;
    const interpolatedStrength = sampleStrengthAtTime(beats, resolvedTime, interval);
    const strength = clamp(
      (nearestBeat?.strength ?? interpolatedStrength) * 0.72 + interpolatedStrength * 0.38,
      0.32,
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

    cursor += interval + clamp((resolvedTime - cursor) * 0.22, -interval * 0.08, interval * 0.08);
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
  const syncedFrontDelay = (frontDelay + leadBias) * OBSTACLE_SYNC_OFFSET_SCALE;

  return {
    kind: "spike" as const,
    time: createObstacleCenterTime(beat.time + syncedFrontDelay, width),
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
  const syncedFrontDelay = (frontDelay + leadBias) * OBSTACLE_SYNC_OFFSET_SCALE;

  return {
    kind: "block" as const,
    time: createObstacleCenterTime(beat.time + syncedFrontDelay, width),
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

function rotatePattern(pattern: ObstacleToken[], offset: number) {
  if (pattern.length === 0) {
    return pattern;
  }

  const normalizedOffset = ((offset % pattern.length) + pattern.length) % pattern.length;

  if (normalizedOffset === 0) {
    return [...pattern];
  }

  return pattern.map((_, index) => pattern[(index - normalizedOffset + pattern.length) % pattern.length] ?? null);
}

function mutateGroundPattern(
  pattern: ObstacleToken[],
  variant: number,
  sectionProgress: number,
  barEnergy: number,
) {
  const rotated = rotatePattern(pattern, variant % 2 === 0 ? 0 : 2);
  const basePattern = variant % 3 === 1 ? [...rotated].reverse() : rotated;

  return basePattern.map((token, index) => {
    if (!token) {
      if (sectionProgress > 0.64 && barEnergy > 0.72 && variant % 5 === 0 && index % 4 === 2) {
        return "tap";
      }

      return null;
    }

    if (token === "tap" && sectionProgress > 0.42 && variant % 4 === 2 && index % 3 === 0) {
      return "step";
    }

    if (token === "step" && sectionProgress > 0.74 && barEnergy > 0.68 && variant % 6 === 4) {
      return "hold";
    }

    if (token === "bridge" && sectionProgress > 0.82 && variant % 5 === 3) {
      return "hold";
    }

    return token;
  });
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
  const basePattern = patternPool[(barIndex + Math.round(barEnergy * 4)) % patternPool.length] ?? patternPool[0] ?? [];
  const pattern = mutateGroundPattern(
    basePattern,
    barIndex + Math.round(sectionProgress * 10) + Math.round(barEnergy * 12),
    sectionProgress,
    barEnergy,
  );
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
  const topHeights = [1.3, 2.78, 1.26];
  const widths = [4.7, 4.4, 5.1];
  const thicknesses = [0.94, 0.42, 1.02];
  const cues = [
    createCue(barBeats[0], "bridge", 0),
    createCue(barBeats[1], "climb", 1),
    createCue(barBeats[2], "step", 0),
  ];
  const platformOne = createPlatformBlock(
    barBeats[0],
    barIndex * BAR_BEAT_COUNT,
    widths[0],
    topHeights[0],
    thicknesses[0],
    0.24,
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
    0.16,
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
    0.2,
    202,
    0.52 + barEnergy * 0.16,
    leadBias,
  );
  const obstacles = [platformOne, platformTwo, exitPlatform];
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
    6.4,
    1.42,
    1.06,
    0.14,
    172,
    0.62 + barEnergy * 0.18,
    leadBias,
  );
  const midStep = createPlatformBlock(
    barBeats[1],
    barIndex * BAR_BEAT_COUNT + 1,
    5.3,
    2.46,
    0.42,
    0.14,
    184,
    0.56 + barEnergy * 0.16,
    leadBias,
  );
  const highStep = createPlatformBlock(
    barBeats[2],
    barIndex * BAR_BEAT_COUNT + 2,
    4.8,
    3.26,
    0.4,
    0.14,
    190,
    0.58 + barEnergy * 0.16,
    leadBias,
  );
  const exitPlatform = createPlatformBlock(
    barBeats[4],
    barIndex * BAR_BEAT_COUNT + 4,
    6.5,
    1.38,
    1.18,
    0.14,
    196,
    0.52 + barEnergy * 0.14,
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
      createCue(barBeats[4], "step", 0),
    ],
    obstacles: [platformOne, midStep, highStep, exitPlatform],
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

function createFlightCue(beat: GridBeat, lane: number): BeatPoint {
  return {
    time: beat.time,
    strength: beat.strength,
    lane,
    action: "flight",
  };
}

function buildFlightBar(
  barBeats: GridBeat[],
  barIndex: number,
  sectionProgress: number,
  barEnergy: number,
  leadBias: number,
) {
  const cueOffsets = [0, 1, 2, 3, 4, 5];
  const lanePatterns = [
    [1, 2, 1, 0, 1, 1],
    [1, 1, 2, 1, 0, 1],
    [1, 0, 1, 2, 1, 1],
    [1, 2, 2, 1, 0, 1],
    [1, 1, 0, 1, 2, 1],
    [1, 2, 1, 1, 2, 0],
  ] as const;
  const lanePattern =
    lanePatterns[(barIndex + Math.round(barEnergy * 10) + Math.round(sectionProgress * 6)) % lanePatterns.length] ??
    lanePatterns[0];
  const corridorGap = clamp(2.62 - sectionProgress * 0.34 - barEnergy * 0.08, 2.04, 2.62);
  const obstacles: Obstacle[] = [];

  for (let index = 0; index < cueOffsets.length; index += 1) {
    const beatOffset = cueOffsets[index];
    const beat = barBeats[beatOffset];
    const lane = lanePattern[index] ?? 1;
    const laneHeight = FLIGHT_LANE_HEIGHTS[lane] ?? FLIGHT_LANE_HEIGHTS[1];
    const gapBottom = clamp(laneHeight - corridorGap * 0.5 - 0.08, 0.96, 4.2);
    const gapTop = clamp(laneHeight + corridorGap * 0.5 + 0.08, gapBottom + 1.5, 5.78);
    const width =
      index === 0 || index === cueOffsets.length - 1
        ? 5.8
        : clamp(4.08 + (index % 2) * 0.4 + barEnergy * 0.18, 4.08, 4.92);
    if (index === 0) {
      continue;
    }

    const floorBlock = createBlockObstacle(
      beat,
      barIndex * BAR_BEAT_COUNT + 600 + beatOffset,
      width,
      gapBottom,
      0.04,
      198,
      0.44 + barEnergy * 0.18,
      0,
      leadBias,
    );
    const ceilingBlock = createBlockObstacle(
      beat,
      barIndex * BAR_BEAT_COUNT + 660 + beatOffset,
      width,
      6.62 - gapTop,
      0.04,
      214,
      0.38 + barEnergy * 0.16,
      gapTop,
      leadBias,
    );

    obstacles.push(floorBlock, ceilingBlock);
  }

  const voidZone = createHazardZoneForObstacles(
    obstacles,
    0.78 + barEnergy * 0.18,
    218 + ((barIndex * 9) % 28),
    0.04,
    0.24,
    "void",
  );

  return {
    cues: cueOffsets.map((offset, index) => createFlightCue(barBeats[offset], lanePattern[index] ?? 1)),
    obstacles,
    lavaZones: voidZone ? [voidZone] : [],
    cameraMoments: [
      {
        time: barBeats[1]?.time ?? barBeats[0].time,
        duration: 0.96,
        strength: 0.76 + barEnergy * 0.14,
        style: "hero",
      },
      {
        time: barBeats[4]?.time ?? barBeats[3].time,
        duration: 0.82,
        strength: 0.82 + barEnergy * 0.12,
        style: "rush",
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
  return obstacle.kind === "block" && obstacle.baseY >= MIN_CEILING_BEAM_BASE_Y && obstacle.height <= 0.82;
}

function isGroundedBlockObstacle(obstacle: Obstacle) {
  return obstacle.kind === "block" && obstacle.baseY <= 0.12;
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
  const wantsAccentSection =
    phase.accentCycle.length > 0 &&
    (
      barEnergy >= phase.accentEnergy ||
      barEnergy > previousBarEnergy + 0.05 ||
      barIndex % (sectionProgress > 0.68 ? 3 : 4) === 0
    );
  const targetDifficulty = clamp(
    1.1 + sectionProgress * 3.25 + Math.max(0, barEnergy - previousBarEnergy) * 1.4,
    1,
    4.7,
  );
  const candidatePool = wantsAccentSection
    ? [...phase.accentCycle, ...phase.cycle]
    : [...phase.cycle, ...phase.accentCycle];
  let bestCandidate: SectionType = "ground";
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidatePool) {
    const recentRepeatPenalty = recentSections[recentSections.length - 1] === candidate ? 0.8 : 0;
    const chainPenalty =
      recentSections.length >= 2 && recentSections.slice(-2).every((section) => section === candidate)
        ? 1.2
        : 0;
    const accentPenalty =
      wantsAccentSection && !phase.accentCycle.includes(candidate)
        ? 0.55
        : !wantsAccentSection && phase.accentCycle.includes(candidate)
          ? 0.28
          : 0;
    const earlyProgressPenalty =
      sectionProgress < 0.24 && SECTION_DIFFICULTY[candidate] > 2.6
        ? 3
        : sectionProgress < 0.4 && SECTION_DIFFICULTY[candidate] > 3.5
          ? 1.5
          : 0;
    const score =
      Math.abs(SECTION_DIFFICULTY[candidate] - targetDifficulty) +
      recentRepeatPenalty +
      chainPenalty +
      accentPenalty +
      earlyProgressPenalty;

    if (score < bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  return bestCandidate;
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
                : sectionType === "flight"
                  ? buildFlightBar(barBeats, barIndex, sectionProgress, barEnergy, leadBias)
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

function getSectionKindAtTime(sections: LevelSection[], time: number): LevelSectionKind {
  for (const section of sections) {
    if (time < section.startTime) {
      return "ground";
    }

    if (time <= section.endTime) {
      return section.kind;
    }
  }

  return "ground";
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

function resolveSimulatedFlightCollisions(
  obstacles: Obstacle[],
  lavaZones: LavaZone[],
  time: number,
  nextY: number,
  nextVelocity: number,
) {
  const overLava = isOverLava(lavaZones, time);
  const bottomOffset = PLAYER_COLLISION_RADIUS * 0.84;
  const topOffset = PLAYER_COLLISION_RADIUS * 0.72;
  const playerBottom = nextY - bottomOffset;
  const playerTop = nextY + topOffset;

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
      if (playerBottom < sampleObstacleHeight(obstacle, relativeX) && playerTop > obstacle.baseY + 0.08) {
        return {
          crashed: true,
          grounded: false,
          playerY: nextY,
          playerVelocity: nextVelocity,
        };
      }

      continue;
    }

    const withinBody = Math.abs(relativeX) < obstacle.width / 2 + PLAYER_COLLISION_RADIUS * 0.12;

    if (withinBody && playerBottom < obstacle.baseY + obstacle.height - 0.04 && playerTop > obstacle.baseY + 0.08) {
      return {
        crashed: true,
        grounded: false,
        playerY: nextY,
        playerVelocity: nextVelocity,
      };
    }
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
  sections: LevelSection[],
  duration: number,
) {
  let time = 0;
  let playerY = GROUND_Y;
  let playerVelocity = 0;
  let grounded = true;
  let holdTime = 0;
  let cueIndex = 0;
  const flightCues = cues.filter((cue) => cue.action === "flight");
  let flightCueIndex = 0;
  let coyoteTime = COYOTE_TIME;

  while (time < duration - 0.08) {
    const sectionKind = getSectionKindAtTime(sections, time);
    const previousY = playerY;

    if (sectionKind === "flight") {
      grounded = false;

      while (flightCueIndex < flightCues.length - 1 && flightCues[flightCueIndex + 1].time < time) {
        flightCueIndex += 1;
      }

      const previousFlightCue = flightCues[flightCueIndex] ?? null;
      const nextFlightCue = flightCues[flightCueIndex + 1] ?? previousFlightCue;
      const previousTargetY = previousFlightCue
        ? FLIGHT_LANE_HEIGHTS[previousFlightCue.lane] ?? FLIGHT_LANE_HEIGHTS[1]
        : FLIGHT_LANE_HEIGHTS[1];
      const nextTargetY = nextFlightCue
        ? FLIGHT_LANE_HEIGHTS[nextFlightCue.lane] ?? FLIGHT_LANE_HEIGHTS[1]
        : previousTargetY;
      const cueProgress =
        previousFlightCue && nextFlightCue && nextFlightCue.time > previousFlightCue.time
          ? clamp((time - previousFlightCue.time) / (nextFlightCue.time - previousFlightCue.time), 0, 1)
          : 0;
      const targetY = previousTargetY + (nextTargetY - previousTargetY) * cueProgress;
      const wantsLift =
        playerY < targetY - 0.08 ||
        (playerVelocity < -0.8 && playerY < targetY + 0.18);

      playerVelocity += (wantsLift ? FLIGHT_THRUST_ACCELERATION : -FLIGHT_FALL_ACCELERATION) * SIMULATION_STEP;
      playerVelocity *= Math.exp(-FLIGHT_DRAG * SIMULATION_STEP);
      playerVelocity = clamp(playerVelocity, -FLIGHT_MAX_SPEED, FLIGHT_MAX_SPEED);
      playerY += playerVelocity * SIMULATION_STEP;
    } else {
      while (cueIndex < cues.length && cues[cueIndex].time <= time + SIMULATION_STEP * 0.5) {
        if (cues[cueIndex].action !== "flight" && (grounded || coyoteTime > 0)) {
          grounded = false;
          playerVelocity = JUMP_VELOCITY;
          holdTime = getCueHoldDuration(cues[cueIndex].action);
          coyoteTime = 0;
        }

        cueIndex += 1;
      }

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
    }

    const collisionResult =
      sectionKind === "flight"
        ? resolveSimulatedFlightCollisions(
            obstacles,
            lavaZones,
            time,
            playerY,
            playerVelocity,
          )
        : resolveSimulatedCollisions(
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
    coyoteTime =
      sectionKind === "flight"
        ? 0
        : grounded
          ? COYOTE_TIME
          : Math.max(0, coyoteTime - SIMULATION_STEP);

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

    if (isGroundedBlockObstacle(obstacle)) {
      return {
        ...obstacle,
        width: clamp(obstacle.width * 0.88, 2.8, 5.8),
        height: clamp(obstacle.height - 0.22, 0.96, 1.96),
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

function forceClearCrashWindow(obstacles: Obstacle[], crashWindowStart: number, crashWindowEnd: number) {
  let changed = false;
  const nextObstacles = obstacles.filter((obstacle) => {
    const overlaps = obstacleEndTime(obstacle) >= crashWindowStart && obstacleStartTime(obstacle) <= crashWindowEnd;

    if (!overlaps) {
      return true;
    }

    changed = true;
    return false;
  });

  return {
    obstacles: nextObstacles,
    changed,
  };
}

function repairLayout(
  cues: BeatPoint[],
  obstacles: Obstacle[],
  lavaZones: LavaZone[],
  sections: LevelSection[],
  duration: number,
) {
  let repairedObstacles = [...obstacles];
  let repairedLavaZones = [...lavaZones];

  for (let iteration = 0; iteration < 24; iteration += 1) {
    const crash = simulateLayout(cues, repairedObstacles, repairedLavaZones, sections, duration);

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
      const forcedRepair = forceClearCrashWindow(
        repairedObstacles,
        crash.obstacleWindowStart,
        crash.obstacleWindowEnd,
      );

      repairedObstacles = forcedRepair.obstacles;

      if (!forcedRepair.changed) {
        break;
      }
    }
  }

  return {
    obstacles: normalizeObstacles(repairedObstacles, duration),
    lavaZones: normalizeLavaZones(repairedLavaZones, duration),
  };
}

export function analyzeAudioBuffer(buffer: AudioBuffer, trackId: TrackId = "default"): LevelData {
  const mono = createMonoBuffer(buffer);
  const frameSize = 1024;
  const hopSize = 512;
  const frameCount = Math.max(1, Math.floor(Math.max(0, mono.length - frameSize) / hopSize) + 1);
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
  const smoothedRms = smooth(normalizedRms, 2);
  const smoothedFlux = smooth(normalizedFlux, 1);
  const pulseEnvelope = normalize(
    smoothedFlux.map((value, index) => {
      const previousRms = smoothedRms[index - 1] ?? (smoothedRms[index] ?? 0);
      const previousFlux = smoothedFlux[index - 1] ?? value;
      const rmsRise = Math.max(0, (smoothedRms[index] ?? 0) - previousRms);
      const fluxRise = Math.max(0, value - previousFlux);

      return value * 0.36 + fluxRise * 0.94 + rmsRise * 0.58 + (smoothedRms[index] ?? 0) * 0.18;
    }),
  );
  const displayEnergy = smooth(
    smoothedRms.map((value, index) => value * 0.58 + (smoothedFlux[index] ?? 0) * 0.42),
    2,
  );
  const frameDuration = hopSize / buffer.sampleRate;
  const detectedBeats = detectBeats(pulseEnvelope, smoothedRms, frameDuration);
  const beatInterval = estimateBeatInterval(detectedBeats, pulseEnvelope, frameDuration, buffer.duration);
  const gridBeats = createJumpTimeline(detectedBeats, buffer.duration, beatInterval);
  const layout = buildLevelLayout(gridBeats, buffer.duration, trackId);
  const repairedLayout = repairLayout(
    layout.cues,
    layout.obstacles,
    layout.lavaZones,
    layout.sections,
    buffer.duration,
  );

  return {
    trackId,
    duration: buffer.duration,
    beatInterval,
    waveform: sampleBuckets(mono, WAVEFORM_BAR_COUNT),
    energyCurve: sampleBuckets(displayEnergy, ENERGY_SAMPLE_COUNT),
    beats: layout.cues,
    obstacles: repairedLayout.obstacles,
    lavaZones: repairedLayout.lavaZones,
    cameraMoments: layout.cameraMoments,
    sections: layout.sections,
  };
}
