// S_VR Surface Roughness Metrology Dashboard Controller
let worker = null
let currentResult = null
let selectedFile = null

// DOM Elements
const fileInput = document.getElementById('file-input')
const dropzone = document.getElementById('dropzone')
const dropzoneText = document.getElementById('dropzone-text')
const dropzoneHint = document.getElementById('dropzone-hint')
const statusDot = document.getElementById('status-dot')
const statusText = document.getElementById('status-text')
const progressBar = document.getElementById('progress-bar')
const progressFill = document.getElementById('progress-fill')
const unitSelect = document.getElementById('unit-select')
const paletteSelect = document.getElementById('palette-select')
const robustCheckbox = document.getElementById('robust-contrast')
const gridPitchInput = document.getElementById('grid-pitch')
const shortCutoffInput = document.getElementById('short-cutoff')
const longCutoffInput = document.getElementById('long-cutoff')
const gaussianCheckbox = document.getElementById('gaussian-mesh')
const emptyState = document.getElementById('empty-state')
const resultsContainer = document.getElementById('results-container')
const reportPre = document.getElementById('report-pre')
const downloadBtn = document.getElementById('download-report-btn')

function updateDropzoneFileDisplay (file, extraInfo) {
  if (!dropzone) return
  if (file) {
    dropzone.classList.add('has-file')
    const sizeMb = file.size / (1024 * 1024)
    const sizeStr =
      sizeMb >= 1.0
        ? sizeMb.toFixed(1) + ' MB'
        : (file.size / 1024).toFixed(0) + ' KB'
    if (dropzoneText) dropzoneText.textContent = file.name
    if (dropzoneHint) {
      dropzoneHint.textContent = `${sizeStr}${
        extraInfo ? ' • ' + extraInfo : ''
      } • Click or drag to replace`
    }
  } else {
    dropzone.classList.remove('has-file')
    if (dropzoneText) dropzoneText.textContent = 'Load 3D Scan'
    if (dropzoneHint) dropzoneHint.textContent = 'PLY, PCD, STL, OBJ, CSV, XYZ'
  }
}

function initWorker () {
  worker = new Worker('worker.js')

  worker.onmessage = function (e) {
    const { type, text, percent, data, error } = e.data

    if (type === 'status') {
      statusText.textContent = text
    } else if (type === 'ready') {
      statusDot.classList.add('ready')
      statusText.textContent = 'Engine ready (WebAssembly)'
      if (selectedFile) {
        startAnalysis(selectedFile)
      }
    } else if (type === 'progress') {
      progressBar.style.display = 'block'
      progressFill.style.width = (percent || 50) + '%'
      statusText.textContent = text
    } else if (type === 'result') {
      progressBar.style.display = 'none'
      statusText.textContent = 'Analysis complete'
      currentResult = data
      renderResults(data)
    } else if (type === 'error') {
      progressBar.style.display = 'none'
      statusText.textContent = 'Error: ' + error
      alert('Analysis error: ' + error)
    }
  }
}

function handleFileSelect (file) {
  if (!file) return
  selectedFile = file
  updateDropzoneFileDisplay(file, 'Preparing scan...')
  startAnalysis(file)
}

async function startAnalysis (file) {
  progressBar.style.display = 'block'
  progressFill.style.width = '15%'
  statusText.textContent = `Reading ${file.name}...`
  updateDropzoneFileDisplay(file, 'Reading binary data...')

  const arrayBuffer = await file.arrayBuffer()

  worker.postMessage({
    type: 'analyze',
    payload: {
      fileData: arrayBuffer,
      fileName: file.name,
      grid_mm: parseFloat(gridPitchInput.value) || 0.2,
      short_cutoff_mm: parseFloat(shortCutoffInput.value) || 1.0,
      long_cutoff_mm: parseFloat(longCutoffInput.value) || 25.0,
      gaussian_mesh: gaussianCheckbox.checked
    }
  })
}

function formatVal (valUm, unit) {
  if (unit === 'mm') return (valUm / 1000.0).toFixed(4) + ' mm'
  if (unit === 'in') return (valUm / 25400.0).toFixed(5) + ' in'
  return valUm.toFixed(3) + ' µm'
}

