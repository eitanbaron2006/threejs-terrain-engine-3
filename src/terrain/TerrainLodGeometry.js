import * as THREE from 'three';

/** Shared skirted grid geometries. Every loaded chunk reuses one of these meshes. */
export class TerrainLodGeometryCache {
  constructor(chunkSize, lodLevels) {
    this.chunkSize = chunkSize;
    this.lodLevels = lodLevels;
    this.cache = new Map();
  }

  get(lodIndex) {
    const level = this.lodLevels[lodIndex] ?? this.lodLevels.at(-1);
    if (!this.cache.has(level.segments)) {
      this.cache.set(level.segments, this.#create(level.segments));
    }
    return this.cache.get(level.segments);
  }

  #create(segments) {
    const size = this.chunkSize;
    const verticesPerSide = segments + 1;
    const baseVertexCount = verticesPerSide * verticesPerSide;
    const positions = [];
    const uvs = [];
    const skirtFlags = [];
    const indices = [];

    for (let z = 0; z <= segments; z += 1) {
      for (let x = 0; x <= segments; x += 1) {
        positions.push((x / segments - 0.5) * size, 0, (z / segments - 0.5) * size);
        uvs.push(x / segments, z / segments);
        skirtFlags.push(0);
      }
    }

    for (let z = 0; z < segments; z += 1) {
      for (let x = 0; x < segments; x += 1) {
        const a = z * verticesPerSide + x;
        const b = a + 1;
        const c = a + verticesPerSide;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const edges = [];
    for (let x = 0; x <= segments; x += 1) edges.push(x);
    for (let z = 1; z <= segments; z += 1) edges.push(z * verticesPerSide + segments);
    for (let x = segments - 1; x >= 0; x -= 1) edges.push(segments * verticesPerSide + x);
    for (let z = segments - 1; z >= 1; z -= 1) edges.push(z * verticesPerSide);

    const skirtStart = baseVertexCount;
    for (const sourceIndex of edges) {
      positions.push(
        positions[sourceIndex * 3],
        positions[sourceIndex * 3 + 1],
        positions[sourceIndex * 3 + 2],
      );
      uvs.push(uvs[sourceIndex * 2], uvs[sourceIndex * 2 + 1]);
      skirtFlags.push(1);
    }

    for (let i = 0; i < edges.length; i += 1) {
      const next = (i + 1) % edges.length;
      const topA = edges[i];
      const topB = edges[next];
      const bottomA = skirtStart + i;
      const bottomB = skirtStart + next;
      indices.push(topA, bottomA, topB, topB, bottomA, bottomB);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aSkirt', new THREE.Float32BufferAttribute(skirtFlags, 1));
    geometry.setIndex(indices);
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-size / 2, -320, -size / 2),
      new THREE.Vector3(size / 2, 420, size / 2),
    );
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 50, 0), Math.hypot(size, 420));
    geometry.userData.segments = segments;
    geometry.userData.sharedTerrainGeometry = true;
    return geometry;
  }

  dispose() {
    for (const geometry of this.cache.values()) geometry.dispose();
    this.cache.clear();
  }
}
