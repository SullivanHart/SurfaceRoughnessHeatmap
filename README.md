# SurfInspect Web

Interactive surface roughness inspector and heatmap visualizer based on ASTM WK92969, powered entirely in the browser using WebAssembly (Pyodide) and the [`svr-roughness`](https://pypi.org/project/svr-roughness/) package.

## Features

- **100% Client-Side**: No server required. Point cloud processing runs in a dedicated Web Worker via Pyodide, pulling the latest `svr-roughness` wheel directly from PyPI.
- **ASTM WK92969 Standard Metrics**: Computes areal surface roughness parameters ($S_a$, $S_q$, and $S_{vr}$ via semi-variogram analysis).
- **Comparator Cross-Checks**: Automatic rating against casting & concrete standards including SCRATA (ASTM A802), GAR C-9, and ACI SIS.
- **Multi-Format Support**: Reads `.ply`, `.stl`, `.obj`, `.pcd`, `.xyz`, `.csv`, `.tsv`, `.txt`, `.npy`, `.npz`, as well as `.gz` and `.zip` archives.
- **Interactive Visualizations**: 3D surface depth rendering with Plotly.js, spatial roughness heatmaps, and experimental variogram curves.

## Running Locally

Serve the directory with any local static HTTP server:

```bash
# Python
python -m http.server 8000

# or Node
npx serve .
```

Then open `http://localhost:8000` in any modern browser (Chrome, Edge, Firefox, Safari).

## Deployment

Configured for zero-config deployment to Cloudflare Pages via `wrangler.toml`.

