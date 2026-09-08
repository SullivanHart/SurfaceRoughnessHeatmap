import concurrent.futures
import gzip
import io
import math
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import streamlit as st

from svr_roughness import (
    RoughnessConfig,
    RoughnessResult,
    analyze_file,
    format_report,
    svr_map,
)

# ── Upload Transfer Timing Tracker ──
_UPLOAD_TIMES: dict[str, float] = {}


def _install_upload_timing_hooks() -> None:
    """Safely hook Starlette ASGI upload routes to measure actual network transfer time."""
    if sys.platform == "emscripten":
        return
    try:
        import gc
        import starlette.routing

        for obj in gc.get_objects():
            if isinstance(obj, starlette.routing.Route):
                path = getattr(obj, "path", "")
                methods = getattr(obj, "methods", None)
                if "upload_file" in path and methods and "PUT" in methods:
                    if not getattr(obj, "_upload_timing_hooked", False):
                        orig_app = obj.app

                        def make_wrapper(inner):
                            async def timed_app(scope, receive, send):
                                if scope.get("type") == "http" and scope.get("method") == "PUT":
                                    t0 = time.perf_counter()
                                    try:
                                        await inner(scope, receive, send)
                                    finally:
                                        dt = time.perf_counter() - t0
                                        file_id = scope.get("path_params", {}).get("file_id")
                                        if file_id:
                                            _UPLOAD_TIMES[str(file_id)] = dt
                                else:
                                    await inner(scope, receive, send)

                            return timed_app

                        obj.app = make_wrapper(orig_app)
                        setattr(obj, "_upload_timing_hooked", True)
    except Exception:
        pass

    try:
        from streamlit.runtime.memory_uploaded_file_manager import MemoryUploadedFileManager

        if not getattr(MemoryUploadedFileManager, "_timing_hooked", False):
            orig_add_file = MemoryUploadedFileManager.add_file

            def timed_add_file(self, session_id, file):
                if file.file_id not in _UPLOAD_TIMES:
                    _UPLOAD_TIMES[f"ts_{file.file_id}"] = time.perf_counter()
                return orig_add_file(self, session_id, file)

            MemoryUploadedFileManager.add_file = timed_add_file
            setattr(MemoryUploadedFileManager, "_timing_hooked", True)
    except Exception:
        pass


_install_upload_timing_hooks()

SUPPORTED_TYPES = ["ply", "pcd", "stl", "obj", "csv", "tsv", "xyz", "txt", "npy", "npz", "gz", "zip"]
SCAN_EXTENSIONS = {".ply", ".pcd", ".stl", ".obj", ".csv", ".tsv", ".xyz", ".txt", ".npy", ".npz"}
COLOR_SCALES = ["Jet", "Turbo", "Viridis", "Plasma", "Inferno", "Rainbow"]
UNITS = ["µm", "mm", "in"]

CUSTOM_CSS = """
    <style>
    /* Clean, modern typography and layout */
    .main-header {
        font-size: 1.65rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin-bottom: 0.15rem;
    }
    .sub-header {
        font-size: 0.88rem;
        opacity: 0.75;
        margin-bottom: 1.25rem;
    }
    /* Status Ribbon */
    .status-ribbon {
        display: flex;
        flex-wrap: wrap;
        gap: 0.85rem;
        align-items: center;
        background: rgba(127, 127, 127, 0.08);
        border: 1px solid rgba(127, 127, 127, 0.22);
        border-radius: 8px;
        padding: 0.7rem 1.1rem;
        margin-bottom: 1.25rem;
        font-size: 0.86rem;
    }
    .ribbon-item {
        display: flex;
        align-items: center;
        gap: 0.45rem;
    }
    .ribbon-label {
        opacity: 0.7;
        font-weight: 500;
    }
    .ribbon-value {
        font-weight: 600;
    }
    .badge {
        display: inline-block;
        padding: 0.22rem 0.6rem;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .badge-pass {
        background-color: rgba(34, 197, 94, 0.18);
        color: #22c55e;
        border: 1px solid rgba(34, 197, 94, 0.4);
    }
    .badge-fail {
        background-color: rgba(239, 68, 68, 0.18);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.4);
    }
    .badge-neutral {
        background-color: rgba(148, 163, 184, 0.18);
        color: #94a3b8;
        border: 1px solid rgba(148, 163, 184, 0.35);
    }
    .badge-warn {
        background-color: rgba(245, 158, 11, 0.18);
        color: #f59e0b;
        border: 1px solid rgba(245, 158, 11, 0.4);
    }
    /* Primary KPI Card */
    .kpi-card {
        background: rgba(127, 127, 127, 0.07);
        border: 1px solid rgba(127, 127, 127, 0.22);
        border-radius: 8px;
        padding: 1.15rem;
        margin-bottom: 0.9rem;
    }
    .kpi-title {
        font-size: 0.8rem;
        font-weight: 600;
        opacity: 0.7;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 0.25rem;
    }
    .kpi-value-primary {
        font-size: 2.1rem;
        font-weight: 700;
        line-height: 1.15;
    }
    .kpi-value-sub {
        font-size: 0.82rem;
        opacity: 0.65;
        margin-top: 0.35rem;
        font-family: monospace;
    }
    /* Secondary Metric Grid */
    .sec-metric {
        border-top: 1px solid rgba(127, 127, 127, 0.15);
        padding-top: 0.55rem;
        margin-top: 0.55rem;
        display: flex;
        justify-content: space-between;
        align-items: baseline;
    }
    .sec-label {
        font-size: 0.83rem;
        opacity: 0.72;
    }
    .sec-val {
        font-size: 0.94rem;
        font-weight: 600;
    }
    </style>
"""


