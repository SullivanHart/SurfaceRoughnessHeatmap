// S_VR Surface Roughness Metrology Dashboard Controller
let worker = null
let currentResult = null
let selectedFile = null
let analysisStartTime = 0

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
const themeBtn = document.getElementById('theme-btn')
const themeIconMoon = document.getElementById('theme-icon-moon')
const themeIconSun = document.getElementById('theme-icon-sun')

function getTheme () {
  return document.documentElement.getAttribute('data-theme') || 'dark'
}

function setTheme (theme) {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('isu-imse-theme', theme)
  if (themeBtn) {
    themeBtn.setAttribute(
      'title',
      theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'
    )
  }
  if (themeIconMoon && themeIconSun) {
    if (theme === 'dark') {
      themeIconSun.style.display = 'block'
      themeIconMoon.style.display = 'none'
    } else {
      themeIconSun.style.display = 'none'
      themeIconMoon.style.display = 'block'
    }
  }
  if (currentResult) {
    renderHeatmap(currentResult)
    renderVariogram(currentResult)
  }
}

function initTheme () {
  const saved = localStorage.getItem('isu-imse-theme') || 'dark'
  setTheme(saved)
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = getTheme()
      setTheme(current === 'dark' ? 'light' : 'dark')
    })
  }
}

const dropzoneReplaceBtn = document.getElementById('dropzone-replace-btn')

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
      dropzoneHint.textContent = extraInfo
        ? `${sizeStr} • ${extraInfo}`
        : sizeStr
    }
  } else {
    dropzone.classList.remove('has-file')
    if (dropzoneText) dropzoneText.textContent = 'Select or Drag 3D Scan'
    if (dropzoneHint) dropzoneHint.textContent = 'PLY, PCD, STL, OBJ, CSV, XYZ'
  }
}

let progressInterval = null
let currentPercent = 0
let targetPercent = 0

let completeTimeout = null

function setProgress (percent, text) {
  if (completeTimeout) {
    clearTimeout(completeTimeout)
    completeTimeout = null
  }
  if (progressBar) progressBar.style.display = 'block'
  targetPercent = Math.max(targetPercent, percent)
  if (statusText && text) statusText.textContent = text

  if (!progressInterval) {
    progressInterval = setInterval(() => {
      if (currentPercent < targetPercent) {
        const step = Math.max(0.5, (targetPercent - currentPercent) * 0.25)
        currentPercent = Math.min(targetPercent, currentPercent + step)
      } else if (targetPercent < 98) {
        currentPercent = Math.min(targetPercent + 3.5, currentPercent + 0.08)
      }
      if (progressFill) {
        progressFill.style.width = currentPercent.toFixed(1) + '%'
      }
    }, 30)
  }
}

function completeProgress (text) {
  targetPercent = 100
  currentPercent = 100
  if (progressFill) progressFill.style.width = '100%'
  if (statusText && text) statusText.textContent = text

  if (progressInterval) {
    clearInterval(progressInterval)
    progressInterval = null
  }

  if (completeTimeout) clearTimeout(completeTimeout)
  completeTimeout = setTimeout(() => {
    if (progressBar) {
      progressBar.style.display = 'none'
      currentPercent = 0
      targetPercent = 0
      if (progressFill) progressFill.style.width = '0%'
    }
    completeTimeout = null
  }, 400)
}

function resetProgress () {
  if (completeTimeout) {
    clearTimeout(completeTimeout)
    completeTimeout = null
  }
  if (progressInterval) {
    clearInterval(progressInterval)
    progressInterval = null
  }
  currentPercent = 0
  targetPercent = 0
  if (progressBar) progressBar.style.display = 'none'
  if (progressFill) progressFill.style.width = '0%'
}

