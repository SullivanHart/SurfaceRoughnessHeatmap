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
COLOR_SCALES = ["Turbo", "Viridis", "Plasma", "Inferno", "Jet"]


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
        color_scale = st.selectbox("Color scale", COLOR_SCALES)

    if uploaded_file is None:
        st.info("Upload a point cloud scan file (.pcd, .ply, .stl, .csv) to calculate roughness using the native C++ engine.")
        return

    try:
        progress_bar = st.progress(0, text="Preparing C++ engine...")

        def update_progress(label: str, value: float) -> None:
            progress_bar.progress(value, text=f"{label}...")

        with st.spinner("Calculating SVR roughness via native C++ core..."):
            result = analyze_uploaded_file(
                uploaded_file,
                RoughnessConfig(
                    grid_mm=grid_mm,
                    short_cutoff_mm=short_cutoff_mm,
                    long_cutoff_mm=long_cutoff_mm,
                    gaussian_mesh=gaussian_mesh,
                ),
                progress=update_progress,
            )
        progress_bar.empty()
    except Exception as exc:
        st.error(f"Could not calculate roughness: {exc}")
        return

    show_result(result, uploaded_file.name, color_scale)


def analyze_uploaded_file(uploaded_file, config: RoughnessConfig, progress=None) -> RoughnessResult:
    suffix = Path(uploaded_file.name).suffix.lower()

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(uploaded_file.getbuffer())
        tmp_path = Path(tmp.name)

    try:
        return analyze_file(tmp_path, config=config, progress=progress)
    finally:
        tmp_path.unlink(missing_ok=True)


def show_result(
    result: RoughnessResult,
    file_name: str,
    color_scale: str,
) -> None:
    left, right = st.columns([3, 1])
    with left:
        st.plotly_chart(
            build_figure(result, color_scale),
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
    color_scale: str,
) -> go.Figure:
    grid = svr_map(
        result.grid.filtered,
        result.grid.valid_filled,
        result.config.grid_mm,
        result.config.svr_points,
        result.config.svr_span_mm,
    )
    origin_x, origin_y, pitch = result.grid.origin
    trace = go.Heatmap(
        z=grid,
        x=[origin_x + index * pitch for index in range(grid.shape[1])],
        y=[origin_y + index * pitch for index in range(grid.shape[0])],
        colorscale=color_scale,
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
