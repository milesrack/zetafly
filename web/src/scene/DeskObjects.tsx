import { useTexture } from "@react-three/drei";
import { useLoader } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import {
  Box3,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

function GreenBook() {
  const cover = useTexture("/desk/green-book.webp", (texture) => {
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
  });

  return (
    <group position={[-1.66, 1.275, 0.04]} rotation={[0, 0.17, 0]}>
      <mesh position={[0, 0.049, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.63, 0.085, 0.87]} />
        <meshStandardMaterial color="#e8e2ce" />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, 0.05 + side * 0.047, 0]} castShadow>
          <boxGeometry args={[0.66, 0.012, 0.91]} />
          <meshStandardMaterial color="#176445" />
        </mesh>
      ))}
      <mesh position={[-0.325, 0.05, 0]}>
        <boxGeometry args={[0.025, 0.1, 0.91]} />
        <meshStandardMaterial color="#14573c" />
      </mesh>
      <mesh position={[0, 0.104, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.66, 0.91]} />
        <meshStandardMaterial map={cover} roughness={0.8} />
      </mesh>
    </group>
  );
}

function PuzzleCube() {
  const materials = useMemo(
    () =>
      [
        "#bd342e",
        "#df7c25",
        "#f1f0e6",
        "#e8bf37",
        "#337349",
        "#315eaa",
        "#171b20",
      ].map((color) => new MeshStandardMaterial({ color, roughness: 0.45 })),
    [],
  );

  useEffect(
    () => () =>
      materials.forEach((material) => {
        material.dispose();
      }),
    [materials],
  );

  return (
    <group position={[-1.9, 1.46, -0.73]} rotation={[0, -0.28, 0]}>
      {Array.from({ length: 27 }, (_, i) => {
        const x = (i % 3) - 1;
        const y = (Math.floor(i / 3) % 3) - 1;
        const z = Math.floor(i / 9) - 1;

        return (
          <mesh
            key={`${x},${y},${z}`}
            position={[x * 0.12, y * 0.12, z * 0.12]}
            castShadow
            receiveShadow
            material={[
              x === 1 ? materials[0] : materials[6],
              x === -1 ? materials[1] : materials[6],
              y === 1 ? materials[2] : materials[6],
              y === -1 ? materials[3] : materials[6],
              z === 1 ? materials[4] : materials[6],
              z === -1 ? materials[5] : materials[6],
            ]}
          >
            <boxGeometry args={[0.112, 0.112, 0.112]} />
          </mesh>
        );
      })}
    </group>
  );
}

function Mouse() {
  return (
    <group>
      <mesh position={[1.25, 1.282, 0.14]} receiveShadow>
        <boxGeometry args={[0.67, 0.012, 0.66]} />
        <meshStandardMaterial color="#656c6c" roughness={1} />
      </mesh>
      <mesh
        position={[1.23, 1.315, 0.13]}
        scale={[0.13, 0.035, 0.21]}
        castShadow
      >
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial
          color="#aab0b6"
          metalness={0.6}
          roughness={0.35}
        />
      </mesh>
      <mesh
        position={[1.23, 1.345, 0.13]}
        scale={[0.128, 0.045, 0.205]}
        castShadow
      >
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial color="#f4f5f6" roughness={0.22} />
      </mesh>
    </group>
  );
}

function Apple() {
  const { scene } = useLoader(GLTFLoader, "/desk/apple/model.gltf");
  const { model, scale, offset } = useMemo(() => {
    const model = scene.clone(true);

    model.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = object.receiveShadow = true;
      }
    });

    const bounds = new Box3().setFromObject(model);
    const center = bounds.getCenter(new Vector3());

    return {
      model,
      scale: 0.34 / bounds.getSize(new Vector3()).y,
      offset: [-center.x, -bounds.min.y, -center.z] as [number, number, number],
    };
  }, [scene]);

  return (
    <group position={[1.93, 1.275, -0.67]} rotation={[0, 0.4, 0]} scale={scale}>
      <primitive object={model} position={offset} dispose={null} />
    </group>
  );
}

export function DeskObjects() {
  return (
    <>
      <Mouse />
      <Suspense fallback={null}>
        <GreenBook />
        <Apple />
      </Suspense>
      <PuzzleCube />
    </>
  );
}
