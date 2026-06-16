// 静态扫描 class，识别属性 / 引用槽 / 写入声明（emitters）
//
// 模型规约：
//   - 节点信息 = class 的非下划线属性
//   - 输出边来源 = class 方法体里 `this.<ref>.<attr> = ...` 形式的写入
//   - 引用槽 = 被方法体写入过的属性（其值运行时指向另一实例）
//
// 限制：本扫描器为正则实现，不识别字符串字面量内的模式。
// class 库作者应避免在方法体的字符串字面量中出现 `this.X.Y =` 形式。

// 匹配 this.<ref>.<attr> 后跟赋值操作符
// `=` 不能后跟 `=`（排除 `==`/`===`）
// 同时支持复合赋值：+=、-=、*=、/=、%=、&=、|=、^=、<<=、>>=、>>>=
const WRITE_RE = /this\.([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\s*(?:=(?!=)|[+\-*/%&|^]=|<<=|>>=?=)/g

export function scanMethod(fn) {
  if (typeof fn !== 'function') return []
  const src = fn.toString()
  const writes = []
  WRITE_RE.lastIndex = 0
  let m
  while ((m = WRITE_RE.exec(src))) {
    writes.push({ ref: m[1], attr: m[2] })
  }
  return writes
}

export function scanClass(cls) {
  let defaults = {}
  try {
    defaults = new cls()
  } catch (e) {
    console.warn('[scanClass] 实例化失败', cls.name, e)
  }

  const properties = Object.keys(defaults).filter(k => !k.startsWith('_'))

  const emitters = []
  const methods = []
  let hasTick = false

  for (const name of Object.getOwnPropertyNames(cls.prototype)) {
    if (name === 'constructor') continue
    const fn = cls.prototype[name]
    if (typeof fn !== 'function') continue
    methods.push(name)
    if (name === 'tick') hasTick = true
    const writes = scanMethod(fn)
    for (const w of writes) {
      emitters.push({ method: name, ref: w.ref, attr: w.attr })
    }
  }

  const references = [...new Set(emitters.map(e => e.ref))]

  return {
    properties,   // string[] — 所有非下划线属性名（即节点信息字段）
    references,   // string[] — 引用槽属性名（被方法体写入过）
    emitters,     // { method, ref, attr }[] — 所有写入声明
    methods,      // string[] — 所有方法名（执行用）
    hasTick,      // boolean — 是否有 tick 方法（时间演化）
    defaults,     // object — new cls() 的默认实例（用于创建实例时拷贝默认值）
  }
}
