import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import {
  GROUND_Y,
  PLAYER_RADIUS,
  PLAYER_TRACK_X,
  RUN_SPEED,
} from "../game/constants";
import type {
  BeatPoint,
  CameraMoment,
  GameSnapshot,
  LavaZone,
  LevelData,
  LevelSection,
  LevelSectionKind,
  LevelSectionTheme,
  Obstacle,
} from "../game/types";

const BACKDROP_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BACKDROP_FRAGMENT_SHADER = `
  varying vec2 vUv;

  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uCrash;
  uniform vec3 uDeep;
  uniform vec3 uPrimary;
  uniform vec3 uSecondary;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 local = fract(p);
    vec2 smoothLocal = local * local * (3.0 - 2.0 * local);

    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));

    return mix(mix(a, b, smoothLocal.x), mix(c, d, smoothLocal.x), smoothLocal.y);
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float time = uTime * 0.2;
    float flow = sin(uv.x * 3.2 + time * 2.4) * 0.15 + sin(uv.y * 5.4 - time * 1.4) * 0.12;
    float field = noise(uv * 2.8 + vec2(time * 0.8, -time * 0.3));
    float ribbon = smoothstep(0.72 + uBass * 0.25, 0.02, abs(uv.y + flow + field * 0.35));
    float bloomBand = smoothstep(0.52, 0.0, length(uv - vec2(-0.25, 0.22 + uMid * 0.08)));

    vec3 glow = mix(uPrimary, uSecondary, clamp(uv.x * 0.45 + uTreble * 0.5 + field * 0.1, 0.0, 1.0));

    vec3 color = uDeep;
    color += ribbon * glow * (0.35 + uMid * 1.25);
    color += bloomBand * mix(uPrimary, uDeep, 0.72);
    color += field * 0.04;
    color = mix(color, uSecondary, uCrash * 0.16);

    gl_FragColor = vec4(color, 0.96);
  }
`;

const LAVA_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LAVA_FRAGMENT_SHADER = `
  varying vec2 vUv;

  uniform float uTime;
  uniform float uIntensity;

  float stripe(float value, float width) {
    return smoothstep(0.5 - width, 0.5, sin(value) * 0.5 + 0.5);
  }

  void main() {
    float flow = vUv.x * 12.0 - uTime * (1.7 + uIntensity * 0.8);
    float wave = sin(vUv.x * 10.0 + uTime * 2.4) * 0.18 + cos(vUv.y * 18.0 - uTime * 3.1) * 0.12;
    float crack = stripe(flow + wave * 4.0, 0.18);
    float shimmer = stripe(flow * 1.6 - vUv.y * 9.0, 0.08);
    vec3 base = vec3(0.2, 0.02, 0.01);
    vec3 lava = mix(vec3(0.95, 0.22, 0.05), vec3(1.0, 0.76, 0.18), clamp(vUv.y + crack * 0.4, 0.0, 1.0));
    vec3 color = mix(base, lava, crack);
    color += shimmer * vec3(1.0, 0.85, 0.2) * (0.24 + uIntensity * 0.32);

    gl_FragColor = vec4(color, 0.96);
  }
`;

const LANE_OFFSETS = [-2.2, 0, 2.2] as const;
const EDGE_OFFSETS = [-4.35, 4.35] as const;
const TRACK_VIEW_AHEAD = 82;
const TRACK_VIEW_BEHIND = 18;
const CUE_VIEW_AHEAD = 72;
const CUE_VIEW_BEHIND = 12;
const MARKER_SPACING = 2.4;
const PYLON_SPACING = 9.6;
const TRAIL_COUNT = 5;
const SECTION_VIEW_PADDING = 1.1;

interface ThemePalette {
  deep: string;
  primary: string;
  secondary: string;
  fog: string;
  trackBase: string;
  trackGlow: string;
  rail: string;
  marker: string;
  markerAccent: string;
  pylon: string;
  pylonAccent: string;
  light: string;
}

const SECTION_PALETTES: Record<LevelSectionTheme, ThemePalette> = {
  pulse: {
    deep: "#06131c",
    primary: "#64fff2",
    secondary: "#ff9d52",
    fog: "#07161f",
    trackBase: "#08131c",
    trackGlow: "#103238",
    rail: "#74fff7",
    marker: "#68fef4",
    markerAccent: "#ff9a56",
    pylon: "#7cfff7",
    pylonAccent: "#ffb074",
    light: "#61fff1",
  },
  solar: {
    deep: "#160a0a",
    primary: "#ffb057",
    secondary: "#ffd86a",
    fog: "#190c0e",
    trackBase: "#1a0f0c",
    trackGlow: "#482112",
    rail: "#ffc875",
    marker: "#ffb15a",
    markerAccent: "#fff0a3",
    pylon: "#ffcc7a",
    pylonAccent: "#ffdca0",
    light: "#ffb667",
  },
  forge: {
    deep: "#170907",
    primary: "#ff6a3d",
    secondary: "#ffc054",
    fog: "#1a0a08",
    trackBase: "#160b09",
    trackGlow: "#431a12",
    rail: "#ff9054",
    marker: "#ff7447",
    markerAccent: "#ffd66b",
    pylon: "#ff8d58",
    pylonAccent: "#ffe08a",
    light: "#ff8147",
  },
  void: {
    deep: "#06071a",
    primary: "#6684ff",
    secondary: "#b26dff",
    fog: "#080b1e",
    trackBase: "#090d1a",
    trackGlow: "#182146",
    rail: "#7fa7ff",
    marker: "#7b90ff",
    markerAccent: "#b77aff",
    pylon: "#9eb3ff",
    pylonAccent: "#d38cff",
    light: "#8da1ff",
  },
  sky: {
    deep: "#071620",
    primary: "#7bf2ff",
    secondary: "#7ec5ff",
    fog: "#081822",
    trackBase: "#08141b",
    trackGlow: "#13323f",
    rail: "#84f3ff",
    marker: "#79e8ff",
    markerAccent: "#99c6ff",
    pylon: "#8eefff",
    pylonAccent: "#acd4ff",
    light: "#7bdfff",
  },
  citadel: {
    deep: "#10121f",
    primary: "#6effd0",
    secondary: "#9ee0ff",
    fog: "#111424",
    trackBase: "#0f1624",
    trackGlow: "#1f354d",
    rail: "#86ffdc",
    marker: "#76ffd2",
    markerAccent: "#93dfff",
    pylon: "#98ffee",
    pylonAccent: "#b2e6ff",
    light: "#82ffe0",
  },
  prism: {
    deep: "#10091a",
    primary: "#ff8ce3",
    secondary: "#6ce8ff",
    fog: "#140b20",
    trackBase: "#120d1c",
    trackGlow: "#31204c",
    rail: "#ffb7ef",
    marker: "#ff93e5",
    markerAccent: "#8ff0ff",
    pylon: "#ffafea",
    pylonAccent: "#9befff",
    light: "#ff91e3",
  },
};

