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
let isLocalBackend = false
let currentViewMode = '3d-surface' // '2d' | '3d-surface' | '3d-object'
let previousViewMode = null
let pointCloudMarkerSize = 1.0
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

async function checkLocalBackend () {
  if (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '0.0.0.0'
  ) {
    try {
      const r = await fetch('/api/health')
      if (r.ok) {
        const info = await r.json()
        if (info && info.status === 'ok') {
          isLocalBackend = true
          if (statusDot) statusDot.className = 'status-dot ready'
          if (statusText) {
            statusText.textContent = `Local Engine active (${info.mode})`
          }
          return true
        }
      }
    } catch (e) {}
  }
  isLocalBackend = false
  return false
}

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
  worker = new Worker('worker.js?t=' + Date.now())

  worker.onmessage = function (e) {
    const { type, text, percent, data, error } = e.data

    if (type === 'status') {
      if (statusText) statusText.textContent = text
    } else if (type === 'ready') {
      if (!isLocalBackend) {
        if (statusDot) {
          statusDot.className = 'status-dot ready'
        }
        if (statusText) statusText.textContent = 'Browser Runtime Ready'
      }
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

  // First verify if local backend is running
  await checkLocalBackend()

  if (isLocalBackend) {
    try {
      setProgress(35, 'Analyzing with local Python engine...')
      const query = new URLSearchParams({
        filename: file.name,
        grid_mm: gridPitchInput.value || '0.2',
        short_cutoff: shortCutoffInput.value || '1.0',
        long_cutoff: longCutoffInput.value || '25.0',
        gaussian: gaussianCheckbox.checked ? '1' : '0'
      })
      const resp = await fetch(`/api/analyze?${query.toString()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Filename': file.name
        },
        body: arrayBuffer
      })
      if (resp.ok) {
        const data = await resp.json()
        if (!data.error) {
          if (statusDot) statusDot.className = 'status-dot ready'
          if (statusText) statusText.textContent = 'Local Engine active'
          completeProgress('Ready')
          currentResult = data
          renderResults(data)
          return
        } else {
          throw new Error(data.error)
        }
      } else {
        const errText = await resp.text()
        throw new Error(`Server returned HTTP ${resp.status}: ${errText || resp.statusText}`)
      }
    } catch (e) {
      console.error('Local Python analysis error:', e)
      if (statusDot) statusDot.className = 'status-dot ready'
      resetProgress()
      if (resultsContainer) {
        resultsContainer.style.opacity = '1'
        resultsContainer.style.pointerEvents = 'auto'
      }
      if (statusText) statusText.textContent = `Local Engine Error: ${e.message}`
      alert(`Local Python Engine Error:\n${e.message}\n\nPlease check server console.`)
      return
    }
  }

  // Deployed production environment: uses browser WebWorker
  setProgress(28, 'Transferring scan data to browser runtime...')
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
      <td>${totalPts}</td>
      <td><strong>${formatVal(res.worst_svr_um || (worstPatch ? worstPatch.svr_um : 0), unit)}</strong></td>
      <td>${formatVal(meanSa, unit)}</td>
      <td>${formatVal(meanSq, unit)}</td>
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
      const pts = patch.point_count ? patch.point_count.toLocaleString() : (patch.processed_points || 0).toLocaleString()
      const color = FACE_PALETTE[idx % FACE_PALETTE.length]

      tr.innerHTML = `
        <td><span class="part-pill-swatch" style="background:${color}; margin-right:6px; display:inline-block;"></span><strong>${patch.name}</strong></td>
        <td>${dims}</td>
        <td>${area}</td>
        <td>${pts}</td>
        <td><strong>${formatVal(patch.svr_um, unit)}</strong></td>
        <td>${formatVal(patch.sa_um, unit)}</td>
        <td>${formatVal(patch.sq_um, unit)}</td>
        <td>${scrataRating}</td>
      `
      tr.addEventListener('click', () => {
        if (currentViewMode === '3d-object') {
          orientFaceInOverview(idx)
        } else {
          selectFace(idx)
        }
      })
      facesTbody.appendChild(tr)
    })
  }

  // Start in Part Overview with 3D point cloud scan visible first
  currentViewMode = '3d-object'
  selectOverview()
}

function selectOverview () {
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
    pointCloudViewer.setCameraView('iso')
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

  // Smoothly turn 3D cube camera to face and highlight face on the All view
  if (pointCloudViewer) {
    pointCloudViewer.alignToFace(index)
    pointCloudViewer.setActivePatch(index)
  }
}

function selectFace (index) {
  if (!currentResult || !currentResult.patches || !currentResult.patches[index]) return
  activePatchIndex = index
  if (currentViewMode === '3d-object') {
    currentViewMode = '3d-surface'
  }
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

  updateActiveChart()
  renderVariogram(patch)
}

function renderSingleSurface (res) {
  const unit = unitSelect ? unitSelect.value : 'µm'
  activePatchIndex = 0
  if (currentViewMode === '3d-object') {
    currentViewMode = '3d-surface'
  }

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
      <td>${pts}</td>
      <td><strong>${formatVal(res.svr_um, unit)}</strong></td>
      <td>${formatVal(res.sa_um || 0, unit)}</td>
      <td>${formatVal(res.sq_um || 0, unit)}</td>
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
  const isFaceOrPlanar = !isOverview

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

  // Show/hide appropriate viewer element and dispatch render
  if (currentViewMode === '3d-object') {
    if (chartContainer) chartContainer.style.display = 'none'
    if (pcCanvas) pcCanvas.style.display = 'block'
    render3DObject(currentResult)
  } else {
    if (chartContainer) chartContainer.style.display = 'block'
    if (pcCanvas) pcCanvas.style.display = 'none'
    render3DSurface(target)
  }

  // Render corner 3D shape mini-map orientation preview when on a face in 2D or 3D surface elevation mode
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

  // Collect faces and depth sort
  const faceDrawOrder = []

  const showUnassigned = showUnassignedCheckbox ? showUnassignedCheckbox.checked : true
  if (showUnassigned && unassignedPts3d.length > 0) {
    const projUnassigned = unassignedPts3d.map(projectPoint)
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
    const pts = p.sample_points_3d || []
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
    pts.forEach(p => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fill()
    })
  })

  ctx.restore()
}

function render3DSurface (target) {
  if (!target) return
  const svrGrid = (target.grid_svr && Array.isArray(target.grid_svr) && target.grid_svr.length > 0)
    ? target.grid_svr
    : target.grid_z

  if (!svrGrid || !Array.isArray(svrGrid) || svrGrid.length === 0) {
    console.warn('render3DSurface: No surface grid available', target)
    return
  }

  const unit = unitSelect ? unitSelect.value : 'µm'
  const robust = robustCheckbox ? robustCheckbox.checked : false
  const palette = paletteSelect ? paletteSelect.value : 'Viridis'

  const originX = typeof target.origin_x === 'number' ? target.origin_x : 0
  const originY = typeof target.origin_y === 'number' ? target.origin_y : 0
  const pitch = typeof target.pitch_mm === 'number'
    ? target.pitch_mm
    : (typeof target.grid_z_pitch_mm === 'number' ? target.grid_z_pitch_mm : 0.2)

  // Flatten and filter S_VR for robust color scale percentiles
  let flat = []
  for (let r = 0; r < svrGrid.length; r++) {
    for (let c = 0; c < svrGrid[r].length; c++) {
      let v = svrGrid[r][c]
      if (typeof v === 'number' && !isNaN(v)) {
        if (unit === 'mm') v /= 1000.0
        else if (unit === 'in') v /= 25400.0
        flat.push(v)
      }
    }
  }
  flat.sort((a, b) => a - b)

  let cmin = flat.length > 0 ? flat[0] : 0
  let cmax = flat.length > 0 ? flat[flat.length - 1] : 1
  if (robust && flat.length > 20) {
    cmin = flat[Math.floor(flat.length * 0.01)]
    cmax = flat[Math.floor(flat.length * 0.99)]
  }

  // Convert S_VR grid units
  const svrData = svrGrid.map(row =>
    row.map(v => {
      if (typeof v !== 'number' || isNaN(v)) return null
      if (unit === 'mm') return v / 1000.0
      if (unit === 'in') return v / 25400.0
      return v
    })
  )

  // Use actual elevation Z grid for 3D shape, colored by S_VR heatmap
  const zGrid = (target.grid_z && Array.isArray(target.grid_z) && target.grid_z.length > 0)
    ? target.grid_z
    : svrGrid

  // Convert elevation Z grid from µm to mm to match physical X and Y coordinates
  const zData = zGrid.map(row =>
    row.map(v => {
      if (typeof v !== 'number' || isNaN(v)) return null
      return v / 1000.0
    })
  )

  const numRows = zData.length
  const numCols = zData[0] ? zData[0].length : 0

  const xCoords = []
  for (let c = 0; c < numCols; c++) xCoords.push(originX + c * pitch)
  const yCoords = []
  for (let r = 0; r < numRows; r++) yCoords.push(originY + r * pitch)

  const isDark = getTheme() === 'dark'
  const chartBg = isDark ? '#1c1d22' : '#ffffff'
  const chartText = isDark ? '#c7cbd3' : '#0f172a'
  const gridColor = isDark ? '#2e3039' : '#e2e8f0'

  const metricLabel = `S_VR (${unit})`

  // Extract only valid non-null vertices and build clean 3D triangle mesh
  const validX = []
  const validY = []
  const validZ = []
  const validIntensity = []
  const vertIdxMap = Array.from({ length: numRows }, () => new Int32Array(numCols).fill(-1))

  let vertCount = 0
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const zVal = zData[r] ? zData[r][c] : null
      const svrVal = svrData[r] ? svrData[r][c] : null
      if (typeof zVal === 'number' && typeof svrVal === 'number' && !isNaN(zVal) && !isNaN(svrVal)) {
        validX.push(xCoords[c])
        validY.push(yCoords[r])
        validZ.push(zVal)
        validIntensity.push(svrVal)
        vertIdxMap[r][c] = vertCount++
      }
    }
  }

  const triI = []
  const triJ = []
  const triK = []

  for (let r = 0; r < numRows - 1; r++) {
    for (let c = 0; c < numCols - 1; c++) {
      const v00 = vertIdxMap[r][c]
      const v10 = vertIdxMap[r + 1][c]
      const v01 = vertIdxMap[r][c + 1]
      const v11 = vertIdxMap[r + 1][c + 1]

      if (v00 >= 0 && v10 >= 0 && v01 >= 0 && v11 >= 0) {
        // Counter-clockwise winding seen from +Z so triangle normals point UP
        triI.push(v00, v01)
        triJ.push(v01, v11)
        triK.push(v10, v10)
      }
    }
  }

  const trace = {
    type: 'mesh3d',
    x: validX,
    y: validY,
    z: validZ,
    i: triI,
    j: triJ,
    k: triK,
    intensity: validIntensity,
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
    lighting: {
      ambient: 1.0,
      diffuse: 0.0,
      specular: 0.0,
      roughness: 1.0,
      fresnel: 0.0
    },
    lightposition: { x: 100, y: 100, z: 1000 },
    hovertemplate: `Surface X: %{x:.2f} mm<br>Surface Y: %{y:.2f} mm<br>Elevation Z: %{z:.3f} mm<br>Local S_VR: %{intensity:.4f} ${unit}<extra></extra>`
  }

  const xSpan = (xCoords[xCoords.length - 1] - xCoords[0]) || 1
  const ySpan = (yCoords[yCoords.length - 1] - yCoords[0]) || 1
  const aspectY = Math.max(0.2, Math.min(5.0, ySpan / Math.max(1e-3, xSpan)))

  const aerialCamera = {
    eye: { x: 0.0, y: 0.0001, z: 2.1 },
    up: { x: 0.0, y: 1.0, z: 0.0 },
    center: { x: 0, y: 0, z: 0 },
    projection: { type: 'orthographic' }
  }

  const layout = {
    autosize: true,
    margin: { l: 65, r: 85, t: 30, b: 60 },
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
    font: {
      family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: chartText
    }
  }

  const config = {
    responsive: true,
    displaylogo: false,
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

  const minZ = validZ.length > 0 ? Math.min(...validZ) : 0
  const baseZ = minZ - 0.002
  const minX = xCoords[0]
  const maxX = xCoords[xCoords.length - 1]
  const minY = yCoords[0]
  const maxY = yCoords[yCoords.length - 1]

  const baseTrace = {
    type: 'mesh3d',
    x: [minX, maxX, maxX, minX],
    y: [minY, minY, maxY, maxY],
    z: [baseZ, baseZ, baseZ, baseZ],
    i: [0, 0],
    j: [1, 2],
    k: [2, 3],
    color: isDark ? '#334155' : '#cbd5e1',
    opacity: 0.95,
    showscale: false,
    hoverinfo: 'skip'
  }

  Plotly.react('chart-container', [baseTrace, trace], layout, config)

  const chartContainerElem = document.getElementById('chart-container')
  if (chartContainerElem && !chartContainerElem._zaxisListenerAttached) {
    chartContainerElem._zaxisListenerAttached = true
    chartContainerElem.on('plotly_relayout', function (eventData) {
      if (!eventData || !eventData['scene.camera']) return
      const cam = eventData['scene.camera']
      if (!cam || !cam.eye) return
      const isAerial = Math.abs(cam.eye.x) < 0.12 && Math.abs(cam.eye.y) < 0.12 && (cam.eye.z > 1.2 || cam.projection?.type === 'orthographic')
      const currentZTitle = chartContainerElem.layout?.scene?.zaxis?.title?.text || ''
      const hasZTitle = currentZTitle.length > 0
      if (isAerial && hasZTitle) {
        Plotly.relayout(chartContainerElem, {
          'scene.zaxis.title.text': '',
          'scene.zaxis.showticklabels': false,
          'scene.zaxis.showgrid': false,
          'scene.zaxis.showline': false
        })
      } else if (!isAerial && !hasZTitle) {
        const dark = getTheme() === 'dark'
        Plotly.relayout(chartContainerElem, {
          'scene.zaxis.title.text': 'Elevation Z (mm)',
          'scene.zaxis.showticklabels': true,
          'scene.zaxis.showgrid': true,
          'scene.zaxis.showline': true,
          'scene.zaxis.linecolor': dark ? '#4b5563' : '#94a3b8',
          'scene.zaxis.gridcolor': dark ? '#2e3039' : '#e2e8f0'
        })
      }
    })
  }
}

function initPointCloudViewer () {
  const canvas = document.getElementById('pointcloud-canvas')
  if (canvas && window.PointCloudViewer && !pointCloudViewer) {
    pointCloudViewer = new window.PointCloudViewer(canvas, {
      onFaceClick: faceIdx => {
        if (currentResult && currentResult.patches && currentResult.patches[faceIdx]) {
          orientFaceInOverview(faceIdx)
        }
      }
    })

    const btnCamAlign = document.getElementById('btn-cam-align')
    const btnCamIso = document.getElementById('btn-cam-iso')
    const btnCamTop = document.getElementById('btn-cam-top')
    const btnCamFront = document.getElementById('btn-cam-front')
    const btnCamReset = document.getElementById('btn-cam-reset')

    if (btnCamAlign) {
      btnCamAlign.addEventListener('click', () => {
        if (pointCloudViewer) {
          const idx = activePatchIndex >= 0 ? activePatchIndex : 0
          pointCloudViewer.alignToFace(idx)
        }
      })
    }
    if (btnCamIso) {
      btnCamIso.addEventListener('click', () => {
        if (pointCloudViewer) pointCloudViewer.setCameraView('iso')
      })
    }
    if (btnCamTop) {
      btnCamTop.addEventListener('click', () => {
        if (pointCloudViewer) pointCloudViewer.setCameraView('top')
      })
    }
    if (btnCamFront) {
      btnCamFront.addEventListener('click', () => {
        if (pointCloudViewer) pointCloudViewer.setCameraView('front')
      })
    }
    if (btnCamReset) {
      btnCamReset.addEventListener('click', () => {
        if (pointCloudViewer) pointCloudViewer.resetCamera()
      })
    }
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
  pointCloudViewer.setTheme(getTheme() === 'dark')
  pointCloudViewer.render()
}

if (showUnassignedCheckbox) {
  showUnassignedCheckbox.addEventListener('change', () => {
    const show = showUnassignedCheckbox.checked
    if (pointCloudViewer) {
      pointCloudViewer.setShowUnassigned(show)
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
    },
    hovertemplate: `Surface X: %{x:.2f} mm<br>Surface Y: %{y:.2f} mm<br>Local S_VR: %{z:.4f} ${unit}<extra></extra>`
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

// Mini-map static thumbnail click: links back to whole part view
const shapeMiniPreviewElem = document.getElementById('shape-mini-preview')
const miniPreviewCanvas = document.getElementById('mini-preview-canvas')

function handleMiniPreviewClick (e) {
  if (e) {
    if (e.preventDefault) e.preventDefault()
    if (e.stopPropagation) e.stopPropagation()
  }
  const faceToOrient = activePatchIndex
  selectOverview()
  if (typeof faceToOrient === 'number' && faceToOrient >= 0) {
    orientFaceInOverview(faceToOrient)
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
  if (currentResult) {
    updateActiveChart()
  }
})
robustCheckbox.addEventListener('change', () => {
  if (currentResult) {
    updateActiveChart()
  }
})

// 2D / 3D View Mode Toggle Buttons
document.querySelectorAll('.view-toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view')
    if (view && view !== currentViewMode) {
      currentViewMode = view
      updateActiveChart()
    }
  })
})

// Point Size Slider for 3D Point Cloud View
const ptsSizeSlider = document.getElementById('pts-size-slider')
const ptsSizeVal = document.getElementById('pts-size-val')
if (ptsSizeSlider) {
  ptsSizeSlider.addEventListener('input', e => {
    pointCloudMarkerSize = parseFloat(e.target.value) || 1.0
    if (ptsSizeVal) ptsSizeVal.textContent = pointCloudMarkerSize.toFixed(1) + 'px'
    if (currentViewMode === '3d-object') {
      updatePointCloudMarkerSizes()
    }
  })
}

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
checkLocalBackend()
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
