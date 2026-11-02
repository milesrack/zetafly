import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { Euler, Matrix4, type Mesh, Quaternion, Vector3 } from "three";
import type { PhysicalFrame } from "../../../shared/contracts.ts";
import { handPositions } from "../../../shared/keyboard.ts";
import { FlyBody } from "./FlyBody";

type P = [number, number, number];

// Seat top is 1.03 m, below the 1.275 m desktop. The abdomen's lowest
// point is 1.038 m. Chair front (z=.70) clears the desk edge (z=.65).
const ORIGIN: P = [0, 0.62, 0.064];
const SCALE = 1.2;
const PITCH = 0.65;
const INVERSE = new Matrix4()
  .compose(
    new Vector3(...ORIGIN),
    new Quaternion().setFromEuler(new Euler(PITCH, 0, 0)),
    new Vector3(SCALE, SCALE, SCALE),
  )
  .invert();
const FORWARD = INVERSE.clone().invert();
const ROOTS = [-1, 1].map(
  (side) =>
    new Vector3(side * 0.09, 0.95, 0.04).applyMatrix4(FORWARD).toArray() as P,
);

function local(p: number[]): P {
  return new Vector3(...p).applyMatrix4(INVERSE).toArray() as P;
}

function Beam({
  from,
  to,
  r = 0.024,
  color = "#33363e",
}: {
  from: P;
  to: P;
  r?: number;
  color?: string;
}) {
  const transform = useMemo(() => {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const axis = b.clone().sub(a);

    return {
      position: a.add(b).multiplyScalar(0.5),
      length: axis.length(),
      rotation: new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        axis.normalize(),
      ),
    };
  }, [from, to]);

  return (
    <mesh
      position={transform.position}
      quaternion={transform.rotation}
      castShadow
    >
      <cylinderGeometry args={[r, r, transform.length, 12]} />
      <meshStandardMaterial color={color} metalness={0.45} roughness={0.48} />
    </mesh>
  );
}

function Pad({
  position,
  size,
  color = "#40434c",
  rotation = 0,
}: {
  position: P;
  size: P;
  color?: string;
  rotation?: number;
}) {
  return (
    <RoundedBox
      args={size}
      position={position}
      rotation={[rotation, 0, 0]}
      radius={Math.min(0.045, ...size.map((length) => length * 0.45))}
      smoothness={3}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial color={color} roughness={0.91} />
    </RoundedBox>
  );
}

