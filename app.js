// Svr Surface Roughness Metrology Dashboard Controller
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
let currentViewMode = '3d-object' // '3d-object' | '3d-surface'
let targetedFaceIndex = -1
let cameraMovedSinceTarget = false
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

function updateOpenScanButton (fileName, ptsStr) {
  const openScanBtn = document.getElementById('open-scan-btn')
  if (!openScanBtn) return
  if (fileName) {
    openScanBtn.classList.add('occupied')
    openScanBtn.title = `Currently loaded: ${fileName}${ptsStr ? ` (${ptsStr})` : ''}. Click to open a different scan.`
    openScanBtn.innerHTML = `
      <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="scan-btn-filename">${fileName}</span>
      <span class="scan-btn-pts">${ptsStr ? `• ${ptsStr}` : ''}</span>
    `
  } else {
    openScanBtn.classList.remove('occupied')
    openScanBtn.title = 'Open 3D optical scan file (.ply, .pcd, .stl, .csv)'
    openScanBtn.innerHTML = `
      <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <span id="open-scan-text">Open Scan</span>
    `
  }
}

function setProcessingUploadVisibility (isProcessing, fileName) {
  const openScanBtn = document.getElementById('open-scan-btn')
  const emptyStateEl = document.getElementById('empty-state')
  const loadingOverlay = document.getElementById('chart-loading-overlay')
  const loadingText = document.getElementById('chart-loading-text')
  const fileInputEl = document.getElementById('file-input')
  const benchmarksBtn = document.getElementById('benchmarks-btn')
  const benchmarksPopover = document.getElementById('benchmarks-popover')

  const exportBtnEl = document.getElementById('export-btn')
  const exportPopoverEl = document.getElementById('export-popover')
  const downloadBtnEl = document.getElementById('download-report-btn')

  if (isProcessing) {
    if (openScanBtn) openScanBtn.style.display = 'none'
    if (emptyStateEl) emptyStateEl.style.display = 'none'
    if (fileInputEl) fileInputEl.disabled = true
    if (benchmarksBtn) {
      benchmarksBtn.disabled = true
      benchmarksBtn.style.opacity = '0.35'
      benchmarksBtn.style.pointerEvents = 'none'
    }
    if (benchmarksPopover) benchmarksPopover.style.display = 'none'
    if (exportBtnEl) {
      exportBtnEl.disabled = true
      exportBtnEl.classList.remove('active')
    }
    if (exportPopoverEl) exportPopoverEl.style.display = 'none'
    if (downloadBtnEl) downloadBtnEl.disabled = true
    if (loadingOverlay) loadingOverlay.style.display = 'flex'
    if (loadingText) loadingText.textContent = fileName ? `Processing ${fileName}...` : 'Computing Metrology Surface...'
  } else {
    if (openScanBtn) openScanBtn.style.display = 'inline-flex'
    if (fileInputEl) fileInputEl.disabled = false
    if (benchmarksBtn) {
      benchmarksBtn.disabled = false
      benchmarksBtn.style.opacity = ''
      benchmarksBtn.style.pointerEvents = ''
    }
    if (exportBtnEl) {
      exportBtnEl.disabled = !currentResult
    }
    if (downloadBtnEl) {
      downloadBtnEl.disabled = !currentResult
    }
    if (loadingOverlay) loadingOverlay.style.display = 'none'
    if (!currentResult && emptyStateEl) {
      emptyStateEl.style.display = 'flex'
    }
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
const errorBanner = document.getElementById('error-banner')
const errorBannerBadge = document.getElementById('error-banner-badge')
const errorBannerLabel = document.getElementById('error-banner-label')
const errorBannerMessage = document.getElementById('error-banner-message')
const errorBannerActions = document.getElementById('error-banner-actions')
const errorActionBtn = document.getElementById('error-action-btn')
const errorBannerClose = document.getElementById('error-banner-close')

function hideErrorBanner () {
  if (errorBanner) errorBanner.style.display = 'none'
}

if (errorBannerClose) {
  errorBannerClose.addEventListener('click', hideErrorBanner)
}

function showErrorBanner (badgeText, labelText, message, suggestedPitch) {
  if (!errorBanner) return
  if (errorBannerBadge) errorBannerBadge.textContent = badgeText || 'NOTICE'
  if (errorBannerLabel) errorBannerLabel.textContent = labelText || 'Status:'
  if (errorBannerMessage) errorBannerMessage.textContent = message || ''

  if (suggestedPitch && errorBannerActions && errorActionBtn) {
    errorBannerActions.style.display = 'flex'
    errorActionBtn.textContent = `Set Δx = ${suggestedPitch} mm & Retry`
    errorActionBtn.onclick = () => {
      hideErrorBanner()
      if (gridPitchInput) {
        gridPitchInput.value = suggestedPitch.toString()
      }
      const panel = document.getElementById('standards-panel')
      if (panel) panel.open = true
      if (selectedFile) {
        startAnalysis(selectedFile)
      }
    }
  } else if (errorBannerActions) {
    errorBannerActions.style.display = 'none'
  }
  errorBanner.style.display = 'flex'
}

let workerRuntimeReady = false

function initWorker () {
  const workerUrl = 'worker.js' + (window.location.search ? window.location.search + '&t=' : '?t=') + Date.now()
  worker = new Worker(workerUrl)

  worker.onmessage = function (e) {
    const { type, text, percent, data, error, analysisId, mode, suggestedPitch, isDensitySparsity } = e.data

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
      setProcessingUploadVisibility(false)
      if (statusDot) statusDot.className = 'status-dot ready'
      completeProgress('Ready')
      hideErrorBanner()
      currentResult = data
      renderResults(data)
    } else if (type === 'error') {
      isAnalyzing = false
      setProcessingUploadVisibility(false)
      if (statusDot) statusDot.className = 'status-dot error'
      resetProgress()
      if (resultsContainer) {
        resultsContainer.style.opacity = '1'
        resultsContainer.style.pointerEvents = 'auto'
      }
      const inspectorEl = document.getElementById('kpi-card')
      if (inspectorEl) {
        inspectorEl.style.opacity = '1'
        inspectorEl.style.pointerEvents = 'auto'
      }

      let cleanMsg = (error || '').replace(/^ValueError:\s*/i, '').replace(/^RuntimeError:\s*/i, '').trim()
      let sugg = suggestedPitch
      if (!sugg) {
        const m = cleanMsg.match(/--grid-mm\s+([0-9]+(?:\.[0-9]+)?)/)
        if (m) {
          try { sugg = parseFloat(m[1]) } catch (_) {}
        }
      }
      const isDensity = isDensitySparsity || cleanMsg.includes('contiguous surface area') || cleanMsg.includes('point spacing') || cleanMsg.includes('coarser than')

      if (isDensity) {
        const pitchVal = gridPitchInput ? gridPitchInput.value : '0.20'
        if (statusText) statusText.textContent = `Scan too sparse for ${pitchVal} mm grid (suggested: ${sugg || 'coarser'} mm)`
        let briefMsg = cleanMsg
        const mSpacing = cleanMsg.match(/spacing for this scan is ~([0-9.]+ mm(?: \([^)]+\))?)/)
        if (mSpacing) {
          briefMsg = `Scan point spacing is ~${mSpacing[1]}, too coarse for requested ${pitchVal} mm pitch.`
        }
        showErrorBanner('SPARSITY', 'Grid Pitch:', briefMsg, sugg)
      } else {
        if (statusText) statusText.textContent = 'Error: ' + cleanMsg
        showErrorBanner('ERROR', 'Engine:', cleanMsg, null)
      }
      console.error('Analysis error:', error)
    }
  }

  worker.onerror = function (err) {
    console.error('Worker error:', err)
    isAnalyzing = false
    setProcessingUploadVisibility(false)
    if (statusDot) statusDot.className = 'status-dot ready'
    resetProgress()
    if (statusText) statusText.textContent = `Worker Error: ${err.message || 'Script execution failed'}`
  }
}

