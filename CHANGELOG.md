# Terrain Engine 3.11.6 — Stable Recovery

Base: Terrain Engine 3.11.1.

## Changes
- Restored the original 3.11.1 water colors, transparency, absorption and reflection logic.
- Set camera-relative horizon curvature to zero. The ocean remains a circular radial mesh, but no longer sinks below underwater terrain when the camera moves.
- Removed missing local HDRI paths from built-in presets; presets use their existing remote URLs directly.
- Initialized the water shader sky result deterministically to remove the compiler warning.
- Kept the editor terrain hidden until its initial full-world queue has settled and the material pack has been applied.
- Updated every visible launcher/version identifier to 3.11.6.

No terrain generation, displacement, material blending, FPS streaming, or sky appearance logic was otherwise changed.
