// v0.6 编辑器：undo/selection/delete
//
// 变化（vs v0.5）：
//   - undo 栈改为存 sourceCode 快照（字符串数组，比 instances 快照简单）
//   - delInstance/delEdge 操作 runtimeInstances + syncCodeFromRuntime（触发 serializeCode → sourceCode 同步）

import { state, MAX_UNDO } from './state.js'
import { render } from './renderer.js'
import { save, syncCodeFromRuntime, wrapInstance } from './io.js'
import { runSource } from './codegraph.js'
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
  for (const inst of state.runtimeInstances) wrapInstance(inst)

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
  state.selEdge = e
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
  // 清理其他实例指向被删实例的引用（身份比较）
  for (const other of state.runtimeInstances) {
    const cls = state.classes[other.className]
    if (!cls) continue
    for (const ref of cls.references) {
      if (other.attrs[ref] === inst.attrs) {
        other.attrs[ref] = null
      }
    }
  }
  // 清理 visualState.positions/colors 中的孤儿条目
  delete state.visualState.positions[inst.varName]
  delete state.visualState.colors[inst.varName]
  if (state.selInstance === inst) deselectAll()
  syncCodeFromRuntime(); render()
}

// 删除边 = 清空源实例的引用槽（让 emitter 不再产出此边）+ 清 edgeMeta
export function delEdge(e) {
  if (!e) return
  pushUndo()
  const src = state.runtimeInstances.find(i => i.varName === e.source_instance)
  if (src) {
    src.attrs[e.source_ref] = null
    if (src.edgeMeta) delete src.edgeMeta[e.source_ref]
  }
  if (state.selEdge === e) deselectAll()
  syncCodeFromRuntime(); render()
}

// 兼容别名：旧代码用 delNode/selectNode
export const delNode = delInstance
export const selectNode = selectInstance
