import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function bendPlane(width, height, segments, bend, taper = 0) {
  const geometry = new THREE.PlaneGeometry(width, height, 1, segments);
  geometry.translate(0, height * 0.5, 0);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const y = positions.getY(index);
    const ratio = y / height;
    const side = positions.getX(index);
    positions.setX(index, side * (1 - taper * ratio) + Math.sin(ratio * Math.PI) * bend);
    positions.setZ(index, Math.sin(ratio * Math.PI * 1.6) * bend * 0.22);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createPlantCluster({
  width,
  height,
  segments,
  bend,
  taper,
  bladeCount,
  spread,
}) {
  const blades = [];
  for (let index = 0; index < bladeCount; index += 1) {
    const angle = index / bladeCount * Math.PI * 2 + (index % 2) * 0.23;
    const scale = 0.72 + (index % 3) * 0.14;
    const blade = bendPlane(
      width * (0.78 + (index % 2) * 0.18),
      height * scale,
      segments,
      bend * (index % 2 ? 1 : -0.82),
      taper,
    );
    blade.rotateY(angle);
    blade.translate(
      Math.cos(angle) * spread * (0.35 + (index % 3) * 0.22),
      0,
      Math.sin(angle) * spread * (0.35 + (index % 3) * 0.22),
    );
    blades.push(blade);
  }
  const geometry = mergeGeometries(blades, false);
  blades.forEach((blade) => blade.dispose());
  geometry.computeVertexNormals();
  return geometry;
}

function createPlantMaterial(color, timeUniform) {
  const baseColor = new THREE.Color(color);
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.82,
    metalness: 0,
    emissive: baseColor.clone().multiplyScalar(0.08),
    emissiveIntensity: 0.22,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAquaticTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        uniform float uAquaticTime;
      `)
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          float aquaticPhase = instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.093;
        #else
          float aquaticPhase = 0.0;
        #endif
        float aquaticHeight = max(position.y, 0.0);
        transformed.x += sin(uAquaticTime * 0.72 + aquaticPhase + aquaticHeight * 0.31)
          * aquaticHeight * 0.045;
        transformed.z += cos(uAquaticTime * 0.57 + aquaticPhase * 1.31 + aquaticHeight * 0.24)
          * aquaticHeight * 0.032;
      `);
  };
  material.customProgramCacheKey = () => 'aquatic-current-v1';
  return material;
}

function createReefMaterial(color, roughness = 0.74) {
  const baseColor = new THREE.Color(color);
  return new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness,
    metalness: 0,
    emissive: baseColor.clone().multiplyScalar(0.07),
    emissiveIntensity: 0.18,
    vertexColors: true,
  });
}

function createTaperedBranch(start, end, baseRadius, tipRadius) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(
    tipRadius,
    baseRadius,
    length,
    7,
    2,
  );
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  ));
  geometry.translate(
    (start.x + end.x) * 0.5,
    (start.y + end.y) * 0.5,
    (start.z + end.z) * 0.5,
  );
  return geometry;
}

function createBranchingCoralGeometry() {
  const branches = [];
  const root = new THREE.Vector3(0, 0, 0);
  const crown = new THREE.Vector3(0, 2.4, 0);
  branches.push(createTaperedBranch(root, crown, 0.46, 0.25));
  for (let index = 0; index < 9; index += 1) {
    const angle = index / 9 * Math.PI * 2 + (index % 2) * 0.2;
    const lower = 0.72 + (index % 3) * 0.42;
    const start = new THREE.Vector3(0, lower, 0);
    const middle = new THREE.Vector3(
      Math.cos(angle) * (0.62 + (index % 2) * 0.18),
      lower + 0.78,
      Math.sin(angle) * (0.62 + (index % 2) * 0.18),
    );
    const end = new THREE.Vector3(
      Math.cos(angle + 0.12) * (0.94 + (index % 3) * 0.11),
      middle.y + 0.72 + (index % 2) * 0.18,
      Math.sin(angle + 0.12) * (0.94 + (index % 3) * 0.11),
    );
    branches.push(createTaperedBranch(start, middle, 0.24, 0.15));
    branches.push(createTaperedBranch(middle, end, 0.15, 0.075));
  }
  const merged = mergeGeometries(branches, false);
  branches.forEach((branch) => branch.dispose());
  merged.computeVertexNormals();
  return merged;
}

