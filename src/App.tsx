import { useDeferredValue, useEffect, useRef, useState } from "react";
import trackUrl from "../assets/music/downboy.mp3";
import foundDaUrl from "../assets/music/Found da.mp3";
import type { TrackId } from "./game/types";
import { useRhythmGame } from "./game/useRhythmGame";
import { RhythmRunnerScene } from "./scene/RhythmRunnerScene";

type FullscreenStageElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: "landscape") => Promise<void>;
  unlock?: () => void;
};

type OrientationCapableScreen = Screen & {
  orientation?: LockableScreenOrientation;
  lockOrientation?: (orientation: "landscape") => boolean;
  mozLockOrientation?: (orientation: "landscape") => boolean;
  msLockOrientation?: (orientation: "landscape") => boolean;
  unlockOrientation?: () => void;
  mozUnlockOrientation?: () => void;
  msUnlockOrientation?: () => void;
};

function isFullscreenTarget(element: HTMLElement | null) {
  const fullscreenDocument = document as FullscreenDocument;

  return (
    document.fullscreenElement === element ||
    fullscreenDocument.webkitFullscreenElement === element
  );
}

function formatTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function shouldAutoRotateForFullscreen() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

async function lockLandscapeOrientation() {
  const orientationScreen = window.screen as OrientationCapableScreen;

  try {
    if (orientationScreen.orientation?.lock) {
      await orientationScreen.orientation.lock("landscape");
      return;
    }
  } catch {
    // Best effort only. Some browsers reject when fullscreen/orientation lock is unsupported.
  }

  orientationScreen.lockOrientation?.("landscape");
  orientationScreen.mozLockOrientation?.("landscape");
  orientationScreen.msLockOrientation?.("landscape");
}

function unlockLandscapeOrientation() {
  const orientationScreen = window.screen as OrientationCapableScreen;

  orientationScreen.orientation?.unlock?.();
  orientationScreen.unlockOrientation?.();
  orientationScreen.mozUnlockOrientation?.();
  orientationScreen.msUnlockOrientation?.();
}

const TRACK_OPTIONS = [
  { id: "downboy", label: "Downboy", url: trackUrl },
  { id: "found-da", label: "Found da", url: foundDaUrl },
] satisfies Array<{ id: TrackId; label: string; url: string }>;

const HERO_TAUNTS = {
  fresh: [
    "Your mate says you've no chance of getting 100%.",
    "Apparently this looked easier in your head.",
    "Confidence is doing a lot of heavy lifting here.",
    "Plenty of track. Shame about the driving.",
    "You only need perfect timing. Minor detail.",
  ],
  warmed: [
    "At this point the opening section knows you personally.",
    "You've really committed to not clearing this bit.",
    "The track believes in you less with every restart.",
    "Strong effort, if the goal was 12%.",
    "Even the cones have stopped respecting you.",
  ],
  tilted: [
    "Your mate has started asking if this is the tutorial.",
    "The first half still remains a rumor.",
    "Brave to keep queueing up the same mistake.",
    "You've turned failure into a daily ritual.",
    "This is less speedrun, more public struggle.",
  ],
  cooked: [
    "The level is now recycling insults to save time.",
    "You've died enough times to qualify as local scenery.",
    "At this point 100% is basically performance art.",
    "The orb is trying its best despite the management.",
    "The track has filed a quiet complaint.",
  ],
} as const;

const HINT_TAUNTS = {
  fresh: [
    "Just give up.",
    "Go on, miss the easy one.",
    "Perfect timing would be a nice change.",
    "Try not to embarrass the orb.",
    "That jump is not getting any kinder.",
  ],
  warmed: [
    "Still chasing 100%? Charming.",
    "The beat is consistent. The driver isn't.",
    "One clean run would really ruin the pattern.",
    "Your Da Sells Avon.",
    "You've nearly mastered crashing in new places.",
    "Maybe this attempt will include landing.",
  ],
  tilted: [
    "You know the jump is coming. Fascinating that it still works.",
    "The track is practically sending you a calendar invite.",
    "All this practice and still no agreement with the beat.",
    "Another restart? The level was hoping you'd say that.",
    "If stubbornness scored points you'd be done already.",
  ],
  cooked: [
    "The orb wants a transfer.",
    "This would be a great run if failure was the objective.",
    "You're not learning, you're rehearsing.",
    "Even the exit button thinks this is getting bleak.",
    "No rush. 100% is only several bad decisions away.",
  ],
} as const;

