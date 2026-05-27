import { useEffect, useRef, useState, useCallback, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Card, Badge, Button, Spinner, Tabs } from '@gsplat/ui';
import { extractGsplatPointCenters, pickMarkerPoint, type SplatAssetFormat, type ViewerManifest } from '@gsplat/viewer-core';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || '/assets';

interface Annotation {
  id: string;
  title: string;
  body?: string;
  kind: string;
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scale: number;
  icon?: string;
  color?: string;
}

interface SplatInfo {
  id: string;
  title: string;
  slug: string;
  status: string;
  productionObjectKey?: string;
  productionFormat?: string;
  boundingBoxJson?: { min: [number, number, number]; max: [number, number, number] };
  defaultCameraJson?: { position: [number, number, number]; target: [number, number, number] };
  pretransformJson?: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | null;
}

interface MarkerObj {
  annotationId: string;
  group: THREE.Group;
  sphere: THREE.Mesh;
  label: THREE.Sprite;
  title: string;
}

type GizmoMode = 'translate' | 'rotate' | 'scale';

const COLOR_PRESETS = ['#ffffff', '#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7', '#06b6d4', '#f97316', '#ec4899', '#8b5cf6'];

const ICON_OPTIONS = [
  { value: 'dot', label: '●' },
  { value: 'info', label: 'ℹ' },
  { value: 'warning', label: '⚠' },
  { value: 'landmark', label: '✦' },
  { value: 'pin', label: '📍' },
  { value: 'star', label: '★' },
];

const KIND_OPTIONS = ['info', 'warning', 'landmark', 'custom'];

// ── Safe number input helper ──
// Allows intermediate states like "-", ".", "-." so user can type freely
function safeNumParse(val: string, fallback: number): number {
  // Allow empty, single minus, single/minus dot
  if (val === '' || val === '-' || val === '.' || val === '-.') return 0;
  const n = parseFloat(val);
  return Number.isNaN(n) ? fallback : n;
}

interface NumInputProps {
  value: number;
  onChange: (v: number) => void;
  step?: string;
  style?: React.CSSProperties;
  placeholder?: string;
}