export const DeskChair = memo(function DeskChair() {
  return (
    <group>
      <Pad position={[0, 0.935, 1.1]} size={[0.8, 0.11, 0.8]} color="#292c34" />
      <Pad position={[0, 0.985, 1.1]} size={[0.76, 0.09, 0.76]} />
      <Pad
        position={[0, 1.36, 1.465]}
        size={[0.7, 0.55, 0.13]}
        rotation={0.1}
      />
      <Pad
        position={[0, 1.25, 1.385]}
        size={[0.59, 0.15, 0.08]}
        color="#50535c"
        rotation={0.1}
      />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Beam
            from={[side * 0.26, 0.92, 1.39]}
            to={[side * 0.26, 1.48, 1.477]}
            r={0.022}
          />
          <Beam
            from={[side * 0.35, 0.94, 1.2]}
            to={[side * 0.35, 1.22, 1.2]}
            r={0.021}
          />
          <Pad
            position={[side * 0.36, 1.245, 1.07]}
            size={[0.085, 0.075, 0.46]}
            color="#292c34"
          />
          <Beam
            from={[side * 0.25, 0.91, 0.77]}
            to={[side * 0.25, 0.63, 0.61]}
            r={0.018}
          />
        </group>
      ))}
      <Beam
        from={[-0.34, 0.625, 0.61]}
        to={[0.34, 0.625, 0.61]}
        r={0.026}
        color="#666b76"
      />
      <Beam
        from={[0, 0.14, 1.11]}
        to={[0, 0.9, 1.11]}
        r={0.047}
        color="#828997"
      />
      <Beam from={[0, 0.15, 1.11]} to={[0, 0.53, 1.11]} r={0.07} />
      {Array.from({ length: 5 }, (_, i) => {
        const angle = (i * Math.PI * 2) / 5;
        const x = Math.sin(angle) * 0.49;
        const z = 1.11 + Math.cos(angle) * 0.49;

        return (
          <group key={angle}>
            <Beam from={[0, 0.18, 1.11]} to={[x, 0.115, z]} r={0.038} />
            <mesh
              position={[x, 0.055, z]}
              rotation={[0, angle, Math.PI / 2]}
              castShadow
            >
              <cylinderGeometry args={[0.07, 0.07, 0.065, 20]} />
              <meshStandardMaterial color="#20232b" roughness={0.85} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
});

export const SeatedDeskFly = memo(function SeatedDeskFly({
  frame,
  time,
  idle,
}: {
  frame: PhysicalFrame | null;
  time: number;
  idle: boolean;
}) {
  const legs = (side: number): P[][] => {
    return [
      [], // Forelegs are supplied by the animated world-space rig.
      [
        [side * 0.11, 0.95, 0.15],
        local([side * 0.25, 1.23, 0.86]),
        local([side * 0.29, 1.12, 0.91]),
        local([side * 0.25, 1.035, 0.91]),
      ],
      [
        [side * 0.09, 0.92, 0.25],
        local([side * 0.25, 1.075, 0.6]),
        local([side * 0.26, 0.78, 0.6]),
        local([side * 0.26, 0.651, 0.61]),
      ],
    ];
  };

  return (
    <>
      <Forelegs frame={frame} time={time} idle={idle} />
      <group position={ORIGIN} rotation={[PITCH, 0, 0]} scale={SCALE}>
        <FlyBody
          hideForelegs
          seated
          legPoses={{ left: legs(-1), right: legs(1) }}
          foldedWings
        />
      </group>
    </>
  );
});

// Effector tips use the motor controller's world coordinates.
function Forelegs({
  frame,
  time,
  idle,
}: {
  frame: PhysicalFrame | null;
  time: number;
  idle: boolean;
}) {
  const rods = useRef<(Mesh | null)[]>([]);
  const idleTransition = useRef({ active: idle, start: null as number | null });
  const scratch = useMemo(
    () => ({
      a: new Vector3(),
      b: new Vector3(),
      axis: new Vector3(),
      up: new Vector3(0, 1, 0),
    }),
    [],
  );
  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useLayoutEffect(() => {
    if (idleTransition.current.active !== idle) {
      idleTransition.current = { active: idle, start: Date.now() / 1000 };
    }
  }, [idle]);

  useFrame(() => {
    const now = Date.now() / 1000;

    const age =
      idleTransition.current.start === null
        ? 0.8
        : now - idleTransition.current.start;
    const progress = Math.min(1, age / 0.8);
    const blend = idle
      ? reducedMotion
        ? 1
        : progress * progress * (3 - 2 * progress)
      : 0;
    const hands = handPositions(
      frame,
      reducedMotion ? 0 : idle ? now : time,
      blend,
    );

    for (const [index, side] of [-1, 1].entries()) {
      const tip = hands[side < 0 ? "left" : "right"];
      const root = ROOTS[index];
      const points: P[] = [
        root,
        [side * 0.28, 1.47, 0.69],
        [tip[0], tip[1] + 0.08, tip[2] + 0.1],
        tip,
      ];

      for (let j = 0; j < 3; j++) {
        const rod = rods.current[index * 3 + j];

        if (!rod) {
          continue;
        }

        scratch.a.set(...points[j]);
        scratch.b.set(...points[j + 1]);
        scratch.axis.subVectors(scratch.b, scratch.a);
        rod.position.addVectors(scratch.a, scratch.b).multiplyScalar(0.5);
        rod.scale.y = scratch.axis.length();
        rod.quaternion.setFromUnitVectors(scratch.up, scratch.axis.normalize());
      }
    }
  });

  return (
    <group>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh
          key={
            [
              "left-upper",
              "left-lower",
              "left-tip",
              "right-upper",
              "right-lower",
              "right-tip",
            ][i]
          }
          ref={(mesh) => {
            rods.current[i] = mesh;
          }}
          castShadow
        >
          <cylinderGeometry
            args={[
              i % 3 === 0 ? 0.0096 : 0.006,
              i % 3 === 0 ? 0.0096 : 0.006,
              1,
              12,
            ]}
          />
          <meshStandardMaterial
            color="#45382e"
            metalness={0.12}
            roughness={0.5}
          />
        </mesh>
      ))}
    </group>
  );
}
