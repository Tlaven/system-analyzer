// v0.9 class field 扫描：description / name / attrs 三个实例级 class field
//
// 模型变更（vs v0.8）：
//   - 删除 edges 字段扫描（edges 不再在 class 上声明，改为实例级 attrs.edges 数组）
//   - 只扫 description / name / attrs 三个 class field
//   - methods / hasTick 仍扫 prototype（Code 模式执行需要）
//
// 限制：
//   - 3 个 class field 必须是字面量写在 class body（无 static 前缀）
//   - attrs 对象字面量：{ key: value, ... }（纯数据，无 null 引用槽）

function deepCopy(v) {
  if (v === null || typeof v !== 'object') return v
  return JSON.parse(JSON.stringify(v))
}

export function scanClass(cls, _classSource) {
  let fresh = {}
  try {
    fresh = new cls()
  } catch (e) {
    console.warn('[scanClass] 实例化失败', cls.name, e)
  }

  const description = typeof fresh.description === 'string' ? fresh.description : ''
  const name = typeof fresh.name === 'string' ? fresh.name : ''

  const rawAttrs = (fresh.attrs && typeof fresh.attrs === 'object' && !Array.isArray(fresh.attrs))
    ? fresh.attrs
    : {}
  // 过滤掉 edges 键（v0.9：edges 是实例级运行时字段，不应在 class attrs 默认里）
  const attrsClean = {}
  for (const k of Object.keys(rawAttrs)) {
    if (k === 'edges') continue
    attrsClean[k] = rawAttrs[k]
  }
  const attrs = deepCopy(attrsClean)

  const methods = []
  let hasTick = false
  for (const methodName of Object.getOwnPropertyNames(cls.prototype)) {
    if (methodName === 'constructor') continue
    const fn = cls.prototype[methodName]
    if (typeof fn !== 'function') continue
    methods.push(methodName)
    if (methodName === 'tick') hasTick = true
  }

  return {
    description,   // string — class 默认描述
    name,          // string — class 默认名（空表示用 className 回退）
    attrs,         // { key: value } — class 默认属性字典（纯数据）
    methods,       // string[] — 所有方法名（Code 模式执行用）
    hasTick,       // boolean — 是否有 tick 方法
  }
}
