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
const pointSizeSlider = document.getElementById('point-size-slider')
const pointSizeVal = document.getElementById('point-size-val')
const robustCheckbox = document.getElementById('robust-contrast')
const showHeatmapCheckbox = document.getElementById('show-heatmap')
const showUnassignedCheckbox = document.getElementById('show-unassigned')
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

// 3D Planar Faces Elements & State
let activePatchIndex = 0
let currentViewMode = '3d-surface' // '2d' | '3d-surface' | '3d-object'
let previousViewMode = null
let pointCloudMarkerSize = 0.5
let pointCloudViewer = null
let lastLoadedResult = null
const FACE_PALETTE = [
  '#c8102e', // Cardinal Red
  '#2563eb', // Royal Blue
  '#16a34a', // Emerald Green
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#10b981'  // Teal
]
const partNavBar = document.getElementById('part-nav-bar')
const partNavPills = document.getElementById('part-nav-pills')
const tabBtnFaces = document.getElementById('tab-btn-faces')
const tabBtnRep = document.getElementById('tab-btn-rep')
const facesTbody = document.getElementById('faces-tbody')

// KPI Card Elements
const kpiCardTitle = document.getElementById('kpi-card-title')
const kpiSvr = document.getElementById('kpi-svr')
const secLabel1 = document.getElementById('sec-label-1')
const secVal1 = document.getElementById('sec-val-1')
const secLabel2 = document.getElementById('sec-label-2')
const secVal2 = document.getElementById('sec-val-2')
const secLabel3 = document.getElementById('sec-label-3')
const secVal3 = document.getElementById('sec-val-3')
const secLabel4 = document.getElementById('sec-label-4')
const secVal4 = document.getElementById('sec-val-4')
const secLabel5 = document.getElementById('sec-label-5')
const secVal5 = document.getElementById('sec-val-5')


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
  if (pointCloudViewer) {
    pointCloudViewer.setTheme(theme === 'dark')
  }
  if (currentResult) {
    updateActiveChart()
    const target =
      currentResult.is_3d &&
      activePatchIndex >= 0 &&
      currentResult.patches &&
      currentResult.patches[activePatchIndex]
        ? currentResult.patches[activePatchIndex]
        : currentResult
    renderVariogram(target)
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
    if (dropzoneText) dropzoneText.textContent = 'Upload or Drag 3D Scan'
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
  targetPercent = Math.min(100, Math.max(targetPercent, percent))
  if (statusText && text) statusText.textContent = text

  if (!progressInterval) {
    progressInterval = setInterval(() => {
      if (currentPercent < targetPercent) {
        const diff = targetPercent - currentPercent
        const step = Math.max(0.3, diff * 0.15)
        currentPercent = Math.min(targetPercent, currentPercent + step)
        if (progressFill) {
          progressFill.style.width = currentPercent.toFixed(1) + '%'
        }
      } else if (currentPercent >= targetPercent) {
        clearInterval(progressInterval)
        progressInterval = null
      }
    }, 25)
  }
}

