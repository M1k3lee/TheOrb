export type GameStatus =
  | "loading"
  | "ready"
  | "playing"
  | "crashed"
  | "finished"
  | "error";

export type TrackId = "downboy" | "found-da" | "default";
export type LevelSectionKind =
  | "ground"
  | "climb"
  | "drop"
  | "bridge"
  | "gauntlet"
  | "floating"
  | "tower";
export type LevelSectionTheme =
  | "pulse"
  | "solar"
  | "forge"
  | "void"
  | "sky"
  | "citadel"
  | "prism";

export interface BeatPoint {
  time: number;
  strength: number;
  lane: number;
  action: "tap" | "hold" | "step" | "bridge" | "climb";
}

export interface Obstacle {
  kind: "spike" | "block";
  time: number;
  baseY: number;
  width: number;
  height: number;
  spikes: number;
  hue: number;
  glow: number;
}

export interface LavaZone {
  startTime: number;
  endTime: number;
  intensity: number;
  hue: number;
}

export interface LevelSection {
  startTime: number;
  endTime: number;
  kind: LevelSectionKind;
  theme: LevelSectionTheme;
  intensity: number;
  variant: number;
}

export interface CameraMoment {
  time: number;
  duration: number;
  strength: number;
  style: "rear" | "hero" | "sweep" | "rush";
}

export interface LevelData {
  trackId: TrackId;
  duration: number;
  beatInterval: number;
  waveform: number[];
  energyCurve: number[];
  beats: BeatPoint[];
  obstacles: Obstacle[];
  lavaZones: LavaZone[];
  cameraMoments: CameraMoment[];
  sections: LevelSection[];
}

export interface AudioFrame {
  bass: number;
  mid: number;
  treble: number;
  overall: number;
}

export interface GameSnapshot {
  status: GameStatus;
  time: number;
  progress: number;
  playerY: number;
  playerVelocity: number;
  grounded: boolean;
  audio: AudioFrame;
  crashFlash: number;
  bestProgress: number;
  deaths: number;
}
