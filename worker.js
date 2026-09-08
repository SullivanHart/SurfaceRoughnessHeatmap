// Surface Roughness Analysis Background Web Worker
importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js')

let pyodideReady = false
let pyodide = null

self.reportProgress = function (percent, text) {
  self.postMessage({ type: 'progress', percent: percent, text: text })
}

async function initPyodide () {
  try {
    postMessage({ type: 'status', text: 'Initializing runtime...' })
    pyodide = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/'
    })

    postMessage({ type: 'status', text: 'Loading numerical packages...' })
    await pyodide.loadPackage(['numpy', 'scipy', 'micropip'])

    postMessage({
      type: 'status',
      text: 'Installing latest svr-roughness from PyPI...'
    })
    const micropip = pyodide.pyimport('micropip')
    await micropip.install('svr-roughness')

    // Setup Python analysis helper
    pyodide.runPython(`
import sys
import io
import time
import json
import gzip
import zipfile
from pathlib import Path
import numpy as np
import js

def report(pct, text):
    try:
        js.reportProgress(pct, text)
    except Exception:
        pass

from svr_roughness.algorithm import analyze_pure_python
from svr_roughness.config import RoughnessConfig
from svr_roughness.io import load_points
from svr_roughness.result import format_report, RoughnessResult, RoughnessGrid, PlaneFit

def decompress_if_needed(raw_bytes, file_name):
    lower = file_name.lower()
    if raw_bytes.startswith(b"\\x1f\\x8b"):
        return gzip.decompress(raw_bytes), file_name[:-3] if lower.endswith(".gz") else file_name
    if raw_bytes.startswith(b"PK\\x03\\x04"):
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
            exts = {".ply", ".pcd", ".stl", ".obj", ".csv", ".tsv", ".xyz", ".txt", ".npy", ".npz"}
            candidates = [n for n in zf.namelist() if Path(n).suffix.lower() in exts and not Path(n).name.startswith(".")]
            if not candidates:
                raise ValueError("Zip archive contains no supported 3D scan files")
            return zf.read(candidates[0]), Path(candidates[0]).name
    return raw_bytes, file_name

def run_analysis_payload(file_path_str, file_name, grid_mm, short_cutoff_mm, long_cutoff_mm, gaussian_mesh):
    t0 = time.perf_counter()
    report(12, "Reading scan data...")
    path = Path(file_path_str)

    with path.open("rb") as f:
        head = f.read(4)

    if head.startswith(b"\\x1f\\x8b") or head.startswith(b"PK\\x03\\x04"):
        raw_bytes = path.read_bytes()
        file_bytes, eff_name = decompress_if_needed(raw_bytes, file_name)
        suffix = Path(eff_name).suffix.lower()
        scan_path = Path("/home/pyodide/temp_scan" + suffix)
        scan_path.write_bytes(file_bytes)
        if path.exists():
            path.unlink()
    else:
        scan_path = path
        eff_name = file_name

    t_decomp = time.perf_counter()
    report(24, "Parsing 3D coordinates...")
    try:
        pts = load_points(scan_path)
    finally:
        if scan_path.exists():
            scan_path.unlink()

    t_load = time.perf_counter()
    report(36, f"Analyzing {len(pts):,} points (ASTM WK92969)...")
    res = analyze_pure_python(
        pts,
        voxel_size_mm=grid_mm,
        short_cutoff_mm=short_cutoff_mm,
        long_cutoff_mm=long_cutoff_mm,
        variogram_points=10,
        variogram_span_mm=0.5,
    )
    t_analyze = time.perf_counter()

    report(92, "Aligning surface plane...")
    conf = RoughnessConfig(
        grid_mm=grid_mm,
        short_cutoff_mm=short_cutoff_mm,
        long_cutoff_mm=long_cutoff_mm,
        gaussian_mesh=gaussian_mesh,
    )
    
    centroid = pts.mean(axis=0)
    centered = pts - centroid
    cov = (centered.T @ centered) / max(len(pts) - 1, 1)
    _, eigvecs = np.linalg.eigh(cov)
    normal = eigvecs[:, 0]
    if normal[2] < 0: normal = -normal
    normal /= np.linalg.norm(normal)
    gx = np.array([1.0, 0.0, 0.0])
    x_ax = gx - normal * np.dot(gx, normal)
    if np.linalg.norm(x_ax) < 1e-6:
        x_ax = np.array([0.0, 1.0, 0.0]) - normal * normal[1]
    x_ax /= np.linalg.norm(x_ax)
    y_ax = np.cross(normal, x_ax)
    coords = np.column_stack((centered @ x_ax, centered @ y_ax, centered @ normal))
    plane = PlaneFit(centroid=centroid, normal=normal, x_axis=x_ax, y_axis=y_ax, coords=coords)

    r_grid = RoughnessGrid(
        raw=res.grid_z_mm,
        filled=res.grid_z_mm,
        filtered=res.grid_z_mm,
        valid_raw=~np.isnan(res.grid_z_mm),
        valid_filled=~np.isnan(res.grid_z_mm),
        origin=res.grid_origin_mm,
        svr_map=res.grid_svr_um,
    )

    report(95, "Formatting report...")
    full_res = RoughnessResult(
        sa_um=res.sa_um,
        sq_um=res.sq_um,
        svr_um=res.svr_um,
        points=len(pts),
        cropped_points=res.processed_points,
        plane=plane,
        raw_residual_std_mm=float(coords[:, 2].std()),
        raw_residual_p05_mm=float(np.percentile(coords[::max(1, len(coords)//50000), 2], 5)),
        raw_residual_p95_mm=float(np.percentile(coords[::max(1, len(coords)//50000), 2], 95)),
        grid=r_grid,
        surface_distances_mm=res.surface_distances_mm,
        variogram_bins_um=res.variogram_bins_um,
        variogram_counts=res.variogram_counts,
        config=conf,
    )

    report_str = format_report(full_res)

    def get_rating(val, thresholds, labels):
        for t, label in zip(thresholds, labels):
            if val <= t:
                return label
        return labels[-1]

    comparators = {
        "SCRATA (ASTM A802)": get_rating(
            res.svr_um,
            [26.0, 48.0, 71.0, 99.0, 137.0, 198.0, 274.0, 381.0, 533.0],
            ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "> A9"]
        ),
        "GAR C-9": get_rating(
            res.svr_um,
            [16.0, 30.0, 56.0, 107.0],
            ["C-9 300", "C-9 600", "C-9 1200", "C-9 2400", "> C-9 2400"]
        ),
        "ACI SIS": get_rating(
            res.svr_um,
            [9.0, 18.0, 36.0, 71.0],
            ["SIS-1", "SIS-2", "SIS-3", "SIS-4", "> SIS-4"]
        ),
    }

    step_sub = max(1, max(res.grid_width, res.grid_height) // 120)
    sub_z = res.grid_z_mm[::step_sub, ::step_sub]
    sub_z = np.where(np.isnan(sub_z), None, np.round(sub_z, 4)).tolist()

    out = {
        "effective_name": eff_name,
        "sa_um": res.sa_um,
        "sq_um": res.sq_um,
        "svr_um": res.svr_um,
        "total_points": len(pts),
        "processed_points": res.processed_points,
        "patch_width_mm": res.grid_width * grid_mm,
        "patch_height_mm": res.grid_height * grid_mm,
        "average_point_spacing_mm": grid_mm,
        "grid_coverage_pct": float(np.count_nonzero(~np.isnan(res.grid_z_mm)) / res.grid_z_mm.size * 100.0),
        "variogram_bins": [round(float(x), 4) for x in res.variogram_bins_um],
        "variogram_counts": [int(x) for x in res.variogram_counts],
        "subsampled_z": sub_z,
        "subsample_step": step_sub,
        "comparators": comparators,
        "report_text": report_str,
        "timings": {
            "decomp_ms": (t_decomp - t0) * 1000.0,
            "load_ms": (t_load - t_decomp) * 1000.0,
            "analyze_ms": (t_analyze - t_load) * 1000.0,
            "total_ms": (t_analyze - t0) * 1000.0,
        }
    }
    return json.dumps(out)
`)

    pyodideReady = true
    postMessage({ type: 'ready' })
  } catch (err) {
    postMessage({ type: 'error', error: err.message || err.toString() })
  }
}

