// 作者态快照层(ADR-007):serializeCode 的序列化源
//
// 定位:sourceCode 只承载作者意图。runtimeInstances 的 attrs 会被方法体/transform/stepAll
// 改写(运行时演化),所以序列化不能直接读 live attrs,而要读"作者态快照"authorAttrs:
//   - runSource 结束时捕获(从源码解析出的状态)
//   - UI 编辑路径写穿(setAuthorAttr / deleteAuthorAttr / markEdgesEdited)
//   - 方法体/transform/stepAll 只改 live attrs,不碰 authorAttrs
//
// 捕获口径:容器深拷贝(限深 8 + visited 防环,与 formatValue 降级一致);
// 实例引用(带 __instId)保身份、不递归进目标;edges 逐条拷贝(只保留
// target/description/transform 三个序列化字段);跳过 `__` 前缀键。
// 任何改 attrs 的 UI 入口都必须写穿(不变量 27)。

export function captureAuthorAttrs(state) {
  const map = new Map()
  for (const inst of state.runtimeInstances) {
    map.set(inst.varName, cloneAttrs(inst.attrs))
  }
  state.authorAttrs = map
}

// 取某实例的作者态 attrs;缺失时回退 live(仅容错,不是行为契约)
export function authorAttrsOf(state, inst) {
  return (state.authorAttrs && state.authorAttrs.get(inst.varName)) || inst.attrs
}

export function setAuthorAttr(state, inst, key, value) {
  const a = state.authorAttrs && state.authorAttrs.get(inst.varName)
  if (!a) return
  a[key] = cloneValue(value)
}

export function deleteAuthorAttr(state, inst, key) {
  const a = state.authorAttrs && state.authorAttrs.get(inst.varName)
  if (a) delete a[key]
}

// 边编辑(增删/重定向/description/transform)后调用:用 live edges 重建作者态 edges
export function markEdgesEdited(state, inst) {
  const a = state.authorAttrs && state.authorAttrs.get(inst.varName)
  if (!a) return
  const c = cloneEdges(inst.attrs.edges)
  if (c) a.edges = c
  else delete a.edges
}

function cloneAttrs(attrs) {
  const out = {}
  for (const k of Object.keys(attrs)) {
    if (k.startsWith('__')) continue
    if (k === 'edges') {
      const c = cloneEdges(attrs.edges)
      if (c) out[k] = c
      continue
    }
    out[k] = cloneValue(attrs[k])
  }
  return out
}

function cloneValue(v, depth = 0, seen = new Set()) {
  if (v === null || typeof v !== 'object') return v
  if (v.__instId) return v
  if (depth >= 8 || seen.has(v)) return null
  seen.add(v)
  let out
  if (Array.isArray(v)) {
    out = v.map(x => cloneValue(x, depth + 1, seen))
  } else {
    out = {}
    for (const k of Object.keys(v)) {
      if (k.startsWith('__')) continue
      out[k] = cloneValue(v[k], depth + 1, seen)
    }
  }
  seen.delete(v)
  return out
}

function cloneEdges(edges) {
  if (!Array.isArray(edges)) return undefined
  return edges.map(e => {
    if (!e || typeof e !== 'object') return e
    const out = { target: e.target, description: e.description }
    if (typeof e.transform === 'string') out.transform = e.transform
    return out
  })
}