function renderResults (res) {
  emptyState.style.display = 'none'
  resultsContainer.style.display = 'block'

  const unit = unitSelect.value
  const fileName = res.effective_name || selectedFile.name

  updateDropzoneFileDisplay(
    selectedFile,
    `${res.processed_points.toLocaleString()} surface points`
  )

  // Status Ribbon
  document.getElementById('ribbon-filename').textContent = fileName
  const ribbonSvr = document.getElementById('ribbon-svr')
  if (ribbonSvr) ribbonSvr.textContent = formatVal(res.svr_um, unit)

  const patchW = res.patch_width_mm
  const patchH = res.patch_height_mm
  const patchOk = patchW >= 50.0 && patchH >= 50.0
  const patchBadge = document.getElementById('ribbon-patch')
  patchBadge.className = 'badge ' + (patchOk ? 'badge-pass' : 'badge-warn')
  patchBadge.innerHTML = `${patchW.toFixed(1)} &times; ${patchH.toFixed(
    1
  )} mm ${patchOk ? '(ASTM Pass)' : '(&lt; 50 mm standard)'}`

  const spacing = res.average_point_spacing_mm
  const spacingOk = spacing <= 0.2
  const spacingBadge = document.getElementById('ribbon-pitch')
  spacingBadge.className = 'badge ' + (spacingOk ? 'badge-pass' : 'badge-warn')
  spacingBadge.innerHTML = `${spacing.toFixed(3)} mm ${
    spacingOk ? '(ASTM Pass)' : '(&gt; 0.20 mm)'
  }`

  const timings = res.timings || {}
  const totalSec = ((timings.total_ms || 0) / 1000.0).toFixed(2)
  document.getElementById('ribbon-timing').textContent = `${totalSec} s`

  // KPI Card
  document.getElementById('kpi-svr').textContent = formatVal(res.svr_um, unit)
  document.getElementById('kpi-svr-sub').textContent = `${res.svr_mm.toFixed(
    4
  )} mm • ${res.svr_um.toFixed(2)} µm • ${res.svr_in.toFixed(5)} in`
  document.getElementById('kpi-sa').textContent = formatVal(res.sa_um, unit)
  document.getElementById('kpi-sq').textContent = formatVal(res.sq_um, unit)
  document.getElementById('kpi-points').textContent =
    res.processed_points.toLocaleString()
  document.getElementById('kpi-coverage').textContent =
    res.grid_coverage_pct.toFixed(1) + '%'
  document.getElementById('kpi-eval-len').textContent = `${(10 * 0.5).toFixed(
    1
  )} mm`

  // Comparator Table
  const compTbody = document.getElementById('comparator-tbody')
  compTbody.innerHTML = ''
  const comps = res.comparators || {}
  const rows = [
    {
      std: 'SCRATA (ASTM A802, Appendix X2)',
      rating: comps['SCRATA (ASTM A802)'] || 'N/A',
      ref: 'Cast steel comparator plates (A1–A4)'
    },
    {
      std: 'GAR C-9 (Appendix X1)',
      rating: comps['GAR C-9'] || 'N/A',
      ref: 'Microfinish comparator (200–900)'
    },
    {
      std: 'ACI Surface Indicator (Appendix X3)',
      rating: comps['ACI SIS'] || 'N/A',
      ref: 'Alloy Casting Institute scale (SIS-1–SIS-4)'
    }
  ]
  rows.forEach(r => {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${r.std}</td><td>${r.rating}</td><td>${r.ref}</td>`
    compTbody.appendChild(tr)
  })

  // Report text
  reportPre.textContent = res.report_text || ''

  // Render Charts
  renderHeatmap(res)
  renderVariogram(res)
}

function renderHeatmap (res) {
  const unit = unitSelect.value
  const grid = res.grid_svr
  const robust = robustCheckbox.checked
  const palette = paletteSelect.value

  const originX = res.origin_x
  const originY = res.origin_y
  const pitch = res.pitch_mm

  // Flatten and filter for percentiles
  let flat = []
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      let v = grid[r][c]
      if (!isNaN(v) && v !== null) {
        if (unit === 'mm') v /= 1000.0
        else if (unit === 'in') v /= 25400.0
        flat.push(v)
      }
    }
  }
  flat.sort((a, b) => a - b)

  let zmin = flat[0]
  let zmax = flat[flat.length - 1]
  if (robust && flat.length > 20) {
    zmin = flat[Math.floor(flat.length * 0.01)]
    zmax = flat[Math.floor(flat.length * 0.99)]
  }

  // Convert grid units
  const zData = grid.map(row =>
    row.map(v => {
      if (isNaN(v) || v === null) return null
      if (unit === 'mm') return v / 1000.0
      if (unit === 'in') return v / 25400.0
      return v
    })
  )

  const xCoords = []
  for (let c = 0; c < res.grid_width; c++) xCoords.push(originX + c * pitch)
  const yCoords = []
  for (let r = 0; r < res.grid_height; r++) yCoords.push(originY + r * pitch)

  const trace = {
    z: zData,
    x: xCoords,
    y: yCoords,
    type: 'heatmap',
    colorscale: palette,
    zmin: zmin,
    zmax: zmax,
    zsmooth: false,
    colorbar: {
      title: `S_VR (${unit})`,
      len: 0.95,
      thickness: 16,
      tickfont: { size: 11, family: 'Inter, sans-serif' }
    },
    hovertemplate: `X: %{x:.2f} mm<br>Y: %{y:.2f} mm<br>Local S_VR: %{z:.4f} ${unit}<extra></extra>`
  }

  const layout = {
    height: 520,
    margin: { l: 40, r: 20, t: 20, b: 40 },
    xaxis: { title: 'Surface X (mm)', showgrid: false },
    yaxis: {
      title: 'Surface Y (mm)',
      showgrid: false,
      scaleanchor: 'x',
      scaleratio: 1
    },
    plot_bgcolor: 'rgba(0,0,0,0)',
    paper_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, sans-serif', color: '#cbd5e1' }
  }

  Plotly.newPlot('chart-container', [trace], layout, {
    responsive: true,
    displaylogo: false
  })
}

function renderVariogram (res) {
  const unit = unitSelect.value
  const bins = res.var_bins || []
  const distances = bins.map((_, idx) => idx * 0.5 + 0.25)
  const binVals = bins.map(v => {
    if (unit === 'mm') return v / 1000.0
    if (unit === 'in') return v / 25400.0
    return v
  })

  const trace = {
    x: distances,
    y: binVals,
    mode: 'lines+markers',
    marker: { size: 6, color: '#38bdf8' },
    line: { width: 2, color: '#38bdf8' },
    hovertemplate: `Distance: %{x:.2f} mm<br>v(d): %{y:.4f} ${unit}<extra></extra>`
  }

  const layout = {
    height: 280,
    margin: { l: 40, r: 20, t: 15, b: 40 },
    xaxis: {
      title: 'Distance Bucket Center d (mm)',
      showgrid: true,
      gridcolor: 'rgba(255,255,255,0.1)'
    },
    yaxis: {
      title: `Roughness v(d) (${unit})`,
      showgrid: true,
      gridcolor: 'rgba(255,255,255,0.1)'
    },
    plot_bgcolor: 'rgba(0,0,0,0)',
    paper_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, sans-serif', color: '#cbd5e1' }
  }

  Plotly.newPlot('variogram-chart', [trace], layout, {
    responsive: true,
    displaylogo: false
  })
}

// Event Listeners
dropzone.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', e => handleFileSelect(e.target.files[0]))

dropzone.addEventListener('dragover', e => {
  e.preventDefault()
  dropzone.classList.add('dragover')
})
dropzone.addEventListener('dragleave', () =>
  dropzone.classList.remove('dragover')
)
dropzone.addEventListener('drop', e => {
  e.preventDefault()
  dropzone.classList.remove('dragover')
  if (e.dataTransfer.files.length > 0) {
    handleFileSelect(e.dataTransfer.files[0])
  }
})

// Unit or visualization switch updates instantly
unitSelect.addEventListener('change', () => {
  if (currentResult) renderResults(currentResult)
})
paletteSelect.addEventListener('change', () => {
  if (currentResult) renderHeatmap(currentResult)
})
robustCheckbox.addEventListener('change', () => {
  if (currentResult) renderHeatmap(currentResult)
})

// Physical filter settings re-run analysis
;[gridPitchInput, shortCutoffInput, longCutoffInput, gaussianCheckbox].forEach(
  el => {
    el.addEventListener('change', () => {
      if (selectedFile) startAnalysis(selectedFile)
    })
  }
)

// Tab Switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document
      .querySelectorAll('.tab-btn')
      .forEach(b => b.classList.remove('active'))
    document
      .querySelectorAll('.tab-content')
      .forEach(c => c.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById(btn.dataset.tab).classList.add('active')

    // Relayout plot when switching to tab
    if (btn.dataset.tab === 'tab-var' && currentResult) {
      Plotly.Plots.resize('variogram-chart')
    }
  })
})

// Download Report
downloadBtn.addEventListener('click', () => {
  if (!currentResult) return
  const blob = new Blob([currentResult.report_text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const name = (currentResult.effective_name || 'inspection').split('.')[0]
  a.download = `ASTM_WK92969_${name}.txt`
  a.click()
  URL.revokeObjectURL(url)
})

// Initialize on page load
initWorker()