type SnapshotRef = MutableRefObject<GameSnapshot>;

function createTrackWindow(currentTime: number, level: LevelData | null) {
  const currentX = currentTime * RUN_SPEED;
  const maxTrackX = level ? level.duration * RUN_SPEED + TRACK_VIEW_AHEAD * 0.5 : currentX + TRACK_VIEW_AHEAD;
  const startX = Math.max(-18, currentX - TRACK_VIEW_BEHIND);
  const endX = Math.max(startX + 28, Math.min(maxTrackX, currentX + TRACK_VIEW_AHEAD));

  return {
    startX,
    endX,
    centerX: startX + (endX - startX) * 0.5,
    length: endX - startX,
  };
}

function getVisibleBeats(beats: BeatPoint[], currentTime: number) {
  const startTime = Math.max(0, currentTime - CUE_VIEW_BEHIND / RUN_SPEED);
  const endTime = currentTime + CUE_VIEW_AHEAD / RUN_SPEED;
  const visible: BeatPoint[] = [];

  for (const beat of beats) {
    if (beat.time < startTime) {
      continue;
    }

    if (beat.time > endTime) {
      break;
    }

    visible.push(beat);
  }

  return visible;
}

function getVisibleObstacles(obstacles: Obstacle[], currentTime: number) {
  const windowStartX = currentTime * RUN_SPEED - TRACK_VIEW_BEHIND;
  const windowEndX = currentTime * RUN_SPEED + TRACK_VIEW_AHEAD;
  const visible: Obstacle[] = [];

  for (const obstacle of obstacles) {
    const obstacleX = obstacle.time * RUN_SPEED;
    const halfWidth = obstacle.width * 0.5;

    if (obstacleX + halfWidth < windowStartX) {
      continue;
    }

    if (obstacleX - halfWidth > windowEndX) {
      break;
    }

    visible.push(obstacle);
  }

  return visible;
}

function getVisibleLavaZones(lavaZones: LavaZone[], currentTime: number) {
  const windowStartTime = Math.max(0, currentTime - TRACK_VIEW_BEHIND / RUN_SPEED);
  const windowEndTime = currentTime + TRACK_VIEW_AHEAD / RUN_SPEED;
  const visible: LavaZone[] = [];

  for (const zone of lavaZones) {
    if (zone.endTime < windowStartTime) {
      continue;
    }

    if (zone.startTime > windowEndTime) {
      break;
    }

    visible.push(zone);
  }

  return visible;
}

function isXInsideLavaZone(lavaZones: LavaZone[], x: number) {
  for (const zone of lavaZones) {
    const startX = zone.startTime * RUN_SPEED;
    const endX = zone.endTime * RUN_SPEED;

    if (x < startX) {
      return false;
    }

    if (x <= endX) {
      return true;
    }
  }

  return false;
}

function createSafeTrackSegments(startX: number, endX: number, lavaZones: LavaZone[]) {
  const segments: Array<{ centerX: number; length: number }> = [];
  let cursor = startX;

  for (const zone of lavaZones) {
    const zoneStartX = Math.max(startX, zone.startTime * RUN_SPEED);
    const zoneEndX = Math.min(endX, zone.endTime * RUN_SPEED);

    if (zoneEndX <= zoneStartX) {
      continue;
    }

    if (zoneStartX > cursor + 0.35) {
      segments.push({
        centerX: cursor + (zoneStartX - cursor) * 0.5,
        length: zoneStartX - cursor,
      });
    }

    cursor = Math.max(cursor, zoneEndX);
  }

  if (endX > cursor + 0.35) {
    segments.push({
      centerX: cursor + (endX - cursor) * 0.5,
      length: endX - cursor,
    });
  }

  return segments;
}

function createMarkerPositions(startX: number, endX: number) {
  const positions: number[] = [];
  const startIndex = Math.floor(startX / MARKER_SPACING) - 1;
  const endIndex = Math.ceil(endX / MARKER_SPACING) + 1;

  for (let index = startIndex; index <= endIndex; index += 1) {
    positions.push(index * MARKER_SPACING);
  }

  return positions;
}

function createPylonPositions(startX: number, endX: number) {
  const positions: number[] = [];
  const startIndex = Math.floor(startX / PYLON_SPACING) - 1;
  const endIndex = Math.ceil(endX / PYLON_SPACING) + 1;

  for (let index = startIndex; index <= endIndex; index += 1) {
    positions.push(index * PYLON_SPACING);
  }

  return positions;
}

function getSectionPalette(theme: LevelSectionTheme | null | undefined) {
  if (!theme) {
    return SECTION_PALETTES.pulse;
  }

  return SECTION_PALETTES[theme] ?? SECTION_PALETTES.pulse;
}

function getActiveSection(sections: LevelSection[], time: number) {
  let fallback = sections[0] ?? null;

  for (const section of sections) {
    if (time < section.startTime) {
      return fallback;
    }

    fallback = section;

    if (time <= section.endTime) {
      return section;
    }
  }

  return sections[sections.length - 1] ?? fallback;
}

function getVisibleSections(sections: LevelSection[], currentTime: number) {
  const startTime = Math.max(0, currentTime - TRACK_VIEW_BEHIND / RUN_SPEED - SECTION_VIEW_PADDING);
  const endTime = currentTime + TRACK_VIEW_AHEAD / RUN_SPEED + SECTION_VIEW_PADDING;
  const visible: LevelSection[] = [];

  for (const section of sections) {
    if (section.endTime < startTime) {
      continue;
    }

    if (section.startTime > endTime) {
      break;
    }

    visible.push(section);
  }

  return visible;
}

function getSectionForTrackX(sections: LevelSection[], x: number) {
  return getActiveSection(sections, Math.max(0, x / RUN_SPEED));
}

function splitTrackSegmentsBySections(
  segments: Array<{ centerX: number; length: number }>,
  sections: LevelSection[],
) {
  const themedSegments: Array<{ centerX: number; length: number; section: LevelSection | null }> = [];

  for (const segment of segments) {
    const segmentStart = segment.centerX - segment.length * 0.5;
    const segmentEnd = segment.centerX + segment.length * 0.5;
    let cursor = segmentStart;

    while (cursor < segmentEnd - 0.04) {
      const activeSection = getSectionForTrackX(sections, cursor + 0.02);
      const cappedEnd = activeSection
        ? Math.min(segmentEnd, activeSection.endTime * RUN_SPEED)
        : segmentEnd;
      const nextCursor = Math.max(cursor + 0.08, cappedEnd);

      themedSegments.push({
        centerX: cursor + (nextCursor - cursor) * 0.5,
        length: nextCursor - cursor,
        section: activeSection,
      });

      cursor = nextCursor;
    }
  }

  return themedSegments;
}