function createMassiveCoralGeometry() {
  const blobs = [];
  const placements = [
    [0, 0.72, 0, 1.22, 0.7, 1.02],
    [0.82, 0.54, 0.18, 0.82, 0.52, 0.72],
    [-0.72, 0.5, 0.34, 0.76, 0.48, 0.7],
    [0.28, 0.49, -0.72, 0.74, 0.45, 0.66],
    [-0.36, 0.44, -0.58, 0.62, 0.4, 0.58],
    [0.15, 1.13, 0.17, 0.66, 0.43, 0.6],
  ];
  for (const [x, y, z, sx, sy, sz] of placements) {
    const blob = new THREE.IcosahedronGeometry(1, 2);
    const positions = blob.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      const px = positions.getX(index);
      const py = positions.getY(index);
      const pz = positions.getZ(index);
      const variation = 1 + Math.sin(
        (px + x) * 8.3 + (pz + z) * 6.7 + (py + y) * 3.9,
      ) * 0.055;
      positions.setXYZ(index, px * sx * variation, py * sy * variation, pz * sz * variation);
    }
    positions.needsUpdate = true;
    blob.translate(x, y, z);
    blob.computeVertexNormals();
    blobs.push(blob);
  }
  const geometry = mergeGeometries(blobs, false);
  blobs.forEach((blob) => blob.dispose());
  geometry.computeVertexNormals();
  return geometry;
}

function createPlateCoralGeometry() {
  const pieces = [];
  const stem = new THREE.CylinderGeometry(0.22, 0.38, 1.25, 10, 3);
  stem.translate(0, 0.625, 0);
  pieces.push(stem);
  const layers = [
    { y: 0.76, radius: 0.92, tilt: -0.08 },
    { y: 1.18, radius: 1.42, tilt: 0.06 },
    { y: 1.55, radius: 1.05, tilt: -0.04 },
  ];
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    const plate = new THREE.CylinderGeometry(
      layer.radius,
      layer.radius * 0.72,
      0.14,
      28,
      2,
    );
    const positions = plate.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const angle = Math.atan2(z, x);
      const scallop = 1 + Math.sin(angle * 7 + layerIndex * 1.9) * 0.085
        + Math.sin(angle * 3 - 0.7) * 0.045;
      positions.setX(index, x * scallop);
      positions.setZ(index, z * scallop);
      positions.setY(index, positions.getY(index) + Math.sin(angle * 4.0) * 0.035);
    }
    positions.needsUpdate = true;
    plate.rotateX(layer.tilt);
    plate.rotateY(layerIndex * 0.74);
    plate.translate((layerIndex - 1) * 0.16, layer.y, (1 - layerIndex) * 0.11);
    plate.computeVertexNormals();
    pieces.push(plate);
  }
  const geometry = mergeGeometries(pieces, false);
  pieces.forEach((piece) => piece.dispose());
  geometry.computeVertexNormals();
  return geometry;
}

