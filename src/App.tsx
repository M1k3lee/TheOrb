import { useDeferredValue, useEffect, useRef, useState } from "react";
import trackUrl from "../assets/music/downboy.mp3";
import foundDaUrl from "../assets/music/Found da.mp3";
import { useRhythmGame } from "./game/useRhythmGame";
import { RhythmRunnerScene } from "./scene/RhythmRunnerScene";

type FullscreenStageElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
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

const TRACK_OPTIONS = [
  { id: "downboy", label: "Downboy", url: trackUrl },
  { id: "found-da", label: "Found da", url: foundDaUrl },
];

export default function App() {
  const [selectedTrackId, setSelectedTrackId] = useState(TRACK_OPTIONS[0].id);
  const activeTrack = TRACK_OPTIONS.find((track) => track.id === selectedTrackId) ?? TRACK_OPTIONS[0];
  const { level, snapshot, snapshotRef, error, startGame, restartGame } = useRhythmGame(activeTrack.url);
  const stageRef = useRef<HTMLElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const deferredProgress = useDeferredValue(snapshot.progress);
  const waveformBars = level?.waveform ?? [];
  const activeBar = Math.floor(deferredProgress * waveformBars.length);
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
        ? "The orb drives forward automatically now. Jump inputs only lock in on cue beats, and the later sections climb over lava."
      : snapshot.status === "playing"
          ? "You are always moving. Press on the cue ring, jab for a short hop, hold for a longer arc, and climb the block stacks cleanly."
          : snapshot.status === "crashed"
            ? `You made it ${Math.round(snapshot.progress * 100)}% through the run. Restart and clean up the next section.`
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

  useEffect(() => {
    const stage = stageRef.current as FullscreenStageElement | null;
    const fullscreenDocument = document as FullscreenDocument;
    const canRequest = Boolean(stage?.requestFullscreen || stage?.webkitRequestFullscreen);

    setFullscreenSupported(
      Boolean(document.fullscreenEnabled || canRequest || fullscreenDocument.webkitExitFullscreen),
    );

    const handleFullscreenChange = () => {
      setIsFullscreen(isFullscreenTarget(stageRef.current));
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
            <p>
              A neon orb runner where the jumps, hazards, and camera hits stay
              locked to the pulse.
            </p>
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
              <div className="hint-chip">Cue lock: press on the ring, tap short, hold long</div>
              {fullscreenSupported ? (
                <button
                  aria-pressed={isFullscreen}
                  className="button button--ghost button--compact"
                  data-ui-interactive="true"
                  onClick={() => {
                    const stage = stageRef.current as FullscreenStageElement | null;
                    const fullscreenDocument = document as FullscreenDocument;

                    if (!stage) {
                      return;
                    }

                    if (isFullscreenTarget(stage)) {
                      if (document.fullscreenElement) {
                        void document.exitFullscreen();
                      } else {
                        void fullscreenDocument.webkitExitFullscreen?.();
                      }

                      return;
                    }

                    if (stage.requestFullscreen) {
                      void stage.requestFullscreen();
                    } else {
                      void stage.webkitRequestFullscreen?.();
                    }
                  }}
                  type="button"
                >
                  {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                </button>
              ) : null}
            </div>
          </div>
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
                onChange={(event) => setSelectedTrackId(event.target.value)}
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