function completeProgress (text) {
  targetPercent = 100
  if (statusText && text) statusText.textContent = text

  if (progressInterval) {
    clearInterval(progressInterval)
    progressInterval = null
  }

  // Smooth final animation to 100%
  currentPercent = 100
  if (progressFill) progressFill.style.width = '100%'

  if (completeTimeout) clearTimeout(completeTimeout)
  completeTimeout = setTimeout(() => {
    if (progressBar) {
      progressBar.style.display = 'none'
      currentPercent = 0
      targetPercent = 0
      if (progressFill) progressFill.style.width = '0%'
    }
    completeTimeout = null
  }, 450)
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

let isAnalyzing = false
let currentAnalysisId = 0
let workerRuntimeReady = false

function initWorker () {
  const workerUrl = 'worker.js' + (window.location.search ? window.location.search + '&t=' : '?t=') + Date.now()
  worker = new Worker(workerUrl)

  worker.onmessage = function (e) {
    const { type, text, percent, data, error, analysisId, mode } = e.data

    if (type === 'status') {
      if (statusText) statusText.textContent = text
      if (isAnalyzing && progressBar) {
        setProgress(Math.max(currentPercent, 22), text)
      }
    } else if (type === 'ready') {
      workerRuntimeReady = true
      if (currentResult) return
      if (statusDot && statusDot.className !== 'status-dot analyzing') {
        statusDot.className = 'status-dot ready'
      }
      if (statusText && !selectedFile) {
        statusText.textContent = mode === 'local'
          ? 'Local Engine Ready (Live svr-roughness)'
          : 'Browser Runtime Ready'
      }
      if (selectedFile && !currentResult && !isAnalyzing) {
        startAnalysis(selectedFile)
      }
    } else if (type === 'progress') {
      if (statusDot) statusDot.className = 'status-dot analyzing'
      setProgress(percent, text)
    } else if (type === 'result') {
      if (analysisId && analysisId !== currentAnalysisId) {
        console.warn('Ignoring stale analysis result')
        return
      }
      isAnalyzing = false
      if (statusDot) statusDot.className = 'status-dot ready'
      completeProgress('Ready')
      currentResult = data
      renderResults(data)
    } else if (type === 'error') {
      isAnalyzing = false
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

  worker.onerror = function (err) {
    console.error('Worker error:', err)
    isAnalyzing = false
    if (statusDot) statusDot.className = 'status-dot ready'
    resetProgress()
    if (statusText) statusText.textContent = `Worker Error: ${err.message || 'Script execution failed'}`
  }
}

function handleFileSelect (file) {
  if (!file) return
  selectedFile = file
  activePatchIndex = 0

  // Reset or sync sample dropdown: if this file was loaded as a sample scan, show it;
  // otherwise (uploaded user file), default dropdown to "Select…" since the scan isn't in there.
  const sampleSelect = document.getElementById('sample-select')
  if (sampleSelect) {
    if (file.isSampleScan) {
      sampleSelect.value = file.name
    } else {
      sampleSelect.selectedIndex = 0
      sampleSelect.value = ''
    }
  }

  // Immediately update Dropzone filename and size
  updateDropzoneFileDisplay(file)

  // If previous results are displayed, subtly dim them to indicate active recalculation
  if (resultsContainer && resultsContainer.style.display !== 'none') {
    resultsContainer.style.opacity = '0.45'
    resultsContainer.style.pointerEvents = 'none'
  }

  resetProgress()
  setProgress(2, `Loading ${file.name}...`)

  startAnalysis(file)
}

async function startAnalysis (file) {
  isAnalyzing = true
  const thisAnalysisId = ++currentAnalysisId
  analysisStartTime = performance.now()
  if (statusDot) statusDot.className = 'status-dot analyzing'
  setProgress(4, `Reading ${file.name}...`)

  const arrayBuffer = await file.arrayBuffer()

  if (!workerRuntimeReady) {
    setProgress(6, 'Initializing Python runtime & numerical packages...')
  } else {
    setProgress(6, 'Transferring scan data to metrology engine...')
  }
  worker.postMessage(
    {
      type: 'analyze',
      payload: {
        fileData: arrayBuffer,
        fileName: file.name,
        grid_mm: parseFloat(gridPitchInput.value) || 0.2,
        short_cutoff_mm: parseFloat(shortCutoffInput.value) || 1.0,
        long_cutoff_mm: parseFloat(longCutoffInput.value) || 25.0,
        gaussian_mesh: gaussianCheckbox.checked,
        analysisId: thisAnalysisId
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

  const fileName = res.effective_name || (selectedFile ? selectedFile.name : 'scan')
  const totalPoints = res.total_points || res.processed_points || 0
  updateDropzoneFileDisplay(
    selectedFile,
    `${totalPoints.toLocaleString()} pts`
  )

  // Report text
  if (reportPre) reportPre.textContent = res.report_text || ''

  if (res.is_3d && res.patches && res.patches.length > 0) {
    render3DFaces(res)
  } else {
    renderSingleSurface(res)
  }
}

function render3DFaces (res) {
  const unit = unitSelect ? unitSelect.value : 'µm'
  if (partNavBar) partNavBar.style.display = 'flex'
  if (tabBtnFaces) {
    tabBtnFaces.style.display = 'inline-block'
    tabBtnFaces.textContent = `Faces (${res.patches.length})`
  }

  // Ensure Faces Breakdown is active tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))
  if (tabBtnFaces) {
    tabBtnFaces.classList.add('active')
    tabBtnFaces.style.display = 'inline-block'
    tabBtnFaces.textContent = `Faces (${res.patches.length})`
  }
  const tabFacesContent = document.getElementById('tab-faces')
  if (tabFacesContent) tabFacesContent.classList.add('active')

  // Find governing/worst face
  let worstPatch = null
  let maxVal = -1
  if (res.patches && res.patches.length > 0) {
    res.patches.forEach(p => {
      if (typeof p.svr_um === 'number' && p.svr_um > maxVal) {
        maxVal = p.svr_um
        worstPatch = p
      }
    })
  }

  // Render Target Navigation Tabs (All + N Faces)
  if (partNavPills) {
    partNavPills.innerHTML = ''

    // 1. All Tab
    const overviewPill = document.createElement('div')
    overviewPill.className = `part-pill ${activePatchIndex === -1 ? 'active' : ''}`
    overviewPill.setAttribute('data-target', 'overview')
    overviewPill.innerHTML = `<span>All</span>`
    overviewPill.addEventListener('click', () => {
      selectOverview()
    })
    partNavPills.appendChild(overviewPill)

    // 2. Individual Face Tabs (Faces 1..N)
    res.patches.forEach((patch, idx) => {
      const pill = document.createElement('div')
      pill.className = `part-pill ${idx === activePatchIndex ? 'active' : ''}`
      pill.setAttribute('data-patch-idx', idx)

      const color = FACE_PALETTE[idx % FACE_PALETTE.length]

      pill.innerHTML = `
        <span class="part-pill-swatch" style="background:${color};"></span>
        <span>${patch.name}</span>
      `
      pill.addEventListener('click', () => {
        selectFace(idx)
      })
      partNavPills.appendChild(pill)
    })
  }

  // Render Table in tab-faces with rows (Whole Part + N Faces)
  if (facesTbody) {
    facesTbody.innerHTML = ''

    // Row 0: Whole Part
    const trOverview = document.createElement('tr')
    trOverview.className = `overview-row ${activePatchIndex === -1 ? 'active-row' : ''}`
    trOverview.setAttribute('data-target', 'overview')

    const totalPts = (res.assigned_points || res.processed_points || res.total_points || 0).toLocaleString()
    const totalArea = res.total_area_mm2
      ? `${res.total_area_mm2.toLocaleString()} mm²`
      : `${res.patches.reduce((s, p) => s + (p.area_mm2 || 0), 0).toLocaleString()} mm²`
    const bbox = res.bounding_box_mm
      ? `${res.bounding_box_mm[0]} × ${res.bounding_box_mm[1]} × ${res.bounding_box_mm[2]} mm`
      : '50.0 × 50.0 × 50.0 mm'
    const meanSa = res.mean_sa_um || (res.patches.reduce((s, p) => s + (p.sa_um || 0), 0) / res.patches.length)
    const meanSq = res.mean_sq_um || (res.patches.reduce((s, p) => s + (p.sq_um || 0), 0) / res.patches.length)
    const worstRating = worstPatch?.comparators?.['SCRATA (A802)'] || worstPatch?.comparators?.['SCRATA (ASTM A802)'] || worstPatch?.comparators?.['SCRATA'] || 'Overall Rating'

    trOverview.innerHTML = `
      <td><span class="part-pill-swatch" style="background:var(--text-muted); margin-right:6px; display:inline-block;"></span><strong>Whole Part</strong></td>
      <td>${bbox}</td>
      <td>${totalArea}</td>
      <td><strong>${formatVal(res.worst_svr_um || (worstPatch ? worstPatch.svr_um : 0), unit)}</strong></td>
      <td><strong>${worstRating}</strong></td>
    `
    trOverview.addEventListener('click', () => {
      selectOverview()
    })
    facesTbody.appendChild(trOverview)

    // Rows 1..N: Individual Faces
    res.patches.forEach((patch, idx) => {
      const tr = document.createElement('tr')
      tr.className = idx === activePatchIndex ? 'active-row' : ''
      tr.setAttribute('data-patch-idx', idx)

      const scrataRating = patch.comparators?.['SCRATA (A802)'] || patch.comparators?.['SCRATA (ASTM A802)'] || patch.comparators?.['SCRATA'] || 'N/A'
      const dims = patch.dims_mm ? `${patch.dims_mm[0]} × ${patch.dims_mm[1]} mm` : '-'
      const area = patch.area_mm2 ? `${patch.area_mm2.toLocaleString()} mm²` : '-'
      const color = FACE_PALETTE[idx % FACE_PALETTE.length]

      tr.innerHTML = `
        <td><span class="part-pill-swatch" style="background:${color}; margin-right:6px; display:inline-block;"></span><strong>${patch.name}</strong></td>
        <td>${dims}</td>
        <td>${area}</td>
        <td><strong>${formatVal(patch.svr_um, unit)}</strong></td>
        <td>${scrataRating}</td>
      `
      tr.addEventListener('click', () => {
        selectFace(idx)
      })
      facesTbody.appendChild(tr)
    })
  }

  // Start in Part Overview with 3D point cloud scan visible first
  currentViewMode = '3d-object'
  selectOverview()

  // Warm up surface point grids in idle time so face switching is instant
  const warmUp = () => {
    if (res.patches) {
      res.patches.forEach(p => getOrExtractSurfaceData(p, unit, false))
    }
  }
  if (window.requestIdleCallback) {
    window.requestIdleCallback(warmUp)
  } else {
    setTimeout(warmUp, 60)
  }
}

function selectOverview (options = {}) {
  if (!currentResult) return
  activePatchIndex = -1
  currentViewMode = '3d-object'
  const unit = unitSelect ? unitSelect.value : 'µm'
  const res = currentResult

  // Update pills active class
  if (partNavPills) {
    const pills = partNavPills.querySelectorAll('.part-pill')
    pills.forEach(p => {
      p.classList.toggle('active', p.getAttribute('data-target') === 'overview')
    })
  }

  // Update table rows active class
  if (facesTbody) {
    const rows = facesTbody.querySelectorAll('tr')
    rows.forEach(r => {
      r.classList.toggle('active-row', r.getAttribute('data-target') === 'overview')
    })
  }

  // Find worst face metadata for description
  let worstPatch = null
  if (res.patches && res.patches.length > 0) {
    let maxVal = -1
    res.patches.forEach(p => {
      if (typeof p.svr_um === 'number' && p.svr_um > maxVal) {
        maxVal = p.svr_um
        worstPatch = p
      }
    })
  }

  // Populate Right KPI Card in Part Overview Mode
  if (kpiCardTitle) kpiCardTitle.innerHTML = 'Roughness (S<sub>VR</sub>)'
  if (kpiSvr) kpiSvr.textContent = formatVal(res.worst_svr_um || (worstPatch ? worstPatch.svr_um : 0), unit)

  if (secLabel1) secLabel1.innerHTML = 'Arithmetic Mean (S<sub>a</sub>)'
  if (secVal1) secVal1.textContent = worstPatch ? formatVal(worstPatch.sa_um, unit) : '-'
  if (secLabel2) secLabel2.innerHTML = 'Root Mean Square (S<sub>q</sub>)'
  if (secVal2) secVal2.textContent = worstPatch ? formatVal(worstPatch.sq_um, unit) : '-'
  if (secLabel3) secLabel3.innerHTML = 'Worst Face S<sub>VR</sub>'
  if (secVal3) secVal3.textContent = formatVal(res.worst_svr_um || (worstPatch ? worstPatch.svr_um : 0), unit)
  if (secLabel4) secLabel4.innerHTML = 'Mean Face S<sub>VR</sub>'
  if (secVal4) secVal4.textContent = formatVal(res.mean_svr_um || 0, unit)
  if (secLabel5) secLabel5.innerHTML = 'Total Points'
  if (secVal5) secVal5.textContent = `${(res.assigned_points || res.total_points || res.processed_points || 0).toLocaleString()} pts`

  // Update Compact Comparators Table in Right Results Panel
  const compTbody = document.getElementById('comparator-tbody')
  if (compTbody) {
    compTbody.innerHTML = ''
    const comps = worstPatch?.comparators || res.comparators || {}
    const rows = [
      { std: 'SCRATA (A802)', rating: comps['SCRATA (A802)'] || comps['SCRATA (ASTM A802)'] || comps['SCRATA'] || 'N/A' },
      { std: 'GAR C-9', rating: comps['GAR C-9'] || 'N/A' },
      { std: 'ACI SIS-1', rating: comps['ACI SIS'] || comps['ACI SIS-1'] || 'N/A' }
    ]
    rows.forEach(r => {
      const tr = document.createElement('tr')
      tr.innerHTML = `<td>${r.std}</td><td>${r.rating}</td>`
      compTbody.appendChild(tr)
    })
  }

  if (pointCloudViewer) {
    pointCloudViewer.setActivePatch(-1)
    if (!options || !options.keepCamera) {
      pointCloudViewer.setCameraView('iso')
    }
  }

  // Render 3D Part View & Variogram for overview
  updateActiveChart()
  renderVariogram(res)
}

function orientFaceInOverview (index) {
  if (!currentResult || !currentResult.patches || !currentResult.patches[index]) return
  activePatchIndex = -1
  currentViewMode = '3d-object'

  // Update table rows active class without changing results panel
  if (facesTbody) {
    const rows = facesTbody.querySelectorAll('tr')
    rows.forEach(r => {
      r.classList.toggle('active-row', r.getAttribute('data-patch-idx') === String(index))
    })
  }

  // Smoothly turn 3D cube camera to face on the All view
  if (pointCloudViewer) {
    pointCloudViewer.alignToFace(index)
    pointCloudViewer.setActivePatch(-1)
  }
}

function selectFace (index) {
  if (!currentResult || !currentResult.patches || !currentResult.patches[index]) return
  activePatchIndex = index
  const patch = currentResult.patches[index]
  const unit = unitSelect ? unitSelect.value : 'µm'

  // Update pills active class
  if (partNavPills) {
    const pills = partNavPills.querySelectorAll('.part-pill')
    pills.forEach((p, i) => {
      if (p.getAttribute('data-target') === 'overview') {
        p.classList.toggle('active', false)
      } else {
        p.classList.toggle('active', p.getAttribute('data-patch-idx') === String(index))
      }
    })
  }

  // Update table rows active class
  if (facesTbody) {
    const rows = facesTbody.querySelectorAll('tr')
    rows.forEach(r => {
      r.classList.toggle('active-row', r.getAttribute('data-patch-idx') === String(index))
    })
  }

  // Populate Right KPI Card in Face Deep-Dive Mode
  if (kpiCardTitle) kpiCardTitle.innerHTML = `Face ${index + 1} Roughness (S<sub>VR</sub>)`
  if (kpiSvr) kpiSvr.textContent = formatVal(patch.svr_um, unit)

  if (secLabel1) secLabel1.innerHTML = 'Arithmetic Mean (S<sub>a</sub>)'
  if (secVal1) secVal1.textContent = formatVal(patch.sa_um, unit)
  if (secLabel2) secLabel2.innerHTML = 'Root Mean Square (S<sub>q</sub>)'
  if (secVal2) secVal2.textContent = formatVal(patch.sq_um, unit)
  if (secLabel3) secLabel3.innerHTML = 'Face Dimensions'
  if (secVal3) secVal3.textContent = patch.dims_mm ? `${patch.dims_mm[0]} × ${patch.dims_mm[1]} mm` : '-'
  if (secLabel4) secLabel4.innerHTML = 'Surface Area'
  if (secVal4) secVal4.textContent = patch.area_mm2 ? `${patch.area_mm2.toLocaleString()} mm²` : '-'
  if (secLabel5) secLabel5.innerHTML = 'Face Points'
  if (secVal5) secVal5.textContent = `${(patch.point_count || patch.processed_points || 0).toLocaleString()} pts`

  // Update Compact Comparators Table for this Face
  const compTbody = document.getElementById('comparator-tbody')
  if (compTbody) {
    compTbody.innerHTML = ''
    const comps = patch.comparators || {}
    const rows = [
      { std: 'SCRATA (A802)', rating: comps['SCRATA (A802)'] || comps['SCRATA (ASTM A802)'] || comps['SCRATA'] || 'N/A' },
      { std: 'GAR C-9', rating: comps['GAR C-9'] || 'N/A' },
      { std: 'ACI SIS-1', rating: comps['ACI SIS'] || comps['ACI SIS-1'] || 'N/A' }
    ]
    rows.forEach(r => {
      const tr = document.createElement('tr')
      tr.innerHTML = `<td>${r.std}</td><td>${r.rating}</td>`
      compTbody.appendChild(tr)
    })
  }

  currentViewMode = '3d-surface'
  if (pointCloudViewer) {
    if (pointCloudViewer.animating) {
      cancelAnimationFrame(pointCloudViewer.animating)
      pointCloudViewer.animating = null
    }
    pointCloudViewer.dampingActive = false
    pointCloudViewer.setActivePatch(index)
  }

  // Render corner 3D shape thumbnail & Variogram FIRST so right KPI card expands to its full height
  renderShapeMiniPreview()
  renderVariogram(patch)

  const kpiCardElem = document.getElementById('kpi-card')
  const chartCardElem = document.querySelector('.chart-card')
  const targetHeight = Math.max(
    580,
    kpiCardElem ? (kpiCardElem.offsetHeight - 16) : 580,
    chartCardElem ? (chartCardElem.offsetHeight - 16) : 580
  )

  const chartContainer = document.getElementById('chart-container')
  const pcCanvas = document.getElementById('pointcloud-canvas')
  const loadingOverlay = document.getElementById('chart-loading-overlay')

  if (chartContainer) {
    chartContainer.style.height = `${targetHeight}px`
    chartContainer.style.display = 'block'
  }
  if (pcCanvas) pcCanvas.style.display = 'none'
  if (loadingOverlay) loadingOverlay.style.display = 'flex'

  // Yield to browser to paint active pill & loading spinner before heavy Plotly render
  requestAnimationFrame(() => {
    setTimeout(() => {
      updateActiveChart()
    }, 16)
  })
}

function renderSingleSurface (res) {
  const unit = unitSelect ? unitSelect.value : 'µm'
  activePatchIndex = 0

  if (partNavBar) partNavBar.style.display = 'none'

  // Single surface / sample scan: hide Faces tab and display Inspection Report
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))
  if (tabBtnFaces) {
    tabBtnFaces.style.display = 'none'
  }
  if (tabBtnRep) {
    tabBtnRep.classList.add('active')
  }
  const tabRepContent = document.getElementById('tab-rep')
  if (tabRepContent) tabRepContent.classList.add('active')

  const patchW = res.patch_width_mm || 0
  const patchH = res.patch_height_mm || 0

  // Render Single Surface Row in breakdown table
  if (facesTbody) {
    facesTbody.innerHTML = ''
    const tr = document.createElement('tr')
    tr.className = 'active-row'
    const scrataRating = res.comparators?.['SCRATA (A802)'] || res.comparators?.['SCRATA (ASTM A802)'] || res.comparators?.['SCRATA'] || 'N/A'
    const dims = `${patchW.toFixed(1)} × ${patchH.toFixed(1)} mm`
    const area = res.patch_area_mm2 ? `${res.patch_area_mm2.toLocaleString()} mm²` : `${(patchW * patchH).toLocaleString()} mm²`
    const pts = (res.processed_points || 0).toLocaleString()

    tr.innerHTML = `
      <td><span class="part-pill-swatch" style="background:var(--text-muted); margin-right:6px; display:inline-block;"></span><strong>${res.effective_name || 'Surface Scan'}</strong></td>
      <td>${dims}</td>
      <td>${area}</td>
      <td><strong>${formatVal(res.svr_um, unit)}</strong></td>
      <td>${scrataRating}</td>
    `
    facesTbody.appendChild(tr)
  }

  // KPI Card
  if (kpiCardTitle) kpiCardTitle.innerHTML = 'Roughness (S<sub>VR</sub>)'
  if (kpiSvr) kpiSvr.textContent = formatVal(res.svr_um, unit)

  if (secLabel1) secLabel1.innerHTML = 'Arithmetic Mean (S<sub>a</sub>)'
  if (secVal1) secVal1.textContent = formatVal(res.sa_um, unit)
  if (secLabel2) secLabel2.innerHTML = 'Root Mean Square (S<sub>q</sub>)'
  if (secVal2) secVal2.textContent = formatVal(res.sq_um, unit)
  if (secLabel3) secLabel3.innerHTML = 'Patch Dimensions'
  if (secVal3) secVal3.textContent = `${patchW.toFixed(1)} × ${patchH.toFixed(1)} mm`
  if (secLabel4) secLabel4.innerHTML = 'Surface Area'
  if (secVal4) secVal4.textContent = res.patch_area_mm2 ? `${res.patch_area_mm2.toLocaleString()} mm²` : `${(patchW * patchH).toLocaleString()} mm²`
  if (secLabel5) secLabel5.innerHTML = 'Active Points'
  if (secVal5) secVal5.textContent = `${(res.processed_points || 0).toLocaleString()} pts`

  // Compact Comparator Table in Results Panel
  const compTbody = document.getElementById('comparator-tbody')
  if (compTbody) {
    compTbody.innerHTML = ''
    const comps = res.comparators || {}
    const rows = [
      { std: 'SCRATA (A802)', rating: comps['SCRATA (A802)'] || comps['SCRATA (ASTM A802)'] || comps['SCRATA'] || 'N/A' },
      { std: 'GAR C-9', rating: comps['GAR C-9'] || 'N/A' },
      { std: 'ACI SIS-1', rating: comps['ACI SIS'] || comps['ACI SIS-1'] || 'N/A' }
    ]
    rows.forEach(r => {
      const tr = document.createElement('tr')
      tr.innerHTML = `<td>${r.std}</td><td>${r.rating}</td>`
      compTbody.appendChild(tr)
    })
  }

  updateActiveChart()
  renderVariogram(res)
}

function updateActiveChart () {
  if (!currentResult) return

  const isOverview = (currentResult.is_3d && activePatchIndex === -1)
  if (isOverview) {
    currentViewMode = '3d-object'
  }

  const target =
    currentResult.is_3d &&
    currentResult.patches &&
    currentResult.patches[activePatchIndex]
      ? currentResult.patches[activePatchIndex]
      : currentResult

  const chartContainer = document.getElementById('chart-container')
  const pcCanvas = document.getElementById('pointcloud-canvas')
  const viewToggleBar = document.getElementById('view-toggle-bar')
  const btnViewTopo = document.getElementById('btn-view-topo')
  const btnView3d = document.getElementById('btn-view-3d')

  // Toggle view-bar buttons when inspecting a face
  if (viewToggleBar) {
    if (currentResult.is_3d && activePatchIndex >= 0) {
      viewToggleBar.style.display = 'inline-flex'
      if (btnViewTopo) btnViewTopo.classList.toggle('active', currentViewMode === '3d-surface')
      if (btnView3d) btnView3d.classList.toggle('active', currentViewMode === '3d-object')
    } else {
      viewToggleBar.style.display = 'none'
    }
  }

  // Show/hide appropriate viewer element and dispatch render
  if (currentViewMode === '3d-object') {
    if (chartContainer) chartContainer.style.display = 'none'
    if (pcCanvas) pcCanvas.style.display = 'block'
    render3DObject(currentResult)
    if (pointCloudViewer) {
      if (activePatchIndex >= 0) {
        pointCloudViewer.setActivePatch(activePatchIndex)
        pointCloudViewer.alignToFace(activePatchIndex)
      } else {
        pointCloudViewer.setActivePatch(-1)
      }
      pointCloudViewer.resize()
    }
  } else {
    const kpiCardElem = document.getElementById('kpi-card')
    const chartCardElem = document.querySelector('.chart-card')
    const targetHeight = Math.max(
      580,
      kpiCardElem ? (kpiCardElem.offsetHeight - 16) : 580,
      chartCardElem ? (chartCardElem.offsetHeight - 16) : 580
    )
    if (chartContainer) {
      chartContainer.style.height = `${targetHeight}px`
      chartContainer.style.display = 'block'
    }
    if (pcCanvas) pcCanvas.style.display = 'none'
    render3DSurface(target)
  }

  // Render corner 3D shape mini-map orientation preview when inspecting a face
  renderShapeMiniPreview()
}

function renderShapeMiniPreview () {
  const previewWidget = document.getElementById('shape-mini-preview')
  const canvas = document.getElementById('mini-preview-canvas')
  if (!previewWidget || !canvas) return

  // Only show when inspecting an individual face in 2D heatmap or 3D surface elevation mode
  if (!currentResult || !currentResult.is_3d || !currentResult.patches || activePatchIndex < 0 || currentViewMode === '3d-object') {
    previewWidget.style.display = 'none'
    return
  }

  previewWidget.style.display = 'block'
  const activeColor = FACE_PALETTE[activePatchIndex % FACE_PALETTE.length] || '#2563eb'

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth || 200
  const h = canvas.clientHeight || 85
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
  }

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  const isDark = getTheme() === 'dark'

  // Calculate overall bounding box of 3D part
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  currentResult.patches.forEach(p => {
    const pts = p.sample_points_3d || []
    pts.forEach(pt => {
      if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0]
      if (pt[1] < minY) minY = pt[1]; if (pt[1] > maxY) maxY = pt[1]
      if (pt[2] < minZ) minZ = pt[2]; if (pt[2] > maxZ) maxZ = pt[2]
    })
  })

  const unassignedPts3d = currentResult.unassigned_points_3d || []
  unassignedPts3d.forEach(pt => {
    if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0]
    if (pt[1] < minY) minY = pt[1]; if (pt[1] > maxY) maxY = pt[1]
    if (pt[2] < minZ) minZ = pt[2]; if (pt[2] > maxZ) maxZ = pt[2]
  })

  if (!isFinite(minX)) {
    ctx.restore()
    return
  }

  const cx = (minX + maxX) * 0.5
  const cy = (minY + maxY) * 0.5
  const cz = (minZ + maxZ) * 0.5
  const maxSpan = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 10)
  const scale = (Math.min(w, h) * 0.75) / maxSpan

  // Static clean isometric projection angles
  const theta = -Math.PI / 4
  const phi = Math.PI / 3.2
  const cosT = Math.cos(theta), sinT = Math.sin(theta)
  const cosP = Math.cos(phi), sinP = Math.sin(phi)

  function projectPoint (pt) {
    const dx = pt[0] - cx
    const dy = pt[1] - cy
    const dz = pt[2] - cz

    const rx = dx * cosT - dy * sinT
    const ry = dx * sinT + dy * cosT
    const pyRot = ry * cosP - dz * sinP
    const pzRot = ry * sinP + dz * cosP

    const screenX = rx * scale + w * 0.5
    const screenY = -pyRot * scale + h * 0.52
    return { x: screenX, y: screenY, depth: pzRot }
  }

  const MAX_MINI_PTS = 300
  function samplePts (arr) {
    if (!arr || arr.length <= MAX_MINI_PTS) return arr || []
    const step = Math.ceil(arr.length / MAX_MINI_PTS)
    const out = []
    for (let i = 0; i < arr.length; i += step) out.push(arr[i])
    return out
  }

  // Collect faces and depth sort
  const faceDrawOrder = []

  const showUnassigned = showUnassignedCheckbox ? showUnassignedCheckbox.checked : true
  if (showUnassigned && unassignedPts3d.length > 0) {
    const sampledU = samplePts(unassignedPts3d)
    const projUnassigned = sampledU.map(projectPoint)
    const avgDepthU = projUnassigned.reduce((acc, pt) => acc + pt.depth, 0) / projUnassigned.length
    faceDrawOrder.push({
      patch: null,
      idx: -1,
      isActive: false,
      points: projUnassigned,
      depth: avgDepthU
    })
  }

  currentResult.patches.forEach((p, idx) => {
    const pts = samplePts(p.sample_points_3d)
    if (pts.length === 0) return
    const projPts = pts.map(projectPoint)
    const avgDepth = projPts.reduce((acc, pt) => acc + pt.depth, 0) / projPts.length
    faceDrawOrder.push({
      patch: p,
      idx: idx,
      isActive: idx === activePatchIndex,
      points: projPts,
      depth: avgDepth
    })
  })

  // Sort back to front (active face drawn on top)
  faceDrawOrder.sort((a, b) => {
    if (a.isActive) return 1
    if (b.isActive) return -1
    return a.depth - b.depth
  })

  faceDrawOrder.forEach(item => {
    const pts = item.points
    if (pts.length === 0) return
    const isAct = item.isActive

    ctx.fillStyle = isAct
      ? activeColor
      : (isDark ? 'rgba(100, 116, 139, 0.40)' : 'rgba(148, 163, 184, 0.50)')

    const radius = isAct ? 1.6 : 1.0
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      ctx.moveTo(p.x + radius, p.y)
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
    }
    ctx.fill()
  })

  ctx.restore()
}

