// v0.6 编辑器：undo/selection/delete
//
// 变化（vs v0.5）：
//   - undo 栈改为存 sourceCode 快照（字符串数组，比 instances 快照简单）
//   - delInstance/delEdge 操作 runtimeInstances + syncCodeFromRuntime（触发 serializeCode → sourceCode 同步）

import { state, MAX_UNDO } from './state.js'
import { render } from './renderer.js'
import { save, syncCodeFromRuntime, wrapAllInstances } from './io.js'
import { runSource, invalidateEdges, deriveEdges } from './codegraph.js'
import { hidePanel } from './panel.js'

// ============ Undo ============
export function pushUndo() {
  state.undoStack.push({
    sourceCode: state.sourceCode,
    visualState: JSON.parse(JSON.stringify(state.visualState)),
    graphId: state.graphId,
    graphTitle: state.graphTitle,
  })
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift()
}

export function undo() {
  if (!state.undoStack.length) return
  const s = state.undoStack.pop()
  state.sourceCode = s.sourceCode
  state.visualState = s.visualState
  state.graphId = s.graphId
  state.graphTitle = s.graphTitle
  const titleEl = document.getElementById('title-text')
  if (titleEl) titleEl.textContent = state.graphTitle

  runSource(state.sourceCode, state)
  wrapAllInstances()

  state.selVarName = null
  state.selEdge = null
  hidePanel(); render(); save()
}

// ============ Selection ============
export function selectInstance(inst) {
  deselectAll()
  state.selInstance = inst  // setter 把 inst.varName 写入 selVarName
  render()
}

export function selectEdge(e) {
  deselectAll()
  // v0.7 Phase 5: 存 id 字符串而非对象引用，活过 runSource 重建
  state.selEdge = e ? e.id : null
  render()
}

export function deselectAll() {
  state.selVarName = null
  state.selEdge = null
  hidePanel()
}

// ============ Instance ops ============
export function delInstance(inst) {
  if (!inst) return
  pushUndo()
  state.runtimeInstances = state.runtimeInstances.filter(i => i !== inst)
  invalidateEdges()
  // 清理其他实例指向被删实例的入边（target 是被删实例的 attrs 对象引用）
  // 不清理的话:deriveEdges 只是隐掉边,但 serializeCode 会输出悬空 target varName,
  // 重载 runSource 直接 ReferenceError,整图加载失败
  for (const other of state.runtimeInstances) {
    const arr = other.attrs.edges
    if (!Array.isArray(arr)) continue
    const kept = arr.filter(e => !(e && e.target === inst.attrs))
    if (kept.length !== arr.length) {
      if (kept.length) other.attrs.edges = kept
      else delete other.attrs.edges
    }
  }
  // 清理 visualState.positions/colors 中的孤儿条目
  delete state.visualState.positions[inst.varName]
  delete state.visualState.colors[inst.varName]
  if (state.selInstance === inst) deselectAll()
  syncCodeFromRuntime(); render()
}

// v0.9: 删除边 = 从源实例 attrs.edges 数组 splice 掉该条目
// 参数兼容两种形态:derived edge 对象 或 edgeId 字符串(keyboard Delete 传 selEdge 字符串)
export function delEdge(e) {
  if (!e) return
  const ed = (typeof e === 'string')
    ? deriveEdges(state).find(x => x.id === e)
    : e
  if (!ed) return
  const src = state.runtimeInstances.find(i => i.varName === ed.source_instance)
  if (!src) return
  const tgtInst = state.runtimeInstances.find(i => i.varName === ed.target_instance)
  const edges = Array.isArray(src.attrs.edges) ? src.attrs.edges : []
  // 先按 id 尾部 idx 定位,再校验 target 身份一致(数组可能已变动,防 idx 漂移)
  const idxFromId = parseInt(String(ed.id).split('>').pop(), 10)
  let hit = -1
  if (Number.isInteger(idxFromId) && edges[idxFromId] && edges[idxFromId].target === (tgtInst && tgtInst.attrs)) {
    hit = idxFromId
  } else {
    for (let i = 0; i < edges.length; i++) {
      if (edges[i] && edges[i].target === (tgtInst ? tgtInst.attrs : null)) { hit = i; break }
    }
  }
  if (hit === -1) return
  pushUndo()
  edges.splice(hit, 1)
  if (!edges.length) delete src.attrs.edges
  invalidateEdges()
  if (state.selEdge === ed.id) deselectAll()
  syncCodeFromRuntime(); render()
}

// 兼容别名：旧 HTML onclick 还在调 delNode
export const delNode = delInstance
