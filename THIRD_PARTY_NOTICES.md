# Third-Party Notices

## ThreeJS Water / Evan Wallace WebGL Water

The GPU wave simulation architecture in `src/water/GpuWaterSimulation.js` and optical concepts in `src/water/AdvancedWaterSystem.js` are adapted for an open-world terrain use case from:

- Original WebGL Water by Evan Wallace.
- Three.js port and enhancements by Yong Su (`jeantimex/threejs-water`).

The source project uses the MIT License. The full license notice is included in:

```text
licenses/threejs-water-MIT.txt
```

The open-world adaptation replaces the original finite pool renderer with a camera-following circular ocean, screen-space depth refraction, shoreline fading and terrain-driven water visibility.