function getOrExtractSurfaceData (target, unit, robust) {
  if (!target) return null
  const svrGrid = (target.grid_svr && Array.isArray(target.grid_svr) && target.grid_svr.length > 0)
    ? target.grid_svr
    : target.grid_z

  if (!svrGrid || !Array.isArray(svrGrid) || svrGrid.length === 0) return null

  let cached = target._extractedSurface
  if (cached && cached.unit === unit && cached.robust === robust) {
    return cached
  }

  const originX = typeof target.origin_x === 'number' ? target.origin_x : 0
  const originY = typeof target.origin_y === 'number' ? target.origin_y : 0
  const pitch = typeof target.pitch_mm === 'number'
    ? target.pitch_mm
    : (typeof target.grid_z_pitch_mm === 'number' ? target.grid_z_pitch_mm : 0.2)

  const numRows = svrGrid.length
  const numCols = svrGrid[0] ? svrGrid[0].length : 0

  const zGrid = (target.grid_z && Array.isArray(target.grid_z) && target.grid_z.length > 0)
    ? target.grid_z
    : svrGrid

  const svrMultiplier = (unit === 'mm') ? 0.001 : (unit === 'in' ? (1.0 / 25400.0) : 1.0)
  const zMultiplier = 0.001 // µm to mm

  const validX = []
  const validY = []
  const validZ = []
  const validIntensity = []
  const invalidX = []
  const invalidY = []
  const invalidZ = []

  let minVal = Infinity, maxVal = -Infinity
  let flatValues = robust ? [] : null

  for (let r = 0; r < numRows; r++) {
    const sRow = svrGrid[r]
    const zRow = zGrid[r]
    const yVal = originY + r * pitch

    for (let c = 0; c < numCols; c++) {
      const zRaw = zRow ? zRow[c] : null
      const sRaw = sRow ? sRow[c] : null
      const xVal = originX + c * pitch

      const hasZ = typeof zRaw === 'number' && !isNaN(zRaw)
      const hasS = typeof sRaw === 'number' && !isNaN(sRaw)

      if (hasZ && hasS) {
        const zMm = zRaw * zMultiplier
        const sConverted = sRaw * svrMultiplier
        validX.push(xVal)
        validY.push(yVal)
        validZ.push(zMm)
        validIntensity.push(sConverted)

        if (sConverted < minVal) minVal = sConverted
        if (sConverted > maxVal) maxVal = sConverted
        if (flatValues) flatValues.push(sConverted)
      } else if (hasZ) {
        invalidX.push(xVal)
        invalidY.push(yVal)
        invalidZ.push(zRaw * zMultiplier)
      }
    }
  }

  if (target.invalid_points_local && Array.isArray(target.invalid_points_local)) {
    target.invalid_points_local.forEach(pt => {
      if (Array.isArray(pt) && pt.length >= 3) {
        invalidX.push(pt[0])
        invalidY.push(pt[1])
        invalidZ.push(pt[2])
      }
    })
  }

  let cmin = isFinite(minVal) ? minVal : 0
  let cmax = isFinite(maxVal) ? maxVal : 1
  if (robust && flatValues && flatValues.length > 20) {
    flatValues.sort((a, b) => a - b)
    cmin = flatValues[Math.floor(flatValues.length * 0.01)]
    cmax = flatValues[Math.floor(flatValues.length * 0.99)]
  }

  const res = { validX, validY, validZ, validIntensity, invalidX, invalidY, invalidZ, cmin, cmax, unit, robust, numRows, numCols, pitch }
  target._extractedSurface = res
  return res
}

