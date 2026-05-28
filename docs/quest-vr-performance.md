# Quest 3 VR Performance Lab

This viewer includes an in-app Quest Perf panel for VR performance captures. Open a scene with `?questPerf=1`, or use the `Quest Perf` button in the viewer top bar.

## Capture Workflow

1. Install OVR Metrics Tool on the headset and enable the persistent overlay.
2. In OVR Metrics Report Mode, include FPS, stale frames, tears, CPU/GPU utilization or levels, heat, memory, and throttling fields when available.
3. Open the viewer on Quest Browser and enter VR.
4. Open `Quest Perf`, press `Capture`, and look at the problem area for at least 20 seconds.
5. Press `Stop`, export CSV and JSON, then export the OVR Metrics report CSV.
6. Compare the viewer trace id and wall-clock timestamps with OVR Metrics timestamps.

## Live Matrix

`Run Matrix` applies live-safe settings while the XR session stays active:

- fixed foveation
- splat budget
- spherical harmonics on/off
- minimum pixel size
- contribution clipping
- radial sorting
- marker/gizmo visibility

XR framebuffer scale is captured in the trace, but it is not changed by the live matrix because WebXR applies `framebufferScaleFactor` when the XR session starts. To test scale values, set the desired scale before entering VR, start a new capture, and compare the exported traces.

## Bottleneck Signals

- CPU-bound: low GPU pressure in OVR Metrics, high viewer CPU buckets, little improvement from foveation or scale.
- Sort-bound: `sortTimeMs` rises with active splats, and lower splat budget improves frame time.
- Fill-rate-bound: lower XR scale, higher foveation, or stricter screen-space culling improves frame time while active splats stay similar.
- LOD/streaming-bound: frame spikes align with `lodLoadingCount` or `refining` phase.
- Memory/GC-bound: spikes align with JS heap growth or large allocation steps.
- Thermal-bound: performance decays over time and OVR Metrics shows heat or throttling changes.

## ADB Log Capture

From the repo root on Windows:

```powershell
.\scripts\quest-perf-adb.ps1
```

The script creates a timestamped folder under `perf-captures/quest/`, stores device properties, and records `adb logcat` until you stop it with `Ctrl+C`.

For a complete run, start the ADB script first, start OVR Metrics Report Mode, then start the in-app Quest Perf capture.