def extract_scan_payload(
    raw_bytes: bytes,
    file_name: str,
) -> tuple[bytes, str, dict[str, Any]]:
    """Detect compression containers (gzip/zip) and decompress transparently in RAM.

    Returns:
        (decompressed_bytes, effective_file_name, metadata)
    """
    t0 = time.perf_counter()
    lower_name = file_name.lower()

    # GZIP magic bytes: 0x1f 0x8b
    if raw_bytes.startswith(b"\x1f\x8b"):
        decompressed = gzip.decompress(raw_bytes)
        dt_ms = (time.perf_counter() - t0) * 1000.0
        effective_name = file_name[:-3] if lower_name.endswith(".gz") else file_name
        orig_sz = len(decompressed)
        comp_sz = len(raw_bytes)
        meta = {
            "container": "gzip",
            "compressed_bytes": comp_sz,
            "uncompressed_bytes": orig_sz,
            "decompress_time_ms": dt_ms,
            "ratio_pct": ((orig_sz - comp_sz) / max(orig_sz, 1)) * 100.0,
        }
        return decompressed, effective_name, meta

    # ZIP magic bytes: PK\x03\x04
    if raw_bytes.startswith(b"PK\x03\x04"):
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
            candidates = [
                name for name in zf.namelist()
                if not name.startswith("__MACOSX")
                and not Path(name).name.startswith(".")
                and Path(name).suffix.lower() in SCAN_EXTENSIONS
            ]
            if not candidates:
                raise ValueError("Zip archive contains no supported 3D scan files (.ply, .pcd, .stl, etc.)")
            target_name = candidates[0]
            decompressed = zf.read(target_name)
            dt_ms = (time.perf_counter() - t0) * 1000.0
            orig_sz = len(decompressed)
            comp_sz = len(raw_bytes)
            meta = {
                "container": "zip",
                "compressed_bytes": comp_sz,
                "uncompressed_bytes": orig_sz,
                "decompress_time_ms": dt_ms,
                "ratio_pct": ((orig_sz - comp_sz) / max(orig_sz, 1)) * 100.0,
            }
            return decompressed, Path(target_name).name, meta

    # Raw uncompressed
    meta = {
        "container": "none",
        "compressed_bytes": len(raw_bytes),
        "uncompressed_bytes": len(raw_bytes),
        "decompress_time_ms": 0.0,
        "ratio_pct": 0.0,
    }
    return raw_bytes, file_name, meta


