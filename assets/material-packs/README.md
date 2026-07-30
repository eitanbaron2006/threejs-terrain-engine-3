# Terrain Material Pack ZIP

The application imports a ZIP directly. No KTX2 command line process is required.

Include `terrain-material-pack.json` and 16 PNG/JPG/WebP maps: Base Color, OpenGL Normal, ORM and Height for each of four layers.

```json
{
  "id": "my-ground-pack",
  "name": "My Ground Pack",
  "description": "Custom terrain materials",
  "splatPreset": "mediterranean",
  "resolution": 2048,
  "colors": ["#d8c28a", "#65864c", "#765139", "#777777"],
  "layers": [
    {"id":"sand","label":"Sand","baseColor":"sand/basecolor.png","normal":"sand/normal.png","orm":"sand/orm.png","height":"sand/height.png"},
    {"id":"grass","label":"Grass","baseColor":"grass/basecolor.png","normal":"grass/normal.png","orm":"grass/orm.png","height":"grass/height.png"},
    {"id":"soil","label":"Soil","baseColor":"soil/basecolor.png","normal":"soil/normal.png","orm":"soil/orm.png","height":"soil/height.png"},
    {"id":"rock","label":"Rock","baseColor":"rock/basecolor.png","normal":"rock/normal.png","orm":"rock/orm.png","height":"rock/height.png"}
  ]
}
```

ORM channels: R=AO, G=Roughness, B=Metallic. Images may be larger than the active quality tier; the application resizes and builds the WebGL2 texture arrays automatically.