function createSpongeClusterGeometry({ tall = false } = {}) {
  const pieces = [];
  const tubes = tall
    ? [
      [-0.32, 0.06, 0.19, 0.3, 2.25],
      [0.2, 0.18, 0.16, 0.26, 1.78],
      [0.28, -0.2, 0.13, 0.22, 1.36],
      [-0.12, -0.26, 0.11, 0.2, 1.12],
    ]
    : [
      [0, 0, 0.48, 0.74, 1.72],
      [0.56, 0.12, 0.27, 0.44, 1.18],
      [-0.5, 0.2, 0.23, 0.39, 1.02],
      [0.26, -0.47, 0.18, 0.32, 0.82],
      [-0.32, -0.42, 0.16, 0.28, 0.72],
    ];
  for (let tubeIndex = 0; tubeIndex < tubes.length; tubeIndex += 1) {
    const [x, z, topRadius, bottomRadius, height] = tubes[tubeIndex];
    const body = new THREE.CylinderGeometry(topRadius, bottomRadius, height, 14, 6, true);
    const positions = body.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      const y = positions.getY(index) + height * 0.5;
      const angle = Math.atan2(positions.getZ(index), positions.getX(index));
      const organic = 1 + Math.sin(angle * 3 + y * 2.4 + tubeIndex) * 0.035;
      positions.setX(index, positions.getX(index) * organic);
      positions.setY(index, y);
      positions.setZ(index, positions.getZ(index) * organic);
    }
    positions.needsUpdate = true;
    body.translate(x, 0, z);
    body.computeVertexNormals();
    pieces.push(body);
    const rim = new THREE.TorusGeometry(topRadius * 1.01, Math.max(0.045, topRadius * 0.13), 7, 16);
    rim.rotateX(Math.PI * 0.5);
    rim.translate(x, height, z);
    pieces.push(rim);
  }
  const geometry = mergeGeometries(pieces, false);
  pieces.forEach((piece) => piece.dispose());
  geometry.computeVertexNormals();
  return geometry;
}

function createRockGeometry(detail, scale) {
  const geometry = new THREE.DodecahedronGeometry(1, detail);
  geometry.scale(scale.x, scale.y, scale.z);
  geometry.translate(0, scale.y * 0.78, 0);
  return geometry;
}

function descriptor(id, geometry, material, sway = 0) {
  return { id, geometry, material, sway };
}

export function createAquaticHabitatGeometryKit() {
  const plantTimeUniform = { value: 0 };
  const grassMaterial = createPlantMaterial('#2f7354', plantTimeUniform);
  const kelpMaterial = createPlantMaterial('#677548', plantTimeUniform);
  const coralMaterial = createReefMaterial('#a56f62', 0.68);
  const plateMaterial = createReefMaterial('#9c776b', 0.72);
  const spongeMaterial = createReefMaterial('#a98255', 0.76);
  const rockMaterial = createReefMaterial('#5b645c', 0.92);

  const kit = {
    plants: [
      descriptor('ribbon-grass', createPlantCluster({
        width: 0.38, height: 3.8, segments: 7, bend: 0.42, taper: 0.58, bladeCount: 5, spread: 0.42,
      }), grassMaterial, 0.8),
      descriptor('blade-grass', createPlantCluster({
        width: 0.22, height: 2.7, segments: 6, bend: 0.24, taper: 0.78, bladeCount: 7, spread: 0.5,
      }), grassMaterial, 1),
      descriptor('kelp-frond', createPlantCluster({
        width: 0.72, height: 5.6, segments: 10, bend: 0.68, taper: 0.38, bladeCount: 4, spread: 0.62,
      }), kelpMaterial, 0.55),
    ],
    corals: [
      descriptor('branching-coral', createBranchingCoralGeometry(), coralMaterial),
      descriptor('massive-coral', createMassiveCoralGeometry(), coralMaterial),
      descriptor('plate-coral', createPlateCoralGeometry(), plateMaterial),
    ],
    sponges: [
      descriptor('barrel-sponge', createSpongeClusterGeometry(), spongeMaterial),
      descriptor('tube-sponge', createSpongeClusterGeometry({ tall: true }), spongeMaterial),
    ],
    plantTimeUniform,
    update(elapsed) {
      plantTimeUniform.value = Number.isFinite(Number(elapsed)) ? Number(elapsed) : 0;
    },
    rocks: [
      descriptor('shelf-rock', createRockGeometry(1, { x: 1.5, y: 0.42, z: 1.15 }), rockMaterial),
      descriptor('rubble-rock', createRockGeometry(0, { x: 0.72, y: 0.55, z: 0.82 }), rockMaterial),
    ],
    dispose() {
      const geometries = new Set();
      const materials = new Set();
      for (const family of [this.plants, this.corals, this.sponges, this.rocks]) {
        for (const item of family) {
          geometries.add(item.geometry);
          materials.add(item.material);
        }
      }
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
  return kit;
}
