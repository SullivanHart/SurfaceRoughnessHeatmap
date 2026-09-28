// Surface Roughness Analysis Background Web Worker
importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js')

let pyodideReady = false
let pyodide = null
let pyodideInitPromise = null

self.reportProgress = function (percent, text) {
  self.postMessage({ type: 'progress', percent: percent, text: text })
}

function initPyodide () {
  if (pyodideReady) return Promise.resolve(pyodide)
  if (pyodideInitPromise) return pyodideInitPromise

  pyodideInitPromise = (async () => {
    try {
      postMessage({ type: 'status', text: 'Initializing runtime...' })
      pyodide = await loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/'
      })

      postMessage({ type: 'status', text: 'Loading numerical packages...' })
      await pyodide.loadPackage(['numpy', 'scipy'])

      postMessage({
        type: 'status',
        text: 'Loading svr-roughness metrology engine...'
      })

      const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(self.location.hostname) ||
                      self.location.hostname.startsWith('192.168.') ||
                      self.location.hostname.startsWith('10.') ||
                      self.location.hostname.endsWith('.local')

      if (isLocal) {
        postMessage({
          type: 'status',
          text: 'Loading live svr-roughness from directory next to it...'
        })
        const localPkgUrl = new URL('api/local-package.zip?v=' + Date.now(), self.location.href).href
        const resp = await fetch(localPkgUrl, { cache: 'no-store' })
        if (!resp.ok) {
          throw new Error(`Failed to load local svr-roughness from directory next to it: HTTP ${resp.status} ${resp.statusText}`)
        }
        const buf = await resp.arrayBuffer()
        const vfsPath = '/home/pyodide/svr_roughness_local.zip'
        pyodide.FS.writeFile(vfsPath, new Uint8Array(buf))
        pyodide.globals.set('_local_pkg_path', vfsPath)
        pyodide.runPython(`
import sys
import zipfile
target_dir = next((p for p in sys.path if "site-packages" in p), None)
if not target_dir:
    target_dir = "/lib/python3.12/site-packages"
with zipfile.ZipFile(_local_pkg_path) as zf:
    zf.extractall(target_dir)
if target_dir not in sys.path:
    sys.path.insert(0, target_dir)
`)
        console.log('[Worker] Loaded live svr-roughness from directory next to it')
      } else {
        postMessage({
          type: 'status',
          text: 'Loading bundled svr-roughness wheel...'
        })
        const whlUrl = new URL('svr_roughness-latest-py3-none-any.whl', self.location.href).href
        const resp = await fetch(whlUrl, { cache: 'no-store' })
        if (!resp.ok) {
          throw new Error(`Failed to load bundled wheel (${whlUrl}): HTTP ${resp.status} ${resp.statusText}`)
        }
        const buf = await resp.arrayBuffer()
        const vfsPath = '/home/pyodide/engine.whl'
        pyodide.FS.writeFile(vfsPath, new Uint8Array(buf))
        pyodide.globals.set('_local_whl_path', vfsPath)
        pyodide.runPython(`
import sys
import zipfile
target_dir = next((p for p in sys.path if "site-packages" in p), None)
if not target_dir:
    target_dir = "/lib/python3.12/site-packages"
with zipfile.ZipFile(_local_whl_path) as zf:
    zf.extractall(target_dir)
if target_dir not in sys.path:
    sys.path.insert(0, target_dir)
`)
        console.log('[Worker] Loaded bundled wheel from site build: svr_roughness-latest-py3-none-any.whl')
      }

    // Setup Python analysis helper
    pyodide.runPython(`
import sys
import io
import time
import json
import gzip
import zipfile
import base64
from pathlib import Path
import numpy as np
import js

def report(pct, text):
    try:
        js.reportProgress(pct, text)
    except Exception:
        pass

from svr_roughness.algorithm import analyze_pure_python, compute_heatmap_grid, interpolate_heatmap_at_points
from svr_roughness.config import RoughnessConfig
from svr_roughness.io import load_points
from svr_roughness.result import format_report, RoughnessResult, PlaneFit

try:
    from svr_roughness.decomposition import DecompositionConfig, decompose_3d_object, is_planar_surface
    HAS_DECOMPOSITION = True
except ImportError:
    HAS_DECOMPOSITION = False

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
    report(8, "Reading scan data...")
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
    report(12, f"Parsing 3D coordinates ({eff_name})...")
    try:
        pts = load_points(scan_path)
    finally:
        if scan_path.exists():
            scan_path.unlink()

    t_load = time.perf_counter()
    conf = RoughnessConfig(
        grid_mm=grid_mm,
        short_cutoff_mm=short_cutoff_mm,
        long_cutoff_mm=long_cutoff_mm,
        gaussian_mesh=gaussian_mesh,
    )

    def get_closest_rating(val, standards):
        return min(standards, key=lambda item: abs(val - item[1]))[0]

    def make_comparators(val_um):
        return {
            "SCRATA (A802)": get_closest_rating(
                val_um,
                [("A1", 26.4), ("A2", 44.8), ("A3", 63.0), ("A4", 131.5)]
            ),
            "GAR C-9": get_closest_rating(
                val_um,
                [("C-9 200", 9.2), ("C-9 300", 16.3), ("C-9 420", 18.7), ("C-9 560", 27.4), ("C-9 720", 58.5), ("C-9 900", 71.1)]
            ),
            "ACI SIS": get_closest_rating(
                val_um,
                [("SIS-1", 9.4), ("SIS-2", 19.9), ("SIS-3", 24.5), ("SIS-4", 80.1)]
            ),
        }

    is_planar = is_planar_surface(pts) if HAS_DECOMPOSITION else True

    if is_planar:
        report(18, f"Calculating surface roughness ({len(pts):,} pts)...")
        res = analyze_pure_python(
            pts,
            voxel_size_mm=grid_mm,
            short_cutoff_mm=short_cutoff_mm,
            long_cutoff_mm=long_cutoff_mm,
            variogram_points=10,
            variogram_span_mm=0.5,
        )
        t_analyze = time.perf_counter()

        report(70, "Aligning surface plane...")
        stride_pts = max(1, int(np.ceil(len(pts) / 250000)))
        raw_f32 = np.ascontiguousarray(pts[::stride_pts], dtype=np.float32)
        # Keep full-resolution extents for reporting, using the engine's exact frame.
        diff = pts - res.plane_centroid_mm
        u = np.dot(diff, res.plane_x_axis)
        v = np.dot(diff, res.plane_y_axis)
        w = np.dot(diff, res.plane_normal)
        coords = np.column_stack((u, v, w))
        plane = PlaneFit(
            centroid=res.plane_centroid_mm,
            normal=res.plane_normal,
            x_axis=res.plane_x_axis,
            y_axis=res.plane_y_axis,
            coords=coords,
        )

        report(82, "Rasterizing height topography...")
        grid_svr_um = compute_heatmap_grid(res.grid_z_mm, grid_mm, radius_mm=5.0)

        report(92, "Formatting surface metrics and report...")
        full_res = RoughnessResult(
            svr_um=res.svr_um,
            sa_um=res.sa_um,
            sq_um=res.sq_um,
            noise_floor_um=res.noise_floor_um,
            svr_raw_um=res.svr_raw_um,
            points=len(pts),
            processed_points=res.processed_points,
            plane=plane,
            grid=res.grid_z_mm,
            grid_pitch_mm=float(grid_mm),
            grid_origin_mm=res.grid_origin_mm,
            variogram_bins_um=res.variogram_bins_um,
            variogram_counts=res.variogram_counts,
            config=conf,
        )

        report_str = format_report(full_res)
        grid_svr = np.where(np.isnan(grid_svr_um), None, np.round(grid_svr_um, 3)).tolist()

        valid_s = grid_svr_um[np.isfinite(grid_svr_um)]
        min_s = float(np.percentile(valid_s, 1)) if len(valid_s) > 0 else float(res.svr_um * 0.5)
        max_s = float(np.percentile(valid_s, 99)) if len(valid_s) > 0 else float(res.svr_um * 1.5)

        sample_b64 = base64.b64encode(raw_f32.tobytes()).decode("ascii")
        stride_light = max(1, len(pts) // 4000)
        sample_pts = np.round(pts[::stride_light], 2).tolist()

        pt_svr_b64 = None
        if grid_svr_um is not None and len(raw_f32) > 0:
            orig_x = float(res.grid_origin_mm[0]) if res.grid_origin_mm is not None else 0.0
            orig_y = float(res.grid_origin_mm[1]) if res.grid_origin_mm is not None else 0.0
            pt_svr = interpolate_heatmap_at_points(grid_svr_um, orig_x, orig_y, grid_mm, u[::stride_pts], v[::stride_pts])
            pt_svr = np.nan_to_num(pt_svr, nan=float(res.svr_um))
            pt_svr_b64 = base64.b64encode(np.ascontiguousarray(pt_svr, dtype=np.float32).tobytes()).decode("ascii")

        elev_g = res.elevation_grid_mm if hasattr(res, "elevation_grid_mm") and res.elevation_grid_mm is not None else res.grid_z_mm
        gz = elev_g * 1000.0 if elev_g is not None else None
        grid_z = np.where(np.isnan(gz), None, np.round(gz, 2)).tolist() if gz is not None else []

        out = {
            "effective_name": eff_name,
            "is_3d": False,
            "sa_um": res.sa_um,
            "sq_um": res.sq_um,
            "svr_um": res.svr_um,
            "min_svr_um": min_s,
            "max_svr_um": max_s,
            "plane_centroid": res.plane_centroid_mm.tolist(),
            "plane_normal": res.plane_normal.tolist(),
            "total_points": len(pts),
            "processed_points": res.processed_points,
            "patch_width_mm": res.grid_width * grid_mm,
            "patch_height_mm": res.grid_height * grid_mm,
            "average_point_spacing_mm": grid_mm,
            "grid_coverage_pct": float(np.count_nonzero(~np.isnan(res.grid_z_mm)) / res.grid_z_mm.size * 100.0),
            "grid_svr": grid_svr,
            "grid_z": grid_z,
            "grid_z_pitch_mm": float(grid_mm),
            "sample_points_b64": sample_b64,
            "sample_points_count": len(raw_f32),
            "sample_points_3d": sample_pts,
            "sample_svr_b64": pt_svr_b64,
            "grid_width": int(res.grid_width),
            "grid_height": int(res.grid_height),
            "origin_x": float(res.grid_origin_mm[0]),
            "origin_y": float(res.grid_origin_mm[1]),
            "pitch_mm": float(grid_mm),
            "var_bins": [round(float(x), 4) for x in res.variogram_bins_um],
            "variogram_bins": [round(float(x), 4) for x in res.variogram_bins_um],
            "variogram_counts": [int(x) for x in res.variogram_counts],
            "comparators": make_comparators(res.svr_um),
            "report_text": report_str,
            "timings": {
                "decomp_ms": (t_decomp - t0) * 1000.0,
                "load_ms": (t_load - t_decomp) * 1000.0,
                "analyze_ms": (t_analyze - t_load) * 1000.0,
                "total_ms": (t_analyze - t0) * 1000.0,
            }
        }
    else:
        report(15, f"3D scan detected ({len(pts):,} pts): Segmenting faces...")
        decomp_cfg = DecompositionConfig()
        def on_decomp_progress(stage_name, fraction):
            pct = int(15 + fraction * 65)
            report(pct, f"3D scan: {stage_name}...")

        obj_res = decompose_3d_object(pts, config=conf, decomp_config=decomp_cfg, progress=on_decomp_progress)
        t_analyze = time.perf_counter()

        num_patches = len(obj_res.patches)
        patches_data = []
        for i, p in enumerate(obj_res.patches):
            pct = int(80 + 16 * (i / max(1, num_patches)))
            report(pct, f"Rasterizing topography for {p.name} ({i+1}/{num_patches})...")
            r = p.roughness
            hmap = compute_heatmap_grid(r.grid, grid_mm, radius_mm=5.0) if r.grid is not None else None
            grid_svr_patch = np.where(np.isnan(hmap), None, np.round(hmap, 3)).tolist() if hmap is not None else []
            coverage_pct = float(np.count_nonzero(~np.isnan(r.grid)) / r.grid.size * 100.0) if (r.grid is not None and r.grid.size > 0) else 0.0
            comparators = r.comparator_equivalents() if hasattr(r, "comparator_equivalents") else make_comparators(r.svr_um)

            # Sampled points and per-point local Svr values
            stride_pts = max(1, len(p.points) // 300000)
            sampled_pts = p.points[::stride_pts]
            raw_f32 = np.ascontiguousarray(sampled_pts, dtype=np.float32)
            sample_b64 = base64.b64encode(raw_f32.tobytes()).decode("ascii")
            stride_light = max(1, len(p.points) // 3000)
            sample_pts = np.round(p.points[::stride_light], 2).tolist()

            # Compute local SVR for each sampled 3D point via continuous bilinear interpolation
            pt_svr_b64 = None
            if hmap is not None and r.plane is not None and len(sampled_pts) > 0:
                diff = sampled_pts - r.plane.centroid
                u = np.dot(diff, r.plane.x_axis)
                v = np.dot(diff, r.plane.y_axis)
                orig_x = float(r.grid_origin_mm[0]) if r.grid_origin_mm is not None else 0.0
                orig_y = float(r.grid_origin_mm[1]) if r.grid_origin_mm is not None else 0.0
                pt_svr = interpolate_heatmap_at_points(hmap, orig_x, orig_y, grid_mm, u, v)
                pt_svr = np.nan_to_num(pt_svr, nan=float(r.svr_um if hasattr(r, "svr_um") else 0.0))
                pt_svr_b64 = base64.b64encode(np.ascontiguousarray(pt_svr).tobytes()).decode("ascii")

            elev_g = r.elevation_grid if hasattr(r, "elevation_grid") and r.elevation_grid is not None else r.grid
            gz = elev_g * 1000.0 if elev_g is not None else None
            grid_z = np.where(np.isnan(gz), None, np.round(gz, 2)).tolist() if gz is not None else []

            # Invalid/edge points belonging to this face
            inv_pts = p.invalid_points if hasattr(p, "invalid_points") and p.invalid_points is not None else np.zeros((0, 3))
            inv_local_pts = []
            if len(inv_pts) > 0:
                stride_inv = max(1, len(inv_pts) // 300000)
                raw_inv_f32 = np.ascontiguousarray(inv_pts[::stride_inv], dtype=np.float32)
                inv_b64 = base64.b64encode(raw_inv_f32.tobytes()).decode("ascii")
                inv_sample_pts = np.round(inv_pts, 2).tolist()
                if r.plane is not None:
                    diff_inv = inv_pts - r.plane.centroid
                    u_inv = np.dot(diff_inv, r.plane.x_axis)
                    v_inv = np.dot(diff_inv, r.plane.y_axis)
                    z_inv = np.dot(diff_inv, r.plane.normal)
                    inv_local_pts = np.round(np.column_stack((u_inv, v_inv, z_inv)), 3).tolist()
            else:
                inv_b64 = None
                inv_sample_pts = []

            patches_data.append({
                "patch_id": p.patch_id,
                "name": p.name,
                "normal": [round(float(x), 4) for x in p.normal],
                "centroid": [round(float(x), 2) for x in p.centroid],
                "area_mm2": round(float(p.area_mm2), 1),
                "dims_mm": [round(float(x), 1) for x in p.dims_mm],
                "point_count": int(p.point_count),
                "invalid_points_count": int(len(inv_pts)),
                "is_astm_compliant": bool(p.is_astm_compliant),
                "sa_um": r.sa_um,
                "sq_um": r.sq_um,
                "svr_um": r.svr_um,
                "processed_points": r.processed_points,
                "grid_coverage_pct": round(coverage_pct, 1),
                "grid_svr": grid_svr_patch,
                "grid_z": grid_z,
                "grid_z_pitch_mm": float(grid_mm),
                "sample_points_b64": sample_b64,
                "sample_points_count": len(raw_f32),
                "sample_points_3d": sample_pts,
                "sample_svr_b64": pt_svr_b64,
                "invalid_points_b64": inv_b64,
                "invalid_points_3d": inv_sample_pts,
                "invalid_points_local": inv_local_pts,
                "grid_width": int(r.grid.shape[1]) if r.grid is not None else 0,
                "grid_height": int(r.grid.shape[0]) if r.grid is not None else 0,
                "origin_x": float(r.grid_origin_mm[0]) if r.grid_origin_mm is not None else 0.0,
                "origin_y": float(r.grid_origin_mm[1]) if r.grid_origin_mm is not None else 0.0,
                "pitch_mm": float(grid_mm),
                "var_bins": [round(float(x), 4) for x in r.variogram_bins_um] if r.variogram_bins_um is not None else [],
                "variogram_bins": [round(float(x), 4) for x in r.variogram_bins_um] if r.variogram_bins_um is not None else [],
                "variogram_counts": [int(x) for x in r.variogram_counts] if r.variogram_counts is not None else [],
                "comparators": comparators,
            })

        dominant_data = patches_data[0]
        report_str = obj_res.format_report()

        unassigned_pts = obj_res.unassigned_points_arr if (hasattr(obj_res, "unassigned_points_arr") and obj_res.unassigned_points_arr is not None) else None
        if unassigned_pts is not None and len(unassigned_pts) > 0:
            stride_u = max(1, len(unassigned_pts) // 300000)
            raw_u_f32 = np.ascontiguousarray(unassigned_pts[::stride_u], dtype=np.float32)
            unassigned_b64 = base64.b64encode(raw_u_f32.tobytes()).decode("ascii")
            stride_light_u = max(1, len(unassigned_pts) // 3000)
            unassigned_sample_pts = np.round(unassigned_pts[::stride_light_u], 2).tolist()
        else:
            unassigned_b64 = None
            unassigned_sample_pts = []

        out = {
            "effective_name": eff_name,
            "is_3d": True,
            "patch_count": obj_res.patch_count,
            "mean_svr_um": obj_res.mean_svr_um,
            "worst_svr_um": obj_res.worst_svr_um,
            "best_svr_um": obj_res.best_svr_um,
            "coverage_pct": obj_res.coverage_pct,
            "total_points": obj_res.total_points,
            "assigned_points": obj_res.assigned_points,
            "unassigned_points": obj_res.unassigned_points,
            "unassigned_points_b64": unassigned_b64,
            "unassigned_points_3d": unassigned_sample_pts,
            "patches": patches_data,
            "sa_um": dominant_data["sa_um"],
            "sq_um": dominant_data["sq_um"],
            "svr_um": dominant_data["svr_um"],
            "processed_points": dominant_data["processed_points"],
            "patch_width_mm": dominant_data["dims_mm"][0],
            "patch_height_mm": dominant_data["dims_mm"][1],
            "average_point_spacing_mm": grid_mm,
            "grid_coverage_pct": dominant_data["grid_coverage_pct"],
            "grid_svr": dominant_data["grid_svr"],
            "grid_z": dominant_data["grid_z"],
            "grid_z_pitch_mm": dominant_data["grid_z_pitch_mm"],
            "sample_points_3d": dominant_data["sample_points_3d"],
            "grid_width": dominant_data["grid_width"],
            "grid_height": dominant_data["grid_height"],
            "origin_x": dominant_data["origin_x"],
            "origin_y": dominant_data["origin_y"],
            "pitch_mm": float(grid_mm),
            "var_bins": dominant_data["var_bins"],
            "variogram_bins": dominant_data["variogram_bins"],
            "variogram_counts": dominant_data["variogram_counts"],
            "comparators": dominant_data["comparators"],
            "report_text": report_str,
            "timings": {
                "decomp_ms": (t_decomp - t0) * 1000.0,
                "load_ms": (t_load - t_decomp) * 1000.0,
                "analyze_ms": (t_analyze - t_load) * 1000.0,
                "total_ms": (t_analyze - t0) * 1000.0,
            }
        }
    report(97, "Finalizing report...")
    return json.dumps(out)
`)

    pyodideReady = true
    postMessage({ type: 'ready', mode: isLocal ? 'local' : 'bundled' })
    return pyodide
  } catch (err) {
    pyodideInitPromise = null
    postMessage({ type: 'error', error: err.message || err.toString() })
    throw err
  }
  })()

  return pyodideInitPromise
}

let currentWorkerJobId = 0

self.onmessage = async function (e) {
  const { type, payload } = e.data
  if (type === 'init') {
    if (!pyodideReady) await initPyodide()
    else postMessage({ type: 'ready' })
  } else if (type === 'analyze') {
    const thisJobId = ++currentWorkerJobId
    try {
      if (!pyodideReady) {
        await initPyodide()
      }
      if (thisJobId !== currentWorkerJobId) {
        return
      }

      const {
        fileData,
        fileName,
        grid_mm,
        short_cutoff_mm,
        long_cutoff_mm,
        gaussian_mesh,
        analysisId
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
      if (thisJobId !== currentWorkerJobId) {
        return
      }
      const result = JSON.parse(jsonStr)
      postMessage({ type: 'result', data: result, analysisId: analysisId })
    } catch (err) {
      if (thisJobId === currentWorkerJobId) {
        postMessage({ type: 'error', error: err.message || err.toString() })
      }
    }
  }
}

initPyodide()
