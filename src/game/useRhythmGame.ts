import { useEffect, useEffectEvent, useRef, useState, type MutableRefObject } from "react";
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
  JUMP_BUFFER_TIME,
  JUMP_VELOCITY,
  LOW_JUMP_GRAVITY_MULTIPLIER,
  MAX_HOLD_JUMP_TIME,
  PHYSICS_STEP,
  PLAYER_COLLISION_RADIUS,
  RUN_SPEED,
} from "./constants";
import { RhythmAudioEngine } from "./audioEngine";
import type {
  AudioFrame,
  BeatPoint,
  GameSnapshot,
  GameStatus,
  LavaZone,
  LevelData,
  MovementMode,
  Obstacle,
  TrackId,
} from "./types";

interface RuntimeState {
  status: GameStatus;
  time: number;
  playerY: number;
  playerVelocity: number;
  grounded: boolean;
  movementMode: MovementMode;
  crashFlash: number;
  bestProgress: number;
  deaths: number;
}

interface CollisionResult {
  crashed: boolean;
  grounded: boolean;
  playerY: number;
  playerVelocity: number;
}

const IDLE_AUDIO: AudioFrame = {
  bass: 0.08,
  mid: 0.06,
  treble: 0.05,
  overall: 0.08,
};

const BEAT_LATE_WINDOW = 0.085;
const PERFECT_BEAT_WINDOW = 0.045;
const GOOD_BEAT_WINDOW = 0.09;
const PERFECT_JUMP_BOOST = 1.06;
const GOOD_JUMP_BOOST = 1.025;
const PERFECT_HOLD_LIMIT = 0.17;
const GOOD_HOLD_LIMIT = 0.15;
const LAVA_SURFACE_Y = 0.22;
const EARLY_BEAT_SNAP_WINDOW = 0.16;
const JUMP_SCHEDULE_TOLERANCE = 0.012;
const CONTINUE_MIN_LEAD_TIME = 1.05;
const CONTINUE_MAX_LEAD_TIME = 1.65;
const CONTINUE_SEARCH_STEP = 0.05;
const CONTINUE_RUN_SAFE_WINDOW = 0.95;
const CONTINUE_RUN_SAFE_WINDOW_MAX = 1.35;
const CONTINUE_FLIGHT_SAFE_WINDOW = 0.48;
const CONTINUE_FLIGHT_SAFE_WINDOW_MAX = 0.76;

function getBeatLateWindow(beatInterval: number) {
  return Math.min(BEAT_LATE_WINDOW, beatInterval * 0.24);
}

function getPerfectBeatWindow(beatInterval: number) {
  return Math.min(PERFECT_BEAT_WINDOW, beatInterval * 0.15);
}

function getGoodBeatWindow(beatInterval: number) {
  return Math.min(GOOD_BEAT_WINDOW, beatInterval * 0.28);
}

function getEarlyBeatSnapWindow(beatInterval: number) {
  return Math.min(EARLY_BEAT_SNAP_WINDOW, beatInterval * 0.42);
}

function getMovementModeForTime(level: LevelData | null, time: number): MovementMode {
  const sections = level?.sections;

  if (!sections) {
    return "run";
  }

  for (const section of sections) {
    if (time < section.startTime) {
      return "run";
    }

    if (time <= section.endTime) {
      return section.kind === "flight" ? "flight" : "run";
    }
  }

  return "run";
}

function getContinueLeadTime(beatInterval: number) {
  return Math.max(CONTINUE_MIN_LEAD_TIME, Math.min(CONTINUE_MAX_LEAD_TIME, beatInterval * 3.5));
}

function getContinueSafeWindow(beatInterval: number, movementMode: MovementMode) {
  if (movementMode === "flight") {
    return Math.max(
      CONTINUE_FLIGHT_SAFE_WINDOW,
      Math.min(CONTINUE_FLIGHT_SAFE_WINDOW_MAX, beatInterval * 1.55),
    );
  }

  return Math.max(
    CONTINUE_RUN_SAFE_WINDOW,
    Math.min(CONTINUE_RUN_SAFE_WINDOW_MAX, beatInterval * 2.45),
  );
}

