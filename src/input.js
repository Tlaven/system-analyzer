import { state, config, DRAG_TH, PALETTES } from './state.js'
import { render, updateTooltip } from './renderer.js'
import { pushUndo, undo, selectInstance, selectEdge, deselectAll, delNode, delEdge } from './editor.js'
window.selectInstance = selectInstance
import { startPhysics, stopPhysics, applyLayout, fitToView } from './physics.js'
import { importJSON, save, onExport, onNew, shareURL, resetRuntime, syncCodeFromRuntime, wrapInstance, wrapAllInstances } from './io.js'
import { deriveEdges, invalidateEdges } from './codegraph.js'
import { toggleCodeView, commitCodeNow, setCodeViewReadOnly } from './codeview.js'
import { loadConfig, saveConfig, applyTheme } from './config.js'
import { showNodePanel, showEdgePanel } from './panel.js'
import { showModal } from './modal.js'
import { cCoords, screenToWorld, hitNode, hitHandle, hitEdge, hitPort, getNodeRect, rectEdge, isEditing, detectSnap, esc, isValidIdentifier, suggestUniqueVarName } from './utils.js'
import { stepAll, propagate, runTransforms } from './engine.js'
import { splitSource } from './parser.js'
import { runSource, _equal, formatValue } from './codegraph.js'

// 测试与调试钩子
window.state = state
window.config = config
window.propagate = propagate
window.deriveEdges = () => deriveEdges(state)
window.invalidateEdges = invalidateEdges
window.__sa_test = window.__sa_test || {}
window.__sa_test.importJSON = importJSON
window.setEditMode = setEditMode
// v0.7 Phase 5: 暴露给测试用的辅助函数
window.selectEdge = selectEdge
window.wrapInstance = wrapInstance
window.showNodePanel = showNodePanel
window.showEdgePanel = showEdgePanel
window.runSource = runSource
window.syncCodeFromRuntime = syncCodeFromRuntime

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
window.toggleBurger = () => { alert('System Analyzer v0.9\n双模式编辑（UI / Code）+ 实例级 edges 模型') }
window.save = save
window.resetRuntime = resetRuntime
window.toggleCodeView = toggleCodeView
window.commitCodeNow = commitCodeNow
window.stepOnce = stepAll
window.stepAll = stepAll
window.runTransforms = runTransforms
window.setExecMode = function(val) {
  config.execMode = val; saveConfig()
  const stepBtn = document.getElementById('step-btn')
  if (stepBtn) stepBtn.style.display = val === 'step' ? '' : 'none'
  if (val === 'auto') { state.tickCount = 0 }
  const pr = document.getElementById('propagate-row')
  if (pr) pr.style.display = val === 'manual' ? 'flex' : 'none'
  render()
}
window.runPropagate = function(instId) { propagate(instId); render() }

// v0.7 Phase 2：UI 模式新建/复制节点入口（Code 模式不响应）
window.createNode = createNode
window.copySelectedNode = () => { if (state.selInstance) copyInstance(state.selInstance) }
window.copyInstance = copyInstance  // 给测试和 panel 直接传 inst 用
// 兼容旧调用（实测无 HTML 引用，保险留 stub）
window.instantiateClass = createNode

// ============================================================
// v0.7 双模式切换：UI 编辑 ↔ 代码
// ============================================================

