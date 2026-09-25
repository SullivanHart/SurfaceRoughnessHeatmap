// High-Performance Native WebGL Point Cloud Viewer for SurfInspect
// Renders 1M+ 3D points at 60 FPS with hardware Z-buffer depth testing

class PointCloudViewer {
  constructor (canvas, options = {}) {
    this.canvas = canvas
    this.gl =
      canvas.getContext('webgl', {
        antialias: true,
        depth: true,
        alpha: false,
        preserveDrawingBuffer: false
      }) ||
      canvas.getContext('experimental-webgl', {
        antialias: true,
        depth: true,
        alpha: false
      })

    if (!this.gl) {
      console.error('WebGL is not supported on this browser/GPU.')
      return
    }

    this.onFaceClick = options.onFaceClick || null
    this.isDark = true
    this.pointSize = 1.0
    this.activePatchIndex = 0
    this.showUnassigned = true

    // Camera & Orbit state (supports smooth inertia damping)
    this.target = [0, 0, 0]
    this.currentTarget = [0, 0, 0]
    this.distance = 150
    this.targetDistance = 150
    this.theta = -Math.PI / 4 // Azimuth angle
    this.targetTheta = -Math.PI / 4
    this.phi = Math.PI / 3.2 // Polar angle from Z up
    this.targetPhi = Math.PI / 3.2
    this.up = [0, 0, 1]

    // Animation & Render loop state
    this.renderRequested = false
    this.dampingActive = false
    this.animating = null

    // Face centroids and metadata for picking
    this.facesMeta = []
    this.totalPoints = 0

    this.initGL()
    this.initEvents()
  }

