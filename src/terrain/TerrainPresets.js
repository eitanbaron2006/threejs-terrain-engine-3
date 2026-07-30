const clamp01 = (value) => Math.min(1, Math.max(0, value));

function smoothRange(value, min, max, blend = 1) {
  const enter = clamp01((value - (min - blend)) / Math.max(blend, 0.0001));
  const exit = 1 - clamp01((value - max) / Math.max(blend, 0.0001));
  return enter * exit;
}

function normalize(weights) {
  const sum = weights.reduce((total, value) => total + Math.max(0, value), 0);
  if (sum <= 0.00001) return [0, 1, 0, 0];
  return weights.map((value) => Math.max(0, value) / sum);
}

export const TERRAIN_PRESETS = Object.freeze({
  mediterranean: {
    id: 'mediterranean',
    name: 'ים־תיכוני',
    description: 'חול בגובה נמוך, דשא ואדמה במישורים וסלע במדרונות.',
    colors: ['#d9c58f', '#638a45', '#70513a', '#77746e'],
    evaluate(height, slope, variation) {
      const sand = smoothRange(height, -20, 2.5, 4) * (1 - clamp01(slope / 42));
      const grass = smoothRange(height, -1, 34, 9) * (1 - clamp01((slope - 18) / 26));
      const dirt = smoothRange(height, -4, 46, 12) * (0.42 + variation * 0.38);
      const rock = clamp01((slope - 23) / 24) + clamp01((height - 32) / 20) * 0.35;
      return normalize([sand, grass, dirt, rock]);
    },
  },
  alpine: {
    id: 'alpine',
    name: 'אלפיני',
    description: 'עמקים ירוקים, סלעים במדרון ושלג בפסגות.',
    colors: ['#dde4e7', '#4f7b3f', '#654b39', '#686b70'],
    evaluate(height, slope, variation) {
      const snow = clamp01((height - 25) / 22) * (1 - clamp01((slope - 52) / 25));
      const grass = smoothRange(height, -12, 29, 10) * (1 - clamp01((slope - 21) / 22));
      const dirt = smoothRange(height, -8, 35, 14) * (0.36 + variation * 0.28);
      const rock = clamp01((slope - 20) / 22) + clamp01((height - 18) / 30) * 0.45;
      return normalize([snow, grass, dirt, rock]);
    },
  },
  desert: {
    id: 'desert',
    name: 'מדברי',
    description: 'דיונות חול, אדמה יבשה וסלעים חשופים.',
    colors: ['#d7ad67', '#a4844f', '#8b5f39', '#6c6257'],
    evaluate(height, slope, variation) {
      const sand = (1 - clamp01((slope - 13) / 24)) * (0.82 + variation * 0.12);
      const dryGround = smoothRange(height, -20, 42, 14) * (0.48 + variation * 0.4);
      const clay = clamp01((height + 5) / 36) * (1 - clamp01((slope - 25) / 22));
      const rock = clamp01((slope - 18) / 28) + clamp01((height - 34) / 24) * 0.25;
      return normalize([sand, dryGround, clay, rock]);
    },
  },
  volcanic: {
    id: 'volcanic',
    name: 'וולקני',
    description: 'אפר כהה, אדמה חרוכה וסלע געשי.',
    colors: ['#2f3031', '#4a3f35', '#57322b', '#242424'],
    evaluate(height, slope, variation) {
      const ash = (1 - clamp01((slope - 19) / 28)) * (0.55 + variation * 0.35);
      const scorched = smoothRange(height, -15, 36, 15) * 0.72;
      const lavaSoil = clamp01((height - 4) / 34) * (0.4 + variation * 0.38);
      const basalt = clamp01((slope - 17) / 25) + clamp01((height - 28) / 20) * 0.45;
      return normalize([ash, scorched, lavaSoil, basalt]);
    },
  },
});

export function getTerrainPreset(id) {
  return TERRAIN_PRESETS[id] ?? TERRAIN_PRESETS.mediterranean;
}
