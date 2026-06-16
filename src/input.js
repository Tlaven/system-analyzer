import { state, config, DRAG_TH, PALETTES } from './state.js'
import { render, updateTooltip } from './renderer.js'
import { pushUndo, undo, selectInstance, selectEdge, deselectAll, delNode, delEdge } from './editor.js'
import { startPhysics, stopPhysics, applyLayout, fitToView } from './physics.js'
import { importJSON, save, onExport, onNew, shareURL, deriveEdges, resetRuntime } from './io.js'
import { toggleCodeView, commitCodeNow } from './codeview.js'
import { loadConfig, saveConfig, applyTheme } from './config.js'
import { showNodePanel, showEdgePanel } from './panel.js'
import { cCoords, screenToWorld, hitNode, hitEdge, hitPort, getNodeRect, rectEdge, isEditing, detectSnap, esc } from './utils.js'
import { stepAll, propagate } from './engine.js'

// 测试与调试钩子
window.state = state
window.config = config
window.propagate = propagate
window.deriveEdges = deriveEdges
window.__testImport = importJSON

// ============================================================
// Register all functions needed by inline onclick handlers in HTML
// ============================================================
window.onExport = onExport
window.onNew = onNew
window.fitToView = fitToView
window.shareURL = shareURL
window.applyLayout = applyLayout
window.delNode = n => delNode(n)
window.delEdge = e => delEdge(e)
window.resetZoom = () => { state.viewScale = 1; render() }
window.toggleBurger = () => { alert('System Analyzer v0.6\nCode-as-truth + GraphStarter') }
window.save = save
window.resetRuntime = resetRuntime
window.toggleCodeView = toggleCodeView
window.commitCodeNow = commitCodeNow
window.stepOnce = stepAll
window.stepAll = stepAll
window.setExecMode = function(val) {
  config.execMode = val; saveConfig()
  const stepBtn = document.getElementById('step-btn')
  if (stepBtn) stepBtn.style.display = val === 'step' ? '' : 'none'
  if (val === 'auto') { state.tickCount = 0 }
  const pr = document.getElementById('propagate-row')
  if (pr) pr.style.display = val === 'manual' ? 'flex' : 'none'
  render()
}
window.runPropagate = function(instId) { propagate(instId) }

// v0.6：实例化改在代码编辑器里写 GraphStarter.add()；面板点击已禁用
window.instantiateClass = function(_classId) {
  alert('v0.6 实例化方式：打开代码编辑器（</> 按钮），在启动代码段加一行\n  const <varName> = GraphStarter.add(<ClassName>)')
}

// Menu system
window.toggleMenu = function(name) {
  const trig = document.querySelector(`.menu-trigger[data-menu="${name}"]`)
  const menu = document.querySelector(`.dropdown-menu[data-menu="${name}"]`)
  if (!trig || !menu) return
  const isOpen = menu.classList.contains('open')
  closeAllMenus()
  if (!isOpen) { menu.classList.add('open'); trig.classList.add('open') }
}

function closeAllMenus() {
  document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'))
  document.querySelectorAll('.menu-trigger.open').forEach(t => t.classList.remove('open'))
}

// ── Hierarchical config constraints ──
const keyToEl = { infoLevel: 'sel-info', nodeShape: 'sel-shape', edgeStyle: 'sel-edge', edgeAnim: 'sel-anim', positionMode: 'sel-pos' }

function applyConstraints(changedKey, changedVal) {
  const changes = {}
  if (changedKey === 'infoLevel' && (changedVal === 'medium' || changedVal === 'full')) {
    if (config.nodeShape !== 'rounded') changes.nodeShape = 'rounded'
  }
  if (changedKey === 'edgeAnim' && changedVal !== 'none') {
    if (config.positionMode !== 'elastic') changes.positionMode = 'elastic'
  }
  if (changedKey === 'positionMode' && changedVal === 'manual') {
    if (config.edgeAnim !== 'none') changes.edgeAnim = 'none'
  }
  return changes
}

function syncUI(changes) {
  for (const [k, v] of Object.entries(changes)) {
    const el = document.getElementById(keyToEl[k])
    if (el && el.value !== v) el.value = v
  }
}

function applyAllChanges(allChanges) {
  for (const [k, v] of Object.entries(allChanges)) {
    if (k === 'positionMode') {
      if (v === 'elastic') startPhysics(); else stopPhysics()
    }
    if (k === 'edgeAnim' && v !== 'none' && config.positionMode === 'elastic') startPhysics()
    if (k === 'infoLevel') {
      const infoDesc = document.getElementById('info-desc')
      if (infoDesc) infoDesc.textContent = v
    }
  }
}