def generate_inspection_report(result: RoughnessResult, unit: str) -> str:
    """Format ASTM WK92969 inspection report with minimum compliant S_VR or N/A."""
    base_report = format_report(result)
    patch_ok = (result.patch_width_mm >= 50.0 and result.patch_height_mm >= 50.0)
    density_ok = (result.average_point_spacing_mm <= 0.20)
    is_valid = patch_ok and density_ok

    if not is_valid:
        compliance_text = (
            "  Specification Compliance (§5.3): N/A\n"
            "  Compliance Status:              INVALID (Specimen fails ASTM WK92969 patch size or point pitch criteria)\n"
        )
    else:
        svr_str = format_unit_val(result.svr_um, unit)
        compliance_text = (
            f"  Specification Compliance (§5.3): S_VR <= {svr_str} ({result.svr_mm:.4f} mm / {result.svr_in:.5f} in)\n"
            f"  Compliance Status:              COMPLIANT (Minimum allowable S_VR specification threshold satisfied)\n"
        )

    next_marker = "§10.1.2  Evaluation Length"
    if next_marker in base_report:
        parts = base_report.split(next_marker, 1)
        return parts[0] + compliance_text + "\n" + next_marker + parts[1]

    return base_report + "\n" + compliance_text


UPLOAD_BRIDGE_HTML = """
<div id="upload-status-banner" style="display: none; margin-bottom: 1.25rem; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.28); border-radius: 8px; padding: 0.85rem 1.15rem; font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-size: 0.86rem;">
    <div style="display: flex; align-items: center; gap: 0.5rem;">
      <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #38bdf8;"></span>
      <span id="upload-status-text" style="font-weight: 600; color: #38bdf8;">Uploading 3D scan...</span>
    </div>
    <span id="upload-status-pct" style="font-weight: 700; color: #38bdf8; font-variant-numeric: tabular-nums;">0%</span>
  </div>
  <div style="width: 100%; height: 6px; background: rgba(127, 127, 127, 0.18); border-radius: 3px; overflow: hidden;">
    <div id="upload-status-fill" style="width: 0%; height: 100%; background: #38bdf8; border-radius: 3px; transition: width 0.08s ease-out;"></div>
  </div>
</div>

<script>
(function() {
  const win = window.parent || window;
  const doc = win.document || document;

  function updateBanner(text, pct) {
    const banner = doc.getElementById('upload-status-banner');
    const fill = doc.getElementById('upload-status-fill');
    const txt = doc.getElementById('upload-status-text');
    const pctEl = doc.getElementById('upload-status-pct');
    if (banner) banner.style.display = 'block';
    if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    if (txt && text) txt.textContent = text;
  }

  // 1. Universal XHR hook for live upload progress display
  if (!win._surfInspectXhrHooked) {
    win._surfInspectXhrHooked = true;
    const origOpen = win.XMLHttpRequest.prototype.open;
    const origSend = win.XMLHttpRequest.prototype.send;

    win.XMLHttpRequest.prototype.open = function(method, url) {
      this._url = url;
      this._method = method;
      return origOpen.apply(this, arguments);
    };

    win.XMLHttpRequest.prototype.send = function(data) {
      if (this._method === 'PUT' && this._url && this._url.includes('_stcore/upload_file')) {
        updateBanner('Uploading surface scan to inspection engine...', 5);
        if (this.upload) {
          this.upload.addEventListener('progress', function(e) {
            if (e.lengthComputable) {
              const pct = (e.loaded / e.total) * 100;
              const loadedMb = (e.loaded / 1048576).toFixed(1);
              const totalMb = (e.total / 1048576).toFixed(1);
              if (pct < 99.5) {
                updateBanner(`Uploading 3D scan (${loadedMb} / ${totalMb} MB)...`, pct);
              } else {
                updateBanner('Upload complete. Handing over to Svr metrology engine...', 100);
              }
            }
          });
          this.upload.addEventListener('load', function() {
            updateBanner('Upload complete. Handing over to Svr metrology engine...', 100);
          });
        }
      }
      return origSend.apply(this, arguments);
    };
  }

  // 2. Client-side transparent gzip compression hook
  function hookStreamlitEndpoints() {
    if (win._surfInspectEndpointsHooked) return true;
    try {
      const root = doc.getElementById('root');
      if (!root) return false;
      const fiberKey = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
      if (!fiberKey) return false;

      let queue = [root[fiberKey]];
      let endpoints = null;

      while (queue.length > 0 && queue.length < 500) {
        let node = queue.shift();
        if (!node) continue;
        if (node.stateNode && node.stateNode.endpoints) {
          endpoints = node.stateNode.endpoints;
          break;
        }
        if (node.memoizedProps && node.memoizedProps.endpoints) {
          endpoints = node.memoizedProps.endpoints;
          break;
        }
        if (node.child) queue.push(node.child);
        if (node.sibling) queue.push(node.sibling);
      }

      if (endpoints && endpoints.uploadFileUploaderFile) {
        const origUpload = endpoints.uploadFileUploaderFile.bind(endpoints);
        endpoints.uploadFileUploaderFile = async function(uploadUrl, file, sessionId, onUploadProgress, abortSignal) {
          let fileToUpload = file;
          if (typeof CompressionStream !== 'undefined' && file.size > 300000 && !file.name.endsWith('.gz') && !file.name.endsWith('.zip')) {
            try {
              updateBanner(`Compressing ${file.name} for high-speed transmission...`, 15);
              const stream = file.stream().pipeThrough(new CompressionStream('gzip'));
              const blob = await new Response(stream).blob();
              fileToUpload = new File([blob], file.name + '.gz', { type: 'application/gzip' });
              updateBanner(`Compressed to ${(fileToUpload.size / 1048576).toFixed(1)} MB. Uploading...`, 25);
            } catch (err) {
              fileToUpload = file;
            }
          }
          return origUpload(uploadUrl, fileToUpload, sessionId, onUploadProgress, abortSignal);
        };
        win._surfInspectEndpointsHooked = true;
        return true;
      }
    } catch (e) {}
    return false;
  }

  if (!hookStreamlitEndpoints()) {
    const timer = setInterval(function() {
      if (hookStreamlitEndpoints()) clearInterval(timer);
    }, 200);
    setTimeout(function() { clearInterval(timer); }, 10000);
  }
})();
</script>
"""