function render3DSurface (target) {
  if (!target) return

  const unit = unitSelect ? unitSelect.value : 'µm'
  const robust = robustCheckbox ? robustCheckbox.checked : false
  const palette = paletteSelect ? paletteSelect.value : 'Viridis'

  const extracted = getOrExtractSurfaceData(target, unit, robust)
  if (!extracted) {
    console.warn('render3DSurface: No surface grid available', target)
    return
  }

  const { validX, validY, validZ, validIntensity, invalidX, invalidY, invalidZ, cmin, cmax, numRows, numCols, pitch } = extracted

  const isDark = getTheme() === 'dark'
  const chartBg = isDark ? '#1c1d22' : '#ffffff'
  const chartText = isDark ? '#c7cbd3' : '#0f172a'
  const gridColor = isDark ? '#2e3039' : '#e2e8f0'
  const metricLabel = `S_VR (${unit})`

  const showHeatmap = showHeatmapCheckbox ? showHeatmapCheckbox.checked : true
  const faceColor = FACE_PALETTE[activePatchIndex >= 0 ? (activePatchIndex % FACE_PALETTE.length) : 0] || '#2563eb'

  const trace = {
    type: 'scatter3d',
    mode: 'markers',
    name: target.name || 'Face Points',
    showlegend: false,
    x: validX,
    y: validY,
    z: validZ,
    marker: showHeatmap ? {
      size: pointCloudMarkerSize,
      color: validIntensity,
      colorscale: palette,
      cmin: cmin,
      cmax: cmax,
      cauto: false,
      showscale: true,
      colorbar: {
        title: {
          text: metricLabel,
          side: 'top',
          font: { size: 11, color: chartText }
        },
        len: 0.86,
        thickness: 16,
        x: 1.02,
        xpad: 18,
        tickfont: { size: 10, color: chartText }
      },
      opacity: 1.0
    } : {
      size: pointCloudMarkerSize,
      color: faceColor,
      showscale: false,
      opacity: 1.0
    },
    hovertemplate: showHeatmap
      ? `Surface X: %{x:.2f} mm<br>Surface Y: %{y:.2f} mm<br>Elevation Z: %{z:.3f} mm<br>Local S_VR: %{marker.color:.4f} ${unit}<extra></extra>`
      : `${target.name || 'Face'}<br>Surface X: %{x:.2f} mm<br>Surface Y: %{y:.2f} mm<br>Elevation Z: %{z:.3f} mm<extra></extra>`
  }

  // Collect invalid and peeled edge points belonging specifically to this face
  const showUnassigned = showUnassignedCheckbox ? showUnassignedCheckbox.checked : true

  const xSpan = (numCols > 1 ? (numCols - 1) * pitch : 1)
  const ySpan = (numRows > 1 ? (numRows - 1) * pitch : 1)
  const aspectY = Math.max(0.2, Math.min(5.0, ySpan / Math.max(1e-3, xSpan)))

  const aerialCamera = {
    eye: { x: 0.0, y: 0.0001, z: 2.1 },
    up: { x: 0.0, y: 1.0, z: 0.0 },
    center: { x: 0, y: 0, z: 0 },
    projection: { type: 'orthographic' }
  }

  // Fill card vertically on 1st visit by matching right KPI card
  const kpiCardElem = document.getElementById('kpi-card')
  const chartCardElem = document.querySelector('.chart-card')
  const targetHeight = Math.max(
    580,
    kpiCardElem ? (kpiCardElem.offsetHeight - 16) : 580,
    chartCardElem ? (chartCardElem.offsetHeight - 16) : 580
  )

  const chartContainerElem = document.getElementById('chart-container')
  if (chartContainerElem) {
    chartContainerElem.style.height = `${targetHeight}px`
  }

  const layout = {
    autosize: true,
    height: targetHeight,
    margin: { l: 65, r: 85, t: 30, b: 60 },
    hovermode: 'closest',
    hoverdistance: 3,
    uirevision: (target.name || 'surface') + '_' + currentViewMode,
    scene: {
      xaxis: {
        title: { text: 'Surface X (mm)', font: { size: 12, color: chartText } },
        color: chartText,
        gridcolor: gridColor,
        showbackground: false,
        showline: true,
        linecolor: isDark ? '#4b5563' : '#94a3b8',
        zeroline: false,
        nticks: 6,
        showspikes: false,
        tickfont: { size: 10, color: chartText }
      },
      yaxis: {
        title: { text: 'Surface Y (mm)', font: { size: 12, color: chartText } },
        color: chartText,
        gridcolor: gridColor,
        showbackground: false,
        showline: true,
        linecolor: isDark ? '#4b5563' : '#94a3b8',
        zeroline: false,
        nticks: 6,
        showspikes: false,
        tickfont: { size: 10, color: chartText }
      },
      zaxis: {
        title: { text: '' },
        showticklabels: false,
        showbackground: false,
        showgrid: false,
        showline: false,
        zeroline: false,
        showspikes: false
      },
      aspectmode: 'manual',
      aspectratio: { x: 1, y: aspectY, z: 0.22 },
      camera: aerialCamera
    },
    plot_bgcolor: chartBg,
    paper_bgcolor: chartBg,
    showlegend: false,
    font: {
      family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: chartText
    }
  }

  const config = {
    responsive: true,
    displaylogo: false,
    plotGlPixelRatio: Math.min(1.5, window.devicePixelRatio || 1),
    scrollZoom: true,
    doubleClick: false,
    modeBarButtonsToAdd: [
      {
        name: 'Reset to Aerial (Top-Down) View',
        icon: Plotly.Icons.home,
        click: function (gd) {
          Plotly.relayout(gd, {
            'scene.camera': {
              eye: { x: 0.0, y: 0.0001, z: 2.1 },
              up: { x: 0.0, y: 1.0, z: 0.0 },
              center: { x: 0, y: 0, z: 0 },
              projection: { type: 'orthographic' }
            },
            'scene.zaxis.title.text': '',
            'scene.zaxis.showticklabels': false,
            'scene.zaxis.showgrid': false,
            'scene.zaxis.showline': false
          })
        }
      },
      {
        name: '3D Isometric Perspective',
        icon: Plotly.Icons.camera,
        click: function (gd) {
          Plotly.relayout(gd, {
            'scene.camera': {
              eye: { x: 1.25, y: -1.35, z: 1.15 },
              up: { x: 0.0, y: 0.0, z: 1.0 },
              center: { x: 0, y: 0, z: 0 },
              projection: { type: 'perspective' }
            },
            'scene.zaxis.title.text': 'Elevation Z (mm)',
            'scene.zaxis.showticklabels': true,
            'scene.zaxis.showgrid': true,
            'scene.zaxis.showline': true,
            'scene.zaxis.linecolor': isDark ? '#4b5563' : '#94a3b8',
            'scene.zaxis.gridcolor': gridColor
          })
        }
      }
    ],
    modeBarButtonsToRemove: ['resetCameraDefault3d', 'resetCameraLastSave3d']
  }

  const traces = [trace]
  if (showUnassigned && invalidX.length > 0) {
    traces.push({
      type: 'scatter3d',
      mode: 'markers',
      name: 'Unprocessed / Edge Points',
      showlegend: false,
      x: invalidX,
      y: invalidY,
      z: invalidZ,
      marker: {
        size: pointCloudMarkerSize,
        color: isDark ? '#64748b' : '#94a3b8',
        opacity: 0.75
      },
      hoverinfo: 'none'
    })
  }

  Plotly.react('chart-container', traces, layout, config).then(() => {
    Plotly.Plots.resize('chart-container')
    const overlay = document.getElementById('chart-loading-overlay')
    if (overlay) overlay.style.display = 'none'
  })
}

