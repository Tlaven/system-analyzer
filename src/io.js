// v0.6 code-as-truth 数据管线
//
// 核心变化（vs v0.5）：
//   - state.sourceCode 是唯一真相源；runtimeInstances 是派生（runSource 得到）
//   - save/load: localStorage.sa_data 存 {version:3, sourceCode, visualState, ...}
//   - shareURL: 编码 sourceCode（base64）
//   - deriveEdges: 基于 runtimeInstances + classes（class emitters）
//   - wrapInstance: 给 RuntimeInstance 加 v0.5 node 形状的 getter，让 renderer/utils 不用大改
//   - 删除 snapshotAttrs/rehydrateReferences/snapshotInstances/restoreInstances
//     （attrs 上的引用就是 attrs 对象，无需身份转换）

import { state } from './state.js'
import { render } from './renderer.js'
import { pushUndo } from './editor.js'
import { applyLayout } from './physics.js'
import { toB64 } from './utils.js'
import { runSource, serializeCode } from './codegraph.js'
import { DEFAULT_BOOTSTRAP } from './bootstrap.js'

// ============ Edges — 由 runtimeInstances + class emitters 派生 ============
//
// 边的存在条件（合取）：
//   1. 源 class 的某方法体里有 this.<ref>.<attr> = ... （class emitter 声明）
//   2. 源实例的 <ref> 当前指向某目标实例（attrs 身份比较）
//   3. 目标实例的 class 声明了 <attr> 属性
//
// edgeMeta key 在 v0.6 改为 refName（不是 targetId|attr），因为 v0.6 的 describe()
// API 是 GraphStarter.describe(srcInst, refName, text)，按 refName 索引。
export function deriveEdges() {
  const edges = []
  for (const inst of state.runtimeInstances) {
    const cls = state.classes[inst.className]
    if (!cls) continue
    for (const em of cls.emitters) {
      const refVal = inst.attrs[em.ref]
      if (!refVal || typeof refVal !== 'object') continue
      const targetInst = state.runtimeInstances.find(i => i.attrs === refVal)
      if (!targetInst) continue
      const targetCls = state.classes[targetInst.className]
      if (!targetCls) continue
      if (!targetCls.properties.includes(em.attr)) continue
      const meta = (inst.edgeMeta || {})[em.ref] || {}
      edges.push({
        id: inst.varName + '>' + em.method + '>' + em.ref + '>' + em.attr + '>' + targetInst.varName,
        source_instance: inst.varName,
        source_node: inst.varName,
        source_method: em.method,
        source_ref: em.ref,
        source_port: em.ref,
        target_instance: targetInst.varName,
        target_node: targetInst.varName,
        target_attr: em.attr,
        target_port: em.attr,
        label: meta.label || '',
        relation: meta.relation || '',
        description: meta.description || '',
        weight: meta.weight != null ? meta.weight : 1,
        metadata: meta.metadata || {},
      })
    }
  }
  return edges
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
    get() { return inst.varName },
    set() { /* v0.6 varName 不可改 */ },
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
      for (const k of cls.properties) {
        if (cls.references.includes(k)) continue
        r[k] = inst.attrs[k]
      }
      return r
    },
    enumerable: false, configurable: true,
  })
  Object.defineProperty(inst, 'inputs', {
    get() {
      const ins = new Set()
      for (const e of deriveEdges()) {
        if (e.target_instance === inst.varName) ins.add(e.target_attr)
      }
      return [...ins].map(id => ({ id, label: id }))
    },
    enumerable: false, configurable: true,
  })
  Object.defineProperty(inst, 'outputs', {
    get() {
      const outs = new Set()
      for (const e of deriveEdges()) {
        if (e.source_instance === inst.varName) outs.add(e.target_attr)
      }
      return [...outs].map(id => ({ id, label: id }))
    },
    enumerable: false, configurable: true,
  })
  Object.defineProperty(inst, 'computed', {
    get() { return inst.attrs },
    enumerable: false, configurable: true,
  })
  Object.defineProperty(inst, 'error', {
    get() { return inst._topoError || inst._execError || null },
    set(v) { inst._execError = v },
    enumerable: false, configurable: true,
  })
  return inst
}

// 在 runSource 之后给所有 runtimeInstances 加 wrap
function wrapAllInstances() {
  for (const inst of state.runtimeInstances) wrapInstance(inst)
}

// ============ EdgeMeta setter ============
// v0.5 接口 setEdgeMeta(sourceInst, targetId, attr, meta)
// v0.6 内部把 attr 映射回 refName（emitter.attr === attr → emitter.ref）
export function setEdgeMeta(sourceInst, _targetVarName, attr, meta) {
  if (!sourceInst.edgeMeta) sourceInst.edgeMeta = {}
  const cls = state.classes[sourceInst.className]
  if (!cls) return
  const em = cls.emitters.find(e => e.attr === attr)
  const refName = em ? em.ref : attr
  if (meta === null) {
    delete sourceInst.edgeMeta[refName]
  } else {
    sourceInst.edgeMeta[refName] = { ...(sourceInst.edgeMeta[refName] || {}), ...meta }
  }
}

// ============ Export / Import (sourceCode 格式) ============
export function exportSource() {
  return {
    version: 3,
    sourceCode: state.sourceCode,
    visualState: JSON.parse(JSON.stringify(state.visualState)),
    graphId: state.graphId,
    title: state.graphTitle,
  }
}

export function importSource(data) {
  if (typeof data !== 'object' || typeof data.sourceCode !== 'string') {
    throw new Error('无效格式，期望 {sourceCode: "..."}')
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
}

export function onNew() {
  if (state.sourceCode && state.sourceCode !== DEFAULT_BOOTSTRAP &&
      !confirm('确定要新建吗？当前图将丢失。')) return
  pushUndo()
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

// ============ v0.5 向后兼容：把 exportJSON/importJSON 当作 sourceCode 包装 ============
// 旧菜单/HTML 还在调 exportJSON/importJSON；v0.6 保留接口名，内部转 sourceCode
export function exportJSON() { return exportSource() }
export function importJSON(data) {
  // 接受 v0.6 {sourceCode} 或 v0.5 wrapper {version:3, sourceCode}
  if (data && data.sourceCode) return importSource(data)
  throw new Error('旧 v0.5 JSON 格式（含 instances 数组）不再支持')
}

// ============ Persistence ============
export function save() {
  try {
    localStorage.setItem('sa_data', JSON.stringify({
      version: 3,
      sourceCode: state.sourceCode,
      visualState: state.visualState,
      graphId: state.graphId,
      graphTitle: state.graphTitle,
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
    // 硬切换：v3 之前格式（v0.5 instances-based）全部丢弃
    if (d.version !== 3) {
      console.warn(`[load] 检测到旧版本 sa_data (v${d.version || '?'})，硬切换：忽略旧数据`)
      localStorage.removeItem('sa_data')
      return false
    }
    state.sourceCode = d.sourceCode || DEFAULT_BOOTSTRAP
    state.visualState = d.visualState || { positions: {}, colors: {} }
    state.graphId = d.graphId || ('g_' + Date.now())
    state.graphTitle = d.graphTitle || '系统模型'
    const titleEl = document.getElementById('title-text')
    if (titleEl) titleEl.textContent = state.graphTitle

    runSource(state.sourceCode, state)
    wrapAllInstances()
    return true
  } catch (e) {
    console.warn('[load] 加载失败', e)
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