// 启发式检测 sourceCode 是否含程序化结构或方法体（Code→UI 切换时用）
// 含：for/while/if/switch/function/=> 控制流，或 class 内非 constructor 方法
function isSourceCodeProgrammatic(code) {
  if (!code) return false
  // 控制流关键字（在 class 外的启动段也算）
  const controlFlowRe = /\b(?:for\s*\(|while\s*\(|if\s*\(|switch\s*\(|function\b|=>)/
  if (controlFlowRe.test(code)) return true
  // class 内非 constructor 方法
  try {
    const { classes } = splitSource(code)
    for (const c of classes) {
      // 匹配 `<ident>(<params>) {` 且不是 constructor
      const methodRe = /\b([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/g
      let m
      while ((m = methodRe.exec(c.source))) {
        if (m[1] !== 'constructor') return true
      }
    }
  } catch (_) { /* splitSource 失败：保守起见视为程序化 */ return true }
  return false
}

// 切换编辑模式
function setEditMode(mode) {
  if (mode !== 'ui' && mode !== 'code') return
  if (state.editMode === mode) return

  if (mode === 'code') {
    // UI → Code：无损切换。声明式 sourceCode 本来就是合法的 Code 模式代码。
    state.editMode = 'code'
    setCodeViewReadOnly(false)
    // 打开 codeview 让用户看见
    const cp = document.getElementById('code-panel')
    if (cp && cp.classList.contains('hidden')) cp.classList.remove('hidden')
    // panel 切到只读：重新渲染当前选中（如有）
    if (state.selInstance) showNodePanel(state.selInstance)
    updateEditModeUI()
    save()
    return
  }

  // Code → UI：检查是否含方法体/控制流
  if (isSourceCodeProgrammatic(state.sourceCode)) {
    const ok = confirm(
      '当前代码含方法体或程序化结构。\n\n' +
      '切换到 UI 模式会丢弃这些（class 段会从实例反向重建，丢方法体、注释、控制流）。\n\n' +
      '是否继续？'
    )
    if (!ok) {
      // 用户取消：UI 同步回 segmented control 选中状态
      updateEditModeUI()
      return
    }
    // 反向构建：serializeCode 重写 sourceCode（class 段从 state.classes 构建，丢方法体）
    pushUndo()
    syncCodeFromRuntime()  // 把当前 runtimeInstances 序列化回声明式 sourceCode
    // 重新 runSource 同步 state.classes 与新（无方法体）sourceCode
    try {
      runSource(state.sourceCode, state)
      wrapAllInstances()
    } catch (e) {
      alert('反向构建失败：' + e.message)
      updateEditModeUI()
      return
    }
  }

  state.editMode = 'ui'
  setCodeViewReadOnly(true)
  if (state.selInstance) showNodePanel(state.selInstance)
  updateEditModeUI()
  save()
  render()
}

// 更新工具栏 segmented control 的视觉状态 + + 按钮启用/禁用
export function updateEditModeUI() {
  document.querySelectorAll('.edit-mode-btn').forEach(btn => {
    const active = btn.dataset.mode === state.editMode
    btn.classList.toggle('active', active)
  })
  // Code 模式下 + 按钮禁用（保持 Code 模式纯净）
  const addBtn = document.getElementById('add-node-btn')
  if (addBtn) {
    addBtn.disabled = state.editMode === 'code'
    addBtn.style.opacity = state.editMode === 'code' ? '0.4' : ''
    addBtn.style.cursor = state.editMode === 'code' ? 'not-allowed' : 'pointer'
  }
}

// ============================================================
// v0.7 Phase 2：新建/复制节点(showModal 已抽到 modal.js)
// ============================================================

// 在 sourceCode 的 class 段末尾追加新 class 模板，启动段末尾追加 add 调用
// 注意 v0.7：add() 第二参数显式 varName，让 runtimeInstance.varName 与 JS const 名一致
function appendInstanceToSource(sourceCode, { className, varName, isNewClass }) {
  const { classes, bootstrap } = splitSource(sourceCode)
  // 重组：原 class 段 + （可选）新 class + '\n\n' + 原 bootstrap + 新 add 调用
  const classSources = classes.map(c => c.source)
  if (isNewClass) {
    classSources.push(buildEmptyClassSource(className))
  }
  const newBootstrapLine = `const ${varName} = GraphStarter.add(${className}, ${JSON.stringify(varName)})`
  const newBootstrap = bootstrap ? (bootstrap.trimEnd() + '\n' + newBootstrapLine) : newBootstrapLine
  const classSection = classSources.join('\n\n')
  if (!classSection) return newBootstrap + '\n'
  return classSection + '\n\n' + newBootstrap + '\n'
}

// 空类模板——与 serializeCode 输出格式严格一致（v0.9：3 字段，无 name 无 edges）
function buildEmptyClassSource(className) {
  return `class ${className} {
  description = ''
  attrs = {}
}`
}

// 构造复制块：add 调用 + override + edges 数组
function buildCopyBlock(srcInst, newVar) {
  const cls = state.classes[srcInst.className]
  const clsAttrs = (cls && cls.attrs) || {}
  const lines = [`const ${newVar} = GraphStarter.add(${srcInst.className}, ${JSON.stringify(newVar)})`]
  for (const key of Object.keys(srcInst.attrs)) {
    if (key.startsWith('__')) continue
    if (key === 'edges') continue   // edges 单独处理
    const defaultVal = clsAttrs[key]
    const curVal = srcInst.attrs[key]
    if (!_equal(defaultVal, curVal)) {
      lines.push(`${newVar}.${key} = ${formatValue(curVal)}`)
    }
  }
  // edges 数组复制（target 引用原样保留——指向相同目标实例）
  const edges = srcInst.attrs.edges
  if (Array.isArray(edges) && edges.length > 0) {
    const items = edges.map(e => {
      const tgtVar = (e && e.target && e.target.__instId)
        ? e.target.__instId.varName
        : 'null'
      const desc = (e && e.description != null) ? e.description : ''
      return `    { target: ${tgtVar}, description: ${formatValue(desc)} }`
    })
    lines.push(`${newVar}.edges = [\n` + items.join(',\n') + '\n  ]')
  }
  return lines.join('\n')
}

// 新建节点：modal 收集 className + varName → 追加 sourceCode → runSource
export async function createNode() {
  return createNodeAt(viewportCenterWorld().x, viewportCenterWorld().y)
}

// 在指定世界坐标新建节点（双击空白时用 click 坐标）
export async function createNodeAt(worldX, worldY) {
  if (state.editMode === 'code') return
  const existingClasses = Object.keys(state.classes)
  const values = await showModal({
    title: '新建节点',
    submitLabel: '创建',
    fields: [
      {
        name: 'className',
        label: 'Class 名（已有的可选，或输入新名）',
        type: 'datalist',
        options: existingClasses,
        default: '',
        validate: v => !isValidIdentifier(v) ? '需为合法 JS 标识符（字母/$/_ 开头）' : null,
      },
      {
        name: 'varName',
        label: '变量名',
        type: 'text',
        default: '',
        validate: (v, all) => {
          if (!isValidIdentifier(v)) return '需为合法 JS 标识符'
          if (state.runtimeInstances.some(i => i.varName === v)) return '与现有变量名冲突'
          return null
        },
      },
    ],
  })
  if (!values) return
  // 根据填的 className 动态算 varName 默认（用户没填时）
  let varName = values.varName
  if (!varName) {
    varName = suggestUniqueVarName(values.className + '_1')
  }

  pushUndo()
  const isNewClass = !existingClasses.includes(values.className)
  state.sourceCode = appendInstanceToSource(state.sourceCode, {
    className: values.className,
    varName,
    isNewClass,
  })
  // 预设位置，避免 spreadUnpositioned 移到默认位
  state.visualState.positions[varName] = { x: worldX, y: worldY }
  try {
    runSource(state.sourceCode, state)
  } catch (e) {
    alert('新建节点失败：' + e.message)
    return
  }
  wrapAllInstances()
  const newInst = state.runtimeInstances.find(i => i.varName === varName)
  save()
  render()
  if (newInst) {
    selectInstance(newInst)
    showNodePanel(newInst)
  }
}

// 复制节点：modal 收集新 varName → 追加 sourceCode 复制块
export async function copyInstance(srcInst) {
  if (state.editMode === 'code') return
  if (!srcInst) return
  const suggested = suggestUniqueVarName(srcInst.varName + '_2')
  const values = await showModal({
    title: '复制 ' + srcInst.varName,
    submitLabel: '复制',
    fields: [
      {
        name: 'varName',
        label: '新变量名',
        type: 'text',
        default: suggested,
        validate: v => {
          if (!isValidIdentifier(v)) return '需为合法 JS 标识符'
          if (state.runtimeInstances.some(i => i.varName === v)) return '与现有变量名冲突'
          return null
        },
      },
    ],
  })
  if (!values) return
  pasteInstanceInternal(srcInst, values.varName)
}

// Ctrl+V 粘贴：不弹 modal，varName 用 `<原>_1` 起，冲突自动 `_2`、`_3`
export function pasteInstanceNoModal(srcInst) {
  if (state.editMode === 'code') return
  if (!srcInst) return
  const used = new Set(state.runtimeInstances.map(i => i.varName))
  let n = 1
  while (used.has(srcInst.varName + '_' + n)) n++
  pasteInstanceInternal(srcInst, srcInst.varName + '_' + n)
}

// 内部：执行复制（构造 sourceCode + runSource + 选中）
function pasteInstanceInternal(srcInst, newVar) {
  pushUndo()
  const copyBlock = buildCopyBlock(srcInst, newVar)
  const { classes, bootstrap } = splitSource(state.sourceCode)
  const classSection = classes.map(c => c.source).join('\n\n')
  const newBootstrap = bootstrap ? (bootstrap.trimEnd() + '\n' + copyBlock) : copyBlock
  state.sourceCode = classSection
    ? classSection + '\n\n' + newBootstrap + '\n'
    : newBootstrap + '\n'

  const srcPos = state.visualState.positions[srcInst.varName] || { x: 0, y: 0 }
  state.visualState.positions[newVar] = { x: srcPos.x + 40, y: srcPos.y + 40 }
  const srcColor = state.visualState.colors[srcInst.varName]
  if (srcColor) state.visualState.colors[newVar] = srcColor

  try {
    runSource(state.sourceCode, state)
  } catch (e) {
    alert('复制失败：' + e.message)
    return
  }
  wrapAllInstances()
  const newInst = state.runtimeInstances.find(i => i.varName === newVar)
  save()
  render()
  if (newInst) {
    selectInstance(newInst)
    showNodePanel(newInst)
  }
}

// 拖边 mouseup：源 → 目标，直接 push { target, description } 到 srcInst.attrs.edges
async function createEdgeFromDrag(srcInst, targetInst) {
  if (state.editMode === 'code') return
  // 收集边描述（可选）
  const values = await showModal({
    title: '连接 ' + srcInst.varName + ' → ' + targetInst.varName,
    submitLabel: '连',
    fields: [
      { name: 'description', label: '边描述（可选）', type: 'text', default: '' },
    ],
  })
  if (!values) return
  pushUndo()
  if (!Array.isArray(srcInst.attrs.edges)) srcInst.attrs.edges = []
  srcInst.attrs.edges.push({ target: targetInst.attrs, description: values.description })
  invalidateEdges()
  syncCodeFromRuntime(); render()
  showNodePanel(srcInst)
}

// viewport 中心的世界坐标
function viewportCenterWorld() {
  return screenToWorld(window.innerWidth / 2, window.innerHeight / 2)
}


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
const keyToEl = { infoLevel: 'sel-info', edgeStyle: 'sel-edge', edgeAnim: 'sel-anim', positionMode: 'sel-pos' }

function applyConstraints(changedKey, changedVal) {
  const changes = {}
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

// v0.10: 布局方向切换（hierarchical 布局 + 端口方向共用，但当前只直接影响 hierarchical）
window.setLayoutDirection = function(val) {
  config.layoutDirection = val
  saveConfig()
  // 若当前是 hierarchical，重跑一次以应用新方向
  if (config.layout === 'hierarchical') applyLayout('hierarchical')
  else render()
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
// v0.7 Phase 5: state.selEdge 现在存 id 字符串（活过 runSource）；window.selEdge 暴露 resolved 对象（兼容旧 HTML）
Object.defineProperty(window, 'selEdge', {
  get() {
    const id = state.selEdge
    if (!id) return null
    return deriveEdges(state).find(e => e.id === id) || null
  },
  set(v) {
    if (v && typeof v === 'object') state.selEdge = v.id
    else state.selEdge = v
  },
})

// ============================================================
// Canvas event handlers
// ============================================================

export function initInput() {
  const canvas = document.getElementById('canvas')

  // v0.13: 监听引擎 sa-tick 事件,更新 step-btn 文本 + 重绘(engine.js 不再直读 DOM)
  window.addEventListener('sa-tick', (e) => {
    const stepBtn = document.getElementById('step-btn')
    if (stepBtn) stepBtn.textContent = '▶ 下一步 (#' + e.detail.tickCount + ')'
    render()
  })

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

    // 拖柄优先（仅 selInstance 存在 + UI 模式）：选中节点的 4 个边缘中点圆点
    if (state.editMode === 'ui' && state.selInstance) {
      const handleHit = hitHandle(p.x, p.y)
      if (handleHit) {
        state.mode = 'edge'
        state.edgeSrcId = handleHit.varName
        state.tempEnd = { x: p.x, y: p.y }
        return
      }
    }
    const n = hitNode(p.x, p.y)
    if (n) {
      state.mode = 'move'; state.dragInstance = n
      if (config.positionMode === 'elastic' && !('vx' in n)) { n.vx = 0; n.vy = 0 }
      return
    }
    const ed = hitEdge(p.x, p.y)
    if (ed) {
      // ADR-003 OQ#1：点边 = 选中边 + 弹独立边 panel(跟节点 panel 平级)
      selectEdge(ed)
      showEdgePanel(ed.id)
      return
    }
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
    if (state.isDown && state.mode === 'edge') {
      state.tempEnd = { x: p.x, y: p.y }
      render()
      return
    }
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
    const edge = n ? null : hitEdge(p.x, p.y)
    const newHoverEdge = edge ? edge.id : null
    if (n !== state.hoverInstance || newHoverEdge !== state.hoverEdge) {
      state.hoverInstance = n
      state.hoverEdge = newHoverEdge
      render()
    }
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
    if (state.mode === 'edge') {
      const p = cCoords(e)
      const target = hitNode(p.x, p.y)
      const srcVar = state.edgeSrcId
      // 清理 edge 模式状态
      state.mode = null
      state.edgeSrcId = null
      state.tempEnd = null
      state.isDown = false
      if (target && srcVar) {
        const src = state.runtimeInstances.find(i => i.varName === srcVar)
        if (src && target !== src) {
          createEdgeFromDrag(src, target)
        }
      }
      render()
      return
    }
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
    // v0.7 Phase 2：双击空白新建节点（UI 模式）
    if (state.editMode === 'code') return
    const p = cCoords(e)
    if (hitNode(p.x, p.y) || hitEdge(p.x, p.y)) return
    createNodeAt(p.x, p.y)
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
    // v0.8：Ctrl+C 复制当前选中实例 varName 到 state.clipboard（UI 模式 + canvas focus）
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !isEditing() && state.selInstance && state.editMode === 'ui') {
      e.preventDefault()
      state.clipboard = state.selVarName
      return
    }
    // v0.8：Ctrl+V 不弹 modal，varName `_1` 起，冲突 `_2` `_3` ...
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !isEditing() && state.editMode === 'ui') {
      e.preventDefault()
      if (state.clipboard) {
        const src = state.runtimeInstances.find(i => i.varName === state.clipboard)
        if (src) pasteInstanceNoModal(src)
      }
      return
    }
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
  const ldir = document.getElementById('sel-layout-dir')
  if (ldir) ldir.value = config.layoutDirection || 'TB'
  document.getElementById('sel-edge').value = config.edgeStyle
  document.getElementById('sel-info').value = config.infoLevel
  document.getElementById('sel-pos').value = config.positionMode
  document.getElementById('sel-anim').value = config.edgeAnim
  document.getElementById('sel-exec').value = config.execMode || 'off'
  if (config.execMode === 'step') document.getElementById('step-btn').style.display = ''

  // v0.7: 同步 segmented control 视觉态（reload 后 state.editMode 可能是 'code'）
  updateEditModeUI()
  // 同步 codeview readOnly（reload 后 mountCodeView 已用初始 editMode，但 segmented control 视觉需要这里补一次）

  console.log('✓ Input initialized')
}
