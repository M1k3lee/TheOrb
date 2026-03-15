import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  COYOTE_TIME,
  FALL_GRAVITY_MULTIPLIER,
  GRAVITY,
  GROUND_Y,
  HOLD_JUMP_GRAVITY_MULTIPLIER,
  JUMP_BUFFER_TIME,
  JUMP_VELOCITY,
  LOW_JUMP_GRAVITY_MULTIPLIER,
  MAX_HOLD_JUMP_TIME,
  PLAYER_RADIUS,
  RUN_SPEED,
} from "./constants";
import { RhythmAudioEngine } from "./audioEngine";
import type { AudioFrame, BeatPoint, GameSnapshot, GameStatus, LavaZone, LevelData, Obstacle } from "./types";

interface RuntimeState {
  status: GameStatus;
  time: number;
  playerY: number;
  playerVelocity: number;
  grounded: boolean;
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

function createRuntimeState(status: GameStatus): RuntimeState {
  return {
    status,
    time: 0,
    playerY: GROUND_Y,
    playerVelocity: 0,
    grounded: true,
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

function advanceCueIndex(cues: BeatPoint[], time: number, currentIndex: number) {
  let nextIndex = currentIndex;

  while (nextIndex < cues.length && cues[nextIndex].time < time - BEAT_LATE_WINDOW) {
    nextIndex += 1;
  }

  return nextIndex;
}

function findNearestCue(cues: BeatPoint[], time: number, currentIndex: number) {
  const nextIndex = advanceCueIndex(cues, time, currentIndex);
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

export function useRhythmGame(audioUrl: string) {
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
  const queuedJumpBoostRef = useRef(1);
  const queuedJumpHoldLimitRef = useRef(MAX_HOLD_JUMP_TIME);
  const launchSequenceRef = useRef(0);
  const isLaunchingRef = useRef(false);

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
    queuedJumpBoostRef.current = 1;
    queuedJumpHoldLimitRef.current = MAX_HOLD_JUMP_TIME;
    launchSequenceRef.current += 1;
    isLaunchingRef.current = false;
    setLevel(null);
    setError(null);
    setSnapshot(loadingSnapshot);

    void (async () => {
      try {
        const analyzedLevel = await engine.load(audioUrl);

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
  }, [audioUrl]);

  const launchRun = useEffectEvent(async () => {
    const engine = engineRef.current;
    const currentLevel = levelRef.current;
    const previousRuntime = runtimeRef.current;

    if (!engine || !currentLevel || isLaunchingRef.current) {
      return;
    }

    isLaunchingRef.current = true;
    const launchSequence = ++launchSequenceRef.current;

    try {
      await engine.start(0);

      if (launchSequence !== launchSequenceRef.current) {
        return;
      }

      runtimeRef.current = {
        ...previousRuntime,
        status: "playing",
        time: 0,
        playerY: GROUND_Y,
        playerVelocity: 0,
        grounded: true,
        crashFlash: 0,
      };
      jumpBufferRef.current = 0;
      jumpHeldRef.current = false;
      jumpHoldTimeRef.current = 0;
      coyoteTimeRef.current = COYOTE_TIME;
      nextCueIndexRef.current = 0;
      queuedJumpBoostRef.current = 1;
      queuedJumpHoldLimitRef.current = MAX_HOLD_JUMP_TIME;
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

  const queueJump = useEffectEvent(() => {
    const runtime = runtimeRef.current;

    if (runtime.status === "ready" || runtime.status === "crashed" || runtime.status === "finished") {
      void launchRun();
      return;
    }

    if (runtime.status !== "playing") {
      return;
    }

    const currentLevel = levelRef.current;

    if (!currentLevel) {
      return;
    }

    const cueIndex = advanceCueIndex(currentLevel.beats, runtime.time, nextCueIndexRef.current);
    nextCueIndexRef.current = cueIndex;
    const nearestCue = findNearestCue(currentLevel.beats, runtime.time, cueIndex);
    const beatError = Math.abs(nearestCue?.delta ?? Number.POSITIVE_INFINITY);

    if (beatError <= PERFECT_BEAT_WINDOW) {
      queuedJumpBoostRef.current = PERFECT_JUMP_BOOST;
      queuedJumpHoldLimitRef.current = Math.max(
        PERFECT_HOLD_LIMIT,
        nearestCue?.cue.action === "hold" || nearestCue?.cue.action === "climb"
          ? PERFECT_HOLD_LIMIT
          : MAX_HOLD_JUMP_TIME,
      );
    } else if (beatError <= GOOD_BEAT_WINDOW) {
      queuedJumpBoostRef.current = GOOD_JUMP_BOOST;
      queuedJumpHoldLimitRef.current = Math.max(
        GOOD_HOLD_LIMIT,
        nearestCue?.cue.action === "hold" || nearestCue?.cue.action === "climb"
          ? GOOD_HOLD_LIMIT
          : MAX_HOLD_JUMP_TIME,
      );
    } else {
      queuedJumpBoostRef.current = 1;
      queuedJumpHoldLimitRef.current = MAX_HOLD_JUMP_TIME;
    }

    jumpBufferRef.current = JUMP_BUFFER_TIME;
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
        event.code !== "KeyR"
      ) {
        return;
      }

      event.preventDefault();

      if (event.code === "KeyR") {
        void launchRun();
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
  }, [launchRun, queueJump, releaseJump]);

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
        runtime.time = engine.getCurrentTime();
        runtime.crashFlash = Math.max(0, runtime.crashFlash - delta * 1.3);
        jumpBufferRef.current = Math.max(0, jumpBufferRef.current - delta);
        nextCueIndexRef.current = advanceCueIndex(currentLevel.beats, runtime.time, nextCueIndexRef.current);
        coyoteTimeRef.current = runtime.grounded
          ? COYOTE_TIME
          : Math.max(0, coyoteTimeRef.current - delta);
        const previousY = runtime.playerY;
        const shouldJump = (runtime.grounded || coyoteTimeRef.current > 0) && jumpBufferRef.current > 0;

        if (shouldJump) {
          runtime.grounded = false;
          runtime.playerVelocity = JUMP_VELOCITY * queuedJumpBoostRef.current;
          jumpBufferRef.current = 0;
          jumpHoldTimeRef.current = queuedJumpHoldLimitRef.current;
          coyoteTimeRef.current = 0;
          queuedJumpBoostRef.current = 1;
          queuedJumpHoldLimitRef.current = MAX_HOLD_JUMP_TIME;
        }

        if (!runtime.grounded) {
          let gravity = GRAVITY;

          if (runtime.playerVelocity > 0) {
            if (jumpHeldRef.current && jumpHoldTimeRef.current > 0) {
              gravity *= HOLD_JUMP_GRAVITY_MULTIPLIER;
              jumpHoldTimeRef.current = Math.max(0, jumpHoldTimeRef.current - delta);
            } else {
              gravity *= LOW_JUMP_GRAVITY_MULTIPLIER;
            }
          } else {
            gravity *= FALL_GRAVITY_MULTIPLIER;
          }

          runtime.playerVelocity -= gravity * delta;
          runtime.playerY += runtime.playerVelocity * delta;
        } else if (runtime.playerY <= GROUND_Y + 0.001) {
          runtime.playerY = GROUND_Y;
          runtime.playerVelocity = 0;
          jumpHoldTimeRef.current = 0;
        }

        const collisionResult = resolvePlayerCollisions(
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
          queuedJumpBoostRef.current = 1;
          queuedJumpHoldLimitRef.current = MAX_HOLD_JUMP_TIME;
          engine.stop();
        } else if (runtime.time >= currentLevel.duration - 0.08) {
          runtime.status = "finished";
          runtime.time = currentLevel.duration;
          queuedJumpBoostRef.current = 1;
          queuedJumpHoldLimitRef.current = MAX_HOLD_JUMP_TIME;
          engine.stop();
        }

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
    queueJump,
  };
}
