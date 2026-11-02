import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import type {
  Position as P,
  PhysicalFrame,
  PhysicalKey,
} from "../../../shared/contracts.ts";
import { KEYS } from "../../../shared/keyboard.ts";
import { Computer } from "./Computer";
import { DeskObjects } from "./DeskObjects";
import { DeskChair, SeatedDeskFly } from "./DeskSeat";

function Box({ p, s, color }: { p: P; s: P; color: string }) {
  return (
    <mesh position={p} castShadow receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  );
}

function Keycap({ item, down }: { item: PhysicalKey; down: boolean }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ecece8";
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = "#343638";
    ctx.textAlign = "center";
    ctx.font = "24px monospace";
    ctx.fillText(item.label, 64, 42);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;

    return texture;
  }, [item.label]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <group
      position={[
        item.position[0],
        item.position[1] + 0.018 - (down ? 0.018 : 0),
        item.position[2],
      ]}
    >
      <Box
        p={[0, 0, 0]}
        s={[item.width, 0.036, 0.086]}
        color={down ? "#9ca7a0" : "#d3d4d0"}
      />
      <mesh position={[0, 0.0181, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[item.width * 0.94, 0.08]} />
        <meshBasicMaterial map={texture} />
      </mesh>
    </group>
  );
}

function Camera({ view }: { view: string }) {
  const { camera } = useThree();
  const target = useMemo<P>(
    () => (view === "keyboard" ? [0, 1.4, 0.2] : [0, 1.9, -0.2]),
    [view],
  );

  useEffect(() => {
    camera.position.set(
      ...((view === "keyboard" ? [1.7, 2.8, 1.6] : [3.5, 3.0, 4.8]) as P),
    );

    camera.lookAt(...target);
    camera.updateProjectionMatrix();
  }, [camera, view, target]); // Camera changes only when the user selects a view.

  return (
    <OrbitControls
      key={view}
      target={target}
      minDistance={1}
      maxDistance={10}
      maxPolarAngle={Math.PI / 2 - 0.04}
    />
  );
}

export function World({
  png,
  frame,
  keys,
  view,
  live = true,
  time = 0,
  idle = true,
  hidden = false,
}: {
  png: string | null;
  frame: PhysicalFrame | null;
  keys: PhysicalKey[];
  view: string;
  live?: boolean;
  time?: number;
  idle?: boolean;
  hidden?: boolean;
}) {
  const [cameraView, setCameraView] = useState(
    view === "keyboard" ? "keyboard" : "desk",
  );

  useEffect(() => {
    if (view === "desk" || view === "keyboard") {
      setCameraView(view);
    }
  }, [view]);

  return (
    <div
      className="world"
      hidden={hidden}
      role="img"
      aria-label={`3D fly at a desk with its ${live ? "live" : "recorded"} Zetamac computer`}
    >
      <Canvas
        frameloop={hidden ? "never" : "always"}
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [3.5, 3, 4.8], fov: 43, near: 0.05, far: 50 }}
      >
        <color attach="background" args={["#f4f3ef"]} />
        <ambientLight intensity={1.6} />
        <directionalLight
          position={[-3, 7, 4]}
          intensity={3}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <Box p={[0, -0.08, 0]} s={[30, 0.1, 30]} color="#eeede8" />
        <Box p={[0, 1.2, -0.25]} s={[4.8, 0.15, 1.8]} color="#d8d8d1" />
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <Box
              key={`${x}${z}`}
              p={[x * 2.1, 0.58, -0.25 + z * 0.64]}
              s={[0.1, 1.15, 0.1]}
              color="#777b7b"
            />
          )),
        )}
        <Computer png={png} />
        <Box p={[0, 1.32, 0.17]} s={[1.86, 0.06, 0.65]} color="#51575b" />
        {(keys.length ? keys : KEYS).map((key) => (
          <Keycap
            key={key.code}
            item={key}
            down={!idle && frame?.phase === "contact" && frame.key === key.code}
          />
        ))}
        <DeskObjects />
        <DeskChair />
        <SeatedDeskFly frame={frame} time={time} idle={idle} />
        <Camera view={cameraView} />
      </Canvas>
    </div>
  );
}