function NumInput({ value, onChange, step, style, placeholder }: NumInputProps) {
  // Use a string representation that preserves the user's typing intent
  const [textVal, setTextVal] = useState(String(value));

  // Sync external value changes
  useEffect(() => {
    // Only update if the parsed value differs, preserving user's typing
    const parsed = safeNumParse(textVal, 0);
    if (Math.abs(parsed - value) > 0.000001) {
      setTextVal(String(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={textVal}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        setTextVal(raw);
        onChange(safeNumParse(raw, 0));
      }}
      onBlur={() => {
        // Normalize on blur
        const n = safeNumParse(textVal, 0);
        setTextVal(String(n));
        onChange(n);
      }}
      style={style}
    />
  );
}

function normalizeProductionFormat(format?: string): SplatAssetFormat {
  switch (format) {
    case 'sog':
    case 'sog-meta':
    case 'lod-meta':
    case 'compressed-ply':
    case 'spz':
      return format;
    case 'ply':
    default:
      return 'ply';
  }
}

function buildEditorManifest(splat: SplatInfo): ViewerManifest | null {
  if (!splat.productionObjectKey) return null;

  const format = normalizeProductionFormat(splat.productionFormat);
  const assetUrl = `${ASSET_BASE}/${splat.productionObjectKey}`;

  return {
    id: splat.id,
    slug: splat.slug,
    title: splat.title,
    assets: {
      format,
      sceneUrl: assetUrl,
      metaUrl: format === 'sog-meta' ? assetUrl : undefined,
      lodManifestUrl: format === 'lod-meta' ? assetUrl : undefined,
    },
    viewer: {
      defaultCamera: splat.defaultCameraJson,
      enableVr: false,
      enableWebGpu: false,
      quality: 'auto',
      budgets: {
        desktop: 900_000,
        mobile: 250_000,
        vr: 120_000,
      },
      pretransform: splat.pretransformJson || null,
    },
  };
}

function loadPlyPositions(_buffer: ArrayBuffer): Float32Array {
  throw new Error('Legacy point-cloud parser is disabled');
}

function loadSogJsonPositions(_json: unknown): Float32Array {
  throw new Error('Legacy point-cloud parser is disabled');
}

function loadSogBinPositions(_buffer: ArrayBuffer): Float32Array {
  throw new Error('Legacy point-cloud parser is disabled');
}

// ── Component ──

export default function Annotation3DEditorPage() {
  const { id } = useParams<{ id: string }>();
  const containerRef = useRef<HTMLDivElement>(null);

  const [splat, setSplat] = useState<SplatInfo | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [splatLoading, setSplatLoading] = useState(false);
  const [splatError, setSplatError] = useState('');
  const [splatVertexCount, setSplatVertexCount] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [editForm, setEditForm] = useState({
    title: '', body: '', kind: 'info',
    positionX: 0, positionY: 0, positionZ: 0,
    rotationX: 0, rotationY: 0, rotationZ: 0,
    scale: 1, icon: 'dot', color: '#ffffff',
  });

  // Gizmo state
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [snapValue, setSnapValue] = useState(0.1);

  // Place marker mode
  const [placeMode, setPlaceMode] = useState(false);

  // Fly mode
  const [flyMode, setFlyMode] = useState(false);
  const flyMoveSpeedRef = useRef(4.0);
  const flyModeRef = useRef(false);
  const flyYawRef = useRef(0);
  const flyPitchRef = useRef(0);
  const keysRef = useRef<Set<string>>(new Set());
  // Sync ref for the animation loop closure
  useEffect(() => { flyModeRef.current = flyMode; }, [flyMode]);

  // Pretransform state (live-editable, applied to the rendered point cloud)
  const [pretransform, setPretransform] = useState({
    posX: 0, posY: 0, posZ: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    sclX: 1, sclY: 1, sclZ: 1,
  });
  const [ptSaving, setPtSaving] = useState(false);
  const [ptMessage, setPtMessage] = useState('');

  // Track if initial pretransform load is done
  const ptLoadedRef = useRef(false);

  // 3D refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const markersRef = useRef<Map<string, MarkerObj>>(new Map());
  const splatCloudRef = useRef<THREE.Points | null>(null);
  const selectedMarkerObjRef = useRef<THREE.Group | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const groundRef = useRef<THREE.Mesh | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const animFrameRef = useRef<number>(0);
  const pointerRef = useRef<THREE.Vector2>(new THREE.Vector2());
  // Cache the untransformed vertex positions so we can re-apply pretransform in-place
  const originalPositionsRef = useRef<Float32Array | null>(null);
  const sceneRadiusRef = useRef(1);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Apply pretransform to the cached original positions without re-fetching
  const applyPretransformInPlace = useCallback((pt: ReturnType<typeof buildTransform>) => {
    const cloud = splatCloudRef.current;
    const orig = originalPositionsRef.current;
    if (!cloud || !orig || !sceneRef.current) return;

    const geo = cloud.geometry;
    const posArr = (geo.attributes.position as THREE.BufferAttribute).array as Float32Array;

    // Reset to original positions
    posArr.set(orig);

    // Apply transform
    const pos = pt.position;
    const rot = pt.rotation;
    const scl = pt.scale;
    const rotRad = rot.map((r) => THREE.MathUtils.degToRad(r)) as [number, number, number];
    const euler = new THREE.Euler(rotRad[0]!, rotRad[1]!, rotRad[2]!, 'ZYX');

    for (let i = 0; i < posArr.length; i += 3) {
      const v = new THREE.Vector3(posArr[i]! * scl[0]!, posArr[i + 1]! * scl[1]!, posArr[i + 2]! * scl[2]!);
      v.applyEuler(euler);
      v.x += pos[0]!;
      v.y += pos[1]!;
      v.z += pos[2]!;
      posArr[i] = v.x;
      posArr[i + 1] = v.y;
      posArr[i + 2] = v.z;
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    geo.computeBoundingSphere();

    // Update ground plane height for placement
    if (groundRef.current && geo.boundingSphere) {
      const baseY = geo.boundingSphere.center.y - geo.boundingSphere.radius;
      groundRef.current.position.y = baseY;
      if (gridRef.current) {
        gridRef.current.position.set(0, 0, 0);
      }
    }
  }, []);

  const fetchData = useCallback(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/admin/splats/${id}`, { credentials: 'include' }).then((r) => r.json()),
      fetch(`${API_BASE}/admin/splats/${id}/markers`, { credentials: 'include' }).then((r) => r.json()),
    ])
      .then(([splatData, annData]) => {
        const s = splatData.splat || splatData;
        setSplat(s as SplatInfo);
        setAnnotations(annData.items || []);
        // Load pretransform if needed
        if (s.pretransformJson && !ptLoadedRef.current) {
          setPretransform({
            posX: s.pretransformJson.position[0]!, posY: s.pretransformJson.position[1]!, posZ: s.pretransformJson.position[2]!,
            rotX: s.pretransformJson.rotation[0]!, rotY: s.pretransformJson.rotation[1]!, rotZ: s.pretransformJson.rotation[2]!,
            sclX: s.pretransformJson.scale[0]!, sclY: s.pretransformJson.scale[1]!, sclZ: s.pretransformJson.scale[2]!,
          });
          ptLoadedRef.current = true;
        } else if (s.pretransformJson === null || s.pretransformJson === undefined) {
          // Fetch from transform endpoint
          fetch(`${API_BASE}/admin/splats/${id}/transform`, { credentials: 'include' })
            .then((r) => r.json())
            .then((td) => {
              if (td.pretransform) {
                setPretransform({
                  posX: td.pretransform.position[0]!, posY: td.pretransform.position[1]!, posZ: td.pretransform.position[2]!,
                  rotX: td.pretransform.rotation[0]!, rotY: td.pretransform.rotation[1]!, rotZ: td.pretransform.rotation[2]!,
                  sclX: td.pretransform.scale[0]!, sclY: td.pretransform.scale[1]!, sclZ: td.pretransform.scale[2]!,
                });
              }
              ptLoadedRef.current = true;
            })
            .catch(() => { ptLoadedRef.current = true; });
        }
        setLoading(false);
      })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build pretransform object for the point-cloud preview
  const buildTransform = useCallback(() => {
    return {
      position: [pretransform.posX, pretransform.posY, pretransform.posZ] as [number, number, number],
      rotation: [pretransform.rotX, pretransform.rotY, pretransform.rotZ] as [number, number, number],
      scale: [pretransform.sclX, pretransform.sclY, pretransform.sclZ] as [number, number, number],
    };
  }, [pretransform]);

  // Helper to build the Three.js Points mesh from raw positions
  const buildCloudFromPositions = useCallback((rawPositions: Float32Array, pt: ReturnType<typeof buildTransform>) => {
    if (!sceneRef.current) return;

    if (splatCloudRef.current) {
      sceneRef.current.remove(splatCloudRef.current);
      splatCloudRef.current.geometry.dispose();
      (splatCloudRef.current.material as THREE.Material).dispose();
    }

    // Clone so we don't mutate the original stored in originalPositionsRef
    const positions = new Float32Array(rawPositions);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Apply pretransform
    const pos = pt.position;
    const rot = pt.rotation;
    const scl = pt.scale;
    const rotRad = rot.map((r) => THREE.MathUtils.degToRad(r)) as [number, number, number];
    const euler = new THREE.Euler(rotRad[0]!, rotRad[1]!, rotRad[2]!, 'ZYX');

    const posArr = (geometry.attributes.position as THREE.BufferAttribute).array;
    for (let i = 0; i < posArr.length; i += 3) {
      const v = new THREE.Vector3(posArr[i]! * scl[0]!, posArr[i + 1]! * scl[1]!, posArr[i + 2]! * scl[2]!);
      v.applyEuler(euler);
      v.x += pos[0]!;
      v.y += pos[1]!;
      v.z += pos[2]!;
      posArr[i] = v.x;
      posArr[i + 1] = v.y;
      posArr[i + 2] = v.z;
    }
    (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    geometry.computeBoundingSphere();

    const material = new THREE.PointsMaterial({
      size: 0.02,
      color: '#88aacc',
      sizeAttenuation: true,
      blending: THREE.NormalBlending,
      depthWrite: true,
    });

    const cloud = new THREE.Points(geometry, material);
    sceneRef.current.add(cloud);
    splatCloudRef.current = cloud;

    if (geometry.boundingSphere) {
      const center = geometry.boundingSphere.center;
      const rawRadius = geometry.boundingSphere.radius;
      const radius = Number.isFinite(rawRadius) && rawRadius > 0 ? rawRadius : 1;
      const safeRadius = Math.min(Math.max(radius, 1), 5000);
      sceneRadiusRef.current = safeRadius;
      const baseY = center.y - safeRadius;
      const gridOrigin = new THREE.Vector3(0, 0, 0);
      const lookTarget = new THREE.Vector3(0, Math.max(safeRadius * 0.35, 0.75), 0);
      const cameraOffset = new THREE.Vector3(1, 0.6, 1).normalize().multiplyScalar(Math.max(safeRadius * 2.1, 6));

      cameraRef.current!.near = Math.max(0.01, safeRadius / 500);
      cameraRef.current!.far = Math.max(200, safeRadius * 20);
      cameraRef.current!.updateProjectionMatrix();
      cameraRef.current!.position.copy(gridOrigin).add(cameraOffset);
      cameraRef.current!.lookAt(lookTarget);
      orbitRef.current!.target.copy(lookTarget);
      orbitRef.current!.minDistance = Math.max(0.5, safeRadius * 0.1);
      orbitRef.current!.maxDistance = Math.max(50, safeRadius * 12);
      orbitRef.current!.update();

      if (sceneRef.current.fog instanceof THREE.Fog) {
        sceneRef.current.fog.near = safeRadius * 2;
        sceneRef.current.fog.far = safeRadius * 12;
      }

      if (groundRef.current) {
        groundRef.current.position.y = baseY;
      }
      if (gridRef.current) {
        gridRef.current.position.copy(gridOrigin);
      }
    }
  }, []);

  // Load point cloud (PLY, binary SOG, or JSON SOG-meta format)
  const loadSplatCloud = useCallback(async (sceneSplat: SplatInfo, pt: ReturnType<typeof buildTransform>) => {
    if (!sceneRef.current) return;
    const manifest = buildEditorManifest(sceneSplat);
    if (manifest) {
      setSplatLoading(true);
      setSplatError('');

      try {
        const positions = await extractGsplatPointCenters(manifest);
        setSplatVertexCount(positions.length / 3);
        originalPositionsRef.current = new Float32Array(positions);
        buildCloudFromPositions(positions, pt);
        setSplatLoading(false);
        return;
      } catch (err) {
        const assetUrl = manifest.assets.lodManifestUrl || manifest.assets.metaUrl || manifest.assets.sceneUrl;
        const format = manifest.assets.format;
        const message = err instanceof Error ? err.message : String(err);
        setSplatError(`${format} @ ${assetUrl}: ${message}`);
        setSplatLoading(false);
        return;
      }
    }

    const objectKey = sceneSplat.productionObjectKey || '';
    setSplatLoading(true);
    setSplatError('');

    // Binary SOG: .sog extension = packed PlayCanvas Float32 binary.
    // Always treat .sog as binary since the upload pipeline stores them as octet-stream.
    // JSON SOG: .meta.json / .lod-meta.json = SuperSplat-style JSON manifests.
    const isSogBinary = objectKey.endsWith('.sog') &&
      splat?.productionFormat !== 'sog-meta' &&
      splat?.productionFormat !== 'lod-meta';
    const isSogJson = objectKey.endsWith('.meta.json') ||
      objectKey.endsWith('.lod-meta.json') ||
      splat?.productionFormat === 'sog-meta' ||
      splat?.productionFormat === 'lod-meta';

    if (isSogBinary) {
      // Binary SOG — fetch as ArrayBuffer, extract positions from interleaved data
      fetch(`${ASSET_BASE}/${objectKey}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((buffer) => {
          const positions = loadSogBinPositions(buffer);
          setSplatVertexCount(positions.length / 3);
          originalPositionsRef.current = new Float32Array(positions);
          buildCloudFromPositions(positions, pt);
          setSplatLoading(false);
        })
        .catch((err) => {
          setSplatError(err.message);
          setSplatLoading(false);
        });
    } else if (isSogJson) {
      // JSON SOG-meta — fetch as JSON
      fetch(`${ASSET_BASE}/${objectKey}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((json) => {
          const positions = loadSogJsonPositions(json);
          setSplatVertexCount(positions.length / 3);
          originalPositionsRef.current = new Float32Array(positions);
          buildCloudFromPositions(positions, pt);
          setSplatLoading(false);
        })
        .catch((err) => {
          setSplatError(err.message);
          setSplatLoading(false);
        });
    } else {
      // PLY format — fetch as binary
      fetch(`${ASSET_BASE}/${objectKey}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((buffer) => {
          const positions = loadPlyPositions(buffer);
          setSplatVertexCount(positions.length / 3);
          originalPositionsRef.current = new Float32Array(positions);
          buildCloudFromPositions(positions, pt);
          setSplatLoading(false);
        })
        .catch((err) => {
          setSplatError(err.message);
          setSplatLoading(false);
        });
    }
  }, [splat?.productionFormat, buildCloudFromPositions]);

  // ── 3D Scene Setup ──
  useEffect(() => {
    if (!containerRef.current || loading) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#050505');
    scene.fog = new THREE.Fog('#050505', 5, 50);
    sceneRef.current = scene;

    const aspect = width / Math.max(height, 1);
    const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 200);
    camera.position.set(4, 3, 6);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.target.set(0, 0, 0);
    orbit.minDistance = 0.5;
    orbit.maxDistance = 50;
    // Right-click for pan, left-click for orbit
    (orbit as unknown as { mouseButtons: Record<string, number> }).mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    orbitRef.current = orbit;
    orbit.enableZoom = false;

    function onCustomWheel(e: WheelEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (flyModeRef.current) {
        const zoomIn = e.deltaY < 0;
        const speedFactor = zoomIn ? 1.15 : 0.85;
        flyMoveSpeedRef.current = Math.max(0.5, Math.min(50, flyMoveSpeedRef.current * speedFactor));
        return;
      }
      const zoomIn = e.deltaY < 0;
      const currentDist = camera.position.distanceTo(orbit.target);
      const scaleFactor = zoomIn ? 0.9 : 1.1;
      const newDist = currentDist * scaleFactor;
      const direction = zoomIn ? -1 : 1;
      const minDelta = 0.05 * direction;
      const targetDist = newDist + minDelta;
      const clampedDist = Math.max(orbit.minDistance, Math.min(orbit.maxDistance, targetDist));

      if (zoomIn) {
        const camForward = new THREE.Vector3();
        camera.getWorldDirection(camForward);
        camForward.y = 0;
        if (camForward.lengthSq() > 0.01) {
          camForward.normalize();
          const nudgeAmount = Math.min(0.02 * clampedDist, 0.1);
          orbit.target.add(camForward.multiplyScalar(nudgeAmount));
        }
      }

      const camForward = new THREE.Vector3();
      camera.getWorldDirection(camForward);
      camera.position.copy(orbit.target).add(camForward.multiplyScalar(-clampedDist));
      orbit.update();
    }
    renderer.domElement.addEventListener('wheel', onCustomWheel, { passive: false });

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode('translate');
    transform.setSize(1.5);
    transform.addEventListener('dragging-changed', (event) => {
      orbit.enabled = !event.value;
    });
    transform.addEventListener('objectChange', () => {
      const obj = transform.object;
      const selectedMarkerId = selectedIdRef.current;
      if (obj && selectedMarkerId) {
        const position = obj.position;
        if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return;
        const next = {
          positionX: Math.round(position.x * 100) / 100,
          positionY: Math.round(position.y * 100) / 100,
          positionZ: Math.round(position.z * 100) / 100,
          rotationX: Math.round(THREE.MathUtils.radToDeg(obj.rotation.x) * 100) / 100,
          rotationY: Math.round(THREE.MathUtils.radToDeg(obj.rotation.y) * 100) / 100,
          rotationZ: Math.round(THREE.MathUtils.radToDeg(obj.rotation.z) * 100) / 100,
          scale: Math.max(0.01, Math.round(obj.scale.x * 100) / 100),
        };
        setEditForm((prev) => ({
          ...prev,
          ...next,
        }));
        setAnnotations((prev) => prev.map((ann) => (
          ann.id === selectedMarkerId
            ? {
                ...ann,
                positionX: next.positionX,
                positionY: next.positionY,
                positionZ: next.positionZ,
                rotationX: next.rotationX,
                rotationY: next.rotationY,
                rotationZ: next.rotationZ,
                scale: next.scale,
              }
            : ann
        )));
      }
    });
    const transformHelper = transform.getHelper();
    scene.add(transformHelper);
    transformHelper.traverse((child) => {
      child.renderOrder = 10000;
      const material = (child as THREE.Mesh).material;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      materials.forEach((m) => {
        m.depthTest = false;
        m.depthWrite = false;
        m.needsUpdate = true;
      });
    });
    transformRef.current = transform;

    scene.add(new THREE.AmbientLight('#404060', 1.5));
    const dirLight = new THREE.DirectionalLight('#ffffff', 2);
    dirLight.position.set(5, 8, 5);
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(10, 20, '#2a2a2a', '#1a1a1a');
    scene.add(gridHelper);
    gridRef.current = gridHelper;
    scene.add(new THREE.AxesHelper(2));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.name = 'ground';
    scene.add(ground);
    groundRef.current = ground;

    if (splat?.boundingBoxJson) {
      const bb = splat.boundingBoxJson;
      const size: [number, number, number] = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
      const center: [number, number, number] = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
      const boxGeo = new THREE.BoxGeometry(size[0], size[1], size[2]);
      const boxLine = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeo),
        new THREE.LineBasicMaterial({ color: '#404040' }),
      );
      boxLine.position.set(center[0], center[1], center[2]);
      scene.add(boxLine);
    }

    if (splat?.productionObjectKey) {
      loadSplatCloud(splat, buildTransform());
    }

    // ── Fly camera helpers ──
    function updateFlyCamera(dt: number) {
      const k = keysRef.current;
      const speed = k.has('shift') ? flyMoveSpeedRef.current * 3 : flyMoveSpeedRef.current;
      const cam = camera;
      const forward = new THREE.Vector3();
      cam.getWorldDirection(forward);
      const right = new THREE.Vector3();
      right.crossVectors(forward, cam.up).normalize();
      const worldUp = new THREE.Vector3(0, 1, 0);

      const move = new THREE.Vector3();
      if (k.has('w')) move.add(forward);
      if (k.has('s')) move.sub(forward);
      if (k.has('d')) move.add(right);
      if (k.has('a')) move.sub(right);
      if (k.has('q')) move.sub(worldUp);
      if (k.has('e')) move.add(worldUp);

      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed * dt);
        cam.position.add(move);
      }

      const cosP = Math.cos(flyPitchRef.current);
      const lookDir = new THREE.Vector3(
        Math.sin(flyYawRef.current) * cosP,
        Math.sin(flyPitchRef.current),
        Math.cos(flyYawRef.current) * cosP,
      );
      cam.lookAt(cam.position.clone().add(lookDir));
    }

    function onPointerLockChange() {
      if (document.pointerLockElement === renderer.domElement) {
        document.addEventListener('mousemove', onFlyMouseMove);
      } else {
        document.removeEventListener('mousemove', onFlyMouseMove);
      }
    }

    function onFlyMouseMove(e: MouseEvent) {
      flyYawRef.current -= e.movementX * 0.003;
      flyPitchRef.current = Math.max(-1.5, Math.min(1.5, flyPitchRef.current - e.movementY * 0.003));
    }

    function onFlyKeyDown(e: KeyboardEvent) {
      keysRef.current.add(e.key.toLowerCase());
    }
    function onFlyKeyUp(e: KeyboardEvent) {
      keysRef.current.delete(e.key.toLowerCase());
    }

    document.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('keydown', onFlyKeyDown);
    window.addEventListener('keyup', onFlyKeyUp);

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      if (flyModeRef.current) {
        updateFlyCamera(0.016);
      } else {
        updateOrbitPan(0.016);
        orbit.update();
      }
      (transform as unknown as { update?: () => void }).update?.();
      renderer.render(scene, camera);
    }

    function updateOrbitPan(dt: number) {
      const k = keysRef.current;
      if (!k.has('w') && !k.has('s') && !k.has('a') && !k.has('d')) return;
      const speed = 4;
      const cam = camera;
      const rawForward = new THREE.Vector3();
      cam.getWorldDirection(rawForward);
      rawForward.y = 0;
      const forward = new THREE.Vector3();
      if (rawForward.lengthSq() > 0.01) {
        forward.copy(rawForward.normalize());
      } else {
        const offset = cam.position.clone().sub(orbit.target);
        offset.y = 0;
        if (offset.lengthSq() > 0.01) {
          forward.copy(offset.normalize());
        } else {
          forward.set(0, 0, -1);
        }
      }
      const strafe = new THREE.Vector3();
      strafe.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

      const move = new THREE.Vector3();
      if (k.has('w')) move.add(forward);
      if (k.has('s')) move.sub(forward);
      if (k.has('d')) move.add(strafe);
      if (k.has('a')) move.sub(strafe);
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed * dt);
        const t = orbit.target;
        t.set(t.x + move.x, t.y + move.y, t.z + move.z);
      }
    }
    animate();

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onFlyMouseMove);
      window.removeEventListener('keydown', onFlyKeyDown);
      window.removeEventListener('keyup', onFlyKeyUp);
      renderer.domElement.removeEventListener('wheel', onCustomWheel);
      document.exitPointerLock();
      renderer.dispose();
      if (splatCloudRef.current) {
        splatCloudRef.current.geometry.dispose();
        (splatCloudRef.current.material as THREE.Material).dispose();
      }
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [loading]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      switch (e.key.toLowerCase()) {
        case 'w': if (!placeMode) { setGizmoMode('translate'); transformRef.current?.setMode('translate'); } break;
        case 'e': if (!placeMode) { setGizmoMode('rotate'); transformRef.current?.setMode('rotate'); } break;
        case 'r': if (!placeMode) { setGizmoMode('scale'); transformRef.current?.setMode('scale'); } break;
        case 'g': setSnapEnabled((p) => !p); break;
        case 'p': setPlaceMode((p) => !p); break;
        case 'delete': if (selectedId) handleDelete(); break;
        case 'escape': setSelectedId(null); setPlaceMode(false); transformRef.current?.detach(); break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedId, placeMode]);

  // Sync markers with the 3D scene
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const liveIds = new Set(annotations.map((ann) => ann.id));
    markersRef.current.forEach((marker, id) => {
      if (!liveIds.has(id)) {
        scene.remove(marker.group);
        marker.sphere.geometry.dispose();
        (marker.sphere.material as THREE.Material).dispose();
        (marker.label.material as THREE.Material).dispose();
        markersRef.current.delete(id);
      }
    });

    annotations.forEach((ann) => {
      const position = new THREE.Vector3(ann.positionX, ann.positionY, ann.positionZ);
      const color = ann.color || '#ffffff';
      let marker = markersRef.current.get(ann.id);
      if (!marker) {
        const group = new THREE.Group();
        group.name = `marker-group-${ann.id}`;
        group.userData = { annotationId: ann.id };
        group.renderOrder = 9000;

        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.15, 16, 16),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(color),
            emissive: new THREE.Color(color),
            emissiveIntensity: 0.6,
            roughness: 0.3,
            metalness: 0.1,
            depthTest: false,
            depthWrite: false,
          }),
        );
        sphere.name = `marker-${ann.id}`;
        sphere.userData = { annotationId: ann.id };
        sphere.renderOrder = 9001;
        group.add(sphere);

        const sprite = createTextSprite(ann.title, color);
        sprite.position.set(0, 0.2, 0);
        sprite.scale.set(0.6, 0.15, 1);
        sprite.renderOrder = 9002;
        group.add(sprite);

        scene.add(group);
        marker = { annotationId: ann.id, group, sphere, label: sprite, title: ann.title };
        markersRef.current.set(ann.id, marker);
      }

      marker.group.position.copy(position);
      marker.group.rotation.set(
        THREE.MathUtils.degToRad(ann.rotationX),
        THREE.MathUtils.degToRad(ann.rotationY),
        THREE.MathUtils.degToRad(ann.rotationZ),
      );
      marker.group.scale.setScalar(Math.max(0.01, ann.scale || 1));
      marker.group.userData = { annotationId: ann.id };
      marker.sphere.userData = { annotationId: ann.id };

      const material = marker.sphere.material as THREE.MeshStandardMaterial;
      material.color.set(color);
      material.emissive.set(color);
      material.depthTest = false;
      material.depthWrite = false;
      material.needsUpdate = true;

      if (marker.title !== ann.title) {
        marker.group.remove(marker.label);
        (marker.label.material as THREE.Material).dispose();
        marker.label = createTextSprite(ann.title, color);
        marker.label.position.set(0, 0.2, 0);
        marker.label.scale.set(0.6, 0.15, 1);
        marker.label.renderOrder = 9002;
        marker.group.add(marker.label);
        marker.title = ann.title;
      }

      if (ann.id === selectedId) {
        transformRef.current?.attach(marker.group);
        selectedMarkerObjRef.current = marker.group;
      }
    });

    if (!selectedId) {
      transformRef.current?.detach();
      selectedMarkerObjRef.current = null;
    }
  }, [annotations, selectedId]);

  useEffect(() => {
    const tc = transformRef.current;
    if (!tc) return;
    tc.setMode(gizmoMode);
    tc.setTranslationSnap(snapEnabled ? snapValue : null);
    tc.setRotationSnap(snapEnabled ? THREE.MathUtils.degToRad(snapValue * 10) : null);
    tc.setScaleSnap(snapEnabled ? snapValue : null);
  }, [gizmoMode, snapEnabled, snapValue]);

  function createTextSprite(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '24px sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, 40);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  }

  // Canvas click — select markers or place new ones with immediate gizmo
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const ground = groundRef.current;
      if (!renderer || !scene || !camera || !ground || !splat) return;
      if ((transformRef.current as unknown as { dragging?: boolean } | null)?.dragging) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = raycasterRef.current;
      raycaster.setFromCamera(pointerRef.current, camera);

      const markerMeshes = Array.from(markersRef.current.values()).map((m) => m.sphere);
      const intersects = raycaster.intersectObjects(markerMeshes, false);

      if (intersects.length > 0 && intersects[0]) {
        const obj = intersects[0].object as THREE.Mesh;
        const annId = obj.userData.annotationId as string | undefined;
        if (annId) {
          const ann = annotations.find((a) => a.id === annId);
          if (ann) { selectAnnotation(ann); return; }
        }
      }

      if (!placeMode) return;

      const cloudPositions = splatCloudRef.current?.geometry.attributes.position as THREE.BufferAttribute | undefined;
      const pointHit = cloudPositions
        ? pickMarkerPoint({
            positions: cloudPositions.array,
            rayOrigin: [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z],
            rayDirection: [raycaster.ray.direction.x, raycaster.ray.direction.y, raycaster.ray.direction.z],
            sceneRadius: sceneRadiusRef.current,
            snapValue: snapEnabled ? snapValue : null,
          })
        : null;

      const groundHits = pointHit ? [] : raycaster.intersectObject(ground);
      const position = pointHit?.position || (groundHits[0]
        ? [groundHits[0].point.x, groundHits[0].point.y, groundHits[0].point.z] as [number, number, number]
        : null);

      if (position) {
        const px = Math.round((snapEnabled && !pointHit ? Math.round(position[0] / snapValue) * snapValue : position[0]) * 100) / 100;
        const py = Math.round((snapEnabled && !pointHit ? Math.round(position[1] / snapValue) * snapValue : position[1]) * 100) / 100;
        const pz = Math.round((snapEnabled && !pointHit ? Math.round(position[2] / snapValue) * snapValue : position[2]) * 100) / 100;
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;
        // Create a temporary preview annotation so the XYZ gizmo appears immediately
        const tempId = 'preview-' + Math.random().toString(36).slice(2);
        const preview: Annotation = {
          id: tempId,
          title: '', body: '', kind: 'info',
          positionX: px, positionY: py, positionZ: pz,
          rotationX: 0, rotationY: 0, rotationZ: 0,
          scale: 1, icon: 'dot', color: '#ffffff',
        };
        setEditForm({
          title: '', body: '', kind: 'info',
          positionX: px, positionY: py, positionZ: pz,
          rotationX: 0, rotationY: 0, rotationZ: 0,
          scale: 1, icon: 'dot', color: '#ffffff',
        });
        // Remove old previews and add the new one — triggers marker sync + gizmo attach
        setAnnotations((prev) => {
          const cleaned = prev.filter((a) => !a.id.startsWith('preview-'));
          return [...cleaned, preview];
        });
        setSelectedId(tempId);
        setPlaceMode(false);
      }
    },
    [splat, annotations, snapEnabled, snapValue, placeMode],
  );

  function updateSelectedMarkerForm(patch: Partial<typeof editForm>) {
    setEditForm((prev) => ({ ...prev, ...patch }));
    const markerId = selectedIdRef.current;
    if (markerId) {
      setAnnotations((current) => current.map((ann) => (
        ann.id === markerId ? { ...ann, ...patch } : ann
      )));
    }
  }

  function selectAnnotation(ann: Annotation) {
    setSelectedId(ann.id);
    setEditForm({
      title: ann.title, body: ann.body || '', kind: ann.kind,
      positionX: ann.positionX, positionY: ann.positionY, positionZ: ann.positionZ,
      rotationX: ann.rotationX, rotationY: ann.rotationY, rotationZ: ann.rotationZ,
      scale: ann.scale, icon: ann.icon || 'dot', color: ann.color || '#ffffff',
    });
    const marker = markersRef.current.get(ann.id);
    if (marker && transformRef.current) {
      transformRef.current.attach(marker.group);
      selectedMarkerObjRef.current = marker.group;
    }
  }

  // Save/Create/Delete annotation — optimistic, gizmo stays active after save
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    const isNew = !selectedId || selectedId.startsWith('preview-') || selectedId.startsWith('temp-');
    try {
      if (isNew) {
        // Create — replace any preview/temp marker
        const tempId = selectedId || 'temp-' + Math.random().toString(36).slice(2);
        const newAnn: Annotation = {
          id: tempId,
          title: editForm.title,
          body: editForm.body,
          kind: editForm.kind,
          positionX: editForm.positionX, positionY: editForm.positionY, positionZ: editForm.positionZ,
          rotationX: editForm.rotationX, rotationY: editForm.rotationY, rotationZ: editForm.rotationZ,
          scale: editForm.scale, icon: editForm.icon, color: editForm.color,
        };
        setAnnotations((prev) => {
          const cleaned = prev.filter((a) => !a.id.startsWith('preview-') && !a.id.startsWith('temp-'));
          return [...cleaned, newAnn];
        });

        const res = await fetch(`${API_BASE}/admin/splats/${id}/markers`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify(editForm),
        });
        if (!res.ok) throw new Error('Failed to create');
        const data = await res.json();
        const realId: string = data.marker?.id || data.annotation?.id || data.id || tempId;
        setAnnotations((prev) => prev.map((a) => (a.id === tempId ? { ...a, id: realId } : a)));
        setSelectedId(realId); // Keep selected so gizmo stays active
      } else {
        // Update existing annotation — gizmo stays active
        const updated: Annotation = {
          id: selectedId,
          title: editForm.title,
          body: editForm.body,
          kind: editForm.kind,
          positionX: editForm.positionX, positionY: editForm.positionY, positionZ: editForm.positionZ,
          rotationX: editForm.rotationX, rotationY: editForm.rotationY, rotationZ: editForm.rotationZ,
          scale: editForm.scale, icon: editForm.icon, color: editForm.color,
        };
        setAnnotations((prev) => prev.map((a) => (a.id === selectedId ? updated : a)));

        const res = await fetch(`${API_BASE}/admin/markers/${selectedId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify(editForm),
        });
        if (!res.ok) throw new Error('Failed to update');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
      fetchData();
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!confirm('Delete this marker?')) return;
    const deletedId = selectedId;
    // Optimistic: remove from local state immediately
    setAnnotations((prev) => prev.filter((a) => a.id !== deletedId));
    setSelectedId(null);
    transformRef.current?.detach();
    setEditForm({ title: '', body: '', kind: 'info', positionX: 0, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, icon: 'dot', color: '#ffffff' });
    try {
      await fetch(`${API_BASE}/admin/markers/${deletedId}`, { method: 'DELETE', credentials: 'include' });
    } catch {
      alert('Delete failed');
      fetchData();
    }
  };

  const handleCancel = () => {
    // Remove preview markers from state
    setAnnotations((prev) => prev.filter((a) => !a.id.startsWith('preview-') && !a.id.startsWith('temp-')));
    setSelectedId(null);
    setPlaceMode(false);
    transformRef.current?.detach();
    setEditForm({ title: '', body: '', kind: 'info', positionX: 0, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, icon: 'dot', color: '#ffffff' });
  };

  // Save pretransform to server (Apply button transforms in-place; Save persists)
  const handlePtSave = async () => {
    setPtSaving(true);
    setPtMessage('');
    try {
      const r = await fetch(`${API_BASE}/admin/splats/${id}/transform`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          position: [pretransform.posX, pretransform.posY, pretransform.posZ],
          rotation: [pretransform.rotX, pretransform.rotY, pretransform.rotZ],
          scale: [pretransform.sclX, pretransform.sclY, pretransform.sclZ],
        }),
      });
      if (!r.ok) throw new Error('Save failed');
      setPtMessage('Saved ✓');
    } catch (err) {
      setPtMessage(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setPtSaving(false);
    }
  };

  // Apply pretransform live to the 3D view — in-place, no camera reset
  const handlePtApply = () => {
    const pt = buildTransform();
    applyPretransformInPlace(pt);
  };

  const isNewMarker = !selectedId || selectedId.startsWith('preview-') || selectedId.startsWith('temp-');
  const isPreview = selectedId ? selectedId.startsWith('preview-') : false;
  const hasSelection = selectedId || (editForm.positionX !== 0 || editForm.positionY !== 0 || editForm.positionZ !== 0);

  if (loading) {
    return <div style={{ padding: '4rem 0', display: 'flex', justifyContent: 'center' }}><Spinner size="md" /></div>;
  }

  if (error) {
    return <div style={{ padding: '2rem', color: '#ef4444' }}>Error: {error}</div>;
  }

  const numInputStyle: React.CSSProperties = {
    width: '100%', padding: '0.4rem 0.5rem', background: '#111', border: '1px solid #2a2a2a',
    borderRadius: 4, color: '#f5f5f5', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'inherit',
  };

  const inputStyle: React.CSSProperties = {
    padding: '0.4rem 0.5rem', background: '#111', border: '1px solid #2a2a2a',
    borderRadius: 4, color: '#f5f5f5', fontSize: '0.8125rem', outline: 'none', width: '100%', boxSizing: 'border-box',
    fontFamily: 'inherit',
  };

  return (
    <div style={layoutStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link to={`/splats/${id}`} style={backLinkStyle}>← Splat</Link>
          <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{splat?.title || 'Scene'} — 3D Editor</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.6875rem', color: '#737373' }}>
          <button
            onClick={() => setPlaceMode(!placeMode)}
            title="Place Marker mode (P) — click ground to place, XYZ gizmo appears immediately"
            style={{
              padding: '0.25rem 0.625rem', fontSize: '0.6875rem', borderRadius: 4,
              background: placeMode ? '#22c55e' : '#171717',
              border: placeMode ? '1px solid #22c55e' : '1px solid #2a2a2a',
              color: placeMode ? '#050505' : '#a3a3a3', cursor: 'pointer',
              fontWeight: placeMode ? 600 : 400,
            }}
          >
            {placeMode ? '▸ Placing...' : '+ Place Marker'}
          </button>

          {/* Fly mode toggle */}
          <button
            onClick={() => {
              const next = !flyMode;
              setFlyMode(next);
              if (next) {
                const cam = cameraRef.current!;
                const forward = new THREE.Vector3();
                cam.getWorldDirection(forward);
                flyYawRef.current = Math.atan2(forward.x, forward.z);
                const horizontalLen = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
                flyPitchRef.current = Math.atan2(forward.y, horizontalLen);
                flyMoveSpeedRef.current = 4.0;
                containerRef.current?.querySelector('canvas')?.requestPointerLock();
              } else {
                document.exitPointerLock();
                const cam = cameraRef.current!;
                const orbit = orbitRef.current!;
                const pos = cam.position.clone();
                const forward = new THREE.Vector3();
                cam.getWorldDirection(forward);
                const orbitDist = Math.max(1, Math.min(20, pos.distanceTo(orbit.target) || 4));
                orbit.target.copy(pos.clone().add(forward.multiplyScalar(orbitDist)));
                orbit.update();
              }
            }}
            title="Fly mode (F) — WASD + mouse look, Shift=boost, Q/E=up/down"
            style={{
              padding: '0.25rem 0.625rem', fontSize: '0.6875rem', borderRadius: 4,
              background: flyMode ? '#3b82f6' : '#171717',
              border: flyMode ? '1px solid #3b82f6' : '1px solid #2a2a2a',
              color: flyMode ? '#ffffff' : '#a3a3a3', cursor: 'pointer',
              fontWeight: flyMode ? 600 : 400,
            }}
          >
            {flyMode ? '◈ Flying' : '☁ Fly'}
          </button>

          {hasSelection && (
            <div style={{ display: 'flex', gap: 2, background: '#111', borderRadius: 4, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
              {(['translate', 'rotate', 'scale'] as GizmoMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setGizmoMode(m)}
                  title={`${m} (${m[0]!.toUpperCase()}) — drag the colored arrows/rings`}
                  style={{
                    padding: '0.25rem 0.5rem', fontSize: '0.625rem', border: 'none', cursor: 'pointer',
                    background: gizmoMode === m ? '#f5f5f5' : 'transparent',
                    color: gizmoMode === m ? '#050505' : '#737373',
                    fontWeight: gizmoMode === m ? 600 : 400,
                  }}
                >
                  {m[0]!.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} style={{ accentColor: '#f5f5f5' }} />
            Snap
          </label>
          {snapEnabled && (
            <select
              value={snapValue}
              onChange={(e) => setSnapValue(parseFloat(e.target.value))}
              style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 4, color: '#f5f5f5', fontSize: '0.625rem', padding: '0.125rem 0.25rem' }}
            >
              <option value={0.01}>0.01</option>
              <option value={0.1}>0.1</option>
              <option value={0.5}>0.5</option>
              <option value={1}>1.0</option>
              <option value={5}>5.0</option>
            </select>
          )}
          <span style={{ marginLeft: 'auto' }}>
            {splatVertexCount > 0 && `${splatVertexCount.toLocaleString()} splats · `}
            {annotations.length} markers · W/E/R=gizmo · G=snap · P=place · Del=delete
          </span>
        </div>
      </div>

      <div style={editorContainerStyle}>
        {/* 3D Scene */}
        <div ref={containerRef} style={viewerPaneStyle} onClick={handleCanvasClick}>
          {splatLoading && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', padding: '0.5rem 1rem', background: 'rgba(13,13,13,0.85)', border: '1px solid #2a2a2a', borderRadius: 8, color: '#a3a3a3', fontSize: '0.75rem', zIndex: 20 }}>
              Loading point cloud...
            </div>
          )}
          {splatError && (
            <div style={{ position: 'absolute', top: '1rem', left: '50%', transform: 'translateX(-50%)', padding: '0.5rem 1rem', background: 'rgba(20,5,5,0.9)', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: '0.75rem', zIndex: 20 }}>
              Failed to load splat: {splatError}
            </div>
          )}
          {!splat?.productionObjectKey && !splatLoading && (
            <div style={hintOverlayStyle}>
              <span>No splat data available. Upload and process a file first.</span>
            </div>
          )}
          {splat?.productionObjectKey && !splatLoading && !splatError && (
            <div style={hintOverlayStyle}>
              <span>
                {placeMode
                  ? 'Click on the ground plane to place a new marker (XYZ gizmo appears)'
                  : 'Click "Place Marker" to add markers · Click existing markers to edit · Drag XYZ handles'}
              </span>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={panelStyle}>
          {/* Marker list */}
          <div style={{ padding: '0.875rem', borderBottom: '1px solid #2a2a2a' }}>
            <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>Markers ({annotations.length})</h3>
            {annotations.length === 0 && (
              <p style={{ color: '#737373', fontSize: '0.75rem', margin: 0 }}>No markers. Click "Place Marker" to add.</p>
            )}
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {annotations.map((ann) => (
                <button
                  key={ann.id}
                  onClick={() => { setPlaceMode(false); selectAnnotation(ann); }}
                  style={{
                    display: 'flex', alignItems: 'center', width: '100%', padding: '0.375rem 0.5rem',
                    border: `1px solid ${selectedId === ann.id ? '#f5f5f5' : '#2a2a2a'}`,
                    borderRadius: 4, background: selectedId === ann.id ? '#171717' : '#0d0d0d',
                    color: '#f5f5f5', cursor: 'pointer', marginBottom: '0.25rem', fontSize: '0.75rem',
                    textAlign: 'left',
                  }}
                >
                  <span style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                    background: ann.color || '#ffffff', marginRight: '0.5rem', flexShrink: 0,
                  }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ann.title || (ann.id.startsWith('preview-') ? '(new marker)' : '(untitled)')}
                  </span>
                  <span style={{ fontSize: '0.625rem', color: '#737373', marginLeft: 'auto', flexShrink: 0 }}>
                    [{ann.positionX.toFixed(1)},{ann.positionY.toFixed(1)},{ann.positionZ.toFixed(1)}]
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Edit form */}
          <div style={{ padding: '0.875rem', borderBottom: '1px solid #2a2a2a' }}>
            <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, margin: '0 0 0.75rem 0' }}>
              {isPreview ? 'New Marker (drag XYZ gizmo to position)' : isNewMarker ? 'New Marker' : 'Edit Marker'}
            </h3>

            {!hasSelection && (
              <p style={{ color: '#737373', fontSize: '0.75rem', margin: 0 }}>
                Select a marker from the list above, or click "Place Marker" and click on the scene to create one.
              </p>
            )}

            {hasSelection && (
              <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem' }}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Title *</span>
                    <input type="text" value={editForm.title} onChange={(e) => updateSelectedMarkerForm({ title: e.target.value })} required placeholder="Name..." style={inputStyle} />
                  </label>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Kind</span>
                    <select value={editForm.kind} onChange={(e) => updateSelectedMarkerForm({ kind: e.target.value })} style={inputStyle}>
                      {KIND_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </label>
                </div>

                <label style={labelStyle}>
                  <span style={labelTextStyle}>Body</span>
                  <input type="text" value={editForm.body} onChange={(e) => updateSelectedMarkerForm({ body: e.target.value })} placeholder="Description..." style={inputStyle} />
                </label>

                <div>
                  <span style={labelTextStyle}>Color</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.25rem' }}>
                    {COLOR_PRESETS.map((c) => (
                      <button key={c} type="button" onClick={() => updateSelectedMarkerForm({ color: c })}
                        style={{
                          width: 22, height: 22, borderRadius: 4, background: c,
                          border: editForm.color === c ? '2px solid #f5f5f5' : '1px solid #2a2a2a',
                          cursor: 'pointer', transition: 'border-color 150ms',
                        }} title={c}
                      />
                    ))}
                    <input type="color" value={editForm.color} onChange={(e) => updateSelectedMarkerForm({ color: e.target.value })}
                      style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid #2a2a2a', cursor: 'pointer', padding: 0, background: 'none' }}
                    />
                  </div>
                </div>

                <div>
                  <span style={labelTextStyle}>Icon</span>
                  <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
                    {ICON_OPTIONS.map((opt) => (
                      <button key={opt.value} type="button" onClick={() => updateSelectedMarkerForm({ icon: opt.value })}
                        style={{
                          width: 28, height: 28, borderRadius: 4, fontSize: '0.875rem',
                          background: editForm.icon === opt.value ? '#171717' : '#0d0d0d',
                          border: editForm.icon === opt.value ? '1px solid #f5f5f5' : '1px solid #2a2a2a',
                          cursor: 'pointer', color: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }} title={opt.value}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Annotation Position */}
                <div>
                  <span style={labelTextStyle}>Position (drag XYZ gizmo arrows in 3D view)</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.375rem', marginTop: '0.25rem' }}>
                    {['X', 'Y', 'Z'].map((axis, i) => {
                      const keys = ['positionX', 'positionY', 'positionZ'] as const;
                      return (
                        <label key={axis} style={labelStyle}>
                          <span style={{ ...labelTextStyle, fontSize: '0.625rem' }}>{axis}</span>
                          <NumInput value={editForm[keys[i]!]} onChange={(v) => updateSelectedMarkerForm({ [keys[i]!]: v })} step="0.01" style={numInputStyle} />
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Annotation Rotation */}
                <div>
                  <span style={labelTextStyle}>Rotation (degrees)</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.375rem', marginTop: '0.25rem' }}>
                    {['X', 'Y', 'Z'].map((axis, i) => {
                      const keys = ['rotationX', 'rotationY', 'rotationZ'] as const;
                      return (
                        <label key={axis} style={labelStyle}>
                          <span style={{ ...labelTextStyle, fontSize: '0.625rem' }}>{axis}</span>
                          <NumInput value={editForm[keys[i]!]} onChange={(v) => updateSelectedMarkerForm({ [keys[i]!]: v })} step="0.1" style={numInputStyle} />
                        </label>
                      );
                    })}
                  </div>
                </div>

                <label style={labelStyle}>
                  <span style={labelTextStyle}>Scale ({editForm.scale.toFixed(2)})</span>
                  <input type="range" min="0.1" max="10" step="0.1" value={editForm.scale}
                    onChange={(e) => updateSelectedMarkerForm({ scale: parseFloat(e.target.value) || 1 })}
                    style={{ width: '100%', accentColor: '#f5f5f5' }}
                  />
                </label>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <Button type="submit" variant="primary" size="sm">
                    {isNewMarker ? 'Create' : 'Update'}
                  </Button>
                  {!isNewMarker && (
                    <Button type="button" variant="danger" size="sm" onClick={handleDelete}>Delete</Button>
                  )}
                  <Button type="button" variant="secondary" size="sm" onClick={handleCancel}>Cancel</Button>
                </div>
              </form>
            )}
          </div>

          {/* ── Pretransform Panel ── */}
          <div style={{ padding: '0.875rem' }}>
            <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, margin: '0 0 0.25rem 0' }}>Pretransform</h3>
            <p style={{ fontSize: '0.625rem', color: '#737373', margin: '0 0 0.75rem 0' }}>
              Adjust the splat's position, rotation, and scale. Save to persist; Apply reloads the 3D view.
            </p>

            {/* Position */}
            <div style={{ marginBottom: '0.625rem' }}>
              <span style={labelTextStyle}>Position</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.25rem', marginTop: '0.125rem' }}>
                {[
                  { label: 'X', val: pretransform.posX, set: (v: number) => setPretransform((p) => ({ ...p, posX: v })) },
                  { label: 'Y', val: pretransform.posY, set: (v: number) => setPretransform((p) => ({ ...p, posY: v })) },
                  { label: 'Z', val: pretransform.posZ, set: (v: number) => setPretransform((p) => ({ ...p, posZ: v })) },
                ].map((a) => (
                  <label key={a.label} style={labelStyle}>
                    <span style={{ ...labelTextStyle, fontSize: '0.6rem' }}>{a.label}</span>
                    <NumInput value={a.val} onChange={a.set} step="0.01" style={numInputStyle} />
                  </label>
                ))}
              </div>
            </div>

            {/* Rotation */}
            <div style={{ marginBottom: '0.625rem' }}>
              <span style={labelTextStyle}>Rotation (degrees)</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.25rem', marginTop: '0.125rem' }}>
                {[
                  { label: 'X', val: pretransform.rotX, set: (v: number) => setPretransform((p) => ({ ...p, rotX: v })) },
                  { label: 'Y', val: pretransform.rotY, set: (v: number) => setPretransform((p) => ({ ...p, rotY: v })) },
                  { label: 'Z', val: pretransform.rotZ, set: (v: number) => setPretransform((p) => ({ ...p, rotZ: v })) },
                ].map((a) => (
                  <label key={a.label} style={labelStyle}>
                    <span style={{ ...labelTextStyle, fontSize: '0.6rem' }}>{a.label}</span>
                    <NumInput value={a.val} onChange={a.set} step="0.1" style={numInputStyle} />
                  </label>
                ))}
              </div>
            </div>

            {/* Scale */}
            <div style={{ marginBottom: '0.75rem' }}>
              <span style={labelTextStyle}>Scale</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.25rem', marginTop: '0.125rem' }}>
                {[
                  { label: 'X', val: pretransform.sclX, set: (v: number) => setPretransform((p) => ({ ...p, sclX: v })) },
                  { label: 'Y', val: pretransform.sclY, set: (v: number) => setPretransform((p) => ({ ...p, sclY: v })) },
                  { label: 'Z', val: pretransform.sclZ, set: (v: number) => setPretransform((p) => ({ ...p, sclZ: v })) },
                ].map((a) => (
                  <label key={a.label} style={labelStyle}>
                    <span style={{ ...labelTextStyle, fontSize: '0.6rem' }}>{a.label}</span>
                    <NumInput value={a.val} onChange={a.set} step="0.01" style={numInputStyle} />
                  </label>
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="primary" size="sm" onClick={handlePtSave} disabled={ptSaving}>
                {ptSaving ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="secondary" size="sm" onClick={handlePtApply} disabled={splatLoading}>
                Apply to View
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPretransform({ posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, sclX: 1, sclY: 1, sclZ: 1 })}>
                Reset
              </Button>
              {ptMessage && (
                <span style={{ fontSize: '0.6875rem', color: ptMessage.startsWith('Error') ? '#ef4444' : '#22c55e', flexBasis: '100%', marginTop: '0.25rem' }}>
                  {ptMessage}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Styles ──
const layoutStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', background: '#050505', color: '#f5f5f5', margin: '-0.5rem -2rem 0' };
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 1rem', borderBottom: '1px solid #2a2a2a', background: '#0d0d0d', flexShrink: 0 };
const backLinkStyle: React.CSSProperties = { color: '#a3a3a3', textDecoration: 'underline', fontSize: '0.75rem' };
const editorContainerStyle: React.CSSProperties = { flex: 1, display: 'flex', minHeight: 0 };
const viewerPaneStyle: React.CSSProperties = { flex: 1, position: 'relative', cursor: 'crosshair', background: '#050505' };
const hintOverlayStyle: React.CSSProperties = { position: 'absolute', top: '1rem', left: '50%', transform: 'translateX(-50%)', padding: '0.5rem 1rem', background: 'rgba(13,13,13,0.85)', border: '1px solid #2a2a2a', borderRadius: 8, color: '#a3a3a3', fontSize: '0.75rem', pointerEvents: 'none', zIndex: 10 };
const panelStyle: React.CSSProperties = { width: 340, background: '#0d0d0d', borderLeft: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' };
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.125rem' };
const labelTextStyle: React.CSSProperties = { fontSize: '0.625rem', color: '#737373' };
