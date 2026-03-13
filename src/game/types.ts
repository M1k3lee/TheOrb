export type GameStatus =
  | "loading"
  | "ready"
  | "playing"
  | "crashed"
  | "finished"
  | "error";

export interface BeatPoint {
  time: number;
  strength: number;
  lane: number;
}

export interface Obstacle {
  kind: "spike" | "block";
  time: number;
  width: number;
  height: number;
  spikes: number;
  hue: number;
  glow: number;
}

export interface LevelData {
  duration: number;
  beatInterval: number;
  waveform: number[];
  energyCurve: number[];
  beats: BeatPoint[];
  obstacles: Obstacle[];
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