self.onmessage = async function (e) {
  const { type, payload } = e.data
  if (type === 'init') {
    if (!pyodideReady) await initPyodide()
    else postMessage({ type: 'ready' })
  } else if (type === 'analyze') {
    if (!pyodideReady) {
      await initPyodide()
    }
    try {
      const {
        fileData,
        fileName,
        grid_mm,
        short_cutoff_mm,
        long_cutoff_mm,
        gaussian_mesh
      } = payload

      const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : ''
      const uint8 = new Uint8Array(fileData)
      const filePath = '/home/pyodide/input_scan' + ext
      pyodide.FS.writeFile(filePath, uint8)

      pyodide.globals.set('_file_path', filePath)
      pyodide.globals.set('_file_name', fileName)
      pyodide.globals.set('_grid_mm', grid_mm)
      pyodide.globals.set('_short_cutoff_mm', short_cutoff_mm)
      pyodide.globals.set('_long_cutoff_mm', long_cutoff_mm)
      pyodide.globals.set('_gaussian_mesh', gaussian_mesh)

      const jsonStr = pyodide.runPython(`
run_analysis_payload(_file_path, _file_name, _grid_mm, _short_cutoff_mm, _long_cutoff_mm, _gaussian_mesh)
`)
      const result = JSON.parse(jsonStr)
      postMessage({ type: 'result', data: result })
    } catch (err) {
      postMessage({ type: 'error', error: err.message || err.toString() })
    }
  }
}

initPyodide()