function canResumeSafely(level: LevelData, startTime: number) {
  const runtime = createRuntimeAtTime(createRuntimeState("playing"), level, startTime);
  const safeUntil = Math.min(
    level.duration,
    startTime + getContinueSafeWindow(level.beatInterval, runtime.movementMode),
  );

  while (runtime.time + 0.0001 < safeUntil) {
    const stepDelta = Math.min(PHYSICS_STEP, safeUntil - runtime.time);
    const nextTime = runtime.time + stepDelta;
    const nextMovementMode = getMovementModeForTime(level, nextTime);

    if (runtime.movementMode !== nextMovementMode) {
      runtime.movementMode = nextMovementMode;
      runtime.playerVelocity = 0;

      if (nextMovementMode === "flight") {
        const flightLane = getFlightLaneForTime(level, nextTime);

        runtime.playerY = FLIGHT_LANE_HEIGHTS[flightLane] ?? FLIGHT_LANE_HEIGHTS[1];
        runtime.grounded = false;
      }
    }

    const previousY = runtime.playerY;

    if (runtime.movementMode === "flight") {
      runtime.grounded = false;
      runtime.playerVelocity -= FLIGHT_FALL_ACCELERATION * stepDelta;
      runtime.playerVelocity *= Math.exp(-FLIGHT_DRAG * stepDelta);
      runtime.playerVelocity = Math.max(
        -FLIGHT_MAX_SPEED,
        Math.min(FLIGHT_MAX_SPEED, runtime.playerVelocity),
      );
      runtime.playerY += runtime.playerVelocity * stepDelta;
    } else if (!runtime.grounded) {
      const gravity =
        runtime.playerVelocity > 0
          ? GRAVITY * LOW_JUMP_GRAVITY_MULTIPLIER
          : GRAVITY * FALL_GRAVITY_MULTIPLIER;

      runtime.playerVelocity -= gravity * stepDelta;
      runtime.playerY += runtime.playerVelocity * stepDelta;
    } else if (runtime.playerY <= GROUND_Y + 0.001) {
      runtime.playerY = GROUND_Y;
      runtime.playerVelocity = 0;
    }

    runtime.time = nextTime;

    const collisionResult =
      runtime.movementMode === "flight"
        ? resolveFlightCollisions(
            level.obstacles,
            level.lavaZones,
            runtime.time,
            runtime.playerY,
            runtime.playerVelocity,
          )
        : resolvePlayerCollisions(
            level.obstacles,
            level.lavaZones,
            runtime.time,
            previousY,
            runtime.playerY,
            runtime.playerVelocity,
          );

    if (collisionResult.crashed) {
      return false;
    }

    runtime.playerY = collisionResult.playerY;
    runtime.playerVelocity = collisionResult.playerVelocity;
    runtime.grounded = collisionResult.grounded;
  }

  return true;
}

function getContinueResumeTime(level: LevelData | null, time: number) {
  const sections = level?.sections;

  if (!sections || sections.length === 0) {
    return 0;
  }

  let checkpointTime = 0;

  for (const section of sections) {
    if (time < section.startTime) {
      break;
    }

    checkpointTime = section.startTime;

    if (time <= section.endTime) {
      break;
    }
  }

  const preferredResumeTime = Math.max(0, checkpointTime - getContinueLeadTime(level.beatInterval));
  let candidateTime = preferredResumeTime;

  while (candidateTime > 0) {
    if (canResumeSafely(level, candidateTime)) {
      return candidateTime;
    }

    candidateTime = Math.max(0, candidateTime - CONTINUE_SEARCH_STEP);
  }

  return 0;
}

function getFlightLaneForTime(level: LevelData | null, time: number) {
  const beats = level?.beats;

  if (!beats) {
    return 1;
  }

  for (const beat of beats) {
    if (beat.action !== "flight") {
      continue;
    }

    if (beat.time >= time - 0.04) {
      return beat.lane;
    }
  }

  return 1;
}

function createRuntimeAtTime(previousRuntime: RuntimeState, level: LevelData, time: number): RuntimeState {
  const movementMode = getMovementModeForTime(level, time);
  const flightLane = getFlightLaneForTime(level, time);
  const isFlight = movementMode === "flight";

  return {
    ...previousRuntime,
    status: "playing",
    time,
    playerY: isFlight ? (FLIGHT_LANE_HEIGHTS[flightLane] ?? FLIGHT_LANE_HEIGHTS[1]) : GROUND_Y,
    playerVelocity: 0,
    grounded: !isFlight,
    movementMode,
    crashFlash: 0,
  };
}