type TauntTier = keyof typeof HERO_TAUNTS;

function getTauntTier(deaths: number): TauntTier {
  if (deaths >= 14) {
    return "cooked";
  }

  if (deaths >= 7) {
    return "tilted";
  }

  if (deaths >= 3) {
    return "warmed";
  }

  return "fresh";
}

function pickTaunt(pool: readonly string[], seed: number, step: number) {
  if (pool.length === 0) {
    return "";
  }

  const index = Math.abs(seed + step * 7) % pool.length;

  return pool[index] ?? "";
}

export default function App() {
  const [selectedTrackId, setSelectedTrackId] = useState<TrackId>(TRACK_OPTIONS[0].id);
  const activeTrack = TRACK_OPTIONS.find((track) => track.id === selectedTrackId) ?? TRACK_OPTIONS[0];
  const { level, snapshot, snapshotRef, error, startGame, restartGame, continueGame } = useRhythmGame(
    activeTrack.url,
    activeTrack.id,
  );
  const stageRef = useRef<HTMLElement | null>(null);
  const tauntSeedRef = useRef(Math.floor(Math.random() * 10_000));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const requiresExplicitStart = shouldAutoRotateForFullscreen();
  const deferredProgress = useDeferredValue(snapshot.progress);
  const waveformBars = level?.waveform ?? [];
  const activeBar = Math.floor(deferredProgress * waveformBars.length);
  const canContinue = snapshot.status === "crashed";
  const showStartOverlay = requiresExplicitStart && snapshot.status === "ready";
  const tauntTier = getTauntTier(snapshot.deaths);
  const heroTaunt = pickTaunt(
    HERO_TAUNTS[tauntTier],
    tauntSeedRef.current + (activeTrack.id === "found-da" ? 19 : 7),
    snapshot.deaths + Math.round(snapshot.bestProgress * 12),
  );
  const hintTaunt = pickTaunt(
    HINT_TAUNTS[tauntTier],
    tauntSeedRef.current + 13,
    snapshot.deaths * 2 + (snapshot.status === "crashed" ? 1 : 0),
  );
  const statusHeading =
    snapshot.status === "loading"
      ? "Analyzing the track"
      : snapshot.status === "ready"
        ? "Forward run is armed"
        : snapshot.status === "playing"
          ? "Keep the orb clear"
          : snapshot.status === "crashed"
            ? "The orb shattered"
            : snapshot.status === "finished"
              ? "Run completed"
              : "Playback error";
  const statusCopy =
    snapshot.status === "loading"
      ? "Breaking the song into pulse points so the level, camera, and effects stay locked to the music."
      : snapshot.status === "ready"
        ? "The orb drives forward automatically now. You can jump at any time, but the level is authored around perfect beat hits and later climbs over lava."
      : snapshot.status === "playing"
          ? "You are always moving. Jump whenever you want, but the clean line is on the cue ring. Tap short, hold longer, and climb the block stacks cleanly."
          : snapshot.status === "crashed"
            ? `You made it ${Math.round(snapshot.progress * 100)}% through the run. Use Continue From Section on the stage to restart from the start of this section, or restart clean from zero.`
            : snapshot.status === "finished"
              ? "Full clear. Orb, obstacles, and music crossed the line together."
              : "The music could not be started cleanly. Try the launch button again.";
  const primaryAction =
    snapshot.status === "ready"
      ? {
          label: "Launch Run",
          action: () => void startGame(),
        }
      : snapshot.status === "crashed" || snapshot.status === "finished"
        ? {
            label: "Restart Run",
            action: () => void restartGame(),
        }
      : null;
  const stopStageControlInteraction = (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const handleStageContinue = (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    stopStageControlInteraction(event);
    void continueGame();
  };
  const handleStageRestart = (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    stopStageControlInteraction(event);
    void restartGame();
  };
  const handleStageStart = (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    stopStageControlInteraction(event);
    void startGame();
  };
  const handleFullscreenToggle = async () => {
    const stage = stageRef.current as FullscreenStageElement | null;
    const fullscreenDocument = document as FullscreenDocument;

    if (!stage) {
      return;
    }

    if (isFullscreenTarget(stage)) {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await fullscreenDocument.webkitExitFullscreen?.();
      }

      unlockLandscapeOrientation();

      return;
    }

    if (stage.requestFullscreen) {
      await stage.requestFullscreen();
    } else {
      await stage.webkitRequestFullscreen?.();
    }

    if (shouldAutoRotateForFullscreen()) {
      await lockLandscapeOrientation();
    }
  };

  useEffect(() => {
    const stage = stageRef.current as FullscreenStageElement | null;
    const fullscreenDocument = document as FullscreenDocument;
    const canRequest = Boolean(stage?.requestFullscreen || stage?.webkitRequestFullscreen);

    setFullscreenSupported(
      Boolean(document.fullscreenEnabled || canRequest || fullscreenDocument.webkitExitFullscreen),
    );

    const handleFullscreenChange = () => {
      const fullscreenActive = isFullscreenTarget(stageRef.current);

      setIsFullscreen(fullscreenActive);

      if (fullscreenActive) {
        if (shouldAutoRotateForFullscreen()) {
          void lockLandscapeOrientation();
        }

        return;
      }

      unlockLandscapeOrientation();
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange as EventListener);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange as EventListener);
    };
  }, []);

  return (
    <div className="app-shell">
      <div className="app-shell__glow app-shell__glow--left" />
      <div className="app-shell__glow app-shell__glow--right" />

      <main className="experience-frame">
        <header className="topbar">
          <div className="brand">
            <span className="eyebrow">Audio-locked orb runner</span>
            <h1>The Orb</h1>
            <p>{heroTaunt}</p>
          </div>

          <div className="meter-row">
            <div className="meter-card">
              <span className="meter-card__label">Track</span>
              <strong>{activeTrack.label}</strong>
              <span className="meter-card__detail">{level ? formatTime(level.duration) : "--:--"}</span>
            </div>
            <div className="meter-card">
              <span className="meter-card__label">Best</span>
              <strong>{Math.round(snapshot.bestProgress * 100)}%</strong>
            </div>
            <div className="meter-card">
              <span className="meter-card__label">Crashes</span>
              <strong>{snapshot.deaths}</strong>
            </div>
            <div className="meter-card meter-card--accent">
              <span className="meter-card__label">Status</span>
              <strong>{snapshot.status}</strong>
            </div>
          </div>
        </header>

        <section
          className="game-stage"
          data-fullscreen={isFullscreen}
          ref={stageRef}
        >
          <div className="canvas-wrap">
            <RhythmRunnerScene level={level} snapshot={snapshot} snapshotRef={snapshotRef} />
          </div>

          <div className="stage-overlay">
            {!isFullscreen ? (
              <>
              <div className="progress-panel">
                <div className="progress-panel__meta">
                  <span>Perfect sync</span>
                  <span>{Math.round(snapshot.progress * 100)}%</span>
                </div>
                <div className="progress-rail">
                  <div
                    className="progress-fill"
                    style={{ width: `${snapshot.progress * 100}%` }}
                  />
                </div>
              </div>

              <div className="overlay-footer">
                <div className="hint-chip">{hintTaunt}</div>
                {fullscreenSupported ? (
                  <button
                    aria-pressed={isFullscreen}
                    className="button button--ghost button--compact"
                    data-ui-interactive="true"
                    onClick={handleFullscreenToggle}
                    type="button"
                  >
                    Fullscreen
                  </button>
                ) : null}
              </div>
              </>
            ) : null}
          </div>

          {snapshot.status === "loading" ? (
            <div
              aria-atomic="true"
              aria-live="polite"
              className="stage-loading-indicator"
            >
              <span className="stage-loading-indicator__label">Loading</span>
              <span aria-hidden="true" className="stage-loading-indicator__dots">
                <span />
                <span />
                <span />
              </span>
            </div>
          ) : null}

          {showStartOverlay ? (
            <div className="stage-start-panel" data-ui-interactive="true">
              <span className="stage-start-panel__eyebrow">Track Ready</span>
              <h2>Start</h2>
              <p>Tap start to begin the run on mobile.</p>
              <button
                className="button button--primary"
                data-ui-interactive="true"
                onPointerDown={handleStageStart}
                type="button"
              >
                Start
              </button>
            </div>
          ) : null}

          {canContinue ? (
            <div className="stage-crash-panel" data-ui-interactive="true">
              <span className="stage-crash-panel__eyebrow">Run Interrupted</span>
              <h2>Continue from this section?</h2>
              <p>You crashed at {Math.round(snapshot.progress * 100)}%. Jump straight back in or restart from zero.</p>
              <div className="stage-crash-actions" data-ui-interactive="true">
                <button
                  className="button button--primary"
                  data-ui-interactive="true"
                  onClick={handleStageContinue}
                  onPointerDown={stopStageControlInteraction}
                  type="button"
                >
                  Continue From Section
                </button>
                <button
                  className="button button--ghost"
                  data-ui-interactive="true"
                  onClick={handleStageRestart}
                  onPointerDown={stopStageControlInteraction}
                  type="button"
                >
                  Restart From Zero
                </button>
              </div>
            </div>
          ) : null}

          {isFullscreen && fullscreenSupported ? (
            <button
              aria-label="Exit fullscreen"
              className="button button--ghost fullscreen-exit-button"
              data-ui-interactive="true"
              onClick={handleFullscreenToggle}
              type="button"
            >
              Exit
            </button>
          ) : null}
        </section>

        <section className="status-dock">
          <div className="status-dock__copy">
            <span className="overlay-panel__eyebrow">Pulse sequence</span>
            <h2>{statusHeading}</h2>
            <p>{statusCopy}</p>
            {error ? <p className="status-dock__error">{error}</p> : null}
          </div>

          <div className="action-row">
            <label className="track-picker" data-ui-interactive="true">
              <span className="meter-card__label">Track Select</span>
              <select
                className="track-picker__select"
                data-ui-interactive="true"
                onChange={(event) => setSelectedTrackId(event.target.value as TrackId)}
                value={selectedTrackId}
              >
                {TRACK_OPTIONS.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.label}
                  </option>
                ))}
              </select>
            </label>

            {primaryAction ? (
              <button
                className="button button--primary"
                data-ui-interactive="true"
                onClick={primaryAction.action}
                type="button"
              >
                {primaryAction.label}
              </button>
            ) : null}

            <button
              className="button button--ghost"
              data-ui-interactive="true"
              onClick={() => void restartGame()}
              type="button"
            >
              Hard Restart
            </button>
          </div>
        </section>

        <section className="waveform-panel">
          <div className="waveform-panel__header">
            <div>
              <span className="eyebrow">Waveform map</span>
              <h3>Track pulse preview</h3>
            </div>
            <p>
              The highlighted bars track your current position through the song.
              Spikes and rings are generated from the analyzed accents.
            </p>
          </div>

          <div className="waveform-grid" aria-hidden="true">
            {waveformBars.map((value, index) => (
              <span
                className={index <= activeBar ? "waveform-bar waveform-bar--active" : "waveform-bar"}
                key={`${index}-${value}`}
                style={{ height: `${18 + value * 82}%` }}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
