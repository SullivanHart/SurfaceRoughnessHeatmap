# SVR Roughness Heatmap

Application for calculating and displaying a surface roughness heatmap using the `svr-roughness` package.

## Supported files

All formats supported by `svr-roughness`: PLY, PCD, STL, OBJ, CSV, TSV, XYZ,
TXT, NPY, and NPZ.

## Run

```powershell
cd "C:\Users\User\Desktop\Research\surface roughness\heatmap"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
streamlit run app.py
```

The app opens in the browser. Upload a scan, choose the grid and filter
parameters, and inspect a spatial Svr heatmap. Each cell shows local Svr,
calculated from neighboring height differences using the same variogram
definition as the package-wide Svr metric. The sidebar also reports global Sa,
Sq, and Svr.

The roughness algorithm and units are provided by `svr-roughness`.