function handleFileSelect (file) {
  if (!file || isAnalyzing) return
  selectedFile = file
  activePatchIndex = 0

  // Hide upload option while processing
  setProcessingUploadVisibility(true, file.name)

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

  // Update Dropzone filename and size
  updateDropzoneFileDisplay(file)

  // If previous results are displayed, subtly dim them to indicate active recalculation
  if (resultsContainer && resultsContainer.style.display !== 'none') {
    resultsContainer.style.opacity = '0.45'
    resultsContainer.style.pointerEvents = 'none'
  }
  const inspectorEl = document.getElementById('kpi-card')
  if (inspectorEl && inspectorEl.style.display !== 'none') {
    inspectorEl.style.opacity = '0.45'
    inspectorEl.style.pointerEvents = 'none'
  }

  resetProgress()
  hideErrorBanner()
  setProgress(2, `Loading ${file.name}...`)

  startAnalysis(file)
}

async function startAnalysis (file) {
  hideErrorBanner()
  isAnalyzing = true
  setProcessingUploadVisibility(true, file.name)
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

function formatValNum (valUm, unit) {
  if (typeof valUm !== 'number' || isNaN(valUm)) return '-'
  if (unit === 'mm') return (valUm / 1000.0).toFixed(3)
  if (unit === 'in') return (valUm / 25400.0).toFixed(4)
  return valUm.toFixed(1)
}

function formatVal (valUm, unit) {
  if (typeof valUm !== 'number' || isNaN(valUm)) return '-'
  const u = unit || 'µm'
  return `${formatValNum(valUm, unit)} ${u}`
}

function renderResults (res) {
  currentResult = res
  if (emptyState) emptyState.style.display = 'none'
  if (resultsContainer) {
    resultsContainer.style.display = 'block'
    resultsContainer.style.opacity = '1'
    resultsContainer.style.pointerEvents = 'auto'
  }

  const inspectorEl = document.getElementById('kpi-card')
  if (inspectorEl) {
    inspectorEl.style.display = 'flex'
    inspectorEl.style.opacity = '1'
    inspectorEl.style.pointerEvents = 'auto'
  }
  const hudEl = document.getElementById('viewport-hud')
  if (hudEl) hudEl.style.display = 'flex'
  const dockEl = document.getElementById('bottom-dock')
  if (dockEl) dockEl.style.display = 'flex'
  const exportBtnEl = document.getElementById('export-btn')
  if (exportBtnEl) exportBtnEl.disabled = false

  const fileName = res.effective_name || (selectedFile ? selectedFile.name : 'scan')
  const totalPoints = res.total_points || res.processed_points || 0

  updateOpenScanButton(fileName, `${totalPoints.toLocaleString()} pts`)

  const unitTag = document.getElementById('verdict-unit-tag')
  if (unitTag && unitSelect) {
    unitTag.textContent = unitSelect.value || 'µm'
  }

  updateDropzoneFileDisplay(
    selectedFile,
    `${totalPoints.toLocaleString()} pts`
  )

  // Report text
  if (reportPre) reportPre.textContent = res.report_text || ''

  if (res.is_3d && res.patches && res.patches.length > 1) {
    render3DFaces(res)
  } else {
    renderSingleSurface(res)
  }
}

function render3DFaces (res) {
  const unit = unitSelect ? unitSelect.value : 'µm'
  const dockEl = document.getElementById('bottom-dock')
  if (dockEl) {
    dockEl.classList.add('expanded')
  }
  const patchCount = res.patches ? res.patches.length : 0
  if (tabBtnFaces) {
    tabBtnFaces.style.display = 'inline-block'
    tabBtnFaces.textContent = `Faces (${patchCount})`
  }
  if (tabBtnRep) {
    tabBtnRep.textContent = 'Metrology Report'
  }

  // Ensure Faces tab is active
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))
  if (tabBtnFaces) {
    tabBtnFaces.classList.add('active')
    tabBtnFaces.style.display = 'inline-block'
    tabBtnFaces.textContent = `Faces (${patchCount})`
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

  // Render Table in tab-faces with rows (Individual Faces)
  if (facesTbody) {
    facesTbody.innerHTML = ''

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
        <td style="text-align: right;">
          <button type="button" class="row-inspect-btn face-inspect-btn" data-patch-idx="${idx}" title="Inspect ${patch.name} Topography" aria-label="Inspect ${patch.name}">
            <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
        </td>
      `
      const inspectBtn = tr.querySelector('.face-inspect-btn')
      if (inspectBtn) {
        inspectBtn.addEventListener('click', e => {
          e.stopPropagation()
          selectFace(idx)
        })
      }

      tr.addEventListener('click', () => {
        handleTableRowClick(idx)
      })
      facesTbody.appendChild(tr)
    })
  }

  // Start in Part Overview with 3D point cloud scan visible first
  currentViewMode = '3d-object'
  targetedFaceIndex = -1
  cameraMovedSinceTarget = false
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

function updateTableRowHighlight (index) {
  if (!facesTbody) return
  const rows = facesTbody.querySelectorAll('tr')
  rows.forEach(r => {
    r.classList.toggle('active-row', index >= 0 && r.getAttribute('data-patch-idx') === String(index))
  })
}

function handleTableRowClick (idx) {
  if (!currentResult) return

  const isMultiFace = Boolean(currentResult.is_3d && currentResult.patches && currentResult.patches.length > 1)
  if (!isMultiFace) {
    activePatchIndex = 0
    currentViewMode = '3d-surface'
    updateActiveChart()
    return
  }

  // Row -1: Whole Part / Overview row
  if (idx === -1) {
    selectOverview()
    targetedFaceIndex = -1
    cameraMovedSinceTarget = false
    if (pointCloudViewer) {
      pointCloudViewer.setCameraView('iso')
    }
    return
  }

  if (!currentResult.patches || !currentResult.patches[idx]) return

  // Clicking a row ALWAYS shows all with the shape oriented to that face!
  orientFaceInOverview(idx)
}

function selectOverview (options = {}) {
  if (!currentResult) return
  activePatchIndex = -1
  currentViewMode = '3d-object' // Whole part is ALWAYS 3D Model!
  if (!options || !options.keepTarget) {
    targetedFaceIndex = -1
    cameraMovedSinceTarget = false
  }
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
  if (!options || !options.keepHighlight) {
    updateTableRowHighlight(-1)
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
  if (kpiCardTitle) kpiCardTitle.innerHTML = 'Roughness (S<sub>vr</sub>)'
  if (kpiSvr) kpiSvr.textContent = formatValNum(res.worst_svr_um || (worstPatch ? worstPatch.svr_um : 0), unit)

  if (secLabel1) secLabel1.innerHTML = 'Arithmetic Mean (S<sub>a</sub>)'
  if (secVal1) secVal1.textContent = worstPatch ? formatVal(worstPatch.sa_um, unit) : '-'
  if (secLabel2) secLabel2.innerHTML = 'Root Mean Square (S<sub>q</sub>)'
  if (secVal2) secVal2.textContent = worstPatch ? formatVal(worstPatch.sq_um, unit) : '-'
  if (secLabel3) secLabel3.innerHTML = 'Worst Face S<sub>vr</sub>'
  if (secVal3) secVal3.textContent = formatVal(res.worst_svr_um || (worstPatch ? worstPatch.svr_um : 0), unit)
  if (secLabel4) secLabel4.innerHTML = 'Mean Face S<sub>vr</sub>'
  if (secVal4) secVal4.textContent = formatVal(res.mean_svr_um || 0, unit)
  if (secLabel5) secLabel5.innerHTML = 'Active Points'
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
  targetedFaceIndex = index
  cameraMovedSinceTarget = false

  // Update table rows active class to highlight the focused face
  updateTableRowHighlight(index)

  // Smoothly turn 3D cube camera to face on the All view
  if (pointCloudViewer) {
    pointCloudViewer.alignToFace(index)
    pointCloudViewer.setActivePatch(-1)
  }

  updateActiveChart()
}

function selectFace (index) {
  if (!currentResult) return
  if (!currentResult.is_3d) {
    activePatchIndex = 0
    currentViewMode = '3d-surface'
    updateTableRowHighlight(0)
    updateActiveChart()
    renderVariogram(currentResult)
    return
  }
  if (!currentResult.patches || !currentResult.patches[index]) return
  activePatchIndex = index
  currentViewMode = '3d-surface' // Face inspection is ALWAYS Topography!
  targetedFaceIndex = index
  cameraMovedSinceTarget = false
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
  updateTableRowHighlight(index)

  // Populate Right KPI Card in Face Deep-Dive Mode
  if (kpiCardTitle) kpiCardTitle.innerHTML = `Face ${index + 1} Roughness (S<sub>vr</sub>)`
  if (kpiSvr) kpiSvr.textContent = formatValNum(patch.svr_um, unit)

  if (secLabel1) secLabel1.innerHTML = 'Arithmetic Mean (S<sub>a</sub>)'
  if (secVal1) secVal1.textContent = formatVal(patch.sa_um, unit)
  if (secLabel2) secLabel2.innerHTML = 'Root Mean Square (S<sub>q</sub>)'
  if (secVal2) secVal2.textContent = formatVal(patch.sq_um, unit)
  if (secLabel3) secLabel3.innerHTML = 'Face Dimensions'
  if (secVal3) secVal3.textContent = patch.dims_mm ? `${patch.dims_mm[0]} × ${patch.dims_mm[1]} mm` : '-'
  if (secLabel4) secLabel4.innerHTML = 'Surface Area'
  if (secVal4) secVal4.textContent = patch.area_mm2 ? `${patch.area_mm2.toLocaleString()} mm²` : '-'
  if (secLabel5) secLabel5.innerHTML = 'Active Points'
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

  // Set active patch in viewer
  if (pointCloudViewer) {
    pointCloudViewer.setActivePatch(index)
  }

  // Render corner 3D shape thumbnail & Variogram
  renderShapeMiniPreview()
  renderVariogram(patch)

  // Switch to Topography view for this face
  updateActiveChart()
}

function renderSingleSurface (res) {
  const unit = unitSelect ? unitSelect.value : 'µm'
  activePatchIndex = 0
  currentViewMode = '3d-surface' // Single surface is ALWAYS Face Topography!

  const dockEl = document.getElementById('bottom-dock')
  if (dockEl) {
    dockEl.classList.remove('expanded')
  }

  // Single surface scan (not 3D shape): NO surface / faces tab!
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))
  if (tabBtnFaces) {
    tabBtnFaces.style.display = 'none'
    tabBtnFaces.classList.remove('active')
  }
  const tabFacesContent = document.getElementById('tab-faces')
  if (tabFacesContent) {
    tabFacesContent.classList.remove('active')
  }

  if (tabBtnRep) {
    tabBtnRep.style.display = 'inline-block'
    tabBtnRep.textContent = 'Metrology Report'
    tabBtnRep.classList.add('active')
  }
  const tabRepContent = document.getElementById('tab-rep')
  if (tabRepContent) {
    tabRepContent.classList.add('active')
  }

  if (facesTbody) {
    facesTbody.innerHTML = ''
  }

  const patchW = (res && typeof res.patch_width_mm === 'number') ? res.patch_width_mm : 0
  const patchH = (res && typeof res.patch_height_mm === 'number') ? res.patch_height_mm : 0

  // KPI Card
  if (kpiCardTitle) kpiCardTitle.innerHTML = 'Roughness (S<sub>vr</sub>)'
  if (kpiSvr) kpiSvr.textContent = formatValNum(res.svr_um, unit)

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
  const previewWidget = document.getElementById('shape-mini-preview')
  if (previewWidget) previewWidget.style.display = 'none'
}

function updateActiveChart () {
  if (!currentResult) return

  if (activePatchIndex === -1) {
    currentViewMode = '3d-object'
  } else {
    currentViewMode = '3d-surface'
  }

  const target =
    currentResult.is_3d &&
    currentResult.patches &&
    currentResult.patches[activePatchIndex]
      ? currentResult.patches[activePatchIndex]
      : currentResult

  const chartContainer = document.getElementById('chart-container')
  const pcCanvas = document.getElementById('pointcloud-canvas')
  const loadingOverlay = document.getElementById('chart-loading-overlay')

  // Show/hide appropriate viewer element and dispatch render
  if (currentViewMode === '3d-object') {
    if (chartContainer) chartContainer.style.display = 'none'
    if (loadingOverlay) loadingOverlay.style.display = 'none'
    if (pcCanvas) pcCanvas.style.display = 'block'
    render3DObject(currentResult)
    if (pointCloudViewer) {
      if (currentResult.is_3d && activePatchIndex >= 0) {
        pointCloudViewer.setActivePatch(activePatchIndex)
      } else {
        pointCloudViewer.setActivePatch(-1)
      }
      pointCloudViewer.resize()
    }
    updateAllViewColorbar()
  } else {
    updateAllViewColorbar()
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
    if (loadingOverlay) loadingOverlay.style.display = 'flex'
    render3DSurface(target)
  }

  // Render corner 3D shape mini-map orientation preview when inspecting a face
  renderShapeMiniPreview()
}

function renderShapeMiniPreview () {
  const previewWidget = document.getElementById('shape-mini-preview')
  const canvas = document.getElementById('mini-preview-canvas')
  if (!previewWidget || !canvas) return

  // Only show when inspecting an individual face in multi-face parts
  if (!currentResult || !currentResult.is_3d || !currentResult.patches || currentResult.patches.length <= 1 || activePatchIndex < 0 || currentViewMode === '3d-object') {
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

  const svrMultiplier = 1.0 // Svr roughness is strictly in µm per ASTM metrology standard
  const zMultiplier = 0.001 // µm to mm for 3D coordinates

  // Adaptive stride for safe, high-performance Plotly scatter3d (caps at ~50,000 points to prevent WebGL crashes)
  const MAX_PLOT_PTS = 50000
  const totalCells = numRows * numCols
  const stride = Math.max(1, Math.ceil(Math.sqrt(totalCells / MAX_PLOT_PTS)))

  const validX = []
  const validY = []
  const validZ = []
  const validZUm = []
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
    const isSampleRow = (r % stride === 0)

    for (let c = 0; c < numCols; c++) {
      const zRaw = zRow ? zRow[c] : null
      const sRaw = sRow ? sRow[c] : null
      const xVal = originX + c * pitch

      const hasZ = typeof zRaw === 'number' && !isNaN(zRaw)
      const hasS = typeof sRaw === 'number' && !isNaN(sRaw)

      if (hasZ && hasS) {
        const zMm = zRaw * zMultiplier
        const sConverted = sRaw * svrMultiplier

        if (sConverted < minVal) minVal = sConverted
        if (sConverted > maxVal) maxVal = sConverted
        if (flatValues) flatValues.push(sConverted)
        if (isSampleRow && (c % stride === 0)) {
          validX.push(xVal)
          validY.push(yVal)
          validZ.push(zMm)
          validZUm.push(zRaw)
          validIntensity.push(sConverted)
        }
      } else if (hasZ && isSampleRow && (c % stride === 0)) {
        invalidX.push(xVal)
        invalidY.push(yVal)
        invalidZ.push(zRaw * zMultiplier)
      }
    }
  }

  if (target.invalid_points_local && Array.isArray(target.invalid_points_local)) {
    const invStride = Math.max(1, Math.ceil(target.invalid_points_local.length / 5000))
    for (let i = 0; i < target.invalid_points_local.length; i += invStride) {
      const pt = target.invalid_points_local[i]
      if (Array.isArray(pt) && pt.length >= 3) {
        invalidX.push(pt[0])
        invalidY.push(pt[1])
        invalidZ.push(pt[2])
      }
    }
  }

  let cmin = isFinite(minVal) ? minVal : 0
  let cmax = isFinite(maxVal) ? maxVal : 1
  if (robust && flatValues && flatValues.length > 20) {
    flatValues.sort((a, b) => a - b)
    cmin = flatValues[Math.floor(flatValues.length * 0.01)]
    cmax = flatValues[Math.floor(flatValues.length * 0.99)]
  }
  if (cmax <= cmin) {
    cmax = cmin + 1.0
  }

  const res = { validX, validY, validZ, validZUm, validIntensity, invalidX, invalidY, invalidZ, cmin, cmax, unit, robust, numRows, numCols, pitch, stride }
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
    const overlay = document.getElementById('chart-loading-overlay')
    if (overlay) overlay.style.display = 'none'
    return
  }

  const { validX, validY, validZ, validZUm, validIntensity, invalidX, invalidY, invalidZ, cmin, cmax, numRows, numCols, pitch } = extracted

  const isDark = getTheme() === 'dark'
  const chartBg = isDark ? '#121318' : '#fbfbfd'
  const chartText = isDark ? '#9ca3af' : '#515154'
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)'

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
    customdata: validZUm,
    marker: showHeatmap ? {
      size: pointCloudMarkerSize,
      color: validIntensity,
      colorscale: palette,
      cmin: cmin,
      cmax: cmax,
      cauto: false,
      showscale: false,
      opacity: 1.0
    } : {
      size: pointCloudMarkerSize,
      color: faceColor,
      showscale: false,
      opacity: 1.0
    },
    hovertemplate: showHeatmap
      ? `Surface X: %{x:.2f} mm<br>Surface Y: %{y:.2f} mm<br>Elevation Z: %{customdata:.1f} µm<br>Local Svr: %{marker.color:.1f} µm<extra></extra>`
      : `${target.name || 'Face'}<br>Surface X: %{x:.2f} mm<br>Surface Y: %{y:.2f} mm<br>Elevation Z: %{customdata:.1f} µm<extra></extra>`
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
    margin: { l: 40, r: 40, t: 30, b: 40 },
    hovermode: 'closest',
    hoverdistance: 3,
    uirevision: (target.name || 'surface') + '_' + currentViewMode,
    scene: {
      xaxis: {
        title: { text: 'X (mm)', font: { size: 11, color: chartText } },
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
        title: { text: 'Y (mm)', font: { size: 11, color: chartText } },
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
    displayModeBar: false,
    displaylogo: false,
    plotGlPixelRatio: Math.min(1.5, window.devicePixelRatio || 1),
    scrollZoom: true,
    doubleClick: false
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
    updateAllViewColorbar()
    const overlay = document.getElementById('chart-loading-overlay')
    if (overlay) overlay.style.display = 'none'
  }).catch(err => {
    console.error('Plotly render error in render3DSurface:', err)
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
      },
      onCameraUserInteraction: () => {
        cameraMovedSinceTarget = true
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
  updateAllViewColorbar()
}

function updateAllViewColorbar () {
  const colorbarEl = document.getElementById('all-view-colorbar')
  if (!colorbarEl) return

  // Display when heatmap is active and a result is loaded
  const showHeatmap = showHeatmapCheckbox ? showHeatmapCheckbox.checked : true
  if (!showHeatmap || !currentResult) {
    colorbarEl.style.display = 'none'
    return
  }

  colorbarEl.style.display = 'flex'
  colorbarEl.style.flexDirection = 'column'

  const unit = (unitSelect && unitSelect.value) ? unitSelect.value : 'µm'
  const unitLabel = unit === 'µm' ? '&micro;m' : unit
  const titleEl = document.getElementById('all-colorbar-title')
  if (titleEl) {
    titleEl.innerHTML = `S<sub>vr</sub> (${unitLabel})`
  }

  // Update colormap gradient strip according to palette selection
  const stripEl = document.getElementById('all-colorbar-strip')
  const palette = paletteSelect ? paletteSelect.value : 'Jet'
  if (stripEl) {
    stripEl.className = 'colorbar-strip ' + palette.toLowerCase()
  }

  let minVal = 0.0
  let maxVal = 100.0

  if (currentViewMode === '3d-surface') {
    // Face Topography View
    const target = (currentResult.is_3d && activePatchIndex >= 0 && currentResult.patches && currentResult.patches[activePatchIndex])
      ? currentResult.patches[activePatchIndex]
      : currentResult

    if (target && target._extractedSurface) {
      minVal = target._extractedSurface.cmin
      maxVal = target._extractedSurface.cmax
    } else {
      const targetSvr = (target && typeof target.svr_um === 'number') ? target.svr_um : 50.0
      minVal = targetSvr * 0.5
      maxVal = targetSvr * 1.5
    }
  } else {
    // Whole 3D Object / Part View
    let svrMin = 0.0
    let svrMax = 100.0
    if (pointCloudViewer && typeof pointCloudViewer.getSvrRange === 'function') {
      const range = pointCloudViewer.getSvrRange()
      if (range && isFinite(range.min) && isFinite(range.max)) {
        svrMin = range.min
        svrMax = range.max
      }
    } else if (currentResult) {
      if (typeof currentResult.best_svr_um === 'number' && typeof currentResult.worst_svr_um === 'number' && currentResult.worst_svr_um > currentResult.best_svr_um) {
        svrMin = currentResult.best_svr_um
        svrMax = currentResult.worst_svr_um
      } else if (typeof currentResult.min_svr_um === 'number' && typeof currentResult.max_svr_um === 'number') {
        svrMin = currentResult.min_svr_um
        svrMax = currentResult.max_svr_um
      } else if (typeof currentResult.svr_um === 'number') {
        svrMin = currentResult.svr_um * 0.5
        svrMax = currentResult.svr_um * 1.5
      }
    }
    minVal = svrMin
    maxVal = svrMax
  }

  if (maxVal <= minVal) {
    maxVal = minVal + 1.0
  }

  const span = maxVal - minVal

  const formatTick = valUm => {
    if (!isFinite(valUm)) return '-'
    if (unit === 'mm') {
      const v = valUm / 1000.0
      const spanMm = span / 1000.0
      return v.toFixed(spanMm < 0.05 ? 4 : 3)
    }
    if (unit === 'in') {
      const v = valUm / 25400.0
      const spanIn = span / 25400.0
      return v.toFixed(spanIn < 0.002 ? 5 : 4)
    }
    return valUm.toFixed(1)
  }

  const t4 = document.getElementById('all-tick-4')
  const t3 = document.getElementById('all-tick-3')
  const t2 = document.getElementById('all-tick-2')
  const t1 = document.getElementById('all-tick-1')
  const t0 = document.getElementById('all-tick-0')

  if (t4) t4.textContent = formatTick(maxVal)
  if (t3) t3.textContent = formatTick(minVal + span * 0.75)
  if (t2) t2.textContent = formatTick(minVal + span * 0.50)
  if (t1) t1.textContent = formatTick(minVal + span * 0.25)
  if (t0) t0.textContent = formatTick(minVal)
}

if (showHeatmapCheckbox) {
  showHeatmapCheckbox.addEventListener('change', () => {
    const show = showHeatmapCheckbox.checked
    const robustWrap = document.getElementById('robust-contrast-wrap')
    if (robustWrap) {
      robustWrap.style.display = show ? 'flex' : 'none'
    }
    if (pointCloudViewer && pointCloudViewer.setShowHeatmap) {
      pointCloudViewer.setShowHeatmap(show)
    }
    if (currentResult && currentViewMode !== '3d-object') {
      updateActiveChart()
    }
    updateAllViewColorbar()
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
        text: `Svr (${unit})`,
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
      ? `Surface X: %{x:.2f} mm<br>Surface Y: %{y:.2f} mm<br>Local Svr: %{z:${unit === 'µm' ? '.1f' : (unit === 'mm' ? '.3f' : '.4f')}} ${unit}<extra></extra>`
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
  const chartBg = isDark ? '#1a1d25' : '#ffffff'
  const chartText = isDark ? '#9ca3af' : '#515154'
  const chartGrid = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)'
  const tickColor = isDark ? '#6b7280' : '#86868b'
  const unit = unitSelect ? unitSelect.value : 'µm'
  const varSectionTitle = document.getElementById('var-section-title')
  const varChartElem = document.getElementById('variogram-chart')
  const varCard = document.getElementById('variogram-card')

  // The variogram is turned off for Part Overview mode (hiding container and border)
  if (!currentResult || (currentResult.is_3d && activePatchIndex === -1)) {
    if (varCard) varCard.style.display = 'none'
    if (varSectionTitle) varSectionTitle.style.display = 'none'
    if (varChartElem) varChartElem.style.display = 'none'
    return
  }

  if (varCard) varCard.style.display = 'block'
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
    height: 165,
    margin: { l: 45, r: 12, t: 8, b: 38 },
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
dropzone.addEventListener('click', e => {
  if (isAnalyzing) return
  if (e && e.target && (e.target.closest('.sample-chip') || e.target.closest('#dropzone-browse-btn') || e.target.closest('.hero-samples-section') || e.target.closest('.dropzone-standards-bar'))) {
    return
  }
  fileInput.value = ''
  fileInput.click()
})
dropzone.addEventListener('keydown', e => {
  if (isAnalyzing) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    fileInput.value = ''
    fileInput.click()
  }
})
if (dropzoneReplaceBtn) {
  dropzoneReplaceBtn.addEventListener('click', e => {
    e.stopPropagation()
    if (isAnalyzing) return
    fileInput.value = ''
    fileInput.click()
  })
}
fileInput.addEventListener('change', e => {
  if (isAnalyzing) return
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
  if (!currentResult) return
  if (!currentResult.is_3d || !currentResult.patches) {
    selectOverview()
    return
  }
  const faceIdx = activePatchIndex >= 0 ? activePatchIndex : 0

  selectOverview({ keepCamera: true, keepHighlight: true, keepTarget: true })
  if (pointCloudViewer) {
    pointCloudViewer.setActivePatch(-1)
    pointCloudViewer.alignToFace(faceIdx)
  }
  targetedFaceIndex = faceIdx
  cameraMovedSinceTarget = false
  updateTableRowHighlight(faceIdx)
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
  if (isAnalyzing) return
  if (e.dataTransfer.files.length > 0) {
    handleFileSelect(e.dataTransfer.files[0])
  }
})

// Unit conversion updates numerical values in-place without resetting camera, face selection, or viewport
function updateUnitDisplay () {
  const unit = unitSelect ? unitSelect.value : 'µm'

  // 1. Update unit tag on Verdict Card
  const unitTag = document.getElementById('verdict-unit-tag')
  if (unitTag) unitTag.textContent = unit

  if (!currentResult) {
    updateAllViewColorbar()
    return
  }

  // 2. Update KPI Card numbers according to current mode without resetting camera or view
  if (currentResult.is_3d && activePatchIndex >= 0 && currentResult.patches && currentResult.patches[activePatchIndex]) {
    // Face Inspection mode (deep dive into specific face)
    const patch = currentResult.patches[activePatchIndex]
    if (kpiSvr) kpiSvr.textContent = formatValNum(patch.svr_um, unit)
    if (secVal1) secVal1.textContent = formatVal(patch.sa_um, unit)
    if (secVal2) secVal2.textContent = formatVal(patch.sq_um, unit)
  } else if (currentResult.is_3d) {
    // Whole Part Overview mode
    let worstPatch = null
    let maxVal = -1
    if (currentResult.patches && currentResult.patches.length > 0) {
      currentResult.patches.forEach(p => {
        if (typeof p.svr_um === 'number' && p.svr_um > maxVal) {
          maxVal = p.svr_um
          worstPatch = p
        }
      })
    }
    if (kpiSvr) kpiSvr.textContent = formatValNum(currentResult.worst_svr_um || (worstPatch ? worstPatch.svr_um : 0), unit)
    if (secVal1) secVal1.textContent = worstPatch ? formatVal(worstPatch.sa_um, unit) : '-'
    if (secVal2) secVal2.textContent = worstPatch ? formatVal(worstPatch.sq_um, unit) : '-'
    if (secVal3) secVal3.textContent = formatVal(currentResult.worst_svr_um || (worstPatch ? worstPatch.svr_um : 0), unit)
    if (secVal4) secVal4.textContent = formatVal(currentResult.mean_svr_um || 0, unit)
  } else {
    // Single Surface mode
    if (kpiSvr) kpiSvr.textContent = formatValNum(currentResult.svr_um, unit)
    if (secVal1) secVal1.textContent = formatVal(currentResult.sa_um, unit)
    if (secVal2) secVal2.textContent = formatVal(currentResult.sq_um, unit)
  }

  // 3. Update Svr in the Faces Table (if present) without re-rendering rows
  if (facesTbody && currentResult.is_3d && currentResult.patches) {
    currentResult.patches.forEach((patch, idx) => {
      const row = facesTbody.querySelector(`tr[data-patch-idx="${idx}"]`)
      if (row && row.cells && row.cells[3]) {
        row.cells[3].innerHTML = `<strong>${formatVal(patch.svr_um, unit)}</strong>`
      }
    })
  }

  // 4. Update Colorbar Legend Overlay
  updateAllViewColorbar()

  // 5. If in 3D topography mode, update hovertemplate on Plotly without touching camera
  if (currentViewMode === '3d-surface') {
    const chartContainer = document.getElementById('chart-container')
    if (chartContainer && chartContainer.data && chartContainer.data.length > 0) {
      const showHeatmap = showHeatmapCheckbox ? showHeatmapCheckbox.checked : true
      const target = (currentResult.is_3d && activePatchIndex >= 0 && currentResult.patches && currentResult.patches[activePatchIndex])
        ? currentResult.patches[activePatchIndex]
        : currentResult
      const hover = showHeatmap
        ? `Surface X: %{x:.2f} mm<br>Surface Y: %{y:.2f} mm<br>Elevation Z: %{customdata:.1f} µm<br>Local Svr: %{marker.color:.1f} µm<extra></extra>`
        : `${target.name || 'Face'}<br>Surface X: %{x:.2f} mm<br>Surface Y: %{y:.2f} mm<br>Elevation Z: %{customdata:.1f} µm<extra></extra>`
      try {
        Plotly.restyle(chartContainer, { hovertemplate: [hover] }, [0])
      } catch (err) {}
    }
  }
}

// Unit switch updates numbers in-place without resetting camera or view
unitSelect.addEventListener('change', () => {
  updateUnitDisplay()
})
paletteSelect.addEventListener('change', () => {
  if (pointCloudViewer && pointCloudViewer.setPalette) {
    pointCloudViewer.setPalette(paletteSelect.value)
  }
  if (currentResult) {
    updateActiveChart()
  }
  updateAllViewColorbar()
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

// Click or press Enter/Space directly on .25, .5, 1.0 text labels
document.querySelectorAll('.point-size-stop').forEach(stopEl => {
  stopEl.addEventListener('click', e => {
    e.preventDefault()
    e.stopPropagation()
    const idx = parseInt(stopEl.getAttribute('data-idx'), 10)
    setDiscretePointSize(idx)
  })
  stopEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      const idx = parseInt(stopEl.getAttribute('data-idx'), 10)
      setDiscretePointSize(idx)
    }
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

// Tab Switching & Data Drawer Toggle
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation()
    const tabId = btn.dataset.tab
    const isAlreadyActive = btn.classList.contains('active')
    const dock = document.getElementById('bottom-dock')
    const isExpanded = dock ? dock.classList.contains('expanded') : false

    if (isAlreadyActive && isExpanded) {
      // Clicked active tab while expanded -> collapse!
      if (dock) dock.classList.remove('expanded')
    } else {
      // Switch tab and expand
      document
        .querySelectorAll('.tab-btn')
        .forEach(b => b.classList.remove('active'))
      document
        .querySelectorAll('.tab-content')
        .forEach(c => c.classList.remove('active'))
      btn.classList.add('active')
      const targetContent = document.getElementById(tabId)
      if (targetContent) targetContent.classList.add('active')
      if (dock) dock.classList.add('expanded')
    }
    window.dispatchEvent(new Event('resize'))
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

// Reference Standards Loader
async function loadSampleScan (fileName) {
  if (isAnalyzing) return
  try {
    isAnalyzing = true
    setProcessingUploadVisibility(true, fileName)

    const benchmarksPopover = document.getElementById('benchmarks-popover')
    if (benchmarksPopover) benchmarksPopover.style.display = 'none'
    const benchmarksBtn = document.getElementById('benchmarks-btn')
    if (benchmarksBtn) benchmarksBtn.classList.remove('active')

    document.querySelectorAll('.sample-btn, .sample-chip').forEach(btn => {
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
    setProgress(20, `Fetching reference standard ${fileName}...`)
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

    // Note: handleFileSelect will startAnalysis
    isAnalyzing = false
    handleFileSelect(file)
  } catch (err) {
    isAnalyzing = false
    setProcessingUploadVisibility(false)
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

// Attach listeners to any trigger buttons with data-sample attribute
document.querySelectorAll('[data-sample]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.preventDefault()
    e.stopPropagation()
    if (isAnalyzing) return
    const sample = btn.getAttribute('data-sample')
    if (sample) loadSampleScan(sample)
  })
})

// Initialize on page load
initTheme()
initWorker()
if (unitSelect) {
  unitSelect.value = 'µm'
}

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

// Workbench UI Controls & Interaction Wire-up
const openScanBtn = document.getElementById('open-scan-btn')
if (openScanBtn && fileInput) {
  openScanBtn.addEventListener('click', () => {
    if (isAnalyzing) return
    fileInput.click()
  })
}

const dropzoneBrowseBtn = document.getElementById('dropzone-browse-btn')
if (dropzoneBrowseBtn && fileInput) {
  dropzoneBrowseBtn.addEventListener('click', e => {
    e.stopPropagation()
    if (isAnalyzing) return
    fileInput.click()
  })
}

// Settings, Benchmarks & Export Popovers
const settingsToggleBtn = document.getElementById('settings-toggle-btn')
const settingsPopover = document.getElementById('settings-popover')
const settingsCloseBtn = document.getElementById('settings-close-btn')
const benchmarksBtn = document.getElementById('benchmarks-btn')
const benchmarksPopover = document.getElementById('benchmarks-popover')
const benchmarksCloseBtn = document.getElementById('benchmarks-close-btn')
const exportBtn = document.getElementById('export-btn')
const exportPopover = document.getElementById('export-popover')
const exportCloseBtn = document.getElementById('export-close-btn')

function closeAllPopovers () {
  if (settingsPopover) settingsPopover.style.display = 'none'
  if (settingsToggleBtn) settingsToggleBtn.classList.remove('active')
  if (benchmarksPopover) benchmarksPopover.style.display = 'none'
  if (benchmarksBtn) benchmarksBtn.classList.remove('active')
  if (exportPopover) exportPopover.style.display = 'none'
  if (exportBtn) exportBtn.classList.remove('active')
}

if (settingsToggleBtn && settingsPopover) {
  settingsToggleBtn.addEventListener('click', e => {
    e.stopPropagation()
    const isOpen = settingsPopover.style.display !== 'none'
    closeAllPopovers()
    if (!isOpen) {
      settingsPopover.style.display = 'block'
      settingsToggleBtn.classList.add('active')
    }
  })
}

if (settingsCloseBtn && settingsPopover) {
  settingsCloseBtn.addEventListener('click', () => {
    settingsPopover.style.display = 'none'
    if (settingsToggleBtn) settingsToggleBtn.classList.remove('active')
  })
}

if (benchmarksBtn && benchmarksPopover) {
  benchmarksBtn.addEventListener('click', e => {
    e.stopPropagation()
    const isOpen = benchmarksPopover.style.display !== 'none'
    closeAllPopovers()
    if (!isOpen) {
      benchmarksPopover.style.display = 'block'
      benchmarksBtn.classList.add('active')
    }
  })
}

if (benchmarksCloseBtn && benchmarksPopover) {
  benchmarksCloseBtn.addEventListener('click', () => {
    benchmarksPopover.style.display = 'none'
    if (benchmarksBtn) benchmarksBtn.classList.remove('active')
  })
}

if (exportBtn && exportPopover) {
  exportBtn.addEventListener('click', e => {
    e.stopPropagation()
    if (exportBtn.disabled || isAnalyzing) return
    const isOpen = exportPopover.style.display !== 'none'
    closeAllPopovers()
    if (!isOpen) {
      exportPopover.style.display = 'block'
      exportBtn.classList.add('active')
    }
  })
}

if (exportCloseBtn && exportPopover) {
  exportCloseBtn.addEventListener('click', () => {
    exportPopover.style.display = 'none'
    if (exportBtn) exportBtn.classList.remove('active')
  })
}

document.addEventListener('click', e => {
  if (settingsPopover && settingsPopover.style.display !== 'none') {
    if (!settingsPopover.contains(e.target) && e.target !== settingsToggleBtn && !settingsToggleBtn.contains(e.target)) {
      settingsPopover.style.display = 'none'
      if (settingsToggleBtn) settingsToggleBtn.classList.remove('active')
    }
  }
  if (benchmarksPopover && benchmarksPopover.style.display !== 'none') {
    if (!benchmarksPopover.contains(e.target) && e.target !== benchmarksBtn && !benchmarksBtn.contains(e.target)) {
      benchmarksPopover.style.display = 'none'
      if (benchmarksBtn) benchmarksBtn.classList.remove('active')
    }
  }
  if (exportPopover && exportPopover.style.display !== 'none') {
    if (!exportPopover.contains(e.target) && e.target !== exportBtn && !exportBtn.contains(e.target)) {
      exportPopover.style.display = 'none'
      if (exportBtn) exportBtn.classList.remove('active')
    }
  }
})

// Export Action Handlers
function downloadDataUri (dataUri, filename) {
  const a = document.createElement('a')
  a.href = dataUri
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

const exportReportAction = document.getElementById('export-report-action')
if (exportReportAction) {
  exportReportAction.addEventListener('click', () => {
    if (!currentResult) return
    if (exportPopover) exportPopover.style.display = 'none'
    if (exportBtn) exportBtn.classList.remove('active')
    const blob = new Blob([currentResult.report_text || ''], { type: 'text/plain;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const baseName = (currentResult.effective_name || selectedFile?.name || 'scan').replace(/\.[^/.]+$/, '')
    downloadDataUri(url, `${baseName}_metrology_report.txt`)
    URL.revokeObjectURL(url)
  })
}

const exportCsvAction = document.getElementById('export-csv-action')
if (exportCsvAction) {
  exportCsvAction.addEventListener('click', () => {
    if (!currentResult) return
    if (exportPopover) exportPopover.style.display = 'none'
    if (exportBtn) exportBtn.classList.remove('active')

    const unit = unitSelect ? unitSelect.value : 'µm'
    const rows = [
      ['Target Surface', 'Width (mm)', 'Height (mm)', 'Surface Area (mm²)', `Svr (${unit})`, `Sa (${unit})`, `Sq (${unit})`, 'SCRATA Equivalent']
    ]

    if (currentResult.patches && currentResult.patches.length > 0) {
      currentResult.patches.forEach((patch, idx) => {
        const name = patch.name || `Face ${idx + 1}`
        const w = patch.width_mm ? patch.width_mm.toFixed(2) : '-'
        const h = patch.height_mm ? patch.height_mm.toFixed(2) : '-'
        const area = (patch.area_mm2 || (patch.width_mm && patch.height_mm ? patch.width_mm * patch.height_mm : 0)).toFixed(1)
        const svr = (unit === 'mm' ? (patch.svr_um / 1000).toFixed(4) : (unit === 'in' ? (patch.svr_um / 25400).toFixed(5) : patch.svr_um.toFixed(2)))
        const sa = (patch.sa_um ? (unit === 'mm' ? (patch.sa_um / 1000).toFixed(4) : (unit === 'in' ? (patch.sa_um / 25400).toFixed(5) : patch.sa_um.toFixed(2))) : '-')
        const sq = (patch.sq_um ? (unit === 'mm' ? (patch.sq_um / 1000).toFixed(4) : (unit === 'in' ? (patch.sq_um / 25400).toFixed(5) : patch.sq_um.toFixed(2))) : '-')
        const scrata = patch.scrata_rating || '-'
        rows.push([name, w, h, area, svr, sa, sq, scrata])
      })
    } else {
      const name = currentResult.effective_name || 'Primary Surface'
      const area = currentResult.area_mm2 ? currentResult.area_mm2.toFixed(1) : '-'
      const svr = (unit === 'mm' ? (currentResult.svr_um / 1000).toFixed(4) : (unit === 'in' ? (currentResult.svr_um / 25400).toFixed(5) : currentResult.svr_um.toFixed(2)))
      const sa = (currentResult.sa_um ? (unit === 'mm' ? (currentResult.sa_um / 1000).toFixed(4) : (unit === 'in' ? (currentResult.sa_um / 25400).toFixed(5) : currentResult.sa_um.toFixed(2))) : '-')
      const sq = (currentResult.sq_um ? (unit === 'mm' ? (currentResult.sq_um / 1000).toFixed(4) : (unit === 'in' ? (currentResult.sq_um / 25400).toFixed(5) : currentResult.sq_um.toFixed(2))) : '-')
      const scrata = currentResult.scrata_rating || '-'
      rows.push([name, '-', '-', area, svr, sa, sq, scrata])
    }

    const csvContent = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const baseName = (currentResult.effective_name || selectedFile?.name || 'scan').replace(/\.[^/.]+$/, '')
    downloadDataUri(url, `${baseName}_surface_metrics.csv`)
    URL.revokeObjectURL(url)
  })
}

const exportPngAction = document.getElementById('export-png-action')
if (exportPngAction) {
  exportPngAction.addEventListener('click', () => {
    if (!currentResult) return
    if (exportPopover) exportPopover.style.display = 'none'
    if (exportBtn) exportBtn.classList.remove('active')

    const baseName = (currentResult.effective_name || selectedFile?.name || 'scan').replace(/\.[^/.]+$/, '')
    if (currentViewMode === '3d-object') {
      if (pointCloudViewer && typeof pointCloudViewer.getScreenshotDataURL === 'function') {
        const dataUrl = pointCloudViewer.getScreenshotDataURL()
        downloadDataUri(dataUrl, `${baseName}_3d_model.png`)
      }
    } else {
      const chartElem = document.getElementById('chart-container')
      if (window.Plotly && chartElem) {
        Plotly.toImage(chartElem, { format: 'png', width: 1920, height: 1080 })
          .then(dataUrl => {
            downloadDataUri(dataUrl, `${baseName}_topography.png`)
          })
          .catch(err => {
            console.error('Snapshot capture error:', err)
          })
      }
    }
  })
}

// CAD Stepper Number Inputs
document.querySelectorAll('.stepper-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target
    const input = document.getElementById(targetId)
    if (!input) return
    const step = parseFloat(input.step) || 1
    const min = input.min !== '' ? parseFloat(input.min) : -Infinity
    const max = input.max !== '' ? parseFloat(input.max) : Infinity
    let val = parseFloat(input.value) || 0
    if (btn.classList.contains('stepper-inc')) {
      val = Math.min(max, +(val + step).toFixed(4))
    } else {
      val = Math.max(min, +(val - step).toFixed(4))
    }
    input.value = val
    input.dispatchEvent(new Event('change'))
  })
})

// Unified HUD Camera Reset / Reorient
const hudCamReset = document.getElementById('hud-cam-reset')
if (hudCamReset) {
  hudCamReset.addEventListener('click', () => {
    if (currentViewMode === '3d-object') {
      if (pointCloudViewer) {
        pointCloudViewer.setCameraView('iso')
      }
    } else if (currentViewMode === '3d-surface') {
      const chartElem = document.getElementById('chart-container')
      if (window.Plotly && chartElem) {
        Plotly.relayout(chartElem, {
          'scene.camera': {
            eye: { x: 0.0, y: 0.0001, z: 2.1 },
            up: { x: 0.0, y: 1.0, z: 0.0 },
            center: { x: 0, y: 0, z: 0 },
            projection: { type: 'orthographic' }
          }
        })
      }
    }
  })
}

// Collapsible Bottom Data Dock
const dockToggleBtn = document.getElementById('dock-toggle-btn')
const bottomDock = document.getElementById('bottom-dock')
const dockHeader = document.querySelector('.dock-header')

if (dockToggleBtn && bottomDock) {
  dockToggleBtn.addEventListener('click', e => {
    e.stopPropagation()
    bottomDock.classList.toggle('expanded')
    window.dispatchEvent(new Event('resize'))
  })
}

if (dockHeader && bottomDock) {
  dockHeader.addEventListener('click', e => {
    if (e.target.closest('.tab-btn') || e.target.closest('.dock-arrow-btn')) return
    bottomDock.classList.toggle('expanded')
    window.dispatchEvent(new Event('resize'))
  })
}

// Window-wide drag and drop for scan files onto the 3D canvas
window.addEventListener('dragover', e => {
  e.preventDefault()
})
window.addEventListener('drop', e => {
  e.preventDefault()
  if (isAnalyzing) return
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleFileSelect(e.dataTransfer.files[0])
  }
})
