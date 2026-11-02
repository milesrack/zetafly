import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import {
  BufferGeometry,
  Float32BufferAttribute,
  ShaderMaterial,
  Vector3,
} from "three";
import type { NeuralActivity as Neural } from "../../../shared/contracts.ts";
import { sampleNeurons } from "../../../shared/neural";
import { activityAt } from "../session/activity";

type Anatomy = {
  positions: Float32Array;
  lookup: Map<number, [number, number, number]>;
};

let pending: Promise<Anatomy> | null = null;

function loadAnatomy() {
  pending ??= fetch("/brain/anchors.bin")
    .then((response) => {
      if (!response.ok) {
        throw Error("Anatomy unavailable");
      }

      return response.arrayBuffer();
    })
    .then((buffer) => {
      const records = new Float32Array(buffer);
      const positions = new Float32Array((records.length / 4) * 3);
      const lookup = new Map<number, [number, number, number]>();

      for (let i = 0; i < records.length; i += 4) {
        const p: [number, number, number] = [
          records[i + 1],
          records[i + 2],
          records[i + 3],
        ];

        lookup.set(records[i], p);
        positions.set(p, (i / 4) * 3);
      }

      return { positions, lookup };
    })
    .catch((error) => {
      pending = null;
      throw error;
    });

  return pending;
}

const vertexShader = `
 uniform vec3 sources[48];
 uniform float strengths[48];
 varying vec3 colour;
 varying float heat;
 void main(){
  float activity=0.0;
  for(int i=0;i<48;i++){
   if(strengths[i]>0.001){vec3 delta=position-sources[i];activity+=strengths[i]*exp(-dot(delta,delta)/0.12);}
  }
  heat=1.0-exp(-activity);
  vec3 cold=vec3(0.40,0.44,0.52);
  vec3 low=vec3(0.10,0.40,0.80);
  vec3 mid=vec3(0.12,0.80,0.61);
  vec3 high=vec3(1.0,0.30,0.08);
  vec3 ramp=mix(low,mid,smoothstep(0.0,0.5,heat));
  ramp=mix(ramp,high,smoothstep(0.45,1.0,heat));
  colour=mix(cold,ramp,smoothstep(0.02,0.30,heat));
  vec4 viewPosition=modelViewMatrix*vec4(position,1.0);
  gl_Position=projectionMatrix*viewPosition;
  gl_PointSize=clamp((2.6+heat*2.6)*12.0/-viewPosition.z,1.0,12.0);
 }
`;
const fragmentShader = `
 varying vec3 colour;
 varying float heat;
 void main(){
  float radius=length(gl_PointCoord-vec2(0.5));
  if(radius>0.5)discard;
  float edge=1.0-smoothstep(0.15,0.5,radius);
  gl_FragColor=vec4(colour,(0.40+0.50*heat)*edge);
 }
`;

function Population({
  anatomy,
  neural,
  time,
}: {
  anatomy: Anatomy;
  neural?: Neural;
  time: number;
}) {
  const geometry = useMemo(
    () =>
      new BufferGeometry().setAttribute(
        "position",
        new Float32BufferAttribute(anatomy.positions, 3),
      ),
    [anatomy],
  );
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        uniforms: {
          sources: { value: Array.from({ length: 48 }, () => new Vector3()) },
          strengths: { value: new Float32Array(48) },
        },
      }),
    [],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  const activity = useMemo(() => activityAt(neural, time), [neural, time]);

  useFrame(() => {
    const sampled = sampleNeurons(
      [...activity.keys()].filter((id) => anatomy.lookup.has(id)),
      (id) => activity.get(id)!,
      neural?.inputs ?? [],
      48,
    );
    const strengths = material.uniforms.strengths.value as Float32Array;
    const sources = material.uniforms.sources.value as Vector3[];
    strengths.fill(0);
    sampled.forEach((id, index) => {
      sources[index].set(...anatomy.lookup.get(id)!);
      strengths[index] = activity.get(id)! * 0.6;
    });
  });

  return <points geometry={geometry} material={material} />;
}

function FrameBrain() {
  const { camera, size } = useThree();

  useEffect(() => {
    camera.position.set(
      0,
      0,
      Math.max(
        12,
        4.3 / (Math.tan((19 * Math.PI) / 180) * (size.width / size.height)),
      ),
    );

    camera.lookAt(0, 0, 0);
  }, [camera, size]);

  return null;
}

export function BrainView({ neural, time }: { neural?: Neural; time: number }) {
  const [anatomy, setAnatomy] = useState<Anatomy | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    loadAnatomy()
      .then((data) => {
        if (active) {
          setAnatomy(data);
        }
      })
      .catch((e) => active && setError(e.message));

    return () => {
      active = false;
    };
  }, []);

  return (
    <div
      className="brain-view"
      role="img"
      aria-label="3D FlyWire brain with recorded neuron activity"
    >
      {anatomy ? (
        <Canvas
          dpr={[1, 1.5]}
          camera={{ position: [0, 0, 12], fov: 38, near: 0.1, far: 200 }}
        >
          <FrameBrain />
          <Population anatomy={anatomy} neural={neural} time={time} />
          <OrbitControls enablePan minDistance={3} maxDistance={50} />
        </Canvas>
      ) : (
        <span className="anatomy-loading">{error || "Loading anatomy…"}</span>
      )}
    </div>
  );
}