function initWorker () {
  worker = new Worker('worker.js')

  worker.onmessage = function (e) {
    const { type, text, percent, data, error } = e.data

    if (type === 'status') {
      if (statusText) statusText.textContent = text
    } else if (type === 'ready') {
      if (statusDot) {
        statusDot.className = 'status-dot ready'
      }
      if (statusText) statusText.textContent = 'Ready'
      if (selectedFile) {
        startAnalysis(selectedFile)
      }
    } else if (type === 'progress') {
      if (statusDot) statusDot.className = 'status-dot analyzing'
      setProgress(percent, text)
    } else if (type === 'result') {
      if (statusDot) statusDot.className = 'status-dot ready'
      completeProgress('Ready')
      currentResult = data
      renderResults(data)
    } else if (type === 'error') {
      if (statusDot) statusDot.className = 'status-dot ready'
      resetProgress()
      if (resultsContainer) {
        resultsContainer.style.opacity = '1'
        resultsContainer.style.pointerEvents = 'auto'
      }
      if (statusText) statusText.textContent = 'Error: ' + error
      console.error('Analysis error:', error)
    }
  }
}

function handleFileSelect (file) {
  if (!file) return
  selectedFile = file

  // Immediately update Dropzone filename and size
  updateDropzoneFileDisplay(file)

  // Immediately update Ribbon filename and status if results container is displayed
  const ribbonFilename = document.getElementById('ribbon-filename')
  if (ribbonFilename) ribbonFilename.textContent = file.name
  const ribbonTiming = document.getElementById('ribbon-timing')
  if (ribbonTiming) ribbonTiming.textContent = 'Calculating...'
  const ribbonSvr = document.getElementById('ribbon-svr')
  if (ribbonSvr) ribbonSvr.textContent = 'Analyzing...'

  // If previous results are displayed, subtly dim them to indicate active recalculation
  if (resultsContainer && resultsContainer.style.display !== 'none') {
    resultsContainer.style.opacity = '0.45'
    resultsContainer.style.pointerEvents = 'none'
  }

  // Immediately launch progress bar at 10%
  if (completeTimeout) {
    clearTimeout(completeTimeout)
    completeTimeout = null
  }
  currentPercent = 10
  targetPercent = 15
  if (progressBar) progressBar.style.display = 'block'
  if (progressFill) progressFill.style.width = '10%'
  setProgress(15, `Loading ${file.name}...`)

  startAnalysis(file)
}

async function startAnalysis (file) {
  analysisStartTime = performance.now()
  if (statusDot) statusDot.className = 'status-dot analyzing'
  setProgress(18, `Loading ${file.name}...`)

  const arrayBuffer = await file.arrayBuffer()
  setProgress(28, 'Transferring scan data...')

  worker.postMessage(
    {
      type: 'analyze',
      payload: {
        fileData: arrayBuffer,
        fileName: file.name,
        grid_mm: parseFloat(gridPitchInput.value) || 0.2,
        short_cutoff_mm: parseFloat(shortCutoffInput.value) || 1.0,
        long_cutoff_mm: parseFloat(longCutoffInput.value) || 25.0,
        gaussian_mesh: gaussianCheckbox.checked
      }
    },
    [arrayBuffer]
  )
}

function formatVal (valUm, unit) {
  if (unit === 'mm') return (valUm / 1000.0).toFixed(4) + ' mm'
  if (unit === 'in') return (valUm / 25400.0).toFixed(5) + ' in'
  return valUm.toFixed(3) + ' µm'
}

