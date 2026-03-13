import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { useRef } from "react";
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

function CameraRig({
  level,
  snapshot,
}: {
  level: LevelData | null;
  snapshot: GameSnapshot;
}) {
  const { camera } = useThree();
  const targetPosition = useRef(new THREE.Vector3());
  const lookTarget = useRef(new THREE.Vector3());

  useFrame((state, delta) => {
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

function Backdrop({ snapshot }: { snapshot: GameSnapshot }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  useFrame((state) => {
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

function ParticleField({ snapshot }: { snapshot: GameSnapshot }) {
  const pointsRef = useRef<THREE.Points>(null);
  const positionsRef = useRef<Float32Array | null>(null);

  if (!positionsRef.current) {
    const pointCount = 900;
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
    if (!pointsRef.current) {
      return;
    }

    pointsRef.current.rotation.y += delta * 0.015;
    pointsRef.current.position.x = PLAYER_TRACK_X - snapshot.time * RUN_SPEED * 0.08;
    pointsRef.current.position.y = 4 + Math.sin(state.clock.elapsedTime * 0.3) * 0.4;
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
        blending={THREE.AdditiveBlending}
        color="#8ffcff"
        depthWrite={false}
        opacity={0.72}
        size={0.18 + snapshot.audio.overall * 0.12}
        sizeAttenuation
        transparent
      />
    </points>
  );
}

function Orb({ snapshot }: { snapshot: GameSnapshot }) {
  const pulse = 1 + snapshot.audio.overall * 0.18;
  const stretch = Math.min(0.2, Math.abs(snapshot.playerVelocity) * 0.009);
  const scaleY = pulse * (snapshot.grounded ? 0.96 + snapshot.audio.bass * 0.1 : 1 + stretch);
  const scaleX = pulse * (snapshot.grounded ? 1.08 - snapshot.audio.bass * 0.04 : 1 - stretch * 0.35);
  const scaleZ = pulse * (1 + snapshot.audio.mid * 0.06);
  const trailCount = 8;

  return (
    <group position={[PLAYER_TRACK_X, snapshot.playerY, 0]}>
      <pointLight
        color="#8afefb"
        decay={2}
        distance={18}
        intensity={7 + snapshot.audio.overall * 16}
      />

      <mesh rotation={[0, snapshot.time * 2.8 + snapshot.audio.overall * 0.6, 0]}>
        <torusGeometry args={[PLAYER_RADIUS * 0.86, PLAYER_RADIUS * 0.08, 12, 48]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#9afcff"
          opacity={0.28 + snapshot.audio.mid * 0.22}
          transparent
        />
      </mesh>

      <mesh position={[0, -snapshot.playerY + 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.1, 1.8, 64]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#59fff8"
          opacity={0.12 + snapshot.audio.overall * 0.12}
          transparent
        />
      </mesh>

      {Array.from({ length: trailCount }).map((_, index) => {
        const offset = index + 1;
        const trailScale = 1 - offset * 0.08;
        const lift = Math.sin(snapshot.time * 6 + offset * 0.6) * 0.08;

        return (
          <mesh
            key={offset}
            position={[-offset * 0.82, lift * 0.6, -offset * 0.06]}
            scale={[trailScale * 0.55, trailScale * 0.55, trailScale * 0.55]}
          >
            <sphereGeometry args={[PLAYER_RADIUS, 32, 32]} />
            <meshBasicMaterial
              blending={THREE.AdditiveBlending}
              color="#58ffe7"
              opacity={0.18 - offset * 0.018}
              transparent
            />
          </mesh>
        );
      })}

      <group scale={[scaleX, scaleY, scaleZ]}>
        <mesh>
          <sphereGeometry args={[PLAYER_RADIUS, 48, 48]} />
          <meshStandardMaterial
            color="#edffff"
            emissive="#59fff0"
            emissiveIntensity={3.2 + snapshot.audio.overall * 3}
            metalness={0.18}
            roughness={0.24}
          />
        </mesh>
        <mesh scale={[1.9, 1.9, 1.9]}>
          <sphereGeometry args={[PLAYER_RADIUS, 32, 32]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#3cf5ff"
            opacity={0.18 + snapshot.audio.bass * 0.14}
            transparent
          />
        </mesh>
      </group>

      {snapshot.crashFlash > 0.01 ? (
        <mesh scale={[1 + snapshot.crashFlash * 4, 1 + snapshot.crashFlash * 4, 1 + snapshot.crashFlash * 4]}>
          <sphereGeometry args={[PLAYER_RADIUS, 28, 28]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#ff8855"
            opacity={snapshot.crashFlash * 0.45}
            transparent
          />
        </mesh>
      ) : null}
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
  const color = new THREE.Color().setHSL(0.48 + beat.lane * 0.06, 0.92, 0.62);

  return (
    <group
      position={[beat.time * RUN_SPEED, 2.8 + beat.lane * 1.4, -3.4 - beat.lane * 0.8]}
      scale={[scale, scale, scale]}
    >
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[1.15, 0.1, 14, 48]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color={color}
          opacity={brightness}
          transparent
        />
      </mesh>
      <mesh position={[0, -2.1, 0]} scale={[0.1, 4.4 + beat.strength * 2, 0.1]}>
        <cylinderGeometry args={[1, 1, 1, 12]} />
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
        <mesh position={[0, -obstacle.height / 2 + 0.08, 0]}>
          <boxGeometry args={[obstacle.width * 1.08, 0.14, 3.1]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color={`hsl(${obstacle.hue} 95% 58%)`}
            opacity={0.12 + obstacle.glow * 0.08}
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
        <cylinderGeometry args={[obstacle.width * 0.44, obstacle.width * 0.52, 0.12, 24]} />
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
              emissiveIntensity={1.8 + obstacle.glow * 1.8}
              metalness={0.18}
              roughness={0.28}
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
}: {
  level: LevelData | null;
  snapshot: GameSnapshot;
}) {
  const trackLength = level ? level.duration * RUN_SPEED + 120 : 480;
  const cueBeats = level?.beats ?? [];
  const trackMarkers = Array.from({ length: Math.ceil(trackLength / 2.4) }, (_, index) => index * 2.4 - 18);
  const edgePylons = Array.from({ length: Math.ceil(trackLength / 9.6) }, (_, index) => index * 9.6 - 14);

  return (
    <group position={[PLAYER_TRACK_X - snapshot.time * RUN_SPEED, 0, 0]}>
      <mesh position={[trackLength / 2 - 10, -0.16, 0]}>
        <boxGeometry args={[trackLength, 0.24, 9.2]} />
        <meshStandardMaterial
          color="#051018"
          emissive="#0d2326"
          emissiveIntensity={0.72 + snapshot.audio.overall * 0.4}
          metalness={0.18}
          roughness={0.6}
        />
      </mesh>

      <mesh position={[trackLength / 2 - 10, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[trackLength, 10]} />
        <meshStandardMaterial
          color="#050c11"
          emissive="#081419"
          emissiveIntensity={0.42}
          metalness={0.06}
          roughness={0.9}
        />
      </mesh>

      {[-2.2, 0, 2.2].map((lane) => (
        <mesh key={lane} position={[trackLength / 2 - 10, 0.04, lane]}>
          <boxGeometry args={[trackLength, 0.04, 0.09]} />
          <meshBasicMaterial
            color="#7dfff4"
            opacity={0.38 + snapshot.audio.bass * 0.26}
            transparent
          />
        </mesh>
      ))}

      {[-4.35, 4.35].map((edge) => (
        <mesh key={edge} position={[trackLength / 2 - 10, 0.16, edge]}>
          <boxGeometry args={[trackLength, 0.18, 0.12]} />
          <meshBasicMaterial
            color="#8dfdf5"
            opacity={0.28 + snapshot.audio.mid * 0.14}
            transparent
          />
        </mesh>
      ))}

      {trackMarkers.map((markerX, index) => (
        <mesh key={markerX} position={[markerX, 0.03, 0]}>
          <boxGeometry args={[0.16, 0.03, 8.6]} />
          <meshBasicMaterial
            color={index % 4 === 0 ? "#ff9657" : "#66fef6"}
            opacity={index % 4 === 0 ? 0.3 : 0.18}
            transparent
          />
        </mesh>
      ))}

      {edgePylons.map((pylonX, index) => (
        <group key={pylonX} position={[pylonX, 0, 0]}>
          {[-4.1, 4.1].map((edge) => (
            <mesh key={`${pylonX}-${edge}`} position={[0, 1.25 + (index % 2) * 0.2, edge]}>
              <boxGeometry args={[0.18, 2.2, 0.18]} />
              <meshBasicMaterial
                color={index % 3 === 0 ? "#ff944f" : "#69fff4"}
                opacity={0.18 + snapshot.audio.overall * 0.1}
                transparent
              />
            </mesh>
          ))}
        </group>
      ))}

      {cueBeats.map((beat) => (
        <BeatRing beat={beat} currentTime={snapshot.time} key={beat.time} />
      ))}

      {level?.obstacles.map((obstacle) => <Hazard key={obstacle.time} obstacle={obstacle} />)}
    </group>
  );
}

function SceneContent({
  level,
  snapshot,
}: {
  level: LevelData | null;
  snapshot: GameSnapshot;
}) {
  return (
    <>
      <color attach="background" args={["#04111b"]} />
      <fog attach="fog" args={["#04111b", 18, 108]} />
      <ambientLight intensity={0.48} />
      <directionalLight color="#f5ffe8" intensity={1.9} position={[8, 18, 12]} />
      <pointLight color="#ff8c4a" distance={36} intensity={3.8} position={[14, 4, -10]} />
      <CameraRig level={level} snapshot={snapshot} />
      <Backdrop snapshot={snapshot} />
      <ParticleField snapshot={snapshot} />
      <Track level={level} snapshot={snapshot} />
      <Orb snapshot={snapshot} />
      <mesh position={[PLAYER_TRACK_X, GROUND_Y - PLAYER_RADIUS - 0.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[3.8, 64]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#55dff8"
          opacity={0.08 + snapshot.audio.overall * 0.05}
          transparent
        />
      </mesh>
      <EffectComposer>
        <Bloom
          intensity={1.05 + snapshot.audio.overall * 1.25}
          luminanceSmoothing={0.35}
          luminanceThreshold={0.12}
          mipmapBlur
          radius={0.86}
        />
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={new THREE.Vector2(0.0006 + snapshot.crashFlash * 0.0016, 0.0004)}
        />
        <Noise
          blendFunction={BlendFunction.SOFT_LIGHT}
          opacity={0.05 + snapshot.audio.treble * 0.04}
          premultiply
        />
        <Vignette darkness={1.08} eskil={false} offset={0.18} />
      </EffectComposer>
    </>
  );
}

export function RhythmRunnerScene({
  level,
  snapshot,
}: {
  level: LevelData | null;
  snapshot: GameSnapshot;
}) {
  return (
    <Canvas
      camera={{ fov: 62, position: [PLAYER_TRACK_X - 1.2, 9.8, 37.6], near: 0.1, far: 520 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
    >
      <SceneContent level={level} snapshot={snapshot} />
    </Canvas>
  );
}
