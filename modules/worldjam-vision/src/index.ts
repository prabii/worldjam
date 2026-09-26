import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/** Normalised 0..1 box in the upright camera frame, origin top-left. */
export interface VisionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type VisionDirection = 'left' | 'center' | 'right';

export interface VisionDetection {
  trackId: string;
  label: string;
  spokenLabel: string;
  confidence: number;
  bbox: VisionBox;
  center: { x: number; y: number };
  areaRatio: number;
  centerScore: number;
  timestamp: number;
}

export interface VisionObjectSummary {
  trackId: string;
  label: string;
  spokenLabel: string;
  bbox: VisionBox;
  isPrimary: boolean;
}

/** Compact state, emitted only when something visible changed (≤5 Hz). */
export interface VisionState {
  primaryObject: VisionDetection | null;
  direction: VisionDirection | null;
  multipleObjectsDetected: boolean;
  objectCount: number;
  objects: VisionObjectSummary[];
  timestamp: number;
}

export interface LatestReadout {
  objectId: string;
  label: string;
  confidence: number;
  direction: VisionDirection;
  multipleObjectsDetected: boolean;
  objectCount: number;
  text: string;
  timestamp: number;
  /** Present on events: whether this readout was announced aloud. */
  spoken?: boolean;
}

export interface VisionStatus {
  status: 'idle' | 'initializing' | 'ready' | 'error';
  error: string | null;
  running: boolean;
  backend: 'qnn' | 'litert' | null;
  execution: 'HTP' | 'GPU' | 'CPU' | null;
  model: string | null;
  inputSize: number | null;
  fallbackReasons: string[];
  device: Record<string, unknown>;
  tts: Record<string, unknown>;
}

export interface FormatRequest {
  requestId: number;
  event: { primary: string; direction: VisionDirection; additionalObjectCount: number };
  fallbackText: string;
  timeoutMs: number;
}

export type VisionDiagnostics = Record<string, unknown>;

type Events = {
  onVisionState: (s: VisionState) => void;
  onReadout: (r: LatestReadout) => void;
  onFormatRequest: (r: FormatRequest) => void;
  onStatus: (s: VisionStatus) => void;
};

interface WorldVisionNative {
  initialize(): VisionStatus;
  startDetection(): void;
  stopDetection(): void;
  setReadoutEnabled(enabled: boolean): boolean;
  isReadoutEnabled(): boolean;
  repeatLatestReadout(): string;
  getLatestReadout(): LatestReadout | null;
  getBackend(): VisionStatus;
  getModelInfo(): Record<string, unknown>;
  getDiagnostics(): VisionDiagnostics;
  resetDiagnostics(): void;
  setConfig(patch: Record<string, unknown>): Record<string, unknown>;
  getConfig(): Record<string, unknown>;
  setExternalFormatting(enabled: boolean): boolean;
  completeReadout(requestId: number, text: string | null): boolean;
  addListener<K extends keyof Events>(event: K, listener: Events[K]): EventSubscription;
}

const native = requireOptionalNativeModule<WorldVisionNative>('WorldVision');

/** False in Expo Go or any build without the native module. */
export const isWorldVisionAvailable = native != null;

/** Name the frame-processor plugin is registered under natively. */
export const WORLD_VISION_PLUGIN = 'worldVisionDetect';

const noop: EventSubscription = { remove: () => {} } as EventSubscription;

/**
 * Keeps screens renderable without the native module; every call reports
 * "unavailable" instead of throwing, so the UI can say so honestly.
 */
const stub: WorldVisionNative = {
  initialize: () => ({
    status: 'error',
    error: 'Vision native module not loaded (dev build required).',
    running: false,
    backend: null,
    execution: null,
    model: null,
    inputSize: null,
    fallbackReasons: [],
    device: {},
    tts: {},
  }),
  startDetection: () => {},
  stopDetection: () => {},
  setReadoutEnabled: (e) => e,
  isReadoutEnabled: () => false,
  repeatLatestReadout: () => '',
  getLatestReadout: () => null,
  getBackend: () => stub.initialize(),
  getModelInfo: () => ({}),
  getDiagnostics: () => ({}),
  resetDiagnostics: () => {},
  setConfig: () => ({}),
  getConfig: () => ({}),
  setExternalFormatting: () => false,
  completeReadout: () => false,
  addListener: () => noop,
};

export const WorldVision: WorldVisionNative = native ?? stub;