function initPointCloudViewer () {
  const canvas = document.getElementById('pointcloud-canvas')
  if (canvas && window.PointCloudViewer && !pointCloudViewer) {
    pointCloudViewer = new window.PointCloudViewer(canvas, {
      onFaceClick: faceIdx => {
        if (currentResult && currentResult.patches && currentResult.patches[faceIdx]) {
          selectFace(faceIdx)
        }
      }
    })
  }
}

function render3DObject (res) {
  if (!res) return
  initPointCloudViewer()
  if (!pointCloudViewer) return

  if (lastLoadedResult !== res) {
    pointCloudViewer.setData(res)
    lastLoadedResult = res
  }
  pointCloudViewer.setActivePatch(activePatchIndex)
  pointCloudViewer.setPointSize(pointCloudMarkerSize)
  pointCloudViewer.setShowUnassigned(showUnassignedCheckbox ? showUnassignedCheckbox.checked : true)
  if (pointCloudViewer.setShowHeatmap) {
    pointCloudViewer.setShowHeatmap(showHeatmapCheckbox ? showHeatmapCheckbox.checked : true)
  }
  pointCloudViewer.setTheme(getTheme() === 'dark')
  if (pointCloudViewer.setPalette && paletteSelect) {
    pointCloudViewer.setPalette(paletteSelect.value)
  }
  pointCloudViewer.render()
}

