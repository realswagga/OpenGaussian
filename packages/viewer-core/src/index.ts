export type {
  RendererMode,
  CameraMode,
  QualityPreset,
  SplatAssetFormat,
  ViewerLoadPhase,
  ViewerManifest,
  DefaultCamera,
  MarkerPoint,
  AnnotationPoint,
  ViewerOptions,
  ViewerStats,
  ViewerRuntimeProgress,
  ResolvedViewerAsset,
  ViewerRuntime,
  QualityProfile,
  QualityProfileName,
} from './types.js';

export {
  qualityProfiles,
  chooseRendererMode,
  detectDeviceProfile,
  resolveViewerAsset,
} from './types.js';

export { GsplatViewer } from './GsplatViewer.js';
export {
  extractGsplatPointCenters,
  extractGsplatPointCentersFromResolvedAsset,
  fetchLodChunkUrls,
} from './gsplatCenters.js';
export { pickMarkerPoint } from './markerPlacement.js';
export type { MarkerPlacementHit, MarkerPlacementInput } from './markerPlacement.js';
export {
  applyDeadzone,
  center2D,
  classifyTwoPointerGesture,
  clamp,
  computeDepthConsensus,
  computeDepthAwareDollyStep,
  computePinchScale,
  distance2D,
  readGamepadStick,
} from './navigationControls.js';
export type {
  DepthAwareDollyInput,
  DepthConsensus,
  DepthConsensusInput,
  GamepadStick,
  GesturePoint,
  TwoPointerGesture,
  TwoPointerGestureInput,
} from './navigationControls.js';
