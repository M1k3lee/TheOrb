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
import type { AudioFrame, GameSnapshot, GameStatus, LevelData, Obstacle } from "./types";

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
    return 0;
  }

  const spikeWidth = obstacle.width / obstacle.spikes;
  const wrappedX = ((relativeX + halfWidth) % spikeWidth + spikeWidth) % spikeWidth;
  const triangle = 1 - Math.abs((wrappedX / spikeWidth) * 2 - 1);

  return obstacle.height * triangle;
}

function resolvePlayerCollisions(
  obstacles: Obstacle[],
  time: number,
  previousY: number,
  nextY: number,
  nextVelocity: number,
): CollisionResult {
  const bottomOffset = PLAYER_RADIUS * 0.84;
  const topOffset = PLAYER_RADIUS * 0.72;
  const previousBottom = previousY - bottomOffset;
  const playerBottom = nextY - bottomOffset;
  const playerTop = nextY + topOffset;
  let supportY = GROUND_Y;
  let grounded = nextY <= GROUND_Y;

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
    const withinBody = Math.abs(relativeX) < halfWidth + PLAYER_RADIUS * 0.62;
    const topSurface = obstacle.height;
    const canLand =
      withinBody &&
      nextVelocity <= 0 &&
      previousBottom >= topSurface - 0.06 &&
      playerBottom <= topSurface + 0.18;
    const isStanding =
      withinBody &&
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

    if (withinBody && playerBottom < topSurface - 0.04 && playerTop > 0.08) {
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

export function useRhythmGame(audioUrl: string) {
  const [level, setLevel] = useState<LevelData | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() =>
    buildSnapshot(createRuntimeState("loading"), null, IDLE_AUDIO),
  );
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<RhythmAudioEngine | null>(null);
  const levelRef = useRef<LevelData | null>(null);
  const runtimeRef = useRef<RuntimeState>(createRuntimeState("loading"));
  const jumpBufferRef = useRef(0);
  const jumpHeldRef = useRef(false);
  const jumpHoldTimeRef = useRef(0);
  const coyoteTimeRef = useRef(0);

  const commitSnapshot = (audio: AudioFrame) => {
    setSnapshot(buildSnapshot(runtimeRef.current, levelRef.current, audio));
  };

  useEffect(() => {
    let active = true;
    const engine = new RhythmAudioEngine();
    engineRef.current = engine;
    levelRef.current = null;
    runtimeRef.current = createRuntimeState("loading");
    setLevel(null);
    setError(null);
    setSnapshot(buildSnapshot(runtimeRef.current, null, IDLE_AUDIO));

    void (async () => {
      try {
        const analyzedLevel = await engine.load(audioUrl);

        if (!active) {
          return;
        }

        levelRef.current = analyzedLevel;
        runtimeRef.current.status = "ready";
        setLevel(analyzedLevel);
        commitSnapshot(createIdleAudio(performance.now(), analyzedLevel, runtimeRef.current));
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
        commitSnapshot(IDLE_AUDIO);
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

    if (!engine || !currentLevel) {
      return;
    }

    try {
      await engine.start(0);

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
      setError(null);
      commitSnapshot({
        bass: 0.12,
        mid: 0.1,
        treble: 0.08,
        overall: 0.12,
      });
    } catch (caughtError) {
      runtimeRef.current.status = "ready";
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Audio playback was blocked.",
      );
      commitSnapshot(createIdleAudio(performance.now(), currentLevel, runtimeRef.current));
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
        coyoteTimeRef.current = runtime.grounded
          ? COYOTE_TIME
          : Math.max(0, coyoteTimeRef.current - delta);
        const previousY = runtime.playerY;

        const shouldJump = (runtime.grounded || coyoteTimeRef.current > 0) && jumpBufferRef.current > 0;

        if (shouldJump) {
          runtime.grounded = false;
          runtime.playerVelocity = JUMP_VELOCITY;
          jumpBufferRef.current = 0;
          jumpHoldTimeRef.current = MAX_HOLD_JUMP_TIME;
          coyoteTimeRef.current = 0;
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
          engine.stop();
        } else if (runtime.time >= currentLevel.duration - 0.08) {
          runtime.status = "finished";
          runtime.time = currentLevel.duration;
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
    error,
    startGame: launchRun,
    restartGame: launchRun,
    queueJump,
  };
}