if (showHeatmapCheckbox) {
  showHeatmapCheckbox.addEventListener('change', () => {
    const show = showHeatmapCheckbox.checked
    if (pointCloudViewer && pointCloudViewer.setShowHeatmap) {
      pointCloudViewer.setShowHeatmap(show)
    }
    if (currentResult && currentViewMode !== '3d-object') {
      updateActiveChart()
    }
  })
}

if (showUnassignedCheckbox) {
  showUnassignedCheckbox.addEventListener('change', () => {
    const show = showUnassignedCheckbox.checked
    if (pointCloudViewer) {
      pointCloudViewer.setShowUnassigned(show)
    }
    if (currentResult && currentViewMode !== '3d-object') {
      updateActiveChart()
    }
    renderShapeMiniPreview()
  })
}

function updatePointCloudMarkerSizes () {
  if (pointCloudViewer && currentViewMode === '3d-object') {
    pointCloudViewer.setPointSize(pointCloudMarkerSize)
  }
}


function renderHeatmap (res) {
  if (
    !res ||
    !res.grid_svr ||
    !Array.isArray(res.grid_svr) ||
    res.grid_svr.length === 0
  ) {
    console.warn('renderHeatmap: No grid_svr data provided in results', res)
    return
  }
  const unit = unitSelect ? unitSelect.value : 'µm'
  const grid = res.grid_svr
  const robust = robustCheckbox ? robustCheckbox.checked : false
  const palette = paletteSelect ? paletteSelect.value : 'Viridis'

  const originX = typeof res.origin_x === 'number' ? res.origin_x : 0
  const originY = typeof res.origin_y === 'number' ? res.origin_y : 0
  const pitch = typeof res.pitch_mm === 'number' ? res.pitch_mm : 0.2

  // Flatten and filter for percentiles
  let flat = []
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      let v = grid[r][c]
      if (typeof v === 'number' && !isNaN(v)) {
        if (unit === 'mm') v /= 1000.0
        else if (unit === 'in') v /= 25400.0
        flat.push(v)
      }
    }
  }
  flat.sort((a, b) => a - b)

  let zmin = flat.length > 0 ? flat[0] : 0
  let zmax = flat.length > 0 ? flat[flat.length - 1] : 1
  if (robust && flat.length > 20) {
    zmin = flat[Math.floor(flat.length * 0.01)]
    zmax = flat[Math.floor(flat.length * 0.99)]
  }

  // Convert grid units
  const zData = grid.map(row =>
    row.map(v => {
      if (typeof v !== 'number' || isNaN(v)) return null
      if (unit === 'mm') return v / 1000.0
      if (unit === 'in') return v / 25400.0
      return v
    })
  )

  const numCols = res.grid_width || (grid[0] ? grid[0].length : 0)
  const numRows = res.grid_height || grid.length

  const xCoords = []
  for (let c = 0; c < numCols; c++) xCoords.push(originX + c * pitch)
  const yCoords = []
  for (let r = 0; r < numRows; r++) yCoords.push(originY + r * pitch)

  const isDark = getTheme() === 'dark'
  const chartBg = isDark ? '#1c1d22' : '#ffffff'
  const chartText = isDark ? '#c7cbd3' : '#0f172a'
  const tickColor = isDark ? '#8e94a0' : '#475569'

  const showHeatmap = showHeatmapCheckbox ? showHeatmapCheckbox.checked : true
  const faceColor = FACE_PALETTE[activePatchIndex >= 0 ? (activePatchIndex % FACE_PALETTE.length) : 0]

  const trace = {
    z: zData,
    x: xCoords,
    y: yCoords,
    type: 'heatmap',
    colorscale: showHeatmap ? palette : [[0, faceColor], [1, faceColor]],
    zmin: zmin,
    zmax: zmax,
    zsmooth: false,
    showscale: showHeatmap,
    colorbar: showHeatmap ? {
      title: {
        text: `S_VR (${unit})`,
        side: 'top',
        font: { size: 11, color: chartText }
      },
      len: 0.86,
      thickness: 16,
      x: 1.02,
      xpad: 18,
      tickfont: { size: 10, color: chartText }
    } : undefined,
    hovertemplate: showHeatmap
      ? `Surface X: %{x:.2f} mm<br>Surface Y: %{y:.2f} mm<br>Local S_VR: %{z:.4f} ${unit}<extra></extra>`
      : `Surface X: %{x:.2f} mm<br>Surface Y: %{y:.2f} mm<extra></extra>`
  }

  const unassignedGrey = isDark ? '#334155' : '#cbd5e1'
  const minX = (xCoords[0] || 0) - pitch * 0.5
  const maxX = (xCoords[xCoords.length - 1] || 0) + pitch * 0.5
  const minY = (yCoords[0] || 0) - pitch * 0.5
  const maxY = (yCoords[yCoords.length - 1] || 0) + pitch * 0.5

  const layout = {
    autosize: true,
    margin: { l: 65, r: 85, t: 30, b: 60 },
    shapes: [
      {
        type: 'rect',
        xref: 'x',
        yref: 'y',
        x0: minX,
        y0: minY,
        x1: maxX,
        y1: maxY,
        fillcolor: unassignedGrey,
        line: { width: 0 },
        layer: 'below'
      }
    ],
    xaxis: {
      title: { text: 'Surface X (mm)', standoff: 15, font: { size: 12, color: chartText } },
      showgrid: false,
      color: chartText,
      tickcolor: tickColor,
      tickfont: { size: 10, color: chartText },
      nticks: 8
    },
    yaxis: {
      title: { text: 'Surface Y (mm)', standoff: 15, font: { size: 12, color: chartText } },
      showgrid: false,
      scaleanchor: 'x',
      scaleratio: 1,
      color: chartText,
      tickcolor: tickColor,
      tickfont: { size: 10, color: chartText },
      nticks: 8
    },
    plot_bgcolor: chartBg,
    paper_bgcolor: chartBg,
    font: {
      family:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: chartText
    }
  }

  Plotly.react('chart-container', [trace], layout, {
    responsive: true,
    displaylogo: false
  })
}

