from __future__ import annotations

import tempfile
from pathlib import Path

import plotly.graph_objects as go
import streamlit as st

from svr_roughness import (
    RoughnessConfig,
    RoughnessResult,
    analyze_file,
    svr_map,
)


SUPPORTED_TYPES = ["ply", "pcd", "stl", "obj", "csv", "tsv", "xyz", "txt", "npy", "npz"]
COLOR_SCALES = ["Jet", "Turbo", "Viridis", "Plasma", "Inferno", "Rainbow"]
COLOR_RANGE_MODES = ["Auto (99.5th Percentile)", "Full Range (0 - Max)", "Custom Cap"]


st.set_page_config(
    page_title="SVR Roughness Native Heatmap",
    page_icon="📐",
    layout="wide",
)


def main() -> None:
    st.title("SurfInspect SVR Roughness Heatmap")
    st.caption("High-performance surface roughness metrology computed directly by the SurfInspect Native C++ engine (PC_svr2).")

    with st.sidebar:
        uploaded_file = st.file_uploader("Upload a scan file", type=SUPPORTED_TYPES)
        st.subheader("Analysis Parameters")
        grid_mm = st.number_input("Grid spacing (mm)", min_value=0.001, value=0.30, step=0.05)
        short_cutoff_mm = st.number_input("Short cutoff (mm)", min_value=0.0, value=1.0, step=0.1)
        long_cutoff_mm = st.number_input("Long cutoff (mm)", min_value=0.0, value=25.0, step=1.0)
        gaussian_mesh = st.checkbox("Gaussian Filtering (Form Removal)", value=True, help="Applies Gaussian bandpass filter (short/long wavelength cutoff) to isolate surface micro-roughness from macro-form shape.")
        
        st.subheader("Display Settings (Instant)")
        color_scale = st.selectbox("Color scale", COLOR_SCALES, index=0)
        robust_contrast = st.checkbox("Robust Contrast Stretch (99.5th Percentile)", value=True, help="Clips extreme outlier peaks so micro-roughness surface details pop out clearly instead of being squashed into blue.")
        custom_max = st.number_input("Custom Colorbar Max (µm, 0 = Auto)", min_value=0.0, value=0.0, step=5.0)

    if uploaded_file is None:
        st.info("Upload a point cloud scan file (.pcd, .ply, .stl, .csv) to calculate roughness using the native C++ engine.")
        return

    try:
        file_bytes = uploaded_file.getvalue()
        with st.spinner("Calculating SVR roughness via native C++ core..."):
            result = analyze_bytes(
                file_bytes,
                uploaded_file.name,
                grid_mm,
                short_cutoff_mm,
                long_cutoff_mm,
                gaussian_mesh,
            )
    except Exception as exc:
        st.error(f"Could not calculate roughness: {exc}")
        return

    show_result(result, uploaded_file.name, color_scale, robust_contrast, custom_max)


@st.cache_data(show_spinner=False)
def analyze_bytes(
    file_bytes: bytes,
    file_name: str,
    grid_mm: float,
    short_cutoff_mm: float,
    long_cutoff_mm: float,
    gaussian_mesh: bool,
) -> RoughnessResult:
    suffix = Path(file_name).suffix.lower()

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)

    try:
        config = RoughnessConfig(
            grid_mm=grid_mm,
            short_cutoff_mm=short_cutoff_mm,
            long_cutoff_mm=long_cutoff_mm,
            gaussian_mesh=gaussian_mesh,
        )
        return analyze_file(tmp_path, config=config)
    finally:
        tmp_path.unlink(missing_ok=True)


@st.cache_data(show_spinner=False)
def get_cached_svr_map(
    grid_filtered: np.ndarray,
    valid_filled: np.ndarray,
    grid_mm: float,
    svr_points: int,
    svr_span_mm: float,
) -> np.ndarray:
    return svr_map(grid_filtered, valid_filled, grid_mm, svr_points, svr_span_mm)


def show_result(
    result: RoughnessResult,
    file_name: str,
    color_scale: str,
    robust_contrast: bool,
    custom_max: float,
) -> None:
    svr_grid = get_cached_svr_map(
        result.grid.filtered,
        result.grid.valid_filled,
        result.config.grid_mm,
        result.config.svr_points,
        result.config.svr_span_mm,
    )

    left, right = st.columns([3, 1])
    with left:
        st.plotly_chart(
            build_figure(result, svr_grid, color_scale, robust_contrast, custom_max),
            width="stretch",
            config={"displaylogo": False},
        )

    with right:
        st.metric("File Name", file_name)
        st.metric("Sa (Arithmetic Mean)", f"{result.sa_um:.3f} µm")
        st.metric("Sq (Root Mean Sq)", f"{result.sq_um:.3f} µm")
        st.metric("Svr (Variogram)", f"{result.svr_um:.3f} µm")
        st.metric("Points Analyzed", f"{result.points:,}")
        st.metric("Grid Coverage", f"{result.grid.valid_filled.mean() * 100:.1f}%")


def build_figure(
    result: RoughnessResult,
    grid: np.ndarray,
    color_scale: str,
    robust_contrast: bool,
    custom_max: float,
) -> go.Figure:
    import numpy as np

    origin_x, origin_y, pitch = result.grid.origin

    valid_vals = grid[~np.isnan(grid)] if np.any(~np.isnan(grid)) else np.array([0.0])

    if custom_max > 0:
        zmin = 0.0
        zmax = custom_max
    elif robust_contrast and len(valid_vals) > 0:
        zmin = float(np.percentile(valid_vals, 1.0))
        zmax = float(np.percentile(valid_vals, 99.0))
    else:
        # Full range of surface values (2nd to 99.8th percentile to exclude extreme 0.2% edge artifacts)
        zmin = float(np.percentile(valid_vals, 0.5)) if len(valid_vals) > 0 else None
        zmax = float(np.percentile(valid_vals, 99.8)) if len(valid_vals) > 0 else None

    trace = go.Heatmap(
        z=grid,
        x=[origin_x + index * pitch for index in range(grid.shape[1])],
        y=[origin_y + index * pitch for index in range(grid.shape[0])],
        colorscale=color_scale,
        zmin=zmin,
        zmax=zmax,
        colorbar={"title": "Local Svr (µm)"},
        hovertemplate="X=%{x:.3f} mm<br>Y=%{y:.3f} mm<br>Local Svr=%{z:.3f} µm<extra></extra>",
    )

    figure = go.Figure(data=[trace])
    figure.update_layout(
        height=700,
        margin={"l": 0, "r": 0, "t": 32, "b": 0},
        xaxis_title="Surface X (mm)",
        yaxis_title="Surface Y (mm)",
        yaxis={"scaleanchor": "x", "scaleratio": 1},
        title="Native C++ Local Svr Heatmap",
    )
    return figure


if __name__ == "__main__":
    main()
