// ADR-010 影响解析:选中节点 → 上游/下游闭包(声明边 + 探测边)
//
// 语义:
//   - 声明边 u→v:影响正向 u→v(作者意图)
//   - 探测边 u⇢v(u 的 attrs 引用 v):影响反向 v→u(依赖方向,与画布箭头相反)
//   - 同对已有声明边 u→v 时该探测边不参与(差集口径,与探测边渲染一致)
// 纯派生:不落持久化;缓存以 deriveEdges/deriveProbeEdges 的缓存数组身份为键,
// 两者自身的失效即缓存失效(不新增失效点,不变量 34)。
//
// direction: 'up'(谁影响它) | 'down'(它影响谁) | 'both'

import { deriveEdges } from './codegraph.js'
import { deriveProbeEdges } from './probe.js'

let _cache = null

export function invalidateInfluence() { _cache = null }

// 返回 { up, down, directUp, directDown, edgeState, probeState }
//   up/down: Set<varName> 闭包(不含自身);directUp/directDown: Set<varName> 第一跳
//   edgeState: Map<声明边 id, 'up'|'down'|'both'>;probeState: Map<探测边 pairKey, 'up'|'down'|'both'>
export function computeInfluence(state, varName, direction) {
  const edges = deriveEdges(state)
  const probes = deriveProbeEdges(state)
  if (_cache && _cache.varName === varName && _cache.dir === direction &&
      _cache.edges === edges && _cache.probes === probes) {
    return _cache.result
  }

  // 正向影响邻接:声明边 u→v 直接;探测边 u⇢v 反向(v→u)
  const fwd = []
  const declaredPairs = new Set()
  for (const e of edges) {
    declaredPairs.add(e.source_instance + '>' + e.target_instance)
    fwd.push({ from: e.source_instance, to: e.target_instance, edgeId: e.id })
  }
  for (const pe of probes) {
    if (declaredPairs.has(pe.id)) continue
    fwd.push({ from: pe.target_instance, to: pe.source_instance, probeKey: pe.id })
  }

  const dirs = direction === 'up' ? ['up'] : direction === 'down' ? ['down'] : ['up', 'down']
  const result = {
    up: new Set(), down: new Set(),
    directUp: new Set(), directDown: new Set(),
    edgeState: new Map(), probeState: new Map(),
  }
  for (const d of dirs) {
    const reverse = d === 'up'
    const closure = new Set()
    const direct = new Set()
    const seen = new Set([varName])
    const queue = [varName]
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi]
      for (const step of fwd) {
        const a = reverse ? step.to : step.from
        const b = reverse ? step.from : step.to
        if (a !== cur) continue
        if (step.edgeId) {
          const prev = result.edgeState.get(step.edgeId)
          result.edgeState.set(step.edgeId, prev && prev !== d ? 'both' : d)
        } else {
          const prev = result.probeState.get(step.probeKey)
          result.probeState.set(step.probeKey, prev && prev !== d ? 'both' : d)
        }
        if (seen.has(b)) continue
        seen.add(b)
        closure.add(b)
        if (cur === varName) direct.add(b)
        queue.push(b)
      }
    }
    if (d === 'down') { result.down = closure; result.directDown = direct }
    else { result.up = closure; result.directUp = direct }
  }

  _cache = { varName, dir: direction, edges, probes, result }
  return result
}

// panel 列表行数据(side: 'up'|'down'):直接邻居 + 来源注
//   声明边行:{ varName, kind:'declared', description }
//   探测边行:{ varName, kind:'probe', fields }
// 口径与 computeInfluence 一致:同对已有声明边 u→v 时该探测边不出现
export function influenceRows(state, varName, side) {
  const edges = deriveEdges(state)
  const probes = deriveProbeEdges(state)
  const declaredPairs = new Set(edges.map(e => e.source_instance + '>' + e.target_instance))
  const rows = []
  for (const e of edges) {
    if (side === 'up' && e.target_instance === varName) {
      rows.push({ varName: e.source_instance, kind: 'declared', description: e.description || '' })
    } else if (side === 'down' && e.source_instance === varName) {
      rows.push({ varName: e.target_instance, kind: 'declared', description: e.description || '' })
    }
  }
  for (const pe of probes) {
    if (declaredPairs.has(pe.id)) continue
    if (side === 'up' && pe.source_instance === varName) {
      rows.push({ varName: pe.target_instance, kind: 'probe', fields: pe.fields })
    } else if (side === 'down' && pe.target_instance === varName) {
      rows.push({ varName: pe.source_instance, kind: 'probe', fields: pe.fields })
    }
  }
  return rows
}