function renderVariogram (target) {
  const isDark = getTheme() === 'dark'
  const chartBg = isDark ? '#1d2026' : '#ffffff'
  const chartText = isDark ? '#c7cbd3' : '#0f172a'
  const chartGrid = isDark ? '#282c35' : '#e2e8f0'
  const tickColor = isDark ? '#8e94a0' : '#475569'
  const unit = unitSelect ? unitSelect.value : 'µm'
  const varSectionTitle = document.getElementById('var-section-title')
  const varChartElem = document.getElementById('variogram-chart')

  // The variogram is turned off for Part Overview mode
  if (!currentResult || (currentResult.is_3d && activePatchIndex === -1)) {
    if (varSectionTitle) varSectionTitle.style.display = 'none'
    if (varChartElem) varChartElem.style.display = 'none'
    return
  }

  if (varSectionTitle) varSectionTitle.style.display = 'block'
  if (varChartElem) varChartElem.style.display = 'block'

  // Determine active single data source for variogram
  let activePatch = target
  let patchColor = isDark ? '#d93848' : '#a6192e'
  if (target && target.name && currentResult?.is_3d) {
    const faceIdx = activePatchIndex >= 0 ? activePatchIndex : 0
    patchColor = FACE_PALETTE[faceIdx % FACE_PALETTE.length]
  }

  if (varSectionTitle) {
    varSectionTitle.innerHTML = 'Autocorrelation Variogram &gamma;(h)'
  }

  const bins = activePatch ? (activePatch.var_bins || activePatch.variogram_bins || []) : []
  if (!bins || bins.length === 0) {
    console.warn('renderVariogram: No var_bins data provided', activePatch)
    return
  }

  const distances = bins.map((_, i) => i * 0.5 + 0.25)
  const binVals = bins.map(v => {
    if (unit === 'mm') return v / 1000.0
    if (unit === 'in') return v / 25400.0
    return v
  })

  const trace = {
    x: distances,
    y: binVals,
    name: activePatch.name || 'Variogram',
    mode: 'lines+markers',
    marker: { size: 4, color: patchColor },
    line: { width: 1.8, color: patchColor },
    hovertemplate: `d: %{x:.2f} mm<br>v(d): %{y:.3f} ${unit}<extra></extra>`
  }

  const layout = {
    height: 155,
    margin: { l: 45, r: 12, t: 8, b: 30 },
    showlegend: false,
    xaxis: {
      title: { text: 'Bucket d (mm)', font: { size: 9, color: chartText } },
      range: [0.0, 5.0],
      dtick: 1.0,
      tickvals: [0, 1, 2, 3, 4, 5],
      ticktext: ['0', '1', '2', '3', '4', '5'],
      tickfont: { size: 8, color: chartText },
      showgrid: true,
      gridcolor: chartGrid,
      color: chartText,
      tickcolor: tickColor
    },
    yaxis: {
      title: { text: `v(d) (${unit})`, font: { size: 9, color: chartText } },
      rangemode: 'tozero',
      tickfont: { size: 8, color: chartText },
      showgrid: true,
      gridcolor: chartGrid,
      color: chartText,
      tickcolor: tickColor
    },
    plot_bgcolor: chartBg,
    paper_bgcolor: chartBg,
    font: {
      family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: chartText,
      size: 9
    }
  }

  Plotly.react('variogram-chart', [trace], layout, {
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

// Mini-map static thumbnail click: links back to 3D scan view
const shapeMiniPreviewElem = document.getElementById('shape-mini-preview')
const miniPreviewCanvas = document.getElementById('mini-preview-canvas')

function handleMiniPreviewClick (e) {
  if (e) {
    if (e.preventDefault) e.preventDefault()
    if (e.stopPropagation) e.stopPropagation()
  }
  if (!currentResult || !currentResult.patches) return
  const faceIdx = activePatchIndex >= 0 ? activePatchIndex : 0

  selectOverview({ keepCamera: true })
  if (pointCloudViewer) {
    pointCloudViewer.setActivePatch(-1)
    pointCloudViewer.alignToFace(faceIdx)
  }
}

if (shapeMiniPreviewElem) {
  shapeMiniPreviewElem.addEventListener('click', handleMiniPreviewClick)
}
if (miniPreviewCanvas) {
  miniPreviewCanvas.addEventListener('click', handleMiniPreviewClick)
}

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
  if (pointCloudViewer && pointCloudViewer.setPalette) {
    pointCloudViewer.setPalette(paletteSelect.value)
  }
  if (currentResult) {
    updateActiveChart()
  }
})
robustCheckbox.addEventListener('change', () => {
  if (currentResult) {
    updateActiveChart()
  }
})

// Point size slider (.25 - .5 - 1.0)
const POINT_SIZES = [0.25, 0.5, 1.0]
let currentDiscreteIdx = 1
let plotlyRestyleInProgress = false
let pendingPlotlySize = null

function updatePlotlyPointSize (sz) {
  pendingPlotlySize = sz
  if (plotlyRestyleInProgress) return
  plotlyRestyleInProgress = true

  requestAnimationFrame(() => {
    const targetSz = pendingPlotlySize
    pendingPlotlySize = null
    const chartContainerElem = document.getElementById('chart-container')
    if (chartContainerElem && chartContainerElem.data && chartContainerElem.data.length > 0) {
      const traceIndices = chartContainerElem.data.length > 1 ? [0, 1] : [0]
      Plotly.restyle('chart-container', { 'marker.size': targetSz }, traceIndices)
        .catch(() => {})
        .finally(() => {
          plotlyRestyleInProgress = false
          if (pendingPlotlySize !== null && pendingPlotlySize !== targetSz) {
            updatePlotlyPointSize(pendingPlotlySize)
          }
        })
    } else {
      plotlyRestyleInProgress = false
    }
  })
}

function setDiscretePointSize (idx, force = false) {
  const clampedIdx = Math.max(0, Math.min(2, idx))
  if (!force && clampedIdx === currentDiscreteIdx && pointSizeSlider && parseInt(pointSizeSlider.value, 10) === clampedIdx) {
    return
  }
  currentDiscreteIdx = clampedIdx

  if (pointSizeSlider && parseInt(pointSizeSlider.value, 10) !== clampedIdx) {
    pointSizeSlider.value = clampedIdx
  }
  const sz = POINT_SIZES[clampedIdx] !== undefined ? POINT_SIZES[clampedIdx] : 0.5
  pointCloudMarkerSize = sz
  if (pointSizeVal) {
    pointSizeVal.textContent = sz
  }
  document.querySelectorAll('.point-size-stop').forEach(s => {
    s.classList.toggle('active', s.getAttribute('data-idx') === String(clampedIdx))
  })

  // 1. Instant synchronous render on WebGL PointCloudViewer (All view / Cube)
  if (pointCloudViewer) {
    pointCloudViewer.setPointSize(sz)
  }

  // 2. Non-blocking, frame-throttled update on Plotly 3D Topography
  if (currentViewMode === '3d-surface') {
    updatePlotlyPointSize(sz)
  }
}

if (pointSizeSlider) {
  pointSizeSlider.addEventListener('input', () => {
    const idx = parseInt(pointSizeSlider.value, 10)
    setDiscretePointSize(idx)
  })
}

// Click anywhere on wrapper or track to jump directly to stop
const pointSizeWrapper = document.querySelector('.point-size-slider-wrapper')
if (pointSizeWrapper) {
  pointSizeWrapper.addEventListener('click', e => {
    if (e.target === pointSizeSlider) return
    const rect = pointSizeWrapper.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const idx = Math.round(ratio * 2)
    setDiscretePointSize(idx)
  })
}

// Click directly on .25, .5, 1.0 text labels
document.querySelectorAll('.point-size-stop').forEach(stopEl => {
  stopEl.addEventListener('click', e => {
    e.preventDefault()
    e.stopPropagation()
    const idx = parseInt(stopEl.getAttribute('data-idx'), 10)
    setDiscretePointSize(idx)
  })
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
    const targetContent = document.getElementById(btn.dataset.tab)
    if (targetContent) targetContent.classList.add('active')
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

// Example SCRATA Samples Loader
async function loadSampleScan (fileName) {
  try {
    const sampleSelect = document.getElementById('sample-select')
    if (sampleSelect) {
      sampleSelect.value = fileName
    }
    document.querySelectorAll('.sample-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-sample') === fileName)
    })

    if (completeTimeout) {
      clearTimeout(completeTimeout)
      completeTimeout = null
    }
    currentPercent = 10
    targetPercent = 25
    if (progressBar) progressBar.style.display = 'block'
    if (progressFill) progressFill.style.width = '10%'
    setProgress(20, `Fetching sample ${fileName}...`)
    if (statusDot) statusDot.className = 'status-dot analyzing'

    if (resultsContainer && resultsContainer.style.display !== 'none') {
      resultsContainer.style.opacity = '0.45'
      resultsContainer.style.pointerEvents = 'none'
    }

    const response = await fetch(`samples/${fileName}`)
    if (!response.ok) {
      throw new Error(`Failed to load ${fileName} (HTTP ${response.status})`)
    }

    setProgress(35, `Reading ${fileName}...`)
    const blob = await response.blob()
    const file = new File([blob], fileName, { type: 'application/octet-stream' })
    file.isSampleScan = true

    handleFileSelect(file)
  } catch (err) {
    const sampleSelect = document.getElementById('sample-select')
    if (sampleSelect) {
      sampleSelect.selectedIndex = 0
      sampleSelect.value = ''
    }
    resetProgress()
    if (statusDot) statusDot.className = 'status-dot ready'
    if (statusText) statusText.textContent = `Error: ${err.message}`
    console.error('Error loading sample:', err)
  }
}

