export interface NeuralActivity {
  spikes: [number, number][];
  rates?: [number, number, number][];
  rateSteps?: number;
  inputs: number[];
  totalSpikes: number;
  population: number;
  activeNeurons?: number;
  durationMs: number;
}

export type Operation = "+" | "-" | "*" | "/";

export type Position = [number, number, number];

export type RangeKey = `${"add" | "mul"}_${"left" | "right"}_${"min" | "max"}`;

export type Settings = Record<RangeKey, number> & {
  add: boolean;
  sub: boolean;
  mul: boolean;
  div: boolean;
  duration: number;
  profileId: string;
};

export type PhysicalKey = {
  code: string;
  label: string;
  position: Position;
  width: number;
};

export type PhysicalFrame = {
  contactId?: number;
  effector?: Position;
  left_effector?: Position;
  right_effector?: Position;
  hand?: "left" | "right";
  phase?: string;
  key?: string;
};

export type ActivityTiming = {
  observationId: string;
  startedAt: number;
  recordedAt: number;
  through: number;
};

export type Problem = {
  a: number;
  b: number;
  operation: Operation;
  text: string;
};

export type Prediction = {
  answer: number;
  answerText?: string;
  seconds: number;
  observations: number;
  downstreamSpikes: number;
  activeNeurons?: number;
  activity: number[];
  neural?: NeuralActivity;
};

export type Trial = Problem &
  Prediction & {
    answerSource: string;
  };

export type SessionState = {
  runId?: string;
  serverTime?: number;
  startedAt?: number;
  endedAt?: number;
  status: string;
  keys: PhysicalKey[];
  frame: PhysicalFrame | null;
  trial: Trial | null;
  neural?: NeuralActivity | null;
  attempts: number;
  accepted: number;
  settings?: Settings;
  error?: string | null;
};

export type MotorFrame = {
  kind: "motor";
  phase: "reach" | "contact" | "release";
  effector: Position;
  left_effector: Position;
  right_effector: Position;
  hand: "left" | "right";
  key: string;
  contactId?: number;
};

export type InputEvent = {
  kind: "input";
  key: string;
  contactId: number;
  position: Position;
  trusted: boolean;
  browserTime: number;
};

export type AttemptEvent = {
  kind: "attempt";
  a: number;
  b: number;
  operation: Operation;
  submitted: number;
  answerSource: string;
  accepted: boolean;
  attempts: number;
  score: number;
};

export type PredictionEvent = { kind: "prediction" } & Trial;

export type RunEvent = (
  MotorFrame | InputEvent | AttemptEvent | PredictionEvent
) & { time?: number };

export type SessionPacket =
  | RunEvent
  | ({ kind: "state" } & SessionState)
  | { kind: "screen"; png: string; time?: number; runId?: string }
  | { kind: "activity"; neural: NeuralActivity; timing?: ActivityTiming };

export type Profile = {
  id: string;
  name: string;
  features: number;
  arithmeticMode: "sequence";
  synaptic: boolean;
  sha256: string;
};

export type Broadcast = (packet: SessionPacket) => void;