function createSectionOffsets(length: number, spacing: number) {
  const count = Math.max(1, Math.min(9, Math.round(length / Math.max(6, spacing))));
  const step = length / count;

  return Array.from({ length: count }, (_, index) => -length * 0.5 + step * (index + 0.5));
}

function getActiveCameraMoment(cameraMoments: CameraMoment[], time: number) {
  for (let index = cameraMoments.length - 1; index >= 0; index -= 1) {
    const moment = cameraMoments[index];

    if (time < moment.time - 0.12) {
      continue;
    }

    if (time <= moment.time + moment.duration) {
      return moment;
    }

    if (time > moment.time + moment.duration) {
      break;
    }
  }

  return null;
}

function CameraRig({
  level,
  snapshotRef,
}: {
  level: LevelData | null;
  snapshotRef: SnapshotRef;
}) {
  const { camera } = useThree();
  const targetPosition = useRef(new THREE.Vector3());
  const lookTarget = useRef(new THREE.Vector3());
  const safetyLookTarget = useRef(new THREE.Vector3());

  useFrame((state, delta) => {
    const snapshot = snapshotRef.current;
    const beatInterval = level?.beatInterval ?? 0.52;
    const barDuration = beatInterval * 8;
    const barIndex = Math.floor(snapshot.time / Math.max(barDuration, 0.001));
    const activeMoment = level ? getActiveCameraMoment(level.cameraMoments, snapshot.time) : null;
    const shotIndex = barIndex % 6;
    const defaultShot =
      shotIndex === 2
        ? "chase"
        : shotIndex === 4
          ? "hero"
          : shotIndex === 5
            ? "sweep"
            : "default";
    const shot =
      activeMoment?.style === "rear"
        ? "chase"
        : activeMoment?.style === "hero"
          ? "hero"
          : activeMoment?.style === "sweep"
            ? "sweep"
            : activeMoment?.style === "rush"
              ? "rush"
              : defaultShot;
    const beatPhase = (snapshot.time / Math.max(beatInterval, 0.001)) % 1;
    const beatPulse = Math.max(0, 1 - Math.min(beatPhase, 1 - beatPhase) * 5);
    const momentStrength = activeMoment?.strength ?? 0;
    const impact = Math.max(snapshot.audio.bass, beatPulse * 0.55, momentStrength * 0.72);
    const shotFov =
      shot === "rush"
        ? 70
        : shot === "chase"
          ? 66
          : shot === "hero"
            ? 56
            : shot === "sweep"
              ? 60
              : 62;

    if (shot === "rush") {
      targetPosition.current.set(
        PLAYER_TRACK_X - 3 + snapshot.audio.mid * 0.26,
        5.2 + (snapshot.playerY - GROUND_Y) * 0.2 + impact * 0.4,
        12.4 - snapshot.audio.overall * 1.1,
      );
      lookTarget.current.set(
        PLAYER_TRACK_X + 12.4,
        snapshot.playerY * 0.92 + 0.92,
        -0.18 + Math.sin(state.clock.elapsedTime * 1.1) * 0.14,
      );
    } else if (shot === "chase") {
      targetPosition.current.set(
        PLAYER_TRACK_X - 7.2 + snapshot.audio.mid * 0.22,
        6 + (snapshot.playerY - GROUND_Y) * 0.18 + impact * 0.36,
        14.8 - snapshot.audio.overall * 1,
      );
      lookTarget.current.set(
        PLAYER_TRACK_X + 13.8,
        snapshot.playerY * 0.9 + 0.94,
        -0.08 + Math.sin(state.clock.elapsedTime * 0.9) * 0.18,
      );
    } else if (shot === "hero") {
      targetPosition.current.set(
        PLAYER_TRACK_X + 4.6 + snapshot.audio.mid * 0.22,
        12.8 + (snapshot.playerY - GROUND_Y) * 0.1 + impact * 0.28,
        24.8 - snapshot.audio.overall * 0.9,
      );
      lookTarget.current.set(
        PLAYER_TRACK_X + 13.2,
        snapshot.playerY * 0.84 + 0.98,
        -0.96,
      );
    } else if (shot === "sweep") {
      targetPosition.current.set(
        PLAYER_TRACK_X + 0.9 + snapshot.audio.mid * 0.18,
        10.8 + (snapshot.playerY - GROUND_Y) * 0.14 + impact * 0.3,
        22.2 - snapshot.audio.overall * 0.8,
      );
      lookTarget.current.set(
        PLAYER_TRACK_X + 14.4,
        snapshot.playerY * 0.84 + 0.98,
        -1.35 + Math.sin(state.clock.elapsedTime * 0.7) * 0.34,
      );
    } else {
      targetPosition.current.set(
        PLAYER_TRACK_X - 1.2 + snapshot.audio.mid * 0.42,
        9.8 + (snapshot.playerY - GROUND_Y) * 0.16 + impact * 0.4,
        37.6 - snapshot.audio.overall * 1.8,
      );
      lookTarget.current.set(
        PLAYER_TRACK_X + 24.4,
        snapshot.playerY * 0.84 + 0.96,
        -0.35 + Math.sin(state.clock.elapsedTime * 0.8) * 0.24,
      );
    }

    const playerAnchorX = PLAYER_TRACK_X + 8.8;
    const playerAnchorY = snapshot.playerY * 0.88 + 0.96;
    const safetyBlend =
      shot === "sweep"
        ? 0.44
        : shot === "hero"
          ? 0.38
          : shot === "rush"
            ? 0.34
            : 0.28;

    lookTarget.current.lerp(
      safetyLookTarget.current.set(playerAnchorX, playerAnchorY, 0),
      safetyBlend,
    );
    targetPosition.current.x = THREE.MathUtils.clamp(
      targetPosition.current.x,
      PLAYER_TRACK_X - 7.6,
      PLAYER_TRACK_X + 4.8,
    );
    targetPosition.current.z = THREE.MathUtils.clamp(targetPosition.current.z, 12, 36);
    lookTarget.current.x = THREE.MathUtils.clamp(
      lookTarget.current.x,
      PLAYER_TRACK_X + 8.4,
      PLAYER_TRACK_X + 15.2,
    );
    lookTarget.current.z = THREE.MathUtils.clamp(lookTarget.current.z, -1.3, 1.3);

    camera.position.lerp(targetPosition.current, 1 - Math.exp(-delta * 5));

    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov += (shotFov - camera.fov) * (1 - Math.exp(-delta * 5.4));
      camera.updateProjectionMatrix();
    }

    camera.lookAt(lookTarget.current);
  });

  return null;
}