// Attach listener to sample dropdown selector
const sampleSelectElem = document.getElementById('sample-select')
if (sampleSelectElem) {
  sampleSelectElem.addEventListener('change', e => {
    const sample = e.target.value
    if (sample) loadSampleScan(sample)
  })
}

// Attach listeners to any trigger buttons with data-sample attribute
document.querySelectorAll('[data-sample]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.preventDefault()
    const sample = btn.getAttribute('data-sample')
    if (sample) loadSampleScan(sample)
  })
})

// Initialize on page load
initTheme()
initWorker()
if (sampleSelectElem) {
  sampleSelectElem.selectedIndex = 0
  sampleSelectElem.value = ''
}
window.addEventListener('pageshow', () => {
  if (sampleSelectElem && !selectedFile) {
    sampleSelectElem.selectedIndex = 0
    sampleSelectElem.value = ''
  }
})

window.addEventListener('resize', () => {
  const chartContainer = document.getElementById('chart-container')
  if (chartContainer && (currentViewMode === '2d' || currentViewMode === '3d-surface')) {
    Plotly.Plots.resize(chartContainer)
  }
  const varChart = document.getElementById('variogram-chart')
  if (varChart) {
    Plotly.Plots.resize(varChart)
  }
})

// Continuously keep chart container filled vertically to match KPI card
if (window.ResizeObserver) {
  const kpiEl = document.getElementById('kpi-card')
  const chartCont = document.getElementById('chart-container')
  if (kpiEl && chartCont) {
    let resizeTimer = null
    const ro = new ResizeObserver(() => {
      if (currentViewMode !== '3d-object' && chartCont.style.display !== 'none') {
        const kpiH = kpiEl.offsetHeight
        if (kpiH > 200) {
          const targetH = Math.max(580, kpiH - 16)
          if (Math.abs(chartCont.offsetHeight - targetH) > 6) {
            chartCont.style.height = `${targetH}px`
            clearTimeout(resizeTimer)
            resizeTimer = setTimeout(() => {
              if (window.Plotly && chartCont.data) {
                Plotly.relayout(chartCont, { height: targetH })
              }
            }, 30)
          }
        }
      }
    })
    ro.observe(kpiEl)
  }
}
