// v0.6 执行引擎
//
// 核心模型（vs v0.5 不变）：
//   - 属性即数据。没有 computed[] 缓存，没有 inputs/outputs 端口声明
//   - propagate/stepAll 按拓扑序调用每个实例的每个方法
//   - 方法的 this = inst.attrs，直接读 self 属性、写下游属性
//   - 引用值在内存中是目标 attrs 对象，this.X.Y = v 直接命中目标
//
// v0.6 变化：
//   - 数据源从 state.instances 改为 state.runtimeInstances
//   - 实例身份从 inst.id 改为 inst.varName
//   - class 查找从 state.classes[inst.classId] 改为 state.classes[inst.className]
//   - 删除 compileAllNodes/compileInstances（旧 API no-op）

import { state } from './state.js'
import { deriveEdges } from './codegraph.js'

const EXEC_TIMEOUT_MS = 100

// ============ Topological sort (Kahn) with cache ============
let _topoCache = null, _topoKey = ''
function topoKey() {
  const nk = state.runtimeInstances.map(i => i.varName).sort().join(',')
  const ek = deriveEdges(state).map(e => e.source_instance + '>' + e.target_instance).sort().join(',')
  return nk + '|' + ek
}

export function topologicalSort() {
  const key = topoKey()
  if (_topoKey === key && _topoCache) return _topoCache
  _topoKey = key

  const inDeg = {}, adj = {}
  for (const i of state.runtimeInstances) {
    inDeg[i.varName] = 0
    adj[i.varName] = []
  }
  for (const e of deriveEdges(state)) {
    if (adj[e.source_instance]) adj[e.source_instance].push(e.target_instance)
    if (inDeg[e.target_instance] !== undefined) inDeg[e.target_instance]++
  }
  const q = state.runtimeInstances.filter(i => inDeg[i.varName] === 0).map(i => i.varName)
  const order = []
  while (q.length) {
    const id = q.shift()
    order.push(id)
    for (const tid of (adj[id] || [])) {
      inDeg[tid]--
      if (inDeg[tid] === 0) q.push(tid)
    }
  }
  // 标记循环依赖
  for (const i of state.runtimeInstances) {
    i._topoError = !order.includes(i.varName) ? '循环依赖' : null
  }

  _topoCache = order
  return order
}

// 调用实例的某方法。this = inst.attrs。超时/异常 → 设置 inst._execError。
function callInstMethod(inst, methodName, args) {
  const cls = state.classes[inst.className]
  if (!cls) return undefined
  const fn = cls.cls.prototype[methodName]
  if (typeof fn !== 'function') return undefined
  try {
    const start = performance.now()
    const result = fn.call(inst.attrs, args || {})
    if (performance.now() - start > EXEC_TIMEOUT_MS) {
      inst._execError = '执行超时 (' + methodName + ')'
      return undefined
    }
    inst._execError = null
    return result
  } catch (e) {
    inst._execError = methodName + ': ' + e.message
    return undefined
  }
}

// 对所有 inst 的 attrs.edges 遍历,有 transform 的边求值。
// transform 是边级 JS 语句片段,source/target 绑定到边两端 attrs(ADR-003)。
// 不依赖 topo 序也不跳过环(_topoError):transform 是声明式"边级公式",
// 各跑一次不会无限循环;按 runtimeInstances 定义顺序跑,source 通常先于 target。
// v0.11: 错误挂到 e._transformError(边对象本身),不挂 inst._execError。
// 理由:错误是边的属性,不是源节点的属性;一条源出 N 条 transform 边各报各的错,
// 不再"最后一条赢"。canvas 通过 io.js inst.error getter 聚合本节点所有 transform 错误。
function evalTransforms() {
  for (const inst of state.runtimeInstances) {
    const edges = Array.isArray(inst.attrs.edges) ? inst.attrs.edges : []
    for (const e of edges) {
      if (!e || typeof e.transform !== 'string' || e.transform.length === 0) {
        if (e) e._transformError = null
        continue
      }
      if (!e.target || typeof e.target !== 'object') continue
      try {
        const start = performance.now()
        const fn = new Function('source', 'target', e.transform)
        fn.call(null, inst.attrs, e.target)
        e._transformError = (performance.now() - start > EXEC_TIMEOUT_MS) ? '执行超时' : null
      } catch (err) {
        e._transformError = err.message
      }
    }
  }
}

// 独立 transform 求值入口,不受 execMode 抑制(ADR-003 OQ#2)。
// setEdgeTransform 改完后直调,绕过 triggerPropagate 的 off 短路。
// v0.13: 不再内部 render,调用方负责(panel._onTransformInput / panel.triggerPropagate)。
export function runTransforms() {
  evalTransforms()
}

// 从某实例开始按拓扑序调用方法，传播到下游
// v0.13: 不再内部 render,调用方负责(panel.triggerPropagate / input.runPropagate)。
export function propagate(startVarName) {
  const order = topologicalSort()
  const startIdx = startVarName ? order.indexOf(startVarName) : -1
  const toProcess = startIdx >= 0 ? order.slice(startIdx) : order

  for (const vName of toProcess) {
    const inst = state.runtimeInstances.find(i => i.varName === vName)
    if (!inst || inst._topoError) continue
    const cls = state.classes[inst.className]
    if (!cls) continue
    for (const methodName of cls.methods) {
      if (methodName === 'tick') continue
      callInstMethod(inst, methodName, { dt: 1 })
    }
  }
  evalTransforms()
}

// 一步时间演化：每个实例先调用所有非 tick 方法，再调用 tick
export function stepAll() {
  const order = topologicalSort()
  for (const vName of order) {
    const inst = state.runtimeInstances.find(i => i.varName === vName)
    if (!inst || inst._topoError) continue
    const cls = state.classes[inst.className]
    if (!cls) continue
    for (const methodName of cls.methods) {
      if (methodName === 'tick') continue
      callInstMethod(inst, methodName, { dt: 1 })
    }
    if (cls.hasTick) {
      callInstMethod(inst, 'tick', { dt: 1 })
    }
  }

  state.tickCount++
  state.execHistory.push({
    tick: state.tickCount,
    instances: state.runtimeInstances.map(i => ({ id: i.varName, error: i._execError || null })),
  })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sa-tick', { detail: { tickCount: state.tickCount } }))
  }
}