  initGL () {
    const gl = this.gl

    const vsSource = `
      attribute vec3 aPosition;
      attribute vec3 aColor;
      attribute float aPatchIndex;

      uniform mat4 uMVP;
      uniform float uPointSize;
      uniform float uActivePatchIndex;
      uniform float uShowUnassigned;

      varying vec3 vColor;

      void main() {
        if (aPatchIndex < -1.5 && uShowUnassigned < 0.5) {
          gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
          gl_PointSize = 0.0;
          vColor = vec3(0.0);
          return;
        }
        bool isActive = (aPatchIndex == uActivePatchIndex || uActivePatchIndex < 0.0);
        vColor = isActive ? aColor : aColor * 0.58;
        gl_Position = uMVP * vec4(aPosition, 1.0);
        gl_PointSize = isActive ? (uPointSize + 0.8) : uPointSize;
      }
    `

    const fsSource = `
      precision mediump float;
      varying vec3 vColor;

      void main() {
        gl_FragColor = vec4(vColor, 1.0);
      }
    `

    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource)
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource)
    const program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Shader link failed:', gl.getProgramInfoLog(program))
      return
    }

    this.program = program
    this.attribs = {
      position: gl.getAttribLocation(program, 'aPosition'),
      color: gl.getAttribLocation(program, 'aColor'),
      patchIndex: gl.getAttribLocation(program, 'aPatchIndex')
    }

    this.uniforms = {
      mvp: gl.getUniformLocation(program, 'uMVP'),
      pointSize: gl.getUniformLocation(program, 'uPointSize'),
      activePatchIndex: gl.getUniformLocation(program, 'uActivePatchIndex'),
      showUnassigned: gl.getUniformLocation(program, 'uShowUnassigned')
    }

    // Hardware depth testing setup: Ensures nearest faces strictly occlude farther faces!
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.disable(gl.BLEND)

    // Create GPU Buffers
    this.posBuffer = gl.createBuffer()
    this.colorBuffer = gl.createBuffer()
    this.patchBuffer = gl.createBuffer()
  }

  compileShader (type, source) {
    const gl = this.gl
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }
    return shader
  }

  decodeBase64Float32 (b64) {
    const bin = atob(b64)
    const len = bin.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = bin.charCodeAt(i)
    }
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
  }

  setData (result) {
    if (!this.gl || !result) return
    const gl = this.gl

    const FACE_PALETTE_RGB = [
      [0.784, 0.063, 0.180], // Cardinal Red (#c8102e)
      [0.145, 0.388, 0.922], // Royal Blue (#2563eb)
      [0.086, 0.639, 0.290], // Emerald Green (#16a34a)
      [0.961, 0.620, 0.043], // Amber (#f59e0b)
      [0.545, 0.361, 0.965], // Violet (#8b5cf6)
      [0.024, 0.714, 0.831], // Cyan (#06b6d4)
      [0.925, 0.282, 0.600], // Pink (#ec4899)
      [0.063, 0.725, 0.506]  // Teal (#10b981)
    ]

    let allPos = []
    let allCol = []
    let allPatch = []
    this.facesMeta = []

    if (result.is_3d && result.patches && result.patches.length > 0) {
      result.patches.forEach((patch, idx) => {
        let f32 = null
        if (patch.sample_points_b64) {
          f32 = this.decodeBase64Float32(patch.sample_points_b64)
        } else if (patch.sample_points_3d && patch.sample_points_3d.length > 0) {
          const pts = patch.sample_points_3d
          f32 = new Float32Array(pts.length * 3)
          for (let i = 0; i < pts.length; i++) {
            f32[i * 3] = pts[i][0]
            f32[i * 3 + 1] = pts[i][1]
            f32[i * 3 + 2] = pts[i][2]
          }
        }

        if (!f32 || f32.length === 0) return

        const ptCount = f32.length / 3
        const rgb = FACE_PALETTE_RGB[idx % FACE_PALETTE_RGB.length]
        const colors = new Float32Array(ptCount * 3)
        const patches = new Float32Array(ptCount)
        for (let i = 0; i < ptCount; i++) {
          colors[i * 3] = rgb[0]
          colors[i * 3 + 1] = rgb[1]
          colors[i * 3 + 2] = rgb[2]
          patches[i] = idx
        }

        allPos.push(f32)
        allCol.push(colors)
        allPatch.push(patches)

        let centroid = patch.centroid
        if (!centroid && patch.sample_points_3d && patch.sample_points_3d.length > 0) {
          const pts = patch.sample_points_3d
          let sx = 0, sy = 0, sz = 0
          for (let i = 0; i < pts.length; i++) {
            sx += pts[i][0]; sy += pts[i][1]; sz += pts[i][2]
          }
          centroid = [sx / pts.length, sy / pts.length, sz / pts.length]
        }

        this.facesMeta.push({
          patchId: patch.patch_id || idx + 1,
          name: patch.name || `Face ${idx + 1}`,
          centroid: centroid || [0, 0, 0],
          normal: patch.normal || patch.plane_normal || null,
          pointCount: ptCount
        })
      })

      // Unassigned / unprocessed points (edges, chamfers, unsegmented geometry) colored neutral grey
      let uF32 = null
      if (result.unassigned_points_b64) {
        uF32 = this.decodeBase64Float32(result.unassigned_points_b64)
      } else if (result.unassigned_points_3d && result.unassigned_points_3d.length > 0) {
        const uPts = result.unassigned_points_3d
        uF32 = new Float32Array(uPts.length * 3)
        for (let i = 0; i < uPts.length; i++) {
          uF32[i * 3] = uPts[i][0]
          uF32[i * 3 + 1] = uPts[i][1]
          uF32[i * 3 + 2] = uPts[i][2]
        }
      }

      if (uF32 && uF32.length > 0) {
        const uCount = uF32.length / 3
        const uColors = new Float32Array(uCount * 3)
        const uPatches = new Float32Array(uCount)
        // Bright neutral slate/grey color [0.65, 0.68, 0.74] matching Whole Part
        for (let i = 0; i < uCount; i++) {
          uColors[i * 3] = 0.65
          uColors[i * 3 + 1] = 0.68
          uColors[i * 3 + 2] = 0.74
          uPatches[i] = -2.0
        }
        allPos.push(uF32)
        allCol.push(uColors)
        allPatch.push(uPatches)
      }
    } else {
      // Planar surface scan
      let f32 = null
      if (result.sample_points_b64) {
        f32 = this.decodeBase64Float32(result.sample_points_b64)
      } else if (result.sample_points_3d && result.sample_points_3d.length > 0) {
        const pts = result.sample_points_3d
        f32 = new Float32Array(pts.length * 3)
        for (let i = 0; i < pts.length; i++) {
          f32[i * 3] = pts[i][0]
          f32[i * 3 + 1] = pts[i][1]
          f32[i * 3 + 2] = pts[i][2]
        }
      }

      if (f32 && f32.length > 0) {
        const ptCount = f32.length / 3
        const colors = new Float32Array(ptCount * 3)
        const patches = new Float32Array(ptCount)
        for (let i = 0; i < ptCount; i++) {
          colors[i * 3] = 0.784
          colors[i * 3 + 1] = 0.063
          colors[i * 3 + 2] = 0.180
          patches[i] = 0
        }
        allPos.push(f32)
        allCol.push(colors)
        allPatch.push(patches)

        this.facesMeta.push({
          patchId: 1,
          name: result.effective_name || 'Surface',
          centroid: [0, 0, 0],
          normal: [0, 0, 1],
          pointCount: ptCount
        })
      }
    }

    if (allPos.length === 0) return

    this.lastResult = result

    // Merge arrays
    let totalLen = 0
    for (let i = 0; i < allPos.length; i++) totalLen += allPos[i].length
    const mergedPos = new Float32Array(totalLen)
    const mergedCol = new Float32Array(totalLen)
    const mergedPatch = new Float32Array(totalLen / 3)

    let offsetPos = 0
    let offsetPatch = 0
    for (let i = 0; i < allPos.length; i++) {
      mergedPos.set(allPos[i], offsetPos)
      mergedCol.set(allCol[i], offsetPos)
      mergedPatch.set(allPatch[i], offsetPatch)
      offsetPos += allPos[i].length
      offsetPatch += allPatch[i].length
    }

    this.totalPoints = totalLen / 3

    // Upload to GPU
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mergedPos, gl.STATIC_DRAW)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mergedCol, gl.STATIC_DRAW)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.patchBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mergedPatch, gl.STATIC_DRAW)

    // Compute bounding box and auto-center camera
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < mergedPos.length; i += 3) {
      const x = mergedPos[i]
      const y = mergedPos[i + 1]
      const z = mergedPos[i + 2]
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }

    this.bounds = { minX, minY, minZ, maxX, maxY, maxZ }
    this.target = [
      (minX + maxX) * 0.5,
      (minY + maxY) * 0.5,
      (minZ + maxZ) * 0.5
    ]
    this.currentTarget = [...this.target]

    const dx = maxX - minX
    const dy = maxY - minY
    const dz = maxZ - minZ
    this.radius = Math.hypot(dx, dy, dz) * 0.5
    this.distance = Math.max(10, this.radius * 3.1)
    this.targetDistance = this.distance
    this.theta = -Math.PI / 4
    this.targetTheta = this.theta
    this.phi = Math.PI / 3.2
    this.targetPhi = this.phi

    this.render()
  }

  setActivePatch (idx) {
    this.activePatchIndex = idx
    this.requestRender()
  }

  requestRender () {
    if (this.renderRequested) return
    this.renderRequested = true
    requestAnimationFrame(() => {
      this.renderRequested = false
      this.render()
    })
  }

  startDampingLoop () {
    if (this.dampingActive) return
    this.dampingActive = true

    const loop = () => {
      if (this.animating) {
        this.dampingActive = false
        return
      }

      const damping = 0.28 // Butter smooth damping
      const dTheta = this.targetTheta - this.theta
      const dPhi = this.targetPhi - this.phi
      const dDist = this.targetDistance - this.distance
      const dTx = this.target[0] - this.currentTarget[0]
      const dTy = this.target[1] - this.currentTarget[1]
      const dTz = this.target[2] - this.currentTarget[2]

      const needsUpdate =
        Math.abs(dTheta) > 0.0001 ||
        Math.abs(dPhi) > 0.0001 ||
        Math.abs(dDist) > 0.01 ||
        Math.abs(dTx) > 0.01 ||
        Math.abs(dTy) > 0.01 ||
        Math.abs(dTz) > 0.01

      if (needsUpdate) {
        this.theta += dTheta * damping
        this.phi += dPhi * damping
        this.distance += dDist * damping
        this.currentTarget[0] += dTx * damping
        this.currentTarget[1] += dTy * damping
        this.currentTarget[2] += dTz * damping
        this.render()
        requestAnimationFrame(loop)
      } else {
        this.theta = this.targetTheta
        this.phi = this.targetPhi
        this.distance = this.targetDistance
        this.currentTarget[0] = this.target[0]
        this.currentTarget[1] = this.target[1]
        this.currentTarget[2] = this.target[2]
        this.render()
        this.dampingActive = false
      }
    }
    requestAnimationFrame(loop)
  }

  animateCameraTo (targetTheta, targetPhi, targetDist, duration = 240) {
    if (this.animating) {
      cancelAnimationFrame(this.animating)
      this.animating = null
    }
    this.dampingActive = false

    const startTheta = this.theta
    const startPhi = this.phi
    const startDist = this.distance
    const startTime = performance.now()

    // Shortest angular path around cylinder
    let dTheta = (targetTheta - startTheta) % (2 * Math.PI)
    if (dTheta > Math.PI) dTheta -= 2 * Math.PI
    if (dTheta < -Math.PI) dTheta += 2 * Math.PI

    const dPhi = targetPhi - startPhi
    const dDist = targetDist - startDist

    const step = now => {
      const elapsed = now - startTime
      const progress = Math.min(1.0, elapsed / duration)
      // Smooth cubic ease-out
      const ease = 1 - Math.pow(1 - progress, 3)

      this.theta = startTheta + dTheta * ease
      this.targetTheta = this.theta
      this.phi = startPhi + dPhi * ease
      this.targetPhi = this.phi
      this.distance = startDist + dDist * ease
      this.targetDistance = this.distance
      this.render()

      if (progress < 1.0) {
        this.animating = requestAnimationFrame(step)
      } else {
        this.animating = null
        this.targetTheta = targetTheta
        this.targetPhi = targetPhi
        this.targetDistance = targetDist
      }
    }

    this.animating = requestAnimationFrame(step)
  }

  alignToFace (faceIdx) {
    if (!this.facesMeta || this.facesMeta.length === 0) return
    const idx = Math.max(0, Math.min(this.facesMeta.length - 1, faceIdx))
    const meta = this.facesMeta[idx]
    if (!meta) return

    let cx = 0, cy = 0, cz = 0
    if (this.bounds) {
      cx = (this.bounds.minX + this.bounds.maxX) * 0.5
      cy = (this.bounds.minY + this.bounds.maxY) * 0.5
      cz = (this.bounds.minZ + this.bounds.maxZ) * 0.5
      this.target = [cx, cy, cz]
      this.currentTarget = [cx, cy, cz]
    } else if (meta.centroid) {
      cx = meta.centroid[0]; cy = meta.centroid[1]; cz = meta.centroid[2]
      this.target = [cx, cy, cz]
      this.currentTarget = [cx, cy, cz]
    }

    let normal = meta.normal
    if (!normal || (normal[0] === 0 && normal[1] === 0 && normal[2] === 0)) {
      if (meta.centroid) {
        normal = [meta.centroid[0] - cx, meta.centroid[1] - cy, meta.centroid[2] - cz]
      }
    }

    if (normal) {
      let nx = normal[0], ny = normal[1], nz = normal[2]

      // Ensure normal vector points outward from part bounding center
      if (meta.centroid) {
        const outX = meta.centroid[0] - cx
        const outY = meta.centroid[1] - cy
        const outZ = meta.centroid[2] - cz
        const dot = nx * outX + ny * outY + nz * outZ
        if (dot < 0) {
          nx = -nx; ny = -ny; nz = -nz
        }
      }

      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len; ny /= len; nz /= len

      const unz = Math.max(-0.9999, Math.min(0.9999, nz))
      const targetPhi = Math.max(0.02, Math.min(Math.PI - 0.02, Math.acos(unz)))
      const targetTheta = Math.atan2(ny, nx)
      const targetDist = Math.max(10, (this.radius || 50) * 3.1)

      this.animateCameraTo(targetTheta, targetPhi, targetDist, 280)
    }
  }

  resetCamera () {
    if (this.bounds) {
      this.target = [
        (this.bounds.minX + this.bounds.maxX) * 0.5,
        (this.bounds.minY + this.bounds.maxY) * 0.5,
        (this.bounds.minZ + this.bounds.maxZ) * 0.5
      ]
      this.currentTarget = [...this.target]
    }
    const targetDist = Math.max(10, (this.radius || 50) * 3.1)
    this.animateCameraTo(-Math.PI / 4, Math.PI / 3.2, targetDist, 240)
  }

  setCameraView (view) {
    if (this.bounds) {
      this.target = [
        (this.bounds.minX + this.bounds.maxX) * 0.5,
        (this.bounds.minY + this.bounds.maxY) * 0.5,
        (this.bounds.minZ + this.bounds.maxZ) * 0.5
      ]
      this.currentTarget = [...this.target]
    }
    const targetDist = Math.max(10, (this.radius || 50) * 3.1)
    let t = -Math.PI / 4, p = Math.PI / 3.2
    if (view === 'iso') {
      t = -Math.PI / 4
      p = Math.PI / 3.2
    } else if (view === 'top') {
      t = 0
      p = 0.02
    } else if (view === 'front') {
      t = -Math.PI / 2
      p = Math.PI / 2
    }
    this.animateCameraTo(t, p, targetDist, 240)
  }

  setPointSize (sz) {
    this.pointSize = Math.max(0.5, sz)
    this.requestRender()
  }

  setTheme (isDark) {
    this.isDark = isDark
    this.requestRender()
  }

  setShowUnassigned (show) {
    this.showUnassigned = !!show
    this.requestRender()
  }

  initEvents () {
    const canvas = this.canvas
    let isDragging = false
    let dragMode = 0 // 0: orbit, 1: pan
    let startX = 0, startY = 0
    let lastX = 0, lastY = 0

    canvas.addEventListener('contextmenu', e => e.preventDefault())

    // High-performance pointer events with subpixel precision
    canvas.addEventListener('pointerdown', e => {
      if (this.animating) {
        cancelAnimationFrame(this.animating)
        this.animating = null
      }
      isDragging = true
      dragMode = (e.button === 2 || e.shiftKey) ? 1 : 0
      startX = e.clientX
      startY = e.clientY
      lastX = e.clientX
      lastY = e.clientY
      canvas.style.cursor = 'grabbing'
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch (err) {}
    })

    canvas.addEventListener('pointermove', e => {
      if (!isDragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY

      if (dragMode === 0) {
        // Butter smooth orbit rotation
        this.targetTheta -= dx * 0.005
        this.targetPhi = Math.max(0.01, Math.min(Math.PI - 0.01, this.targetPhi - dy * 0.005))
      } else {
        // Butter smooth pan
        const panFactor = (this.radius * 0.0014) * (this.targetDistance / Math.max(1, this.radius * 2.0))
        const sinT = Math.sin(this.targetTheta), cosT = Math.cos(this.targetTheta)
        const sinP = Math.sin(this.targetPhi), cosP = Math.cos(this.targetPhi)

        const forward = [-sinP * cosT, -sinP * sinT, -cosP]
        const right = [-sinT, cosT, 0]
        const camUp = [
          right[1] * forward[2] - right[2] * forward[1],
          right[2] * forward[0] - right[0] * forward[2],
          right[0] * forward[1] - right[1] * forward[0]
        ]

        this.target[0] += (-dx * right[0] + dy * camUp[0]) * panFactor
        this.target[1] += (-dx * right[1] + dy * camUp[1]) * panFactor
        this.target[2] += (-dx * right[2] + dy * camUp[2]) * panFactor
      }

      this.startDampingLoop()
    })

    const onPointerUp = e => {
      if (!isDragging) return
      isDragging = false
      canvas.style.cursor = 'grab'
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch (err) {}

      const dist = Math.hypot(e.clientX - startX, e.clientY - startY)
      if (dist < 4 && this.onFaceClick && this.facesMeta.length > 1) {
        this.handleClick(e)
      }
    }

    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)

    // Smooth wheel zoom with delta clamping and inertia damping
    canvas.addEventListener('wheel', e => {
      e.preventDefault()
      if (this.animating) {
        cancelAnimationFrame(this.animating)
        this.animating = null
      }
      const rawDelta = e.deltaY
      const delta = Math.max(-2, Math.min(2, rawDelta * 0.02))
      const zoomFactor = Math.exp(delta * 0.06)
      this.targetDistance = Math.max(this.radius * 0.15, Math.min(this.radius * 12.0, this.targetDistance * zoomFactor))
      this.startDampingLoop()
    }, { passive: false })

    canvas.addEventListener('dblclick', () => {
      this.resetCamera()
    })

    // Resize observer
    if (window.ResizeObserver) {
      new ResizeObserver(() => this.resize()).observe(canvas)
    }
  }

  handleClick (e) {
    if (!this.lastMVP || !this.facesMeta.length) return
    const rect = this.canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight

    // Project each face centroid to screen coordinates
    let bestIdx = -1
    let bestDist = Infinity

    this.facesMeta.forEach((meta, idx) => {
      const c = meta.centroid
      const v = this.project(c, this.lastMVP, w, h)
      if (v && v.z > 0 && v.z < 1) {
        const d = Math.hypot(v.x - mouseX, v.y - mouseY)
        if (d < bestDist && d < 90) {
          bestDist = d
          bestIdx = idx
        }
      }
    })

    if (bestIdx >= 0) {
      this.onFaceClick(bestIdx)
    }
  }

  project (pos, m, w, h) {
    const x = pos[0], y = pos[1], z = pos[2]
    const clipW = m[3] * x + m[7] * y + m[11] * z + m[15]
    if (clipW <= 0) return null
    const clipX = (m[0] * x + m[4] * y + m[8] * z + m[12]) / clipW
    const clipY = (m[1] * x + m[5] * y + m[9] * z + m[13]) / clipW
    const clipZ = (m[2] * x + m[6] * y + m[10] * z + m[14]) / clipW
    return {
      x: (clipX * 0.5 + 0.5) * w,
      y: (1.0 - (clipY * 0.5 + 0.5)) * h,
      z: clipZ
    }
  }

  resize () {
    const canvas = this.canvas
    const dpr = Math.min(2.0, window.devicePixelRatio || 1)
    const w = Math.floor((canvas.clientWidth || 800) * dpr)
    const h = Math.floor((canvas.clientHeight || 500) * dpr)

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      if (this.gl) this.gl.viewport(0, 0, w, h)
      this.requestRender()
    }
  }

  render () {
    if (!this.gl || !this.program || this.totalPoints === 0) return
    const gl = this.gl

    const bg = this.isDark
      ? [28 / 255, 29 / 255, 34 / 255, 1.0]
      : [1.0, 1.0, 1.0, 1.0]

    gl.clearColor(bg[0], bg[1], bg[2], bg[3])
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    gl.useProgram(this.program)

    // Eye position in spherical coordinates (Z up)
    const sinPhi = Math.sin(this.phi)
    const cosPhi = Math.cos(this.phi)
    const sinTheta = Math.sin(this.theta)
    const cosTheta = Math.cos(this.theta)

    const center = this.currentTarget || this.target
    const eye = [
      center[0] + this.distance * sinPhi * cosTheta,
      center[1] + this.distance * sinPhi * sinTheta,
      center[2] + this.distance * cosPhi
    ]

    const aspect = this.canvas.width / Math.max(1, this.canvas.height)
    const near = Math.max(0.1, this.distance * 0.05)
    const far = Math.max(500, this.distance * 10.0)

    const projMat = this.perspective(45 * Math.PI / 180, aspect, near, far)
    const viewMat = this.lookAt(eye, center, this.up)
    const mvpMat = this.multiply(projMat, viewMat)
    this.lastMVP = mvpMat

    gl.uniformMatrix4fv(this.uniforms.mvp, false, mvpMat)
    gl.uniform1f(this.uniforms.pointSize, this.pointSize * (window.devicePixelRatio || 1))
    gl.uniform1f(this.uniforms.activePatchIndex, this.activePatchIndex)
    gl.uniform1f(this.uniforms.showUnassigned, this.showUnassigned ? 1.0 : 0.0)

    // Bind Buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
    gl.enableVertexAttribArray(this.attribs.position)
    gl.vertexAttribPointer(this.attribs.position, 3, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
    gl.enableVertexAttribArray(this.attribs.color)
    gl.vertexAttribPointer(this.attribs.color, 3, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.patchBuffer)
    gl.enableVertexAttribArray(this.attribs.patchIndex)
    gl.vertexAttribPointer(this.attribs.patchIndex, 1, gl.FLOAT, false, 0, 0)

    // Fast Single GPU Draw Call for ALL raw points!
    gl.drawArrays(gl.POINTS, 0, this.totalPoints)
  }

  perspective (fovRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovRad / 2)
    const nf = 1 / (near - far)
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ])
  }

  lookAt (eye, center, up) {
    let z0 = eye[0] - center[0]
    let z1 = eye[1] - center[1]
    let z2 = eye[2] - center[2]
    let len = 1 / (Math.hypot(z0, z1, z2) || 1)
    z0 *= len; z1 *= len; z2 *= len

    let upX = up[0], upY = up[1], upZ = up[2]

    // Cross product up x z
    let x0 = upY * z2 - upZ * z1
    let x1 = upZ * z0 - upX * z2
    let x2 = upX * z1 - upY * z0
    let xLen = Math.hypot(x0, x1, x2)
    if (xLen < 1e-6) {
      x0 = -Math.sin(this.theta || 0)
      x1 = Math.cos(this.theta || 0)
      x2 = 0
    } else {
      x0 /= xLen; x1 /= xLen; x2 /= xLen
    }

    // Cross product z x right
    let y0 = z1 * x2 - z2 * x1
    let y1 = z2 * x0 - z0 * x2
    let y2 = z0 * x1 - z1 * x0
    let yLen = Math.hypot(y0, y1, y2) || 1
    y0 /= yLen; y1 /= yLen; y2 /= yLen

    return new Float32Array([
      x0, y0, z0, 0,
      x1, y1, z1, 0,
      x2, y2, z2, 0,
      -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]),
      -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
      -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]),
      1
    ])
  }

  multiply (a, b) {
    const out = new Float32Array(16)
    for (let i = 0; i < 4; i++) {
      const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12]
      out[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3]
      out[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7]
      out[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11]
      out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15]
    }
    return out
  }
}

if (typeof window !== 'undefined') {
  window.PointCloudViewer = PointCloudViewer
}
