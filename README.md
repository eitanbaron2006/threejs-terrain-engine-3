# Terrain Engine 3.10.2 — Clean Editor & Material Pack Studio

עורך ומחולל Terrain גדול ל־Three.js/WebGL2, עם Full World Editor Mode, מצב FPS עם Streaming דינמי, חומרי PBR אמיתיים, HDRI/IBL, מים על GPU ו־Terrain Material System בעל ארבע שכבות.

## הפעלה

1. חלץ את החבילה לתיקייה חדשה.
2. ודא שמותקן Node.js 20 ומעלה.
3. הפעל `START_WINDOWS.bat`.
4. בהפעלה הראשונה מתבצע `npm install` אוטומטי.
5. הדפדפן נפתח ב־`http://127.0.0.1:5173/?v=3.10.2`.

## Clean Editor Presentation

מצב העריכה מציג את העולם כפי שמעצב עולם צריך לראות אותו, בלי לחשוף פרטי Core:

- ערפל Terrain פנימי כבוי כברירת מחדל.
- Atmospheric Fog מופעל רק כאשר המשתמש מסמן אותו במפורש ב־Sky Studio.
- Terrain עמוק מתחת לים מוסתר רק במצב Editor כדי שלא ייראו גבולות Chunks ו־Skirts דרך האוקיינוס.
- מים עמוקים נעשים אטומים באופן טבעי במבט Editor, בעוד מים רדודים ממשיכים להציג Refraction וקו חוף.
- מצב FPS מחזיר את המבנה המלא עבור משחק, שחייה ו־Streaming.
- כל עולם ה־8×8 ק״מ נשאר טעון ב־Editor באמצעות LOD מדורג.

## HDRI ו־Sky Studio

- Presets של שמיים.
- טעינת HDR מקומי.
- טעינת HDR באמצעות URL.
- רשימת HDRI של ambientCG דרך ה־API המקומי.
- PMREM ו־IBL לחומרי PBR.
- שליטה בשמש, Exposure, Environment Intensity, רקע, צללים וציפורים.
- טעינת HDRI מותאם אינה מדווחת עוד כהצלחה אם הקובץ נכשל; שגיאה מוצגת והמפה הקודמת נשמרת.

## בחירת חבילת Terrain

בחירת `Terrain Material Pack` ברשימה אינה משנה את העולם.

1. בחר חבילה כדי לראות את התיאור וה־Preview.
2. לחץ **הורד והחל חבילת PBR** כדי להוריד ולהחיל אותה.
3. חבילות שכבר הורדו משתמשות במטמון המקומי.

## Terrain Material Pack Studio

לחץ **צור / ערוך חבילה** כדי לפתוח את ה־Studio.

אפשר ליצור חבילה חדשה או לערוך חבילה מובנית/מותאמת, ולבחור לכל אחת מארבע השכבות:

- ספק: ambientCG או Poly Haven.
- Asset ID וחיפוש בקטלוג המקושר.
- שם שכבה וקנה מידה פיזי במטרים.
- Displacement, Roughness ו־Metalness.
- גובה מינימלי ומקסימלי.
- רוחב Blend בגובה.
- שיפוע מינימלי ומקסימלי.
- רוחב Blend בשיפוע.
- זיקה לרכס או שקע לפי Curvature.
- זיקה ללחות.
- זיקה לקו החוף.
- זיקה לשחיקה.
- עדיפות שכבה.
- עוצמת Blend כללית ורעש מעבר לכל החבילה.

כפתור **שמור חבילה** שומר אותה ב־IndexedDB אך אינו משנה את העולם.  
כפתור **שמור והחל** שומר, מוריד את מפות ה־PBR ומחשב מחדש את Splat Maps.

חבילות מותאמות נשמרות גם בתוך קובץ פרויקט JSON, כדי שניתן יהיה להעביר את הפרויקט למחשב אחר.

## Terrain Material System

- ארבע שכבות PBR בו־זמנית.
- Height-aware blending.
- חלוקה גיאולוגית לפי גובה, שיפוע, קימור, לחות, חשיפה, שחיקה וחוף.
- Planar/Triplanar Hybrid.
- Stochastic anti-tiling רציף.
- Macro, Mid ו־Micro detail.
- Control Map smoothing ו־Mipmaps.
- עריכת חומר ידנית באמצעות Brush נשמרת מעל המסכות האוטומטיות.

## ספקי נכסים

האפליקציה משתמשת בנכסי CC0 של:

- Poly Haven
- ambientCG

השרת המקומי מוריד ושומר את הקבצים תחת `.cache/`. תיקיית המטמון אינה נכללת ב־ZIP או בייצוא הפרויקט.

## בדיקות

```bash
npm test
npm run check
npm run benchmark
```

בגרסה זו קיימות 48 בדיקות אוטומטיות עבור Terrain, LOD, חומרים, Streaming, מים, HDRI, Clean Editor View ו־Material Pack Studio.

## קבצים מרכזיים

```text
src/app/TerrainEditorApp.js
src/ui/EditorUI.js
src/ui/TerrainMaterialPackStudio.js
src/terrain/TerrainMaterial.js
src/terrain/TerrainMaterialPackManager.js
src/terrain/TerrainWorld.js
src/terrain/noise.js
src/environment/WorldEnvironment.js
src/water/AdvancedWaterSystem.js
server.js
```

## מגבלות

- ההורדה הראשונה של חומר או HDRI דורשת חיבור לאינטרנט.
- רמת ULTRA 4K צורכת זיכרון רב משום שהיא יוצרת ארבע Texture Arrays עם ארבע שכבות.
- לא כל Asset של ספק חיצוני מכיל את כל מפות ה־PBR; במפות אופציונליות חסרות נעשה שימוש ב־fallback ניטרלי.

## 3.10.2 editor stability

Editor mode uses a stable world-space terrain layout. Moving or zooming the editor camera no longer changes chunk LOD, height source resolution or material control resolution. FPS mode continues to use dynamic streaming and LOD around the player.

Water presentation is identical in Editor and FPS. Technical sea-floor details are hidden naturally by depth absorption rather than editor-only terrain removal or a flat-color water mask.

## ambientCG HDRI

בחירת HDRI מ־ambientCG משתמשת ב־API v3 הרשמי. השרת המקומי מוריד את חבילת הרזולוציה שנבחרה, מאמת שמדובר ב־ZIP או Radiance HDR, מחלץ את קובץ ה־`.hdr`, שומר אותו ב־Cache ומעביר אותו ל־RGBELoader. אם 2K אינו זמין, המערכת מנסה אוטומטית 1K. שגיאות מהשרת מוצגות בממשק עם הסיבה המלאה.

## True Geometric Displacement 3.11.0

The terrain vertex shader can now move real mesh vertices from the selected material height layers. In the **Real PBR Terrain Materials** panel:

1. Enable **True Geometric Displacement**.
2. Choose normal-direction or vertical displacement.
3. Enable geometry only for the required layers.
4. Set each layer's amplitude in metres and Height Center.
5. In Editor mode, press **Update Preview around view target** to upgrade a fixed nearby region to LOD0. The region does not follow the camera automatically, preventing tile rebuilding artifacts.
6. In FPS mode, LOD0 displacement follows the player automatically.

Three.js displacement changes vertex positions, so visible geometric detail is limited by the mesh vertex density. Parallax and normal maps continue to provide sub-vertex detail between vertices. The current terrain collision heightfield remains based on the main terrain height map; material micro-displacement is a render-geometry feature.
