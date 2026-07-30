import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'index.html',
  'favicon.ico',
  'assets/favicon.svg',
  'server.js',
  'src/main.js',
  'src/app/TerrainEditorApp.js',
  'src/terrain/TerrainWorld.js',
  'src/terrain/TerrainMaterial.js',
  'src/terrain/TerrainLodGeometry.js',
  'src/workers/terrainWorker.js',
];

for (const path of required) {
  if (!existsSync(join(root, path))) throw new Error(`Missing required file: ${path}`);
}

const jsFiles = [];
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith('.js')) jsFiles.push(path);
  }
}
walk(join(root, 'src'));
walk(join(root, 'tests'));

const relativeImportPattern = /from\s+['"](\.{1,2}\/[^'"]+)['"]/g;
for (const file of jsFiles) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(relativeImportPattern)) {
    const target = resolve(dirname(file), match[1]);
    if (!existsSync(target)) throw new Error(`Broken import in ${file}: ${match[1]}`);
  }
}

console.log(`Project check passed: ${jsFiles.length} JavaScript files, all relative imports resolved.`);
