from __future__ import annotations

import tempfile
import time
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
import streamlit.components.v1 as components

from svr_roughness import (
    RoughnessConfig,
    RoughnessResult,
    analyze_file,
    format_report,
    svr_map,
)

SUPPORTED_TYPES = ["ply", "pcd", "stl", "obj", "csv", "tsv", "xyz", "txt", "npy", "npz"]
COLOR_SCALES = ["Jet", "Turbo", "Viridis", "Plasma", "Inferno", "Rainbow"]
UNITS = ["µm", "mm", "in"]

st.set_page_config(
    page_title="S_VR Metrology | ASTM WK92969",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Industrial Theme Custom CSS (Theme-Adaptive, Dark/Light Compatible) ──
st.markdown(
    """
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
    """,
    unsafe_allow_html=True,
)


def main() -> None:
    st.markdown('<div class="main-header">S<sub>VR</sub> Surface Roughness Metrology</div>', unsafe_allow_html=True)
    st.markdown(
        '<div class="sub-header">ASTM WK92969 Digital Surface Inspection Standard &bull; ISO 16610-61 Gaussian Areal Filtration</div>',
        unsafe_allow_html=True,
    )

    with st.sidebar:
        st.subheader("Inspection Setup")
        uploaded_file = st.file_uploader("Surface Scan File", type=SUPPORTED_TYPES)

        selected_unit = st.selectbox(
            "Measurement Units",
            UNITS,
            index=0,
            help="Select display unit for roughness values and colorbar scales.",
        )

        target_svr_input = st.number_input(
            f"Acceptance Limit $S_{{VR}}$ ({selected_unit})",
            min_value=0.0,
            value=0.0,
            step=0.005 if selected_unit == "mm" else (5.0 if selected_unit == "µm" else 0.0002),
            format="%.4f" if selected_unit in ("mm", "in") else "%.2f",
            help="ASTM WK92969 §5.3 specification threshold. Specimen passes if S_VR <= limit. Set 0.0 to disable.",
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
        smooth_display = st.checkbox(
            "Bilinear Interpolation",
            value=False,
            help="Applies surface smoothing without modifying underlying numerical data.",
        )
        custom_max = st.number_input(
            f"Fixed Colorbar Ceiling ({selected_unit})",
            min_value=0.0,
            value=0.0,
            step=5.0 if selected_unit == "µm" else 0.01,
            help="Fixes the maximum scale across multiple scans. Set 0.0 for auto-scale.",
        )

    if uploaded_file is None:
        for k in ["current_scan_result", "current_svr_grid_um", "scan_upload_id", "filter_signature", "last_analysis_time"]:
            st.session_state.pop(k, None)
        st.info("Upload a 3D scan (.pcd, .ply, .stl, .csv) in the sidebar to begin inspection.")
        return

    # Normalize target to millimeters for internal logic
    target_svr_mm: float | None = None
    if target_svr_input > 0:
        if selected_unit == "µm":
            target_svr_mm = target_svr_input / 1000.0
        elif selected_unit == "in":
            target_svr_mm = target_svr_input * 25.4
        else:
            target_svr_mm = target_svr_input

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
        progress_slot = st.empty()
        timer_slot = st.empty()
        progress_bar = progress_slot.progress(25, text="Running ASTM WK92969 inspection pipeline...")
        t0 = time.perf_counter()

        with timer_slot:
            components.html(
                """
                <div style="display:flex; justify-content:space-between; align-items:center; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size:0.86rem; color:#94a3b8; padding:2px 0;">
                    <span>Stage: <strong style="color:#f8fafc;">Executing C++ Metrology Pipeline</strong></span>
                    <span>Elapsed: <strong id="live-timer" style="color:#38bdf8; font-family:monospace; font-size:1.05rem; font-weight:700;">0.0s</strong></span>
                </div>
                <script>
                    const startTime = Date.now();
                    const timerElem = document.getElementById('live-timer');
                    setInterval(function() {
                        if (timerElem) {
                            const sec = ((Date.now() - startTime) / 1000).toFixed(1);
                            timerElem.textContent = sec + 's';
                        }
                    }, 100);
                </script>
                """,
                height=34,
            )

        file_bytes = uploaded_file.getvalue()

        try:
            result, timings = run_analysis(
                file_bytes,
                uploaded_file.name,
                grid_mm,
                short_cutoff_mm,
                long_cutoff_mm,
                gaussian_mesh,
            )

            progress_bar.progress(85, text="Evaluating variogram & local roughness distribution...")
            if result.grid.svr_map is not None:
                svr_grid_um = result.grid.svr_map
            else:
                svr_grid_um = svr_map(
                    result.grid.filtered,
                    result.grid.valid_filled,
                    result.config.grid_mm,
                    result.config.svr_points,
                    result.config.svr_span_mm,
                )

            progress_bar.progress(100, text="Analysis complete (100%)")
            total_time = time.perf_counter() - t0
            progress_slot.empty()
            timer_slot.empty()

            # Store in session state for instant display manipulation
            st.session_state["current_scan_result"] = result
            st.session_state["current_svr_grid_um"] = svr_grid_um
            st.session_state["scan_upload_id"] = upload_id
            st.session_state["filter_signature"] = filter_sig
            st.session_state["last_analysis_time"] = total_time
            st.session_state["stage_timings"] = timings
        except Exception as exc:
            progress_slot.empty()
            timer_slot.empty()
            st.error(f"Analysis failed: {exc}")
            return
    else:
        result = st.session_state["current_scan_result"]
        svr_grid_um = st.session_state["current_svr_grid_um"]
        total_time = st.session_state.get("last_analysis_time", 0.0)
        timings = st.session_state.get("stage_timings")

    render_dashboard(
        result,
        svr_grid_um,
        uploaded_file.name,
        smooth_display,
        color_scale,
        robust_contrast,
        custom_max,
        selected_unit,
        target_svr_mm,
        total_time,
        timings,
    )


def run_analysis(
    file_bytes: bytes,
    file_name: str,
    grid_mm: float,
    short_cutoff_mm: float,
    long_cutoff_mm: float,
    gaussian_mesh: bool,
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
    smooth_display: bool,
    color_scale: str,
    robust_contrast: bool,
    custom_max: float,
    unit: str,
    target_svr_mm: float | None,
    total_time: float,
    timings: dict[str, float] | None = None,
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
    if target_svr_mm is not None and target_svr_mm > 0:
        passed = (result.svr_mm <= target_svr_mm)
        status_badge = '<span class="badge badge-pass">Pass</span>' if passed else '<span class="badge badge-fail">Fail</span>'
        spec_text = f"Target &le; {target_svr_mm:.4f} mm"
    else:
        status_badge = '<span class="badge badge-neutral">Inspected</span>'
        spec_text = "No limit set"

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

    timing_breakdown = ""
    if timings and "core" in timings:
        timing_breakdown = f'<span style="color:#94a3b8; font-size:0.8rem; margin-left:0.4rem;">(C++: {timings["core"]:.2f}s | Load: {timings.get("load", 0.0):.2f}s)</span>'

    ribbon_html = f"""
    <div class="status-ribbon">
        <div class="ribbon-item">
            <span class="ribbon-label">File:</span>
            <span class="ribbon-value">{file_name}</span>
        </div>
        <div class="ribbon-item">
            <span class="ribbon-label">Conformance:</span>
            {status_badge}
            <span style="color:#94a3b8; font-size:0.8rem;">({spec_text})</span>
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
            <span class="ribbon-label">Runtime:</span>
            <span class="ribbon-value">{total_time:.2f}s</span>
            {timing_breakdown}
        </div>
    </div>
    """
    st.markdown(ribbon_html, unsafe_allow_html=True)

    # ── Main View: Interactive Heatmap + Primary KPI Card ──
    col_chart, col_kpi = st.columns([3, 1])

    with col_chart:
        st.plotly_chart(
            build_figure(result, grid_display, smooth_display, color_scale, robust_contrast, custom_max, unit),
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
        report_text = format_report(result, target_svr_mm=target_svr_mm)
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
    smooth_display: bool,
    color_scale: str,
    robust_contrast: bool,
    custom_max: float,
    unit: str,
) -> go.Figure:
    origin_x, origin_y, pitch = result.grid.origin
    valid_vals = grid[~np.isnan(grid)] if np.any(~np.isnan(grid)) else np.array([0.0])

    if custom_max > 0:
        zmin = 0.0
        zmax = custom_max
    elif robust_contrast and len(valid_vals) > 0:
        zmin = float(np.percentile(valid_vals, 1.0))
        zmax = float(np.percentile(valid_vals, 99.0))
    else:
        zmin = float(np.percentile(valid_vals, 0.5)) if len(valid_vals) > 0 else None
        zmax = float(np.percentile(valid_vals, 99.8)) if len(valid_vals) > 0 else None

    zsmooth = "best" if smooth_display else False

    trace = go.Heatmap(
        z=grid,
        x=[origin_x + index * pitch for index in range(grid.shape[1])],
        y=[origin_y + index * pitch for index in range(grid.shape[0])],
        colorscale=color_scale,
        zmin=zmin,
        zmax=zmax,
        zsmooth=zsmooth,
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