window.onStyleChange = function(key, val) {
  config[key] = val
  const cascade = applyConstraints(key, val)
  for (const [k, v] of Object.entries(cascade)) config[k] = v
  const all = { [key]: val, ...cascade }
  syncUI(all)
  saveConfig()
  applyAllChanges(all)
  render()
}

window.setPositionMode = function(val) {
  config.positionMode = val
  const cascade = applyConstraints('positionMode', val)
  for (const [k, v] of Object.entries(cascade)) config[k] = v
  const all = { positionMode: val, ...cascade }
  syncUI(all)
  saveConfig()
  applyAllChanges(all)
  render()
}

window.setBrightness = function(val) {
  config.brightness = parseInt(val) || 0
  const lbl = document.getElementById('brightness-label')
  if (lbl) lbl.textContent = val + '%'
  applyTheme()
  saveConfig()
  render()
}

// Bridge for inline onclick handlers in panel HTML that reference selNode/selEdge as globals
Object.defineProperty(window, 'selNode', { get: () => state.selInstance, set: v => { state.selInstance = v } })
Object.defineProperty(window, 'selEdge', { get: () => state.selEdge, set: v => { state.selEdge = v } })

// ============================================================
// Canvas event handlers
// ============================================================

export function initInput() {
  const canvas = document.getElementById('canvas')

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.menu-group') && !e.target.closest('.dropdown-menu') && !e.target.closest('.menu-trigger')) {
      closeAllMenus()
    }
  })

  // --- Canvas mouse events ---
  canvas.onmousedown = function(e) {
    document.getElementById('tip').classList.add('hidden')
    const p = cCoords(e); state.mPos = p

    if (e.button === 2 || e.button === 1 || (e.button === 0 && state.spaceHeld)) {
      state.panState = { startX: e.clientX, startY: e.clientY, viewX: state.viewX, viewY: state.viewY }
      canvas.style.cursor = 'grabbing'
      e.preventDefault()
      return
    }

    if (e.button !== 0) return
    state.isDown = true; state.sX = p.x; state.sY = p.y; state.moved = false

    const n = hitNode(p.x, p.y)
    if (n) {
      state.mode = 'move'; state.dragInstance = n
      if (config.positionMode === 'elastic' && !('vx' in n)) { n.vx = 0; n.vy = 0 }
      return
    }
    const ed = hitEdge(p.x, p.y)
    if (ed) { selectEdge(ed); showEdgePanel(ed); return }
    deselectAll(); render()
  }

  document.onmousemove = function(e) {
    state.mouseSX = e.clientX; state.mouseSY = e.clientY
    if (state.panState) {
      state.viewX = state.panState.viewX + (e.clientX - state.panState.startX)
      state.viewY = state.panState.viewY + (e.clientY - state.panState.startY)
      document.getElementById('tip').classList.add('hidden'); render()
      return
    }
    const p = cCoords(e); state.mPos = p
    if (state.isDown && state.mode === 'move') {
      const dx = p.x - state.sX, dy = p.y - state.sY
      if (Math.hypot(dx, dy) > DRAG_TH && !state.moved) {
        state.moved = true
        if (config.positionMode !== 'elastic') pushUndo()
        else { state.sX = p.x; state.sY = p.y }
      }
      if (state.moved && state.dragInstance) {
        if (config.positionMode !== 'elastic') {
          state.dragInstance.x += dx; state.dragInstance.y += dy
          state.sX = p.x; state.sY = p.y
          const lines = detectSnap(state.dragInstance, state.instances)
          state.snapLines = lines
          if (lines.length) {
            const sl = lines[0]
            if (sl.axis === 'x') state.dragInstance.x += sl.off
            else state.dragInstance.y += sl.off
          }
          render()
        } else render()
      }
      return
    }
    const n = hitNode(p.x, p.y)
    if (n !== state.hoverInstance) { state.hoverInstance = n; render() }
    updateTooltip()
  }

  document.onmouseup = function(e) {
    if (state.panState) {
      state.panState = null
      canvas.style.cursor = state.spaceHeld ? 'grab' : 'default'
      return
    }
    if (!state.isDown) return
    state.snapLines = []
    if (state.mode === 'move') {
      if (!state.moved && state.dragInstance) {
        selectInstance(state.dragInstance); showNodePanel(state.dragInstance)
      } else if (state.moved && state.dragInstance && config.positionMode !== 'elastic') {
        save()
      }
      state.mode = null; state.dragInstance = null
    }
    state.isDown = false
    updateTooltip()
  }

  canvas.onwheel = function(e) {
    e.preventDefault()
    const r = canvas.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const oldS = state.viewScale
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1
    const ns = Math.max(0.1, Math.min(5, oldS * f))
    state.viewX = mx - (mx - state.viewX) / oldS * ns
    state.viewY = my - (my - state.viewY) / oldS * ns
    state.viewScale = ns
    render()
  }

  canvas.ondblclick = function(e) {
    // 新模型下双击空白不创建实例。用户从左侧 class 库面板点击/拖拽来实例化。
    const p = cCoords(e)
    if (hitNode(p.x, p.y) || hitEdge(p.x, p.y)) return
  }

  canvas.oncontextmenu = e => e.preventDefault()

  // --- Keyboard events ---
  document.onkeydown = function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      const si = document.getElementById('search-input')
      if (si) si.focus()
      return
    }
    if (e.key === ' ' && !isEditing()) {
      state.spaceHeld = true
      if (!state.panState) canvas.style.cursor = 'grab'
      e.preventDefault()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditing()) {
      e.preventDefault()
      if (state.selInstance) delNode(state.selInstance)
      else if (state.selEdge) delEdge(state.selEdge)
    }
  }

  document.onkeyup = function(e) {
    if (e.key === ' ') {
      state.spaceHeld = false
      if (!state.panState) canvas.style.cursor = 'default'
    }
  }

  // --- DOM events ---
  document.getElementById('title-text').onclick = function() {
    const inp = document.createElement('input')
    inp.type = 'text'; inp.value = state.graphTitle
    inp.className = 'title-input'
    inp.style.width = Math.max(80, Math.min(200, state.graphTitle.length * 9)) + 'px'
    this.replaceWith(inp); inp.focus(); inp.select()
    const done = () => {
      const v = inp.value.trim()
      if (v && v !== state.graphTitle) {
        pushUndo(); state.graphTitle = v
        document.getElementById('title-text').textContent = v
        save()
      }
      inp.replaceWith(document.getElementById('title-text'))
    }
    inp.onblur = done
    inp.onkeydown = function(e) {
      if (e.key === 'Enter') { inp.blur(); e.preventDefault() }
      if (e.key === 'Escape') { inp.value = state.graphTitle; inp.blur(); e.preventDefault() }
    }
  }

  document.getElementById('import-input').onchange = function(e) {
    const file = e.target.files[0]; if (!file) return
    const r = new FileReader()
    r.onload = function(ev) {
      try {
        // v0.6: .js 文件直接当 sourceCode 导入；.json 文件按旧 wrapper 解析
        const text = ev.target.result
        let data
        try {
          data = JSON.parse(text)
          if (!data.sourceCode) throw 0
        } catch (_) {
          // 不是 JSON，当成裸 sourceCode
          data = { sourceCode: text, title: file.name.replace(/\.js$/i, '') }
        }
        pushUndo(); importJSON(data); save(); render()
      } catch (err) { alert('导入失败：' + err.message) }
    }
    r.readAsText(file)
    this.value = ''
  }

  document.getElementById('panel-close').onclick = () => { deselectAll(); render() }

  const searchInput = document.getElementById('search-input')
  if (searchInput) {
    searchInput.oninput = function() {
      state.searchQuery = this.value
      render()
    }
    searchInput.onkeydown = function(e) {
      if (e.key === 'Enter') {
        const q = this.value.toLowerCase()
        const match = state.instances.find(n => (n.label || '').toLowerCase().includes(q))
        if (match) {
          state.viewX = window.innerWidth / 2 - match.x * state.viewScale
          state.viewY = window.innerHeight / 2 - match.y * state.viewScale
          render()
        }
      }
      if (e.key === 'Escape') {
        this.value = ''; state.searchQuery = ''; render(); this.blur()
      }
      e.stopPropagation()
    }
  }

  // --- Palette grid population ---
  const grid = document.getElementById('palette-grid')
  if (grid) {
    Object.entries(PALETTES).forEach(([key, p]) => {
      const el = document.createElement('div')
      el.className = 'palette-item' + (config.palette === key ? ' active' : '')
      el.textContent = p.name
      el.onclick = () => {
        config.palette = key
        saveConfig()
        document.querySelectorAll('.palette-item').forEach(i => i.classList.remove('active'))
        el.classList.add('active')
        applyTheme(); render(); closeAllMenus()
      }
      grid.appendChild(el)
    })
  }

  // v0.6: class-library 面板已删除，class 信息通过 codeview 查看

  // --- Sync UI controls ---
  const bs = document.getElementById('brightness-slider')
  if (bs) bs.value = config.brightness || 0
  document.getElementById('sel-layout').value = config.layout
  document.getElementById('sel-edge').value = config.edgeStyle
  document.getElementById('sel-shape').value = config.nodeShape
  document.getElementById('sel-info').value = config.infoLevel
  document.getElementById('sel-pos').value = config.positionMode
  document.getElementById('sel-anim').value = config.edgeAnim
  document.getElementById('sel-exec').value = config.execMode || 'off'
  if (config.execMode === 'step') document.getElementById('step-btn').style.display = ''

  console.log('✓ Input initialized')
}