def main() -> None:
    st.set_page_config(
        page_title="S_VR Metrology | ASTM WK92969",
        layout="wide",
        initial_sidebar_state="expanded",
    )
    st.markdown(CUSTOM_CSS, unsafe_allow_html=True)
    st.markdown('<div class="main-header">S<sub>VR</sub> Surface Roughness Metrology</div>', unsafe_allow_html=True)
    st.markdown(
        '<div class="sub-header">ASTM WK92969 Digital Surface Inspection Standard &bull; ISO 16610-61 Gaussian Areal Filtration</div>',
        unsafe_allow_html=True,
    )
    if sys.platform != "emscripten":
        st.html(UPLOAD_BRIDGE_HTML, unsafe_allow_javascript=True)

    with st.sidebar:
        st.subheader("Inspection Setup")
        uploaded_file = st.file_uploader("Surface Scan File", type=SUPPORTED_TYPES)

        selected_unit = st.selectbox(
            "Measurement Units",
            UNITS,
            index=0,
            help="Select display unit for roughness values and colorbar scales.",
        )

        with st.expander("Filter & Sampling Standards", expanded=False):
            grid_mm = st.number_input(
                "Grid Pitch / Downsample (mm)",
                min_value=0.001,
                value=0.20,
                step=0.05,
                help="Spatial resolution. ASTM WK92969 §8.2 standard is 0.20 mm.",
            )
            short_cutoff_mm = st.number_input(
                "Short Cutoff λs (mm)",
                min_value=0.0,
                value=1.0,
                step=0.1,
                help="High-frequency cutoff. ASTM WK92969 §9.1 recommended is 1.0 mm.",
            )
            long_cutoff_mm = st.number_input(
                "Long Cutoff λc (mm)",
                min_value=0.0,
                value=25.0,
                step=1.0,
                help="Low-frequency cutoff. ASTM WK92969 §9.1 recommended is 25.0 mm.",
            )
            gaussian_mesh = st.checkbox(
                "ISO 16610-61 Gaussian Form Removal",
                value=True,
                help="Enforces dual-pass areal Gaussian filtering with alpha=0.4697.",
            )

        st.subheader("Visualization")
        color_scale = st.selectbox("Color Palette", COLOR_SCALES, index=0)
        robust_contrast = st.checkbox(
            "Robust Contrast (1st–99th Percentile)",
            value=True,
            help="Suppresses outlier boundary spikes to preserve micro-roughness dynamic range.",
        )

    if uploaded_file is None:
        for k in [
            "current_scan_result",
            "current_svr_grid_um",
            "scan_upload_id",
            "filter_signature",
            "last_analysis_time",
            "decomp_time_ms",
            "upload_time_s",
            "effective_name",
        ]:
            st.session_state.pop(k, None)
        st.info("Upload a 3D scan (.pcd, .ply, .stl, .csv) in the sidebar to begin inspection.")
        return

    # Unique upload identifier per file upload event in Streamlit
    upload_id = getattr(uploaded_file, "file_id", getattr(uploaded_file, "id", None))
    if upload_id is None:
        upload_id = f"{uploaded_file.name}_{uploaded_file.size}"

    filter_sig = (grid_mm, short_cutoff_mm, long_cutoff_mm, gaussian_mesh)

    # Re-run inspection only if a new file upload is presented or physical filter settings change.
    # Display parameter changes (color palette, units, contrast ceiling, interpolation) update instantly.
    need_analysis = (
        "current_scan_result" not in st.session_state
        or st.session_state.get("scan_upload_id") != upload_id
        or st.session_state.get("filter_signature") != filter_sig
    )

    if need_analysis:
        raw_bytes = uploaded_file.getvalue()
        file_bytes, effective_name, meta = extract_scan_payload(raw_bytes, uploaded_file.name)
        decomp_time_ms = meta.get("decompress_time_ms", 0.0)
        decompress_time_s = decomp_time_ms / 1000.0

        # Retrieve tracked upload transfer time for this file
        upload_time_s = _UPLOAD_TIMES.get(str(upload_id))

        # Calibrated analysis duration estimate based on payload size and filter mode
        payload_mb = len(file_bytes) / (1024 * 1024)
        if gaussian_mesh:
            est_duration = max(0.20, 0.06 + payload_mb * 0.038)
        else:
            est_duration = max(1.50, 0.50 + payload_mb * 1.15)

        progress_bar = st.progress(0.0, text="Initializing surface topography analysis...")
        t_prog_start = time.perf_counter()

        try:
            if sys.platform == "emscripten":
                progress_bar.progress(0.35, text="Analyzing surface topography (§8.2 Areal Grid)...")
                result, timings = run_analysis(
                    file_bytes,
                    effective_name,
                    grid_mm,
                    short_cutoff_mm,
                    long_cutoff_mm,
                    gaussian_mesh,
                    decompress_time_s=decompress_time_s,
                )
            else:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(
                        run_analysis,
                        file_bytes,
                        effective_name,
                        grid_mm,
                        short_cutoff_mm,
                        long_cutoff_mm,
                        gaussian_mesh,
                        decompress_time_s=decompress_time_s,
                    )

                    while not future.done():
                        elapsed = time.perf_counter() - t_prog_start
                        ratio = elapsed / est_duration
                        if ratio < 0.90:
                            prog = ratio * 0.90
                        else:
                            # Smooth asymptotic approach towards 0.97 without stalling
                            prog = 0.81 + (1.0 - math.exp(-(ratio - 0.90) * 1.5)) * 0.16
                        prog = min(max(prog, 0.0), 0.97)

                        rem = max(0.0, est_duration - elapsed)
                        if rem > 0.05:
                            status_text = f"Analyzing surface topography (§8.2 Areal Grid)... (~{rem:.1f}s remaining)"
                        else:
                            status_text = "Finalizing Svr calculation & spatial grid..."

                        progress_bar.progress(prog, text=status_text)
                        time.sleep(0.025)

                    result, timings = future.result()

            progress_bar.progress(1.0, text="Analysis complete!")
            time.sleep(0.04)

            if result.grid.svr_map is not None:
                svr_grid_um = result.grid.svr_map
            elif result.grid.filtered is not None and result.grid.valid_filled is not None:
                svr_grid_um = svr_map(
                    result.grid.filtered,
                    result.grid.valid_filled,
                    result.config.grid_mm,
                    result.config.svr_points,
                    result.config.svr_span_mm,
                )
            else:
                svr_grid_um = np.zeros((result.grid.height, result.grid.width))

            analysis_time = timings.get("total", 0.0)

            # Store in session state for instant display manipulation
            st.session_state["current_scan_result"] = result
            st.session_state["current_svr_grid_um"] = svr_grid_um
            st.session_state["scan_upload_id"] = upload_id
            st.session_state["filter_signature"] = filter_sig
            st.session_state["last_analysis_time"] = analysis_time
            st.session_state["decomp_time_ms"] = decomp_time_ms
            st.session_state["upload_time_s"] = upload_time_s
            st.session_state["stage_timings"] = timings
            st.session_state["effective_name"] = effective_name
        except Exception as exc:
            st.error(f"Analysis failed: {exc}")
            return
        finally:
            progress_bar.empty()
    else:
        result = st.session_state["current_scan_result"]
        svr_grid_um = st.session_state["current_svr_grid_um"]
        analysis_time = st.session_state.get("last_analysis_time", 0.0)
        decomp_time_ms = st.session_state.get("decomp_time_ms", 0.0)
        upload_time_s = st.session_state.get("upload_time_s")
        timings = st.session_state.get("stage_timings")
        effective_name = st.session_state.get("effective_name", uploaded_file.name)

    render_dashboard(
        result,
        svr_grid_um,
        effective_name,
        color_scale,
        robust_contrast,
        selected_unit,
        analysis_time,
        decomp_time_ms=decomp_time_ms,
        upload_time_s=upload_time_s,
    )


