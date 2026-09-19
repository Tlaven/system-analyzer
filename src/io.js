// v0.6 code-as-truth 数据管线
//
// 核心变化（vs v0.5）：
//   - state.sourceCode 是唯一真相源；runtimeInstances 是派生（runSource 得到）
//   - save/load: localStorage.sa_data 存 {version:3, sourceCode, visualState, ...}
//   - shareURL: 编码 sourceCode（base64）
//   - deriveEdges: v0.13 已迁出到 codegraph.js(lazy 缓存 + invalidateEdges)
//   - wrapInstance: 给 RuntimeInstance 加 v0.5 node 形状的 getter，让 renderer/utils 不用大改
//   - 删除 snapshotAttrs/rehydrateReferences/snapshotInstances/restoreInstances
//     （attrs 上的引用就是 attrs 对象，无需身份转换）

import { state } from './state.js'
import { render } from './renderer.js'
import { pushUndo } from './editor.js'
import { applyLayout, fitToView, spreadUnpositioned } from './physics.js'
import { toB64 } from './utils.js'
import { runSource, serializeCode } from './codegraph.js'
import { isSourceCodeProgrammatic, classifySource } from './parser.js'
import { DEFAULT_BOOTSTRAP } from './bootstrap.js'

// ============ loadError 保护 ============
// sourceCode 存了但 runSource 失败(语法错/悬空引用)时:
//   - load() 返回 false 走空画布,但 sa_data 完好
//   - save() 拒绝覆盖 sa_data,否则空图下一次编辑就抹掉用户数据
//   - loadError 由"成功操作"清除:onNew / importJSON / codeview 修好 commitCode
export function hasLoadError() { return !!state.loadError }
export function clearLoadError() {
  if (state.loadError) { state.loadError = null; save() }
}

// ============ wrapInstance — 给 RuntimeInstance 加 v0.5 node 形状的 getter ============
//
// 让 renderer/utils 等下游代码无须大改即可工作。RuntimeInstance 本身保持简单
// （只含 varName/className/attrs/edgeMeta/_topoError/_execError），v0.5 兼容字段
// 通过 getter 提供：
//   - id/classId/label → varName/className/varName
//   - x/y → visualState.positions[varName]
//   - properties/inputs/outputs/computed/error → 同 v0.5 语义
export function wrapInstance(inst) {
  // __wrapped 守卫:防重复 wrap。runSource 重建 + import/load 多次调用时,
  // 已 wrap 的实例重复 defineProperty 会 silently 失败或抛错(看 configurable)。
  if (inst.__wrapped) return inst
  Object.defineProperty(inst, '__wrapped', { value: true, enumerable: false })

  Object.defineProperty(inst, 'id', {
    get() { return inst.varName },
    enumerable: false, configurable: true,
  })
  Object.defineProperty(inst, 'classId', {
    get() { return inst.className },
    enumerable: false, configurable: true,
  })
  Object.defineProperty(inst, 'label', {
    get() {
      const cls = state.classes[inst.className]
      return inst.attrs.name || (cls && cls.name) || inst.className || inst.varName
    },
    set() { /* v0.6 varName 不可改；name 通过 attrs.name 写 */ },
    enumerable: false, configurable: true,
  })
  Object.defineProperty(inst, 'name', {
    get() { return inst.attrs.name || '' },
    enumerable: false, configurable: true,
  })
  Object.defineProperty(inst, 'description', {
    get() {
      const cls = state.classes[inst.className]
      const v = inst.attrs.description
      return v != null ? v : (cls.description || '')
    },
    enumerable: false, configurable: true,
  })
  Object.defineProperty(inst, 'x', {
    get() { return (state.visualState.positions[inst.varName] || {}).x || 0 },
    set(v) {
      if (!state.visualState.positions[inst.varName]) {
        state.visualState.positions[inst.varName] = { x: 0, y: 0 }
      }
      state.visualState.positions[inst.varName].x = v
    },
    enumerable: false, configurable: true,
  })
  Object.defineProperty(inst, 'y', {
    get() { return (state.visualState.positions[inst.varName] || {}).y || 0 },
    set(v) {
      if (!state.visualState.positions[inst.varName]) {
        state.visualState.positions[inst.varName] = { x: 0, y: 0 }
      }
      state.visualState.positions[inst.varName].y = v
    },
    enumerable: false, configurable: true,
  })
  Object.defineProperty(inst, 'properties', {
    get() {
      const cls = state.classes[inst.className]
      const r = {}
      if (!cls) return r
      const allKeys = new Set([
        ...Object.keys(cls.attrs || {}),
        ...Object.keys(inst.attrs),
      ])
      for (const k of allKeys) {
        if (k === 'name' || k === 'description' || k === 'edges') continue
        if (k.startsWith('__')) continue
        r[k] = inst.attrs[k] !== undefined ? inst.attrs[k] : cls.attrs[k]
      }
      return r
    },
    enumerable: false, configurable: true,
  })
  Object.defineProperty(inst, 'error', {
    get() {
      if (inst._topoError) return inst._topoError
      if (inst._execError) return inst._execError
      // v0.11: 聚合本节点所有 transform 边错误(每条边各报各的,不再 last-edge-wins)
      const edges = Array.isArray(inst.attrs.edges) ? inst.attrs.edges : []
      const edgeErrs = []
      for (const e of edges) {
        if (e && e._transformError) {
          const tgtVar = (e.target && e.target.__instId && e.target.__instId.varName) || '?'
          edgeErrs.push('→' + tgtVar + ': ' + e._transformError)
        }
      }
      return edgeErrs.length ? edgeErrs.join('; ') : null
    },
    set(v) { inst._execError = v },
    enumerable: false, configurable: true,
  })
  return inst
}