function renderResults (res) {
  emptyState.style.display = 'none'
  resultsContainer.style.display = 'block'
  resultsContainer.style.opacity = '1'
  resultsContainer.style.pointerEvents = 'auto'

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
  patchBadge.textContent = `${patchW.toFixed(1)} × ${patchH.toFixed(1)} mm`

  const spacing = res.average_point_spacing_mm
  const spacingOk = spacing <= 0.2
  const spacingBadge = document.getElementById('ribbon-pitch')
  spacingBadge.className = 'badge ' + (spacingOk ? 'badge-pass' : 'badge-warn')
  spacingBadge.textContent = `${spacing.toFixed(3)} mm`

  const totalSec =
    analysisStartTime > 0
      ? ((performance.now() - analysisStartTime) / 1000.0).toFixed(2)
      : ((res.timings?.total_ms || 0) / 1000.0).toFixed(2)
  document.getElementById('ribbon-timing').textContent = `${totalSec} s`

  // KPI Card
  document.getElementById('kpi-svr').textContent = formatVal(res.svr_um, unit)
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
      std: 'SCRATA (ASTM A802)',
      rating: comps['SCRATA (ASTM A802)'] || 'N/A'
    },
    {
      std: 'GAR C-9',
      rating: comps['GAR C-9'] || 'N/A'
    },
    {
      std: 'ACI SIS',
      rating: comps['ACI SIS'] || 'N/A'
    }
  ]
  rows.forEach(r => {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${r.std}</td><td>${r.rating}</td>`
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

  const isDark = getTheme() === 'dark'
  const chartBg = isDark ? '#1c1d22' : '#ffffff'
  const chartText = isDark ? '#c7cbd3' : '#0f172a'
  const tickColor = isDark ? '#8e94a0' : '#475569'

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
      tickfont: { size: 11, color: chartText }
    },
    hovertemplate: `X: %{x:.2f} mm<br>Y: %{y:.2f} mm<br>Local S_VR: %{z:.4f} ${unit}<extra></extra>`
  }

  const layout = {
    height: 500,
    margin: { l: 45, r: 20, t: 20, b: 45 },
    xaxis: {
      title: 'Surface X (mm)',
      showgrid: false,
      color: chartText,
      tickcolor: tickColor
    },
    yaxis: {
      title: 'Surface Y (mm)',
      showgrid: false,
      scaleanchor: 'x',
      scaleratio: 1,
      color: chartText,
      tickcolor: tickColor
    },
    plot_bgcolor: chartBg,
    paper_bgcolor: chartBg,
    font: {
      family:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: chartText
    }
  }

  Plotly.newPlot('chart-container', [trace], layout, {
    responsive: true,
    displaylogo: false
  })
}

function renderVariogram (res) {
  const isDark = getTheme() === 'dark'
  const chartBg = isDark ? '#1c1d22' : '#ffffff'
  const chartText = isDark ? '#c7cbd3' : '#0f172a'
  const chartGrid = isDark ? '#282a31' : '#e2e8f0'
  const tickColor = isDark ? '#8e94a0' : '#475569'
  const varColor = isDark ? '#d93848' : '#a6192e'

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
    marker: { size: 5, color: varColor },
    line: { width: 2, color: varColor },
    hovertemplate: `Distance: %{x:.2f} mm<br>v(d): %{y:.4f} ${unit}<extra></extra>`
  }

  const layout = {
    height: 280,
    margin: { l: 45, r: 20, t: 15, b: 45 },
    xaxis: {
      title: 'Distance Bucket Center d (mm)',
      showgrid: true,
      gridcolor: chartGrid,
      color: chartText,
      tickcolor: tickColor
    },
    yaxis: {
      title: `Roughness v(d) (${unit})`,
      showgrid: true,
      gridcolor: chartGrid,
      color: chartText,
      tickcolor: tickColor
    },
    plot_bgcolor: chartBg,
    paper_bgcolor: chartBg,
    font: {
      family:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: chartText
    }
  }

  Plotly.newPlot('variogram-chart', [trace], layout, {
    responsive: true,
    displaylogo: false
  })
}

// Event Listeners
dropzone.addEventListener('click', () => {
  fileInput.value = ''
  fileInput.click()
})
if (dropzoneReplaceBtn) {
  dropzoneReplaceBtn.addEventListener('click', e => {
    e.stopPropagation()
    fileInput.value = ''
    fileInput.click()
  })
}
fileInput.addEventListener('change', e => {
  if (e.target.files && e.target.files.length > 0) {
    handleFileSelect(e.target.files[0])
  }
})

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
  a.download = `roughness_report_${name}.txt`
  a.click()
  URL.revokeObjectURL(url)
})

// Initialize on page load
initTheme()
initWorker()