def run_analysis(
    file_bytes: bytes,
    file_name: str,
    grid_mm: float,
    short_cutoff_mm: float,
    long_cutoff_mm: float,
    gaussian_mesh: bool,
    decompress_time_s: float = 0.0,
) -> tuple[RoughnessResult, dict[str, float]]:
    t_start = time.perf_counter()
    suffix = Path(file_name).suffix.lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)

    try:
        t_write = time.perf_counter()
        config = RoughnessConfig(
            grid_mm=grid_mm,
            short_cutoff_mm=short_cutoff_mm,
            long_cutoff_mm=long_cutoff_mm,
            gaussian_mesh=gaussian_mesh,
        )
        from svr_roughness.io import load_points
        from svr_roughness.analyze import analyze_points
        points = load_points(tmp_path)
        t_load = time.perf_counter()

        result = analyze_points(points, config=config)
        t_analyze = time.perf_counter()

        timings = {
            "decomp": decompress_time_s,
            "write": t_write - t_start,
            "load": t_load - t_write,
            "core": t_analyze - t_load,
            "total": t_analyze - t_start,
        }
        return result, timings
    finally:
        tmp_path.unlink(missing_ok=True)


def format_unit_val(val_um: float, unit: str) -> str:
    if unit == "µm":
        return f"{val_um:.3f} µm"
    if unit == "mm":
        return f"{val_um / 1000.0:.4f} mm"
    if unit == "in":
        return f"{val_um / 25400.0:.5f} in"
    return f"{val_um:.3f}"


