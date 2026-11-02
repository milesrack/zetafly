import { useMemo } from "react";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
} from "three";

type P = [number, number, number];

function Rod({
  a,
  b,
  r = 0.012,
  color = "#b0b6b4",
  metal = 0.75,
}: {
  a: P;
  b: P;
  r?: number;
  color?: string;
  metal?: number;
}) {
  const shape = useMemo(() => {
    const from = new Vector3(...a);
    const to = new Vector3(...b);
    const axis = to.clone().sub(from);

    return {
      center: from.add(to).multiplyScalar(0.5),
      length: axis.length(),
      rotation: new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        axis.normalize(),
      ),
    };
  }, [a, b]);

  return (
    <mesh position={shape.center} quaternion={shape.rotation} castShadow>
      <cylinderGeometry args={[r, r, shape.length, 12]} />
      <meshStandardMaterial color={color} metalness={metal} roughness={0.32} />
    </mesh>
  );
}

function Wing({ side, folded = false }: { side: number; folded?: boolean }) {
  const shape = useMemo(() => {
    const s = new Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.09, 0.015, 0.24, 0.19, 0.21, 0.36);
    s.bezierCurveTo(0.16, 0.53, 0.015, 0.43, -0.018, 0.26);
    s.bezierCurveTo(-0.04, 0.13, -0.015, 0.035, 0, 0);

    return new ShapeGeometry(s, 24);
  }, []);
  const veins = useMemo(() => {
    const lines = [
      [
        [0, 0],
        [0.11, 0.14],
        [0.15, 0.36],
      ],
      [
        [0, 0],
        [0.055, 0.18],
        [0.04, 0.39],
      ],
      [
        [0.05, 0.14],
        [0.18, 0.22],
      ],
      [
        [0.06, 0.24],
        [0.17, 0.33],
      ],
    ];
    const positions: number[] = [];

    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        positions.push(
          line[i - 1][0],
          line[i - 1][1],
          0.002,
          line[i][0],
          line[i][1],
          0.002,
        );
      }
    }

    return new BufferGeometry().setAttribute(
      "position",
      new Float32BufferAttribute(positions, 3),
    );
  }, []);

  return (
    <group
      position={[side * 0.075, 1.06, 0.15]}
      rotation={[Math.PI / 2, 0, -side * 0.16]}
      scale={[side * (folded ? 0.72 : 1), folded ? 0.72 : 1, 1]}
    >
      <mesh geometry={shape}>
        <meshPhysicalMaterial
          color="#cad5cb"
          transparent
          opacity={0.56}
          roughness={0.19}
          metalness={0.08}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={veins}>
        <lineBasicMaterial color="#748176" transparent opacity={0.6} />
      </lineSegments>
    </group>
  );
}