function createRuntimeState(status: GameStatus): RuntimeState {
  return {
    status,
    time: 0,
    playerY: GROUND_Y,
    playerVelocity: 0,
    grounded: true,
    movementMode: "run",
    crashFlash: 0,
    bestProgress: 0,
    deaths: 0,
  };
}

function buildSnapshot(runtime: RuntimeState, level: LevelData | null, audio: AudioFrame): GameSnapshot {
  return {
    status: runtime.status,
    time: runtime.time,
    progress: level ? Math.min(1, runtime.time / level.duration) : 0,
    playerY: runtime.playerY,
    playerVelocity: runtime.playerVelocity,
    grounded: runtime.grounded,
    movementMode: runtime.movementMode,
    audio,
    crashFlash: runtime.crashFlash,
    bestProgress: runtime.bestProgress,
    deaths: runtime.deaths,
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

function resolvePlayerCollisions(
  obstacles: Obstacle[],
  lavaZones: LavaZone[],
  time: number,
  previousY: number,
  nextY: number,
  nextVelocity: number,
): CollisionResult {
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

function resolveFlightCollisions(
  obstacles: Obstacle[],
  lavaZones: LavaZone[],
  time: number,
  nextY: number,
  nextVelocity: number,
): CollisionResult {
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

function createIdleAudio(now: number, level: LevelData | null, runtime: RuntimeState): AudioFrame {
  const pulse = 0.08 + (Math.sin(now * 0.0012) + 1) * 0.035;
  const energyIndex =
    level && level.energyCurve.length > 0
      ? Math.floor((now * 0.00007 * level.energyCurve.length) % level.energyCurve.length)
      : 0;
  const previewEnergy = level?.energyCurve[energyIndex] ?? 0;
  const crashBoost = runtime.crashFlash * 0.16;

  return {
    bass: Math.min(1, pulse + previewEnergy * 0.24 + crashBoost),
    mid: Math.min(1, 0.07 + previewEnergy * 0.16 + crashBoost * 0.6),
    treble: Math.min(1, 0.06 + previewEnergy * 0.12 + Math.cos(now * 0.0016) * 0.02),
    overall: Math.min(1, 0.1 + previewEnergy * 0.18 + crashBoost),
  };
}

function advanceCueIndex(cues: BeatPoint[], time: number, currentIndex: number, beatInterval: number) {
  const lateWindow = getBeatLateWindow(beatInterval);
  let nextIndex = currentIndex;

  while (nextIndex < cues.length && cues[nextIndex].time < time - lateWindow) {
    nextIndex += 1;
  }

  return nextIndex;
}

function findNearestCue(cues: BeatPoint[], time: number, currentIndex: number, beatInterval: number) {
  const nextIndex = advanceCueIndex(cues, time, currentIndex, beatInterval);
  const nextCue = cues[nextIndex] ?? null;
  const previousCue = nextIndex > 0 ? cues[nextIndex - 1] : null;

  if (!nextCue) {
    return previousCue
      ? { cue: previousCue, index: nextIndex - 1, delta: time - previousCue.time }
      : null;
  }

  if (!previousCue) {
    return { cue: nextCue, index: nextIndex, delta: nextCue.time - time };
  }

  const previousDelta = Math.abs(time - previousCue.time);
  const nextDelta = Math.abs(nextCue.time - time);

  return previousDelta <= nextDelta
    ? { cue: previousCue, index: nextIndex - 1, delta: time - previousCue.time }
    : { cue: nextCue, index: nextIndex, delta: nextCue.time - time };
}

function applyQueuedJumpTiming(
  action: BeatPoint["action"] | undefined,
  beatError: number,
  beatInterval: number,
  queuedJumpBoostRef: MutableRefObject<number>,
  queuedJumpHoldLimitRef: MutableRefObject<number>,
) {
  if (beatError <= getPerfectBeatWindow(beatInterval)) {
    queuedJumpBoostRef.current = PERFECT_JUMP_BOOST;
    queuedJumpHoldLimitRef.current = Math.max(
      PERFECT_HOLD_LIMIT,
      action === "hold" || action === "climb"
        ? PERFECT_HOLD_LIMIT
        : MAX_HOLD_JUMP_TIME,
    );
    return;
  }

  if (beatError <= getGoodBeatWindow(beatInterval)) {
    queuedJumpBoostRef.current = GOOD_JUMP_BOOST;
    queuedJumpHoldLimitRef.current = Math.max(
      GOOD_HOLD_LIMIT,
      action === "hold" || action === "climb"
        ? GOOD_HOLD_LIMIT
        : MAX_HOLD_JUMP_TIME,
    );
    return;
  }

  queuedJumpBoostRef.current = 1;
  queuedJumpHoldLimitRef.current = MAX_HOLD_JUMP_TIME;
}

function clearQueuedJumpState(
  jumpBufferRef: MutableRefObject<number>,
  scheduledJumpTimeRef: MutableRefObject<number | null>,
  queuedJumpBoostRef: MutableRefObject<number>,
  queuedJumpHoldLimitRef: MutableRefObject<number>,
) {
  jumpBufferRef.current = 0;
  scheduledJumpTimeRef.current = null;
  queuedJumpBoostRef.current = 1;
  queuedJumpHoldLimitRef.current = MAX_HOLD_JUMP_TIME;
}

function resetMovementModeState(
  runtime: RuntimeState,
  nextMovementMode: MovementMode,
  jumpBufferRef: MutableRefObject<number>,
  jumpHoldTimeRef: MutableRefObject<number>,
  coyoteTimeRef: MutableRefObject<number>,
  scheduledJumpTimeRef: MutableRefObject<number | null>,
  queuedJumpBoostRef: MutableRefObject<number>,
  queuedJumpHoldLimitRef: MutableRefObject<number>,
) {
  if (runtime.movementMode === nextMovementMode) {
    return;
  }

  runtime.movementMode = nextMovementMode;
  clearQueuedJumpState(
    jumpBufferRef,
    scheduledJumpTimeRef,
    queuedJumpBoostRef,
    queuedJumpHoldLimitRef,
  );
  jumpHoldTimeRef.current = 0;
  coyoteTimeRef.current = 0;

  if (nextMovementMode === "flight") {
    runtime.grounded = false;
    runtime.playerVelocity = 0;
  }
}

function tryConsumeQueuedJump(
  runtime: RuntimeState,
  jumpBufferRef: MutableRefObject<number>,
  jumpHoldTimeRef: MutableRefObject<number>,
  coyoteTimeRef: MutableRefObject<number>,
  scheduledJumpTimeRef: MutableRefObject<number | null>,
  queuedJumpBoostRef: MutableRefObject<number>,
  queuedJumpHoldLimitRef: MutableRefObject<number>,
) {
  const dueScheduledJump =
    scheduledJumpTimeRef.current !== null &&
    runtime.time + JUMP_SCHEDULE_TOLERANCE >= scheduledJumpTimeRef.current;
  const shouldJump =
    runtime.movementMode === "run" &&
    (runtime.grounded || coyoteTimeRef.current > 0) &&
    jumpBufferRef.current > 0 &&
    (scheduledJumpTimeRef.current === null || dueScheduledJump);

  if (!shouldJump) {
    return false;
  }

  runtime.grounded = false;
  runtime.playerVelocity = JUMP_VELOCITY * queuedJumpBoostRef.current;
  jumpBufferRef.current = 0;
  scheduledJumpTimeRef.current = null;
  jumpHoldTimeRef.current = queuedJumpHoldLimitRef.current;
  coyoteTimeRef.current = 0;
  queuedJumpBoostRef.current = 1;
  queuedJumpHoldLimitRef.current = MAX_HOLD_JUMP_TIME;

  return true;
}

export function useRhythmGame(audioUrl: string, trackId: TrackId = "default") {
  const initialRuntime = createRuntimeState("loading");
  const initialSnapshot = buildSnapshot(initialRuntime, null, IDLE_AUDIO);
  const [level, setLevel] = useState<LevelData | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<RhythmAudioEngine | null>(null);
  const levelRef = useRef<LevelData | null>(null);
  const runtimeRef = useRef<RuntimeState>(initialRuntime);
  const snapshotRef = useRef<GameSnapshot>(initialSnapshot);
  const uiSnapshotRef = useRef<GameSnapshot>(initialSnapshot);
  const lastUiCommitRef = useRef(0);
  const jumpBufferRef = useRef(0);
  const jumpHeldRef = useRef(false);
  const jumpHoldTimeRef = useRef(0);
  const coyoteTimeRef = useRef(0);
  const nextCueIndexRef = useRef(0);
  const scheduledJumpTimeRef = useRef<number | null>(null);
  const queuedJumpBoostRef = useRef(1);
  const queuedJumpHoldLimitRef = useRef(MAX_HOLD_JUMP_TIME);
  const launchSequenceRef = useRef(0);
  const isLaunchingRef = useRef(false);
  const pendingLaunchRequestedRef = useRef(false);

  const commitSnapshot = (audio: AudioFrame, forceUi = false) => {
    const nextSnapshot = buildSnapshot(runtimeRef.current, levelRef.current, audio);
    const previousUiSnapshot = uiSnapshotRef.current;
    const now = performance.now();
    const shouldCommitUi =
      forceUi ||
      nextSnapshot.status !== previousUiSnapshot.status ||
      nextSnapshot.deaths !== previousUiSnapshot.deaths ||
      Math.abs(nextSnapshot.progress - previousUiSnapshot.progress) >= 0.01 ||
      Math.abs(nextSnapshot.playerY - previousUiSnapshot.playerY) >= 0.18 ||
      Math.abs(nextSnapshot.crashFlash - previousUiSnapshot.crashFlash) >= 0.08 ||
      now - lastUiCommitRef.current >= 1000 / 15;

    snapshotRef.current = nextSnapshot;

    if (!shouldCommitUi) {
      return;
    }

    uiSnapshotRef.current = nextSnapshot;
    lastUiCommitRef.current = now;
    setSnapshot(nextSnapshot);
  };

  const syncRuntimeToAudioTime = (
    currentLevel: LevelData,
    targetTime: number,
    engine: RhythmAudioEngine | null,
  ) => {
    const runtime = runtimeRef.current;
    const clampedTargetTime = Math.max(runtime.time, Math.min(targetTime, currentLevel.duration));

    while (runtime.status === "playing" && runtime.time + 0.0001 < clampedTargetTime) {
      const stepDelta = Math.min(PHYSICS_STEP, clampedTargetTime - runtime.time);
      const nextTime = runtime.time + stepDelta;

      resetMovementModeState(
        runtime,
        getMovementModeForTime(currentLevel, nextTime),
        jumpBufferRef,
        jumpHoldTimeRef,
        coyoteTimeRef,
        scheduledJumpTimeRef,
        queuedJumpBoostRef,
        queuedJumpHoldLimitRef,
      );

      runtime.crashFlash = Math.max(0, runtime.crashFlash - stepDelta * 1.3);
      jumpBufferRef.current = Math.max(0, jumpBufferRef.current - stepDelta);
      nextCueIndexRef.current = advanceCueIndex(
        currentLevel.beats,
        nextTime,
        nextCueIndexRef.current,
        currentLevel.beatInterval,
      );
      coyoteTimeRef.current = runtime.grounded
        ? COYOTE_TIME
        : Math.max(0, coyoteTimeRef.current - stepDelta);

      tryConsumeQueuedJump(
        runtime,
        jumpBufferRef,
        jumpHoldTimeRef,
        coyoteTimeRef,
        scheduledJumpTimeRef,
        queuedJumpBoostRef,
        queuedJumpHoldLimitRef,
      );

      const previousY = runtime.playerY;

      if (runtime.movementMode === "flight") {
        runtime.grounded = false;

        const acceleration = jumpHeldRef.current
          ? FLIGHT_THRUST_ACCELERATION
          : -FLIGHT_FALL_ACCELERATION;

        runtime.playerVelocity += acceleration * stepDelta;
        runtime.playerVelocity *= Math.exp(-FLIGHT_DRAG * stepDelta);
        runtime.playerVelocity = Math.max(
          -FLIGHT_MAX_SPEED,
          Math.min(FLIGHT_MAX_SPEED, runtime.playerVelocity),
        );
        runtime.playerY += runtime.playerVelocity * stepDelta;
      } else if (!runtime.grounded) {
        let gravity = GRAVITY;

        if (runtime.playerVelocity > 0) {
          if (jumpHeldRef.current && jumpHoldTimeRef.current > 0) {
            gravity *= HOLD_JUMP_GRAVITY_MULTIPLIER;
            jumpHoldTimeRef.current = Math.max(0, jumpHoldTimeRef.current - stepDelta);
          } else {
            gravity *= LOW_JUMP_GRAVITY_MULTIPLIER;
          }
        } else {
          gravity *= FALL_GRAVITY_MULTIPLIER;
        }

        runtime.playerVelocity -= gravity * stepDelta;
        runtime.playerY += runtime.playerVelocity * stepDelta;
      } else if (runtime.playerY <= GROUND_Y + 0.001) {
        runtime.playerY = GROUND_Y;
        runtime.playerVelocity = 0;
        jumpHoldTimeRef.current = 0;
      }

      runtime.time = nextTime;

      const collisionResult =
        runtime.movementMode === "flight"
          ? resolveFlightCollisions(
              currentLevel.obstacles,
              currentLevel.lavaZones,
              runtime.time,
              runtime.playerY,
              runtime.playerVelocity,
            )
          : resolvePlayerCollisions(
              currentLevel.obstacles,
              currentLevel.lavaZones,
              runtime.time,
              previousY,
              runtime.playerY,
              runtime.playerVelocity,
            );

      runtime.playerY = collisionResult.playerY;
      runtime.playerVelocity = collisionResult.playerVelocity;
      runtime.grounded = collisionResult.grounded;

      if (runtime.grounded) {
        jumpHoldTimeRef.current = 0;
        coyoteTimeRef.current = COYOTE_TIME;
      }

      runtime.bestProgress = Math.max(runtime.bestProgress, runtime.time / currentLevel.duration);

      if (collisionResult.crashed) {
        runtime.status = "crashed";
        runtime.crashFlash = 1;
        runtime.deaths += 1;
        clearQueuedJumpState(
          jumpBufferRef,
          scheduledJumpTimeRef,
          queuedJumpBoostRef,
          queuedJumpHoldLimitRef,
        );
        engine?.stop();
        break;
      }

      if (runtime.time >= currentLevel.duration - 0.08) {
        runtime.status = "finished";
        runtime.time = currentLevel.duration;
        clearQueuedJumpState(
          jumpBufferRef,
          scheduledJumpTimeRef,
          queuedJumpBoostRef,
          queuedJumpHoldLimitRef,
        );
        engine?.stop();
        break;
      }
    }
  };

  useEffect(() => {
    let active = true;
    const engine = new RhythmAudioEngine();
    engineRef.current = engine;
    levelRef.current = null;
    runtimeRef.current = createRuntimeState("loading");
    const loadingSnapshot = buildSnapshot(runtimeRef.current, null, IDLE_AUDIO);
    snapshotRef.current = loadingSnapshot;
    uiSnapshotRef.current = loadingSnapshot;
    lastUiCommitRef.current = performance.now();
    nextCueIndexRef.current = 0;
    scheduledJumpTimeRef.current = null;
    queuedJumpBoostRef.current = 1;
    queuedJumpHoldLimitRef.current = MAX_HOLD_JUMP_TIME;
    launchSequenceRef.current += 1;
    isLaunchingRef.current = false;
    pendingLaunchRequestedRef.current = false;
    setLevel(null);
    setError(null);
    setSnapshot(loadingSnapshot);

    void (async () => {
      try {
        const analyzedLevel = await engine.load(audioUrl, trackId);

        if (!active) {
          return;
        }

        levelRef.current = analyzedLevel;
        runtimeRef.current.status = "ready";
        setLevel(analyzedLevel);
        commitSnapshot(createIdleAudio(performance.now(), analyzedLevel, runtimeRef.current), true);
      } catch (caughtError) {
        if (!active) {
          return;
        }

        runtimeRef.current.status = "error";
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "The music file could not be analyzed.",
        );
        commitSnapshot(IDLE_AUDIO, true);
      }
    })();

    return () => {
      active = false;
      engine.dispose();

      if (engineRef.current === engine) {
        engineRef.current = null;
      }
    };
  }, [audioUrl, trackId]);

  const startRunAt = useEffectEvent(async (startTime: number) => {
    const engine = engineRef.current;
    const currentLevel = levelRef.current;
    const previousRuntime = runtimeRef.current;

    if (!engine || !currentLevel || isLaunchingRef.current) {
      return;
    }

    isLaunchingRef.current = true;
    const launchSequence = ++launchSequenceRef.current;

    try {
      const safeStartTime = Math.max(0, Math.min(startTime, Math.max(0, currentLevel.duration - 0.3)));
      await engine.unlock();

      if (launchSequence !== launchSequenceRef.current) {
        return;
      }

      await engine.start(safeStartTime);

      if (launchSequence !== launchSequenceRef.current) {
        return;
      }

      runtimeRef.current = createRuntimeAtTime(previousRuntime, currentLevel, safeStartTime);
      jumpBufferRef.current = 0;
      jumpHeldRef.current = false;
      jumpHoldTimeRef.current = 0;
      coyoteTimeRef.current = runtimeRef.current.grounded ? COYOTE_TIME : 0;
      nextCueIndexRef.current = advanceCueIndex(
        currentLevel.beats,
        safeStartTime,
        0,
        currentLevel.beatInterval,
      );
      scheduledJumpTimeRef.current = null;
      queuedJumpBoostRef.current = 1;
      queuedJumpHoldLimitRef.current = MAX_HOLD_JUMP_TIME;
      pendingLaunchRequestedRef.current = false;
      setError(null);
      commitSnapshot({
        bass: 0.12,
        mid: 0.1,
        treble: 0.08,
        overall: 0.12,
      }, true);
    } catch (caughtError) {
      if (launchSequence !== launchSequenceRef.current) {
        return;
      }

      runtimeRef.current.status = "ready";
      pendingLaunchRequestedRef.current = false;
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Audio playback was blocked.",
      );
      commitSnapshot(createIdleAudio(performance.now(), currentLevel, runtimeRef.current), true);
    } finally {
      if (launchSequence === launchSequenceRef.current) {
        isLaunchingRef.current = false;
      }
    }
  });

  const launchRun = useEffectEvent(async () => {
    await startRunAt(0);
  });

  const continueRun = useEffectEvent(async () => {
    const currentLevel = levelRef.current;
    const runtime = runtimeRef.current;

    if (!currentLevel || (runtime.status !== "crashed" && runtime.status !== "finished")) {
      return;
    }

    const checkpointTime = getContinueResumeTime(currentLevel, Math.max(0, runtime.time - 0.04));
    await startRunAt(checkpointTime);
  });

  useEffect(() => {
    if (
      !pendingLaunchRequestedRef.current ||
      snapshot.status !== "ready" ||
      !level
    ) {
      return;
    }

    pendingLaunchRequestedRef.current = false;
    void launchRun();
  }, [level, launchRun, snapshot.status]);

  const queueJump = useEffectEvent(() => {
    const runtime = runtimeRef.current;

    if (runtime.status === "loading") {
      pendingLaunchRequestedRef.current = true;
      void engineRef.current?.unlock();
      return;
    }

    if (runtime.status === "ready" || runtime.status === "crashed" || runtime.status === "finished") {
      void launchRun();
      return;
    }

    if (runtime.status !== "playing") {
      return;
    }

    const currentLevel = levelRef.current;
    const engine = engineRef.current;

    if (!currentLevel) {
      return;
    }

    if (engine) {
      syncRuntimeToAudioTime(currentLevel, engine.getCurrentTime(), engine);
    }

    const liveRuntime = runtimeRef.current;

    if (liveRuntime.status !== "playing") {
      if (engine) {
        commitSnapshot(engine.sampleLevels());
      }

      return;
    }

    if (liveRuntime.movementMode === "flight") {
      clearQueuedJumpState(
        jumpBufferRef,
        scheduledJumpTimeRef,
        queuedJumpBoostRef,
        queuedJumpHoldLimitRef,
      );
      return;
    }

    const cueIndex = advanceCueIndex(
      currentLevel.beats,
      liveRuntime.time,
      nextCueIndexRef.current,
      currentLevel.beatInterval,
    );
    nextCueIndexRef.current = cueIndex;
    const nearestCue = findNearestCue(
      currentLevel.beats,
      liveRuntime.time,
      cueIndex,
      currentLevel.beatInterval,
    );
    const upcomingCue = currentLevel.beats[cueIndex] ?? null;
    const beatError = Math.abs(nearestCue?.delta ?? Number.POSITIVE_INFINITY);
    const earlyBeatSnapWindow = getEarlyBeatSnapWindow(currentLevel.beatInterval);

    let queuedEarlySnap = false;

    if (
      (liveRuntime.grounded || coyoteTimeRef.current > 0) &&
      upcomingCue &&
      upcomingCue.time >= liveRuntime.time
    ) {
      const earlyDelta = upcomingCue.time - liveRuntime.time;

      if (earlyDelta <= earlyBeatSnapWindow) {
        scheduledJumpTimeRef.current = upcomingCue.time;
        applyQueuedJumpTiming(
          upcomingCue.action,
          earlyDelta,
          currentLevel.beatInterval,
          queuedJumpBoostRef,
          queuedJumpHoldLimitRef,
        );
        jumpBufferRef.current = Math.max(JUMP_BUFFER_TIME, earlyDelta + JUMP_SCHEDULE_TOLERANCE);
        queuedEarlySnap = true;
      }
    }

    if (!queuedEarlySnap) {
      scheduledJumpTimeRef.current = null;
      applyQueuedJumpTiming(
        nearestCue?.cue.action,
        beatError,
        currentLevel.beatInterval,
        queuedJumpBoostRef,
        queuedJumpHoldLimitRef,
      );
      jumpBufferRef.current = JUMP_BUFFER_TIME;
    }

    tryConsumeQueuedJump(
      liveRuntime,
      jumpBufferRef,
      jumpHoldTimeRef,
      coyoteTimeRef,
      scheduledJumpTimeRef,
      queuedJumpBoostRef,
      queuedJumpHoldLimitRef,
    );

    if (engine) {
      commitSnapshot(engine.sampleLevels());
    }
  });

  const releaseJump = useEffectEvent(() => {
    jumpHeldRef.current = false;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" &&
        event.code !== "ArrowUp" &&
        event.code !== "KeyW" &&
        event.code !== "Enter" &&
        event.code !== "KeyR" &&
        event.code !== "KeyC"
      ) {
        return;
      }

      event.preventDefault();

        if (event.code === "KeyR") {
          if (runtimeRef.current.status === "loading") {
            pendingLaunchRequestedRef.current = true;
            void engineRef.current?.unlock();
            return;
          }

          void launchRun();
          return;
        }

        if (event.code === "KeyC") {
          void continueRun();
          return;
        }

      if (event.repeat) {
        return;
      }

      jumpHeldRef.current = true;
      queueJump();
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" &&
        event.code !== "ArrowUp" &&
        event.code !== "KeyW" &&
        event.code !== "Enter"
      ) {
        return;
      }

      releaseJump();
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (target instanceof HTMLElement && target.closest("[data-ui-interactive='true']")) {
        return;
      }

      jumpHeldRef.current = true;
      queueJump();
    };

    const handlePointerUp = () => {
      releaseJump();
    };

    window.addEventListener("keydown", handleKeyDown, { passive: false });
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("blur", handlePointerUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("blur", handlePointerUp);
    };
  }, [continueRun, launchRun, queueJump, releaseJump]);

  useEffect(() => {
    let animationFrame = 0;
    let previousFrame = performance.now();

    const tick = (now: number) => {
      const engine = engineRef.current;
      const currentLevel = levelRef.current;
      const runtime = runtimeRef.current;
      const delta = Math.min(0.05, (now - previousFrame) / 1000);
      previousFrame = now;

      if (runtime.status === "playing" && engine && currentLevel) {
        syncRuntimeToAudioTime(currentLevel, engine.getCurrentTime(), engine);
        commitSnapshot(engine.sampleLevels());
      } else {
        runtime.crashFlash = Math.max(0, runtime.crashFlash - delta * 1.1);
        commitSnapshot(createIdleAudio(now, currentLevel, runtime));
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return {
    level,
    snapshot,
    snapshotRef,
    error,
    startGame: launchRun,
    restartGame: launchRun,
    continueGame: continueRun,
    queueJump,
  };
}