def render_dashboard(
    result: RoughnessResult,
    svr_grid_um: np.ndarray,
    file_name: str,
    color_scale: str,
    robust_contrast: bool,
    unit: str,
    analysis_time: float,
    decomp_time_ms: float = 0.0,
    upload_time_s: float | None = None,
) -> None:
    # ── Unit Conversion for 2D Grid ──
    if unit == "mm":
        grid_display = svr_grid_um / 1000.0
    elif unit == "in":
        grid_display = svr_grid_um / 25400.0
    else:
        grid_display = svr_grid_um

    # ── Physical Checks per ASTM WK92969 ──
    patch_w = result.patch_width_mm
    patch_h = result.patch_height_mm
    spacing = result.average_point_spacing_mm

    patch_ok = (patch_w >= 50.0 and patch_h >= 50.0)
    density_ok = (spacing <= 0.20)

    # ── Status Ribbon ──
    svr_display = format_unit_val(result.svr_um, unit)

    patch_badge = (
        f'<span class="badge badge-pass">{patch_w:.1f} &times; {patch_h:.1f} mm</span>'
        if patch_ok
        else f'<span class="badge badge-warn">{patch_w:.1f} &times; {patch_h:.1f} mm (&lt; 50 mm)</span>'
    )
    density_badge = (
        f'<span class="badge badge-pass">{spacing:.3f} mm</span>'
        if density_ok
        else f'<span class="badge badge-warn">{spacing:.3f} mm (&gt; 0.20 mm)</span>'
    )

    # Timings
    decomp_display = (
        f"{decomp_time_ms:.0f} ms"
        if (0.0 < decomp_time_ms < 1000.0)
        else (f"{decomp_time_ms / 1000.0:.2f}s" if decomp_time_ms >= 1000.0 else "N/A")
    )
    upload_display = (
        f"{upload_time_s * 1000.0:.0f} ms"
        if (upload_time_s is not None and 0.0 < upload_time_s < 1.0)
        else (f"{upload_time_s:.2f}s" if upload_time_s is not None and upload_time_s >= 1.0 else "N/A")
    )
    analysis_display = (
        f"{analysis_time * 1000.0:.0f} ms"
        if analysis_time < 1.0
        else f"{analysis_time:.2f}s"
    )

    ribbon_html = f"""
    <div class="status-ribbon">
        <div class="ribbon-item">
            <span class="ribbon-label">File:</span>
            <span class="ribbon-value">{file_name}</span>
        </div>
        <div class="ribbon-item">
            <span class="ribbon-label">S<sub>VR</sub>:</span>
            <span class="ribbon-value" style="color:#38bdf8;">{svr_display}</span>
        </div>
        <div class="ribbon-item">
            <span class="ribbon-label">Patch Size (§3.1.5):</span>
            {patch_badge}
        </div>
        <div class="ribbon-item">
            <span class="ribbon-label">Point Pitch (§8.2):</span>
            {density_badge}
        </div>
        <div class="ribbon-item" style="margin-left: auto;">
            <span class="ribbon-label">Decomp:</span>
            <span class="ribbon-value">{decomp_display}</span>
        </div>
        <div class="ribbon-item">
            <span class="ribbon-label">Upload:</span>
            <span class="ribbon-value">{upload_display}</span>
        </div>
        <div class="ribbon-item">
            <span class="ribbon-label">Analysis:</span>
            <span class="ribbon-value" style="color:#38bdf8;">{analysis_display}</span>
        </div>
    </div>
    """
    st.markdown(ribbon_html, unsafe_allow_html=True)
    st.html(
        """<script>
        (function() {
          const win = window.parent || window;
          const doc = win.document || document;
          const banner = doc.getElementById('upload-status-banner');
          if (banner) banner.style.display = 'none';
        })();
        </script>""",
        unsafe_allow_javascript=True,
    )

    # ── Main View: Interactive Heatmap + Primary KPI Card ──
    col_chart, col_kpi = st.columns([3, 1])

    with col_chart:
        st.plotly_chart(
            build_figure(result, grid_display, color_scale, robust_contrast, unit),
            width="stretch",
            config={"displaylogo": False},
        )

    with col_kpi:
        # Highlight Primary Metric: S_VR
        svr_primary = format_unit_val(result.svr_um, unit)
        svr_alt = f"{result.svr_mm:.4f} mm &bull; {result.svr_um:.2f} &mu;m &bull; {result.svr_in:.5f} in"
        eval_len = result.config.svr_points * result.config.svr_span_mm

        kpi_card_html = f"""
        <div class="kpi-card">
            <div class="kpi-title">Surface Variogram Roughness (S<sub>VR</sub>)</div>
            <div class="kpi-value-primary">{svr_primary}</div>
            <div class="kpi-value-sub">{svr_alt}</div>
            <div class="sec-metric">
                <span class="sec-label">Arithmetic Mean (Sa)</span>
                <span class="sec-val">{format_unit_val(result.sa_um, unit)}</span>
            </div>
            <div class="sec-metric">
                <span class="sec-label">Root Mean Square (Sq)</span>
                <span class="sec-val">{format_unit_val(result.sq_um, unit)}</span>
            </div>
            <div class="sec-metric">
                <span class="sec-label">Active Surface Points</span>
                <span class="sec-val">{result.cropped_points:,}</span>
            </div>
            <div class="sec-metric">
                <span class="sec-label">Grid Coverage</span>
                <span class="sec-val">{result.grid.valid_filled.mean() * 100:.1f}%</span>
            </div>
            <div class="sec-metric">
                <span class="sec-label">Evaluation Length</span>
                <span class="sec-val">{eval_len:.1f} mm</span>
            </div>
        </div>
        """
        st.markdown(kpi_card_html, unsafe_allow_html=True)

    # ── Structured Inspection Tabs ──
    tab_comp, tab_var, tab_rep = st.tabs(["Comparator Equivalents", "Variogram Distribution", "Inspection Report"])

    with tab_comp:
        comps = result.comparator_equivalents()
        data = [
            {"Standard / Reference": "SCRATA (ASTM A802, Appendix X2)", "Visual Rating": comps["SCRATA (ASTM A802)"], "Reference Type": "Cast steel comparator plates (A1–A4)"},
            {"Standard / Reference": "GAR C-9 (Appendix X1)", "Visual Rating": comps["GAR C-9"], "Reference Type": "Microfinish comparator (200–900)"},
            {"Standard / Reference": "ACI Surface Indicator (Appendix X3)", "Visual Rating": comps["ACI SIS"], "Reference Type": "Alloy Casting Institute scale (SIS-1–SIS-4)"},
        ]
        df_comp = pd.DataFrame(data)
        st.dataframe(df_comp, hide_index=True, width="stretch")

    with tab_var:
        distances = [
            idx * result.config.svr_span_mm + (result.config.svr_span_mm / 2.0)
            for idx in range(len(result.variogram_bins_um))
        ]
        bin_vals = [
            (val / 1000.0 if unit == "mm" else (val / 25400.0 if unit == "in" else val))
            for val in result.variogram_bins_um
        ]

        fig_var = go.Figure()
        fig_var.add_trace(
            go.Scatter(
                x=distances,
                y=bin_vals,
                mode="lines+markers",
                marker={"size": 6, "color": "#0284c7"},
                line={"width": 2, "color": "#0284c7"},
                name="v(d)",
                hovertemplate="Distance: %{x:.2f} mm<br>v(d): %{y:.4f}<extra></extra>",
            )
        )
        fig_var.update_layout(
            height=300,
            margin={"l": 0, "r": 0, "t": 16, "b": 0},
            xaxis_title="Distance Bucket Center d (mm)",
            yaxis_title=f"Roughness v(d) ({unit})",
            xaxis={"showgrid": True, "gridcolor": "rgba(127,127,127,0.18)"},
            yaxis={"showgrid": True, "gridcolor": "rgba(127,127,127,0.18)"},
            plot_bgcolor="rgba(0,0,0,0)",
            paper_bgcolor="rgba(0,0,0,0)",
        )
        st.plotly_chart(fig_var, width="stretch", config={"displaylogo": False})

    with tab_rep:
        report_text = generate_inspection_report(result, unit)
        st.code(report_text, language="text")

        st.download_button(
            "Download Report (.txt)",
            data=report_text,
            file_name=f"ASTM_WK92969_{Path(file_name).stem}.txt",
            mime="text/plain",
        )


