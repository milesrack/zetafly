import { RoundedBox } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";

function Display({ png }: { png: string | null }) {
  const surface = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 700;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 1200, 700);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;

    return { canvas, texture };
  }, []);

  useEffect(() => {
    if (!png) {
      const context = surface.canvas.getContext("2d")!;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, surface.canvas.width, surface.canvas.height);
      surface.texture.needsUpdate = true;

      return;
    }

    let live = true;
    const image = new Image();

    image.onload = () => {
      if (live) {
        surface.canvas.getContext("2d")!.drawImage(image, 0, 0);
        surface.texture.needsUpdate = true;
      }
    };

    image.src = `data:image/png;base64,${png}`;

    return () => {
      live = false;
    };
  }, [png, surface]);

  useEffect(() => () => surface.texture.dispose(), [surface]);

  return (
    <mesh position={[0, 2.54, -0.858]}>
      <planeGeometry args={[3, 1.75]} />
      <meshBasicMaterial map={surface.texture} toneMapped={false} />
    </mesh>
  );
}

export function Computer({ png }: { png: string | null }) {
  return (
    <group>
      <RoundedBox
        position={[0, 1.295, -0.75]}
        args={[0.7, 0.035, 0.48]}
        radius={0.015}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color="#b7bec5"
          metalness={0.65}
          roughness={0.3}
        />
      </RoundedBox>
      <RoundedBox
        position={[0, 1.52, -0.98]}
        rotation={[-0.18, 0, 0]}
        args={[0.27, 0.46, 0.05]}
        radius={0.012}
        smoothness={3}
        castShadow
      >
        <meshStandardMaterial
          color="#bbc2c9"
          metalness={0.65}
          roughness={0.3}
        />
      </RoundedBox>
      <RoundedBox
        position={[0, 2.43, -0.91]}
        args={[3.2, 2.08, 0.065]}
        radius={0.03}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color="#c5cbd0"
          metalness={0.6}
          roughness={0.32}
        />
      </RoundedBox>
      <RoundedBox
        position={[0, 2.54, -0.871]}
        args={[3.08, 1.83, 0.008]}
        radius={0.015}
        smoothness={3}
      >
        <meshStandardMaterial color="#e3e6e8" roughness={0.28} />
      </RoundedBox>
      <Display png={png} />
      <mesh position={[0, 3.438, -0.873]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.009, 0.009, 0.008, 12]} />
        <meshStandardMaterial color="#3b4249" roughness={0.25} />
      </mesh>
    </group>
  );
}
