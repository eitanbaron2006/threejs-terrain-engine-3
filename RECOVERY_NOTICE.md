# Stable Recovery Branch

This build is intentionally based on Terrain Engine 3.3.0, the last known-good integrated version.

It does **not** contain the 3.4.x Exact Water Optics branch. Those changes modified the global render pipeline and caused regressions in terrain streaming, sky rendering and ocean presentation.

Future exact-water work must be validated in a standalone water laboratory before integration. The terrain renderer, streaming system, sky and LOD pipeline must remain unchanged.