def build_figure(
    result: RoughnessResult,
    grid: np.ndarray,
    color_scale: str,
    robust_contrast: bool,
    unit: str,
) -> go.Figure:
    origin_x, origin_y, pitch = result.grid.origin
    valid_vals = grid[~np.isnan(grid)] if np.any(~np.isnan(grid)) else np.array([0.0])

    if robust_contrast and len(valid_vals) > 0:
        zmin = float(np.percentile(valid_vals, 1.0))
        zmax = float(np.percentile(valid_vals, 99.0))
    else:
        zmin = float(np.percentile(valid_vals, 0.5)) if len(valid_vals) > 0 else None
        zmax = float(np.percentile(valid_vals, 99.8)) if len(valid_vals) > 0 else None

    trace = go.Heatmap(
        z=grid,
        x=[origin_x + index * pitch for index in range(grid.shape[1])],
        y=[origin_y + index * pitch for index in range(grid.shape[0])],
        colorscale=color_scale,
        zmin=zmin,
        zmax=zmax,
        zsmooth=False,
        colorbar={
            "title": f"S<sub>VR</sub> ({unit})",
            "len": 0.95,
            "thickness": 16,
            "tickfont": {"size": 11, "family": "Inter, sans-serif"},
        },
        hovertemplate=f"X: %{{x:.2f}} mm<br>Y: %{{y:.2f}} mm<br>Local S<sub>VR</sub>: %{{z:.4f}} {unit}<extra></extra>",
    )

    figure = go.Figure(data=[trace])
    figure.update_layout(
        height=660,
        margin={"l": 0, "r": 0, "t": 24, "b": 0},
        xaxis_title="Surface X (mm)",
        yaxis_title="Surface Y (mm)",
        xaxis={"showgrid": False},
        yaxis={"showgrid": False, "scaleanchor": "x", "scaleratio": 1},
        plot_bgcolor="rgba(0,0,0,0)",
        paper_bgcolor="rgba(0,0,0,0)",
        font={"family": "Inter, sans-serif"},
    )
    return figure


if __name__ == "__main__":
    main()

