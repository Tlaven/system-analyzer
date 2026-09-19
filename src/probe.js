// B-L1 双层边(探测边)——从 attrs 引用推而得的隐式依赖
//
// 定位(roadmap B):声明边(attrs.edges,实线)= 作者意图;探测边(虚线灰)= 运行时事实,
// 纯派生、不序列化、不入 URL hash(演化层原则,ADR-005/ADR-006)。
// "差集有价值":探测有而声明无的引用 = 未声明的隐式依赖(AI 副作用无所遁形)。
//
// 噪音治理口径(2026-09-15 定,ADR-006):
//   - 同对多引用收敛:同一 (source,target) 只产一条,fields 记全部 field-path
//   - 只认实例边界:遍历 plain object/array(限深 4 + visited 防环),
//     命中带 __instId 的对象即记一条并停止深入(否则 A→B→C 传染)
//   - 跳过 `edges` 键(声明边已是一等公民)与 `__` 前缀(内部字段);自引用不记(L1 不渲染自环探测边)
//
// 失效点:invalidateEdges(结构变更)/runSource(重建)/engine 的 evalTransforms+stepAll
// (方法体与 transform 可能改引用)。读时 lazy 重算,模式同 deriveEdges。

const PROBE_MAX_DEPTH = 4

let _probeCache = null
let _probeDirty = true

export function invalidateProbes() {
  _probeDirty = true
}

export function deriveProbeEdges(state) {
  if (!_probeDirty && _probeCache) return _probeCache

  const attrsToInst = new Map()
  for (const inst of state.runtimeInstances) attrsToInst.set(inst.attrs, inst)

  const byPair = new Map()
  for (const inst of state.runtimeInstances) {
    walkAttrs(inst, attrsToInst, byPair)
  }
  _probeCache = Array.from(byPair.values())
  _probeDirty = false
  return _probeCache
}

function walkAttrs(srcInst, attrsToInst, byPair) {
  const visited = new Set()
  const walk = (val, path, depth) => {
    if (depth > PROBE_MAX_DEPTH) return
    if (val === null || typeof val !== 'object') return
    // 命中实例边界:先于 visited 判定——同一目标出现多次要计数;且不深入目标 attrs(防传染)
    const hit = attrsToInst.get(val)
    if (hit) {
      if (hit === srcInst) return
      const key = srcInst.varName + '>' + hit.varName
      let rec = byPair.get(key)
      if (!rec) {
        rec = {
          id: key,
          source_instance: srcInst.varName,
          source_node: srcInst.varName,
          target_instance: hit.varName,
          target_node: hit.varName,
          fields: [],
        }
        byPair.set(key, rec)
      }
      rec.fields.push(path)
      return
    }
    if (visited.has(val)) return
    visited.add(val)
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) walk(val[i], path + '[' + i + ']', depth + 1)
      return
    }
    for (const k of Object.keys(val)) {
      if (k.startsWith('__') || k === 'edges') continue
      walk(val[k], path ? path + '.' + k : k, depth + 1)
    }
  }
  // 从 attrs 的每个键出发(不从 attrs 自身出发,否则即刻自命中)
  for (const k of Object.keys(srcInst.attrs)) {
    if (k.startsWith('__') || k === 'edges') continue
    walk(srcInst.attrs[k], k, 1)
  }
}