// 在 runSource 之后给所有 runtimeInstances 加 wrap
export function wrapAllInstances() {
  for (const inst of state.runtimeInstances) wrapInstance(inst)
}

// ============ Export / Import (sourceCode 格式) ============
export function exportSource() {
  return {
    version: 6,
    sourceCode: state.sourceCode,
    visualState: JSON.parse(JSON.stringify(state.visualState)),
    graphId: state.graphId,
    title: state.graphTitle,
    editMode: state.editMode,
  }
}

export function importSource(data) {
  if (typeof data !== 'object' || typeof data.sourceCode !== 'string') {
    throw new Error('无效格式，期望 {sourceCode: "..."}')
  }
  // 版本校验:带 version 字段的数据必须符合当前模型(version 6 = 实例级 edges)
  if (data.version !== undefined && data.version !== 6) {
    throw new Error('旧版本数据 (v' + data.version + ') 与当前实例级 edges 模型不兼容')
  }
  // ADR-008 外部导入执行闸门:声明式免确认;其余(程序化/未知)先确认。
  // 闸门必须在任何 state mutation 之前,取消 = 完全不动当前状态。
  const _level = classifySource(data.sourceCode)
  if (_level !== 'declarative') {
    const ok = confirm(
      '此链接包含可执行代码(sourceCode 含方法体/控制流或无法归类)。\n\n' +
      '是否载入并运行?\n' +
      '确定 = 载入并运行\n' +
      '取消 = 不载入(保留当前图)'
    )
    if (!ok) return false
  }

  // 载入后 save() 可能合法发生,先清 loadError(这是一个"成功操作")
  state.loadError = null

  // 尊重 URL/导入数据里的 editMode(llms.txt 指示 AI 显式设置)
  state.editMode = data.editMode === 'code' ? 'code' : 'ui'
  // UI 模式 + 程序化 sourceCode = "panel 一编辑就丢方法体"的静默陷阱。
  // 给用户一次选择机会:推荐切 Code 模式(不丢),硬选继续则承认丢弃代价。
  if (state.editMode === 'ui' && isSourceCodeProgrammatic(data.sourceCode)) {
    const asCode = confirm(
      '即将载入的 sourceCode 含方法体或控制流。\n\n' +
      '建议切到代码模式载入(panel 编辑不会丢失它们)。\n' +
      '确定 = 以代码模式载入(推荐)\n' +
      '取消 = 仍以 UI 模式载入(一旦 panel 编辑,方法体将被静默丢弃)'
    )
    state.editMode = asCode ? 'code' : 'ui'
  }

  state.sourceCode = data.sourceCode
  if (data.visualState) {
    state.visualState = {
      positions: data.visualState.positions || {},
      colors: data.visualState.colors || {},
    }
  } else {
    state.visualState = { positions: {}, colors: {} }
  }
  state.graphId = data.graphId || ('g_' + Date.now())
  state.graphTitle = data.title || '系统模型'
  const titleEl = document.getElementById('title-text')
  if (titleEl) titleEl.textContent = state.graphTitle
  state.selVarName = null
  state.selEdge = null

  runSource(state.sourceCode, state)
  wrapAllInstances()
  spreadUnpositioned()
  fitToView()
  return true
}

