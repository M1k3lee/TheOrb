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
import type { BeatPoint, GameSnapshot, LevelData, Obstacle } from "../game/types";

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

    vec3 deep = vec3(0.015, 0.04, 0.08);
    vec3 aqua = vec3(0.08, 0.92, 0.86);
    vec3 ember = vec3(1.0, 0.48, 0.24);
    vec3 glow = mix(aqua, ember, clamp(uv.x * 0.45 + uTreble * 0.5 + field * 0.1, 0.0, 1.0));

    vec3 color = deep;
    color += ribbon * glow * (0.35 + uMid * 1.25);
    color += bloomBand * vec3(0.12, 0.22, 0.34);
    color += field * 0.04;
    color = mix(color, vec3(1.0, 0.28, 0.2), uCrash * 0.16);

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

type SnapshotRef = MutableRefObject<GameSnapshot>;

function createTrackWindow(currentTime: number, level: LevelData | null) {
  const currentX = currentTime * RUN_SPEED;
  const maxTrackX = level ? level.duration * RUN_SPEED + TRACK_VIEW_AHEAD * 0.5 : currentX + TRACK_VIEW_AHEAD;
  const startX = Math.max(-18, currentX - TRACK_VIEW_BEHIND);
  const endX = Math.max(startX + 28, Math.min(maxTrackX, currentX + TRACK_VIEW_AHEAD));

  return {
    currentX,
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

  useFrame((state, delta) => {
    const snapshot = snapshotRef.current;
    const beatInterval = level?.beatInterval ?? 0.52;
    const barDuration = beatInterval * 8;
    const barIndex = Math.floor(snapshot.time / Math.max(barDuration, 0.001));
    const shotIndex = barIndex % 6;
    const shot =
      shotIndex === 2
        ? "chase"
        : shotIndex === 4
          ? "hero"
          : shotIndex === 5
            ? "sweep"
            : "default";
    const beatPhase = (snapshot.time / Math.max(beatInterval, 0.001)) % 1;
    const beatPulse = Math.max(0, 1 - Math.min(beatPhase, 1 - beatPhase) * 5);
    const impact = Math.max(snapshot.audio.bass, beatPulse * 0.55);
    const shotFov =
      shot === "chase"
        ? 66
        : shot === "hero"
          ? 52
          : shot === "sweep"
            ? 56
            : 62;

    if (shot === "chase") {
      targetPosition.current.set(
        PLAYER_TRACK_X - 8.2 + snapshot.audio.mid * 0.26,
        5.6 + (snapshot.playerY - GROUND_Y) * 0.2 + impact * 0.4,
        13.8 - snapshot.audio.overall * 1.2,
      );
      lookTarget.current.set(
        PLAYER_TRACK_X + 20.4,
        snapshot.playerY * 0.9 + 0.92,
        -0.1 + Math.sin(state.clock.elapsedTime * 0.9) * 0.22,
      );
    } else if (shot === "hero") {
      targetPosition.current.set(
        PLAYER_TRACK_X + 9.6 + snapshot.audio.mid * 0.36,
        13.8 + (snapshot.playerY - GROUND_Y) * 0.1 + impact * 0.32,
        25.8 - snapshot.audio.overall * 1.1,
      );
      lookTarget.current.set(
        PLAYER_TRACK_X + 20.2,
        snapshot.playerY * 0.82 + 1,
        -0.7,
      );
    } else if (shot === "sweep") {
      targetPosition.current.set(
        PLAYER_TRACK_X + 1.8 + snapshot.audio.mid * 0.22,
        11.6 + (snapshot.playerY - GROUND_Y) * 0.14 + impact * 0.36,
        20.4 - snapshot.audio.overall * 0.9,
      );
      lookTarget.current.set(
        PLAYER_TRACK_X + 22.8,
        snapshot.playerY * 0.84 + 0.98,
        -4.8 + Math.sin(state.clock.elapsedTime * 0.7) * 0.6,
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

    camera.position.lerp(targetPosition.current, 1 - Math.exp(-delta * 5));

    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov += (shotFov - camera.fov) * (1 - Math.exp(-delta * 5.4));
      camera.updateProjectionMatrix();
    }

    camera.lookAt(lookTarget.current);
  });

  return null;
}

function Backdrop({ snapshotRef }: { snapshotRef: SnapshotRef }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  useFrame((state) => {
    const snapshot = snapshotRef.current;

    if (!materialRef.current) {
      return;
    }

    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    materialRef.current.uniforms.uBass.value = snapshot.audio.bass;
    materialRef.current.uniforms.uMid.value = snapshot.audio.mid;
    materialRef.current.uniforms.uTreble.value = snapshot.audio.treble;
    materialRef.current.uniforms.uCrash.value = snapshot.crashFlash;
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
        }}
        vertexShader={BACKDROP_VERTEX_SHADER}
      />
    </mesh>
  );
}

function ParticleField({ snapshotRef }: { snapshotRef: SnapshotRef }) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const positionsRef = useRef<Float32Array | null>(null);

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

    if (!pointsRef.current) {
      return;
    }

    pointsRef.current.rotation.y += delta * 0.015;
    pointsRef.current.position.x = PLAYER_TRACK_X - snapshot.time * RUN_SPEED * 0.08;
    pointsRef.current.position.y = 4 + Math.sin(state.clock.elapsedTime * 0.3) * 0.4;

    if (!materialRef.current) {
      return;
    }

    materialRef.current.opacity = 0.54;
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

function BeatRing({
  beat,
  currentTime,
}: {
  beat: BeatPoint;
  currentTime: number;
}) {
  const proximity = Math.max(0, 1 - Math.abs(beat.time - currentTime) * 3.5);
  const scale = 0.92 + beat.strength * 0.55 + proximity * 0.45;
  const brightness = 0.25 + beat.strength * 0.32 + proximity * 0.55;
  const color = `hsl(${172 + beat.lane * 22} 92% 64%)`;

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
      <group position={[obstacle.time * RUN_SPEED, obstacle.height / 2, 0]}>
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
      </group>
    );
  }

  const spikes = Array.from({ length: obstacle.spikes });
  const spikeWidth = obstacle.width / obstacle.spikes;

  return (
    <group position={[obstacle.time * RUN_SPEED, 0.02, 0]}>
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
      <mesh position={[trackWindow.centerX, -0.16, 0]}>
        <boxGeometry args={[trackWindow.length, 0.24, 9.2]} />
        <meshStandardMaterial
          color="#051018"
          emissive="#0d2326"
          emissiveIntensity={0.72 + snapshot.audio.overall * 0.4}
          metalness={0.18}
          roughness={0.6}
        />
      </mesh>

      <mesh position={[trackWindow.centerX, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[trackWindow.length, 10]} />
        <meshStandardMaterial
          color="#050c11"
          emissive="#081419"
          emissiveIntensity={0.42}
          metalness={0.06}
          roughness={0.9}
        />
      </mesh>

      {LANE_OFFSETS.map((lane) => (
        <mesh key={lane} position={[trackWindow.centerX, 0.04, lane]}>
          <boxGeometry args={[trackWindow.length, 0.04, 0.09]} />
          <meshBasicMaterial
            color="#7dfff4"
            opacity={0.32 + snapshot.audio.bass * 0.2}
            transparent
          />
        </mesh>
      ))}

      {EDGE_OFFSETS.map((edge) => (
        <mesh key={edge} position={[trackWindow.centerX, 0.16, edge]}>
          <boxGeometry args={[trackWindow.length, 0.18, 0.12]} />
          <meshBasicMaterial
            color="#8dfdf5"
            opacity={0.24 + snapshot.audio.mid * 0.12}
            transparent
          />
        </mesh>
      ))}

      {trackMarkers.map((markerX, index) => (
        <mesh key={markerX} position={[markerX, 0.03, 0]}>
          <boxGeometry args={[0.16, 0.03, 8.6]} />
          <meshBasicMaterial
            color={index % 4 === 0 ? "#ff9657" : "#66fef6"}
            opacity={index % 4 === 0 ? 0.28 : 0.16}
            transparent
          />
        </mesh>
      ))}

      {edgePylons.map((pylonX, index) => (
        <group key={pylonX} position={[pylonX, 0, 0]}>
          {EDGE_OFFSETS.map((edge) => (
            <mesh key={`${pylonX}-${edge}`} position={[0, 1.25 + (index % 2) * 0.2, edge - 0.25 * Math.sign(edge)]}>
              <boxGeometry args={[0.18, 2.2, 0.18]} />
              <meshBasicMaterial
                color={index % 3 === 0 ? "#ff944f" : "#69fff4"}
                opacity={0.16}
                transparent
              />
            </mesh>
          ))}
        </group>
      ))}

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
      <color attach="background" args={["#04111b"]} />
      <fog attach="fog" args={["#04111b", 18, 108]} />
      <ambientLight intensity={0.44} />
      <directionalLight color="#f5ffe8" intensity={1.55} position={[8, 18, 12]} />
      <pointLight color="#ff8c4a" distance={32} intensity={3.1} position={[14, 4, -10]} />
      <CameraRig level={level} snapshotRef={snapshotRef} />
      <Backdrop snapshotRef={snapshotRef} />
      <ParticleField snapshotRef={snapshotRef} />
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