function Atmosphere({
  level,
  snapshotRef,
}: {
  level: LevelData | null;
  snapshotRef: SnapshotRef;
}) {
  const { scene } = useThree();
  const fogColorRef = useRef(new THREE.Color(SECTION_PALETTES.pulse.fog));
  const targetFogColorRef = useRef(new THREE.Color(SECTION_PALETTES.pulse.fog));

  useFrame((_, delta) => {
    const snapshot = snapshotRef.current;
    const activeSection = level ? getActiveSection(level.sections, snapshot.time) : null;
    const palette = getSectionPalette(activeSection?.theme);

    targetFogColorRef.current.set(palette.fog);
    fogColorRef.current.lerp(targetFogColorRef.current, 1 - Math.exp(-delta * 2.4));

    if (scene.background instanceof THREE.Color) {
      scene.background.copy(fogColorRef.current);
    } else {
      scene.background = fogColorRef.current.clone();
    }

    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(fogColorRef.current);
    }
  });

  return null;
}

function Backdrop({
  level,
  snapshotRef,
}: {
  level: LevelData | null;
  snapshotRef: SnapshotRef;
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const deepColorRef = useRef(new THREE.Color(SECTION_PALETTES.pulse.deep));
  const primaryColorRef = useRef(new THREE.Color(SECTION_PALETTES.pulse.primary));
  const secondaryColorRef = useRef(new THREE.Color(SECTION_PALETTES.pulse.secondary));
  const targetDeepColorRef = useRef(new THREE.Color(SECTION_PALETTES.pulse.deep));
  const targetPrimaryColorRef = useRef(new THREE.Color(SECTION_PALETTES.pulse.primary));
  const targetSecondaryColorRef = useRef(new THREE.Color(SECTION_PALETTES.pulse.secondary));

  useFrame((state, delta) => {
    const snapshot = snapshotRef.current;
    const activeSection = level ? getActiveSection(level.sections, snapshot.time) : null;
    const palette = getSectionPalette(activeSection?.theme);
    const colorLerp = 1 - Math.exp(-delta * 2.8);

    if (!materialRef.current) {
      return;
    }

    targetDeepColorRef.current.set(palette.deep);
    targetPrimaryColorRef.current.set(palette.primary);
    targetSecondaryColorRef.current.set(palette.secondary);
    deepColorRef.current.lerp(targetDeepColorRef.current, colorLerp);
    primaryColorRef.current.lerp(targetPrimaryColorRef.current, colorLerp);
    secondaryColorRef.current.lerp(targetSecondaryColorRef.current, colorLerp);
    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    materialRef.current.uniforms.uBass.value = snapshot.audio.bass;
    materialRef.current.uniforms.uMid.value = snapshot.audio.mid;
    materialRef.current.uniforms.uTreble.value = snapshot.audio.treble;
    materialRef.current.uniforms.uCrash.value = snapshot.crashFlash;
    materialRef.current.uniforms.uDeep.value.copy(deepColorRef.current);
    materialRef.current.uniforms.uPrimary.value.copy(primaryColorRef.current);
    materialRef.current.uniforms.uSecondary.value.copy(secondaryColorRef.current);
  });

  return (
    <mesh position={[22, 14, -36]} rotation={[0.08, -0.3, 0]}>
      <planeGeometry args={[130, 72]} />
      <shaderMaterial
        ref={materialRef}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        fragmentShader={BACKDROP_FRAGMENT_SHADER}
        transparent
        uniforms={{
          uTime: { value: 0 },
          uBass: { value: 0 },
          uMid: { value: 0 },
          uTreble: { value: 0 },
          uCrash: { value: 0 },
          uDeep: { value: new THREE.Color(SECTION_PALETTES.pulse.deep) },
          uPrimary: { value: new THREE.Color(SECTION_PALETTES.pulse.primary) },
          uSecondary: { value: new THREE.Color(SECTION_PALETTES.pulse.secondary) },
        }}
        vertexShader={BACKDROP_VERTEX_SHADER}
      />
    </mesh>
  );
}

function ParticleField({
  level,
  snapshotRef,
}: {
  level: LevelData | null;
  snapshotRef: SnapshotRef;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const positionsRef = useRef<Float32Array | null>(null);
  const targetColorRef = useRef(new THREE.Color(SECTION_PALETTES.pulse.primary));

  if (!positionsRef.current) {
    const pointCount = 360;
    const positions = new Float32Array(pointCount * 3);

    for (let index = 0; index < pointCount; index += 1) {
      const stride = index * 3;
      positions[stride] = (Math.random() - 0.2) * 180;
      positions[stride + 1] = Math.random() * 40;
      positions[stride + 2] = -Math.random() * 34 - 2;
    }

    positionsRef.current = positions;
  }

  useFrame((state, delta) => {
    const snapshot = snapshotRef.current;
    const activeSection = level ? getActiveSection(level.sections, snapshot.time) : null;
    const palette = getSectionPalette(activeSection?.theme);

    if (!pointsRef.current) {
      return;
    }

    pointsRef.current.rotation.y += delta * 0.015;
    pointsRef.current.position.x = PLAYER_TRACK_X - snapshot.time * RUN_SPEED * 0.08;
    pointsRef.current.position.y = 4 + Math.sin(state.clock.elapsedTime * 0.3) * 0.4;

    if (!materialRef.current) {
      return;
    }

    targetColorRef.current.set(palette.primary);
    materialRef.current.color.lerp(targetColorRef.current, 1 - Math.exp(-delta * 4));
    materialRef.current.opacity = 0.44 + (activeSection?.intensity ?? 0.4) * 0.16;
    materialRef.current.size = 0.12 + snapshot.audio.overall * 0.08;
  });

  return (
    <points ref={pointsRef} position={[0, 5, -14]}>
      <bufferGeometry>
        <bufferAttribute
          args={[positionsRef.current, 3]}
          attach="attributes-position"
          count={(positionsRef.current?.length ?? 0) / 3}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        blending={THREE.AdditiveBlending}
        color="#8ffcff"
        depthWrite={false}
        opacity={0.54}
        size={0.14}
        sizeAttenuation
        transparent
      />
    </points>
  );
}

function Orb({ snapshotRef }: { snapshotRef: SnapshotRef }) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const crashRef = useRef<THREE.Mesh>(null);
  const haloMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const coreMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const crashMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const trailRefs = useRef<Array<THREE.Mesh | null>>([]);

  useFrame(() => {
    const snapshot = snapshotRef.current;
    const pulse = 1 + snapshot.audio.overall * 0.18;
    const stretch = Math.min(0.2, Math.abs(snapshot.playerVelocity) * 0.009);
    const scaleY = pulse * (snapshot.grounded ? 0.96 + snapshot.audio.bass * 0.1 : 1 + stretch);
    const scaleX = pulse * (snapshot.grounded ? 1.08 - snapshot.audio.bass * 0.04 : 1 - stretch * 0.35);
    const scaleZ = pulse * (1 + snapshot.audio.mid * 0.06);

    if (groupRef.current) {
      groupRef.current.position.set(PLAYER_TRACK_X, snapshot.playerY, 0);
    }

    if (ringRef.current) {
      ringRef.current.rotation.y = snapshot.time * 2.8 + snapshot.audio.overall * 0.6;
    }

    if (shadowRef.current) {
      shadowRef.current.position.y = -snapshot.playerY + 0.04;
    }

    if (coreRef.current) {
      coreRef.current.scale.set(scaleX, scaleY, scaleZ);
    }

    if (glowRef.current) {
      const glowScale = 1.9 + snapshot.audio.bass * 0.18;
      glowRef.current.scale.set(glowScale, glowScale, glowScale);
    }

    if (haloMaterialRef.current) {
      haloMaterialRef.current.opacity = 0.28 + snapshot.audio.mid * 0.22;
    }

    if (coreMaterialRef.current) {
      coreMaterialRef.current.emissiveIntensity = 2.6 + snapshot.audio.overall * 2.4;
    }

    if (lightRef.current) {
      lightRef.current.intensity = 5.6 + snapshot.audio.overall * 10;
    }

    for (let index = 0; index < TRAIL_COUNT; index += 1) {
      const mesh = trailRefs.current[index];

      if (!mesh) {
        continue;
      }

      const offset = index + 1;
      const trailScale = (1 - offset * 0.1) * 0.55;
      const lift = Math.sin(snapshot.time * 6 + offset * 0.6) * 0.08;

      mesh.position.set(-offset * 0.82, lift * 0.6, -offset * 0.06);
      mesh.scale.setScalar(trailScale);
    }

    if (!crashRef.current || !crashMaterialRef.current) {
      return;
    }

    const crashScale = 1 + snapshot.crashFlash * 4;
    crashRef.current.scale.set(crashScale, crashScale, crashScale);
    crashMaterialRef.current.opacity = snapshot.crashFlash * 0.45;
    crashRef.current.visible = snapshot.crashFlash > 0.01;
  });

  return (
    <group ref={groupRef} position={[PLAYER_TRACK_X, GROUND_Y, 0]}>
      <pointLight
        ref={lightRef}
        color="#8afefb"
        decay={2}
        distance={18}
        intensity={5.6}
      />

      <mesh ref={ringRef}>
        <torusGeometry args={[PLAYER_RADIUS * 0.86, PLAYER_RADIUS * 0.08, 12, 24]} />
        <meshBasicMaterial
          ref={haloMaterialRef}
          blending={THREE.AdditiveBlending}
          color="#9afcff"
          opacity={0.28}
          transparent
        />
      </mesh>

      <mesh ref={shadowRef} position={[0, -GROUND_Y + 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.1, 1.8, 32]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#59fff8"
          opacity={0.16}
          transparent
        />
      </mesh>

      {Array.from({ length: TRAIL_COUNT }).map((_, index) => (
        <mesh
          key={index}
          ref={(node) => {
            trailRefs.current[index] = node;
          }}
        >
          <sphereGeometry args={[PLAYER_RADIUS, 16, 16]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#58ffe7"
            opacity={0.15 - index * 0.018}
            transparent
          />
        </mesh>
      ))}

      <group ref={coreRef}>
        <mesh>
          <sphereGeometry args={[PLAYER_RADIUS, 28, 28]} />
          <meshStandardMaterial
            ref={coreMaterialRef}
            color="#edffff"
            emissive="#59fff0"
            emissiveIntensity={2.6}
            metalness={0.14}
            roughness={0.28}
          />
        </mesh>
        <mesh ref={glowRef} scale={[1.9, 1.9, 1.9]}>
          <sphereGeometry args={[PLAYER_RADIUS, 16, 16]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#3cf5ff"
            opacity={0.24}
            transparent
          />
        </mesh>
      </group>

      <mesh ref={crashRef} scale={[1, 1, 1]} visible={false}>
        <sphereGeometry args={[PLAYER_RADIUS, 16, 16]} />
        <meshBasicMaterial
          ref={crashMaterialRef}
          blending={THREE.AdditiveBlending}
          color="#ff8855"
          opacity={0}
          transparent
        />
      </mesh>
    </group>
  );
}

function LavaPool({ zone }: { zone: LavaZone }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const length = Math.max(2, (zone.endTime - zone.startTime) * RUN_SPEED);
  const centerX = (zone.startTime + zone.endTime) * RUN_SPEED * 0.5;
  const lavaGlowColor = `hsl(${zone.hue} 96% 58%)`;
  const lavaLightColor = `hsl(${zone.hue + 18} 100% 66%)`;

  useFrame((state) => {
    if (!materialRef.current) {
      return;
    }

    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    materialRef.current.uniforms.uIntensity.value = zone.intensity;
  });

  return (
    <group position={[centerX, 0, 0]}>
      <pointLight
        color={lavaGlowColor}
        distance={18 + length * 0.3}
        intensity={1.6 + zone.intensity * 2.2}
        position={[0, 0.45, 0]}
      />
      <mesh position={[0, -0.02, 0]}>
        <boxGeometry args={[length, 0.12, 8.5]} />
        <meshStandardMaterial color="#090707" emissive={lavaGlowColor} emissiveIntensity={0.12} roughness={1} />
      </mesh>
      <mesh position={[0, -0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[length, 7.8]} />
        <shaderMaterial
          ref={materialRef}
          fragmentShader={LAVA_FRAGMENT_SHADER}
          transparent
          uniforms={{
            uIntensity: { value: zone.intensity },
            uTime: { value: 0 },
          }}
          vertexShader={LAVA_VERTEX_SHADER}
        />
      </mesh>
      {[-3.85, 3.85].map((edge) => (
        <mesh key={edge} position={[0, 0.03, edge]}>
          <boxGeometry args={[length, 0.08, 0.16]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color={lavaLightColor}
            opacity={0.28 + zone.intensity * 0.16}
            transparent
          />
        </mesh>
      ))}
    </group>
  );
}

function BeatRing({
  beat,
  currentTime,
}: {
  beat: BeatPoint;
  currentTime: number;
}) {
  const proximity = Math.max(0, 1 - Math.abs(beat.time - currentTime) * 3.5);
  const actionScale =
    beat.action === "climb" ? 0.28 : beat.action === "hold" ? 0.18 : beat.action === "bridge" ? 0.12 : 0;
  const scale = 0.92 + beat.strength * 0.55 + proximity * 0.45 + actionScale;
  const brightness = 0.25 + beat.strength * 0.32 + proximity * 0.55;
  const actionHue =
    beat.action === "tap"
      ? 172
      : beat.action === "hold"
        ? 28
        : beat.action === "step"
          ? 194
          : beat.action === "bridge"
            ? 210
            : 8;
  const color = `hsl(${actionHue + beat.lane * 10} 92% 64%)`;

  return (
    <group
      position={[beat.time * RUN_SPEED, 2.8 + beat.lane * 1.4, -3.4 - beat.lane * 0.8]}
      scale={[scale, scale, scale]}
    >
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[1.15, 0.1, 10, 24]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color={color}
          opacity={brightness}
          transparent
        />
      </mesh>
      <mesh position={[0, -2.1, 0]} scale={[0.1, 4.4 + beat.strength * 2, 0.1]}>
        <cylinderGeometry args={[1, 1, 1, 8]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color={color}
          opacity={0.08 + proximity * 0.08}
          transparent
        />
      </mesh>
    </group>
  );
}

function Hazard({ obstacle }: { obstacle: Obstacle }) {
  if (obstacle.kind === "block") {
    return (
      <group position={[obstacle.time * RUN_SPEED, obstacle.baseY + obstacle.height / 2, 0]}>
        <mesh>
          <boxGeometry args={[obstacle.width, obstacle.height, 2.8]} />
          <meshStandardMaterial
            color={`hsl(${obstacle.hue} 78% 64%)`}
            emissive={`hsl(${obstacle.hue} 95% 55%)`}
            emissiveIntensity={0.82 + obstacle.glow * 1.2}
            metalness={0.12}
            roughness={0.22}
          />
        </mesh>
        <mesh position={[0, obstacle.height / 2 + 0.05, 0]}>
          <boxGeometry args={[obstacle.width * 0.92, 0.08, 2.3]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#d8ffff"
            opacity={0.22 + obstacle.glow * 0.2}
            transparent
          />
        </mesh>
        {obstacle.baseY > 0.16 ? (
          <mesh position={[0, -obstacle.height / 2 - obstacle.baseY / 2, 0]}>
            <boxGeometry args={[obstacle.width * 0.14, obstacle.baseY, 0.16]} />
            <meshBasicMaterial
              blending={THREE.AdditiveBlending}
              color="#4be4ff"
              opacity={0.08}
              transparent
            />
          </mesh>
        ) : null}
      </group>
    );
  }

  const spikes = Array.from({ length: obstacle.spikes });
  const spikeWidth = obstacle.width / obstacle.spikes;

  return (
    <group position={[obstacle.time * RUN_SPEED, obstacle.baseY + 0.02, 0]}>
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[obstacle.width * 0.44, obstacle.width * 0.52, 0.12, 16]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color={`hsl(${obstacle.hue} 92% 58%)`}
          opacity={obstacle.glow * 0.16}
          transparent
        />
      </mesh>

      {spikes.map((_, index) => {
        const x = -obstacle.width / 2 + spikeWidth * (index + 0.5);
        const height = obstacle.height * (0.94 + (index % 2) * 0.08);
        const radius = Math.max(0.28, spikeWidth * 0.34);

        return (
          <mesh key={index} position={[x, height / 2, 0]}>
            <coneGeometry args={[radius, height, 4]} />
            <meshStandardMaterial
              color={`hsl(${obstacle.hue} 92% 60%)`}
              emissive={`hsl(${obstacle.hue} 100% 52%)`}
              emissiveIntensity={1.4 + obstacle.glow * 1.2}
              metalness={0.16}
              roughness={0.32}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function getSectionSpacing(kind: LevelSectionKind) {
  if (kind === "gauntlet") {
    return 11;
  }

  if (kind === "bridge") {
    return 16;
  }

  if (kind === "tower") {
    return 18;
  }

  return 14;
}

function SectionScenery({ section }: { section: LevelSection }) {
  const palette = getSectionPalette(section.theme);
  const startX = section.startTime * RUN_SPEED;
  const endX = section.endTime * RUN_SPEED;
  const length = Math.max(12, endX - startX);
  const centerX = (startX + endX) * 0.5;
  const offsets = createSectionOffsets(length, getSectionSpacing(section.kind));
  const hazeOpacity = 0.04 + section.intensity * 0.04;
  const accentOpacity = 0.12 + section.intensity * 0.14;

  return (
    <group position={[centerX, 0, 0]}>
      <pointLight
        color={palette.light}
        distance={30 + length * 0.2}
        intensity={0.42 + section.intensity * 0.9}
        position={[0, 5.6 + section.variant * 0.5, -6]}
      />
      <mesh position={[0, 9 + section.variant * 0.8, -28]} rotation={[0.05, 0, 0]}>
        <planeGeometry args={[Math.max(34, length * 0.68), 18]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color={palette.primary}
          opacity={hazeOpacity}
          transparent
        />
      </mesh>

      {section.kind === "ground"
        ? offsets.map((offset, index) => (
            <group key={`${section.startTime}-ground-${offset}`} position={[offset, 0, 0]}>
              {[-1, 1].map((sign) => (
                <mesh
                  key={sign}
                  position={[0, 1.3 + (index % 2) * 0.35, sign * 6.2]}
                  rotation={[0, sign * 0.32, 0]}
                >
                  <boxGeometry args={[0.34, 2.4 + (index % 3) * 0.45, 1.7]} />
                  <meshBasicMaterial
                    blending={THREE.AdditiveBlending}
                    color={index % 2 === 0 ? palette.pylon : palette.pylonAccent}
                    opacity={accentOpacity}
                    transparent
                  />
                </mesh>
              ))}
            </group>
          ))
        : null}

      {section.kind === "climb"
        ? offsets.map((offset, index) => (
            <group key={`${section.startTime}-climb-${offset}`} position={[offset, 0, 0]}>
              {[-1, 1].map((sign) => (
                <group key={sign} position={[0, 4.8 + (index % 3) * 0.55, sign * 6.2]}>
                  <mesh rotation={[0.4, index * 0.35, sign * 0.24]}>
                    <octahedronGeometry args={[0.94 + section.intensity * 0.45, 0]} />
                    <meshStandardMaterial
                      color={sign > 0 ? palette.primary : palette.secondary}
                      emissive={sign > 0 ? palette.primary : palette.secondary}
                      emissiveIntensity={1.2}
                      metalness={0.18}
                      roughness={0.24}
                    />
                  </mesh>
                  <mesh position={[0, -2.8, 0]}>
                    <boxGeometry args={[0.12, 4.8, 0.12]} />
                    <meshBasicMaterial
                      blending={THREE.AdditiveBlending}
                      color={palette.rail}
                      opacity={0.22}
                      transparent
                    />
                  </mesh>
                </group>
              ))}
            </group>
          ))
        : null}

      {section.kind === "drop"
        ? offsets.map((offset, index) => (
            <group key={`${section.startTime}-drop-${offset}`} position={[offset, 0, 0]}>
              {[-1, 1].map((sign) => (
                <mesh
                  key={sign}
                  position={[0, 3.8 + (index % 2) * 0.7, sign * 6.9]}
                  rotation={[0, 0, sign * 0.22]}
                >
                  <boxGeometry args={[0.26, 7.4 + (index % 3) * 1.2, 1.08]} />
                  <meshBasicMaterial
                    blending={THREE.AdditiveBlending}
                    color={sign > 0 ? palette.primary : palette.secondary}
                    opacity={accentOpacity}
                    transparent
                  />
                </mesh>
              ))}
            </group>
          ))
        : null}

      {section.kind === "bridge"
        ? offsets.map((offset) => (
            <group key={`${section.startTime}-bridge-${offset}`} position={[offset, 0, 0]}>
              {[-1, 1].map((sign) => (
                <mesh key={sign} position={[0, 2.7, sign * 4.9]}>
                  <boxGeometry args={[0.2, 5.4, 0.2]} />
                  <meshBasicMaterial
                    blending={THREE.AdditiveBlending}
                    color={palette.pylon}
                    opacity={0.18 + section.intensity * 0.08}
                    transparent
                  />
                </mesh>
              ))}
              <mesh position={[0, 5.35, 0]}>
                <boxGeometry args={[0.2, 0.2, 9.8]} />
                <meshBasicMaterial
                  blending={THREE.AdditiveBlending}
                  color={palette.pylonAccent}
                  opacity={0.16 + section.intensity * 0.08}
                  transparent
                />
              </mesh>
              <mesh position={[0, 3.2, 0]} rotation={[0, Math.PI / 2, 0]}>
                <torusGeometry args={[4.95, 0.07, 10, 28]} />
                <meshBasicMaterial
                  blending={THREE.AdditiveBlending}
                  color={palette.secondary}
                  opacity={0.12 + section.intensity * 0.08}
                  transparent
                />
              </mesh>
            </group>
          ))
        : null}

      {section.kind === "gauntlet"
        ? offsets.map((offset) => (
            <group key={`${section.startTime}-gauntlet-${offset}`} position={[offset, 0, 0]}>
              {[-1, 1].map((sign) => (
                <mesh key={sign} position={[0, 2.35, sign * 3.95]}>
                  <boxGeometry args={[0.22, 4.7, 0.22]} />
                  <meshBasicMaterial
                    blending={THREE.AdditiveBlending}
                    color={palette.primary}
                    opacity={0.18 + section.intensity * 0.08}
                    transparent
                  />
                </mesh>
              ))}
              <mesh position={[0, 4.65, 0]}>
                <boxGeometry args={[0.22, 0.22, 8.1]} />
                <meshBasicMaterial
                  blending={THREE.AdditiveBlending}
                  color={palette.secondary}
                  opacity={0.18 + section.intensity * 0.08}
                  transparent
                />
              </mesh>
              <mesh position={[0, 2.25, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[4.05, 0.06, 10, 22]} />
                <meshBasicMaterial
                  blending={THREE.AdditiveBlending}
                  color={palette.markerAccent}
                  opacity={0.12 + section.intensity * 0.08}
                  transparent
                />
              </mesh>
            </group>
          ))
        : null}

      {section.kind === "floating"
        ? offsets.map((offset, index) => (
            <group key={`${section.startTime}-floating-${offset}`} position={[offset, 0, 0]}>
              <mesh position={[0, 6.4 + (index % 2) * 0.7, -4.6 - (index % 3) * 0.6]} rotation={[0.28, index * 0.45, 0]}>
                <octahedronGeometry args={[1.28 + section.intensity * 0.38, 0]} />
                <meshStandardMaterial
                  color={palette.secondary}
                  emissive={palette.secondary}
                  emissiveIntensity={1.1}
                  metalness={0.12}
                  roughness={0.2}
                />
              </mesh>
              {[-1, 1].map((sign) => (
                <mesh
                  key={sign}
                  position={[0, 4.6 + (index % 3) * 0.45, sign * 6.4]}
                  rotation={[0.42, index * 0.3, sign * 0.28]}
                >
                  <dodecahedronGeometry args={[0.7 + section.intensity * 0.22, 0]} />
                  <meshStandardMaterial
                    color={palette.primary}
                    emissive={palette.primary}
                    emissiveIntensity={0.9}
                    metalness={0.08}
                    roughness={0.24}
                  />
                </mesh>
              ))}
            </group>
          ))
        : null}

      {section.kind === "tower"
        ? offsets.map((offset, index) => (
            <group key={`${section.startTime}-tower-${offset}`} position={[offset, 0, 0]}>
              {[-1, 1].map((sign) => {
                const height = 4.8 + (index % 3) * 1.2 + section.variant * 0.5;

                return (
                  <group key={sign} position={[0, 0, sign * 6.35]}>
                    <mesh position={[0, height * 0.5, 0]}>
                      <boxGeometry args={[1.18, height, 1.18]} />
                      <meshStandardMaterial
                        color={sign > 0 ? palette.pylon : palette.pylonAccent}
                        emissive={palette.trackGlow}
                        emissiveIntensity={0.58}
                        metalness={0.18}
                        roughness={0.32}
                      />
                    </mesh>
                    <mesh position={[0, height + 0.46, 0]}>
                      <sphereGeometry args={[0.26, 16, 16]} />
                      <meshBasicMaterial
                        blending={THREE.AdditiveBlending}
                        color={palette.light}
                        opacity={0.3}
                        transparent
                      />
                    </mesh>
                  </group>
                );
              })}
            </group>
          ))
        : null}
    </group>
  );
}

function Track({
  level,
  snapshot,
  snapshotRef,
}: {
  level: LevelData | null;
  snapshot: GameSnapshot;
  snapshotRef: SnapshotRef;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const trackWindow = createTrackWindow(snapshot.time, level);
  const cueBeats = level ? getVisibleBeats(level.beats, snapshot.time) : [];
  const obstacles = level ? getVisibleObstacles(level.obstacles, snapshot.time) : [];
  const lavaZones = level ? getVisibleLavaZones(level.lavaZones, snapshot.time) : [];
  const visibleSections = level ? getVisibleSections(level.sections, snapshot.time) : [];
  const trackSegments = createSafeTrackSegments(trackWindow.startX, trackWindow.endX, lavaZones);
  const themedTrackSegments = splitTrackSegmentsBySections(trackSegments, visibleSections);
  const trackMarkers = createMarkerPositions(trackWindow.startX, trackWindow.endX);
  const edgePylons = createPylonPositions(trackWindow.startX, trackWindow.endX);

  useFrame(() => {
    const liveSnapshot = snapshotRef.current;

    if (!groupRef.current) {
      return;
    }

    groupRef.current.position.x = PLAYER_TRACK_X - liveSnapshot.time * RUN_SPEED;
  });

  return (
    <group ref={groupRef} position={[PLAYER_TRACK_X - snapshot.time * RUN_SPEED, 0, 0]}>
      {visibleSections.map((section) => (
        <SectionScenery
          key={`${section.startTime}-${section.endTime}-${section.theme}-${section.kind}-${section.variant}`}
          section={section}
        />
      ))}

      {lavaZones.map((zone) => (
        <LavaPool key={`${zone.startTime}-${zone.endTime}`} zone={zone} />
      ))}

      {themedTrackSegments.map((segment) => {
        const palette = getSectionPalette(segment.section?.theme);

        return (
          <mesh key={`track-${segment.centerX}-${segment.section?.theme ?? "base"}`} position={[segment.centerX, -0.16, 0]}>
            <boxGeometry args={[segment.length, 0.24, 9.2]} />
            <meshStandardMaterial
              color={palette.trackBase}
              emissive={palette.trackGlow}
              emissiveIntensity={0.62 + snapshot.audio.overall * 0.48}
              metalness={0.18}
              roughness={0.6}
            />
          </mesh>
        );
      })}

      {themedTrackSegments.map((segment) => {
        const palette = getSectionPalette(segment.section?.theme);

        return (
          <mesh
            key={`surface-${segment.centerX}-${segment.section?.theme ?? "base"}`}
            position={[segment.centerX, 0.02, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[segment.length, 10]} />
            <meshStandardMaterial
              color={palette.deep}
              emissive={palette.trackGlow}
              emissiveIntensity={0.28 + (segment.section?.intensity ?? 0.4) * 0.26}
              metalness={0.06}
              roughness={0.9}
            />
          </mesh>
        );
      })}

      {themedTrackSegments.map((segment) => {
        const palette = getSectionPalette(segment.section?.theme);

        return (
          <group key={`lanes-${segment.centerX}-${segment.section?.theme ?? "base"}`}>
            {LANE_OFFSETS.map((lane) => (
              <mesh key={`${segment.centerX}-${lane}-${segment.section?.theme ?? "base"}-lane`} position={[segment.centerX, 0.04, lane]}>
                <boxGeometry args={[segment.length, 0.04, 0.09]} />
                <meshBasicMaterial
                  color={palette.rail}
                  opacity={0.26 + snapshot.audio.bass * 0.24}
                  transparent
                />
              </mesh>
            ))}
          </group>
        );
      })}

      {themedTrackSegments.map((segment) => {
        const palette = getSectionPalette(segment.section?.theme);

        return (
          <group key={`edges-${segment.centerX}-${segment.section?.theme ?? "base"}`}>
            {EDGE_OFFSETS.map((edge) => (
              <mesh key={`${segment.centerX}-${edge}-${segment.section?.theme ?? "base"}-edge`} position={[segment.centerX, 0.16, edge]}>
                <boxGeometry args={[segment.length, 0.18, 0.12]} />
                <meshBasicMaterial
                  color={palette.pylon}
                  opacity={0.22 + snapshot.audio.mid * 0.14}
                  transparent
                />
              </mesh>
            ))}
          </group>
        );
      })}

      {trackMarkers.map((markerX, index) => (
        isXInsideLavaZone(lavaZones, markerX) ? null : (() => {
          const section = getSectionForTrackX(level?.sections ?? [], markerX);
          const palette = getSectionPalette(section?.theme);

          return (
            <mesh key={markerX} position={[markerX, 0.03, 0]}>
              <boxGeometry args={[0.16, 0.03, 8.6]} />
              <meshBasicMaterial
                color={index % 4 === 0 ? palette.markerAccent : palette.marker}
                opacity={index % 4 === 0 ? 0.28 : 0.16}
                transparent
              />
            </mesh>
          );
        })()
      ))}

      {edgePylons.map((pylonX, index) => {
        const section = getSectionForTrackX(level?.sections ?? [], pylonX);
        const palette = getSectionPalette(section?.theme);

        return (
          <group key={pylonX} position={[pylonX, 0, 0]}>
            {EDGE_OFFSETS.map((edge) => (
              <mesh key={`${pylonX}-${edge}`} position={[0, 1.25 + (index % 2) * 0.2, edge - 0.25 * Math.sign(edge)]}>
                <boxGeometry args={[0.18, 2.2, 0.18]} />
                <meshBasicMaterial
                  color={index % 3 === 0 ? palette.pylonAccent : palette.pylon}
                  opacity={0.18}
                  transparent
                />
              </mesh>
            ))}
          </group>
        );
      })}

      {cueBeats.map((beat) => (
        <BeatRing beat={beat} currentTime={snapshot.time} key={beat.time} />
      ))}

      {obstacles.map((obstacle) => <Hazard key={obstacle.time} obstacle={obstacle} />)}
    </group>
  );
}

function PostEffects({ snapshot }: { snapshot: GameSnapshot }) {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.8 + snapshot.audio.overall * 0.8}
        luminanceSmoothing={0.38}
        luminanceThreshold={0.18}
        mipmapBlur
        radius={0.72}
      />
      <Vignette darkness={0.92} eskil={false} offset={0.2} />
    </EffectComposer>
  );
}

function SceneContent({
  level,
  snapshot,
  snapshotRef,
}: {
  level: LevelData | null;
  snapshot: GameSnapshot;
  snapshotRef: SnapshotRef;
}) {
  return (
    <>
      <color attach="background" args={[SECTION_PALETTES.pulse.fog]} />
      <fog attach="fog" args={[SECTION_PALETTES.pulse.fog, 18, 108]} />
      <Atmosphere level={level} snapshotRef={snapshotRef} />
      <ambientLight intensity={0.44} />
      <directionalLight color="#f5ffe8" intensity={1.55} position={[8, 18, 12]} />
      <pointLight color="#ff8c4a" distance={32} intensity={3.1} position={[14, 4, -10]} />
      <CameraRig level={level} snapshotRef={snapshotRef} />
      <Backdrop level={level} snapshotRef={snapshotRef} />
      <ParticleField level={level} snapshotRef={snapshotRef} />
      <Track level={level} snapshot={snapshot} snapshotRef={snapshotRef} />
      <Orb snapshotRef={snapshotRef} />
      <mesh position={[PLAYER_TRACK_X, GROUND_Y - PLAYER_RADIUS - 0.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[3.8, 32]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#55dff8"
          opacity={0.08 + snapshot.audio.overall * 0.05}
          transparent
        />
      </mesh>
      <PostEffects snapshot={snapshot} />
    </>
  );
}

export function RhythmRunnerScene({
  level,
  snapshot,
  snapshotRef,
}: {
  level: LevelData | null;
  snapshot: GameSnapshot;
  snapshotRef: SnapshotRef;
}) {
  return (
    <Canvas
      camera={{ fov: 62, position: [PLAYER_TRACK_X - 1.2, 9.8, 37.6], near: 0.1, far: 220 }}
      dpr={[1, 1.25]}
      gl={{ alpha: false, antialias: false, powerPreference: "high-performance", stencil: false }}
    >
      <SceneContent level={level} snapshot={snapshot} snapshotRef={snapshotRef} />
    </Canvas>
  );
}