export function onNew() {
  if (state.sourceCode && state.sourceCode !== DEFAULT_BOOTSTRAP &&
      !confirm('确定要新建吗？当前图将丢失。')) return
  pushUndo()
  state.loadError = null
  state.sourceCode = DEFAULT_BOOTSTRAP
  state.visualState = { positions: {}, colors: {} }
  state.selVarName = null
  state.selEdge = null
  state.graphId = 'g_' + Date.now()
  state.graphTitle = '系统模型'
  const titleEl = document.getElementById('title-text')
  if (titleEl) titleEl.textContent = state.graphTitle
  runSource(state.sourceCode, state)
  wrapAllInstances()
  spreadUnpositioned()
  fitToView()
  localStorage.removeItem('sa_data')
  render()
}

export function onExport() {
  const data = exportSource()
  const blob = new Blob([data.sourceCode], { type: 'text/javascript' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = state.graphTitle.replace(/[\\/:*?"<>|]/g, '_') + '.js'
  a.click()
  URL.revokeObjectURL(a.href)
}

// ============ v0.5 向后兼容：importJSON 是 sourceCode 包装 ============
// 旧菜单/HTML 还在调 importJSON；v0.6 保留接口名，内部转 sourceCode
export function importJSON(data) {
  // 接受 v0.6 {sourceCode} 或 v0.5 wrapper {version:3, sourceCode}
  if (data && typeof data.sourceCode === 'string') return importSource(data)
  throw new Error('旧 v0.5 JSON 格式（含 instances 数组）不再支持')
}

// ============ Persistence ============
export function save() {
  if (state.loadError) {
    console.warn('[save] loadError 未清除,拒绝覆盖 sa_data(用户数据保护)')
    return
  }
  try {
    localStorage.setItem('sa_data', JSON.stringify({
      version: 6,
      sourceCode: state.sourceCode,
      visualState: state.visualState,
      graphId: state.graphId,
      graphTitle: state.graphTitle,
      editMode: state.editMode,
    }))
  } catch (e) {
    console.warn('[save] 持久化失败', e)
  }
}

export function load() {
  try {
    const raw = localStorage.getItem('sa_data')
    if (!raw) return false
    const d = JSON.parse(raw)
    // 硬切换：v6 之前格式（v0.5/v0.6/v0.7/v0.8）全部丢弃——实例级 edges 模型与历史不兼容
    if (d.version !== 6) {
      console.warn(`[load] 检测到旧版本 sa_data (v${d.version || '?'})，硬切换：忽略旧数据`)
      localStorage.removeItem('sa_data')
      return false
    }
    state.sourceCode = d.sourceCode || DEFAULT_BOOTSTRAP
    state.visualState = d.visualState || { positions: {}, colors: {} }
    state.graphId = d.graphId || ('g_' + Date.now())
    state.graphTitle = d.graphTitle || '系统模型'
    state.editMode = d.editMode === 'code' ? 'code' : 'ui'
    const titleEl = document.getElementById('title-text')
    if (titleEl) titleEl.textContent = state.graphTitle

    runSource(state.sourceCode, state)
    wrapAllInstances()
    return true
  } catch (e) {
    // sa_data 完好 + save() 被保护:用户修复后刷新即可找回;或新建/导入走 onNew/importJSON
    state.loadError = e.message
    console.warn('[load] 加载失败(数据未破坏,已阻止覆盖保存)', e)
    alert('本地图加载失败：' + e.message + '\n\n原始数据已保留在 localStorage。\n可切到"代码"模式修复语法/引用错误,或新建/导入其他图。')
    return false
  }
}

export function shareURL() {
  const data = exportSource()
  const json = JSON.stringify(data)
  const enc = toB64(json)
  if (enc.length > 24000) {
    alert('图太大（编码后 ' + enc.length + ' 字符），请使用导出文件分享')
    return
  }
  const url = location.origin + location.pathname + '#' + enc
  navigator.clipboard.writeText(url)
    .then(() => alert('分享链接已复制到剪贴板（' + enc.length + ' 字符）'))
    .catch(() => prompt('复制此链接：', url))
}

// ============ Panel 触发：runtimeInstances → sourceCode 序列化 + 持久化 ============
// panel 改实例属性后调用：序列化回 sourceCode + 保存 + dispatch 事件给 codeview
export function syncCodeFromRuntime() {
  state.sourceCode = serializeCode(state)
  save()
  // 通知 codeview 同步编辑器内容（panel 改 → sourceCode 变 → 编辑器更新）
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sa-source-updated'))
  }
}

// ============ 重置运行时（运行时 mutation 丢弃） ============
// panel/input 的 reset 按钮调用：重新执行 sourceCode，attrs 回到初始
export function resetRuntime() {
  runSource(state.sourceCode, state)
  wrapAllInstances()
  render()
}