export function FlyBody({
  seated = false,
  typing = false,
  effectors,
  legPoses,
  foldedWings = false,
  hideForelegs = false,
}: {
  seated?: boolean;
  typing?: boolean;
  effectors?: { left: P; right: P };
  legPoses?: { left: P[][]; right: P[][] };
  foldedWings?: boolean;
  hideForelegs?: boolean;
} = {}) {
  const bristles = useMemo(() => {
    const vertices: number[] = [];

    for (let i = 0; i < 70; i++) {
      const a = i * 2.39996;
      const v = -0.8 + 1.6 * ((i % 17) / 16);
      const q = Math.sqrt(1 - v * v);
      const x = Math.cos(a) * q * 0.125;
      const y = 0.98 + v * 0.15;
      const z = 0.15 + Math.sin(a) * q * 0.18;

      vertices.push(
        x,
        y,
        z,
        x * 1.18,
        y + (y - 0.98) * 0.2,
        z + (z - 0.15) * 0.16,
      );
    }

    return new BufferGeometry().setAttribute(
      "position",
      new Float32BufferAttribute(vertices, 3),
    );
  }, []);

  return (
    <group>
      <mesh
        position={[0, 0.94, 0.35]}
        scale={[0.145, 0.145, 0.245]}
        rotation={[-0.16, 0, 0]}
        castShadow
      >
        <sphereGeometry args={[1, 48, 32]} />
        <meshPhysicalMaterial
          color="#493426"
          metalness={0.22}
          roughness={0.34}
          clearcoat={0.5}
        />
      </mesh>
      {[0.28, 0.37, 0.45].map((z, i) => (
        <mesh
          key={z}
          position={[0, 0.94 - i * 0.008, z]}
          rotation={[0.08, 0, 0]}
          scale={[1, 0.91, 1]}
        >
          <torusGeometry args={[0.14 - i * 0.015, 0.006, 8, 40]} />
          <meshStandardMaterial color="#241d18" roughness={0.65} />
        </mesh>
      ))}
      <mesh position={[0, 0.99, 0.15]} scale={[0.125, 0.155, 0.17]} castShadow>
        <sphereGeometry args={[1, 48, 32]} />
        <meshPhysicalMaterial
          color="#8a7052"
          roughness={0.65}
          metalness={0.13}
        />
      </mesh>
      <lineSegments geometry={bristles}>
        <lineBasicMaterial color="#30261c" />
      </lineSegments>
      <mesh
        position={[0, 1.13, -0.015]}
        scale={[0.132, 0.11, 0.105]}
        castShadow
      >
        <sphereGeometry args={[1, 40, 28]} />
        <meshStandardMaterial color="#9d8060" roughness={0.6} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh
            position={[side * 0.097, 1.15, -0.045]}
            scale={[0.069, 0.095, 0.077]}
            rotation={[0, side * -0.23, -side * 0.2]}
            castShadow
          >
            <icosahedronGeometry args={[1, 4]} />
            <meshPhysicalMaterial
              color="#a4412c"
              roughness={0.37}
              clearcoat={0.35}
              flatShading
            />
          </mesh>
          <mesh
            position={[side * 0.036, 1.15, -0.109]}
            scale={[0.018, 0.019, 0.035]}
          >
            <sphereGeometry args={[1, 12, 10]} />
            <meshStandardMaterial color="#433126" />
          </mesh>
          <Rod
            a={[side * 0.04, 1.16, -0.13]}
            b={[side * 0.077, 1.195, -0.19]}
            r={0.0025}
            color="#433126"
            metal={0}
          />
          {/* The desk rig supplies animated forelegs when hideForelegs is set. */}
          {(
            legPoses?.[side < 0 ? "left" : "right"] ?? [
              effectors
                ? [
                    [side * 0.09, 0.95, 0.04],
                    [side * 0.3, 0.8, -0.05],
                    [
                      (side < 0 ? effectors.left : effectors.right)[0],
                      0.6,
                      (side < 0 ? effectors.left : effectors.right)[2] + 0.12,
                    ],
                    side < 0 ? effectors.left : effectors.right,
                  ]
                : seated
                  ? [
                      [side * 0.09, 0.95, 0.04],
                      [side * 0.19, 0.72, -0.1],
                      [side * 0.19, 0.42, -0.29],
                      [side * 0.2, typing ? 0.35 : 0.38, -0.43],
                    ]
                  : [
                      [side * 0.09, 0.95, 0.04],
                      [side * 0.19, 0.85, -0.09],
                      [side * 0.19, 0.49, -0.31],
                      [side * 0.2, 0.3, -0.4],
                    ],
              seated
                ? [
                    [side * 0.11, 0.95, 0.15],
                    [side * 0.23, 0.78, 0.3],
                    [side * 0.26, 0.68, 0.5],
                    [side * 0.2, 0.68, 0.6],
                  ]
                : [
                    [side * 0.11, 0.95, 0.15],
                    [side * 0.23, 0.88, 0.05],
                    [side * 0.26, 0.76, -0.02],
                    [side * 0.2, 0.765, -0.12],
                  ],
              seated
                ? [
                    [side * 0.09, 0.92, 0.25],
                    [side * 0.22, 0.8, 0.45],
                    [side * 0.22, 0.68, 0.58],
                    [side * 0.16, 0.68, 0.68],
                  ]
                : [
                    [side * 0.09, 0.92, 0.25],
                    [side * 0.22, 0.86, 0.36],
                    [side * 0.22, 0.765, 0.35],
                    [side * 0.16, 0.765, 0.4],
                  ],
            ]
          ).map((leg, i) =>
            hideForelegs && i === 0 ? null : (
              <group key={["front", "middle", "hind"][i]}>
                {leg.slice(1).map((to, j) => (
                  <Rod
                    key={["femur", "tibia", "tarsus"][j]}
                    a={leg[j] as P}
                    b={to as P}
                    r={j === 0 ? 0.008 : 0.005}
                    color="#45382e"
                    metal={0.12}
                  />
                ))}
              </group>
            ),
          )}
          <Wing side={side} folded={foldedWings} />
        </group>
      ))}
    </group>
  );
}
