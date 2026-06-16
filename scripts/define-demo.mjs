// define() 演示：用 JS 运行时反射代替源码解析
//
// 核心思想：不解析代码字符串，而是让代码自己暴露结构。
// AI 写的每一段代码都是"自描述"的——静态字段声明元数据，
// new 实例暴露属性默认值，原型暴露方法。
// define() 只是读取这些 JS 内置信息。

// ============================================================
// define() —— 零解析提取器
// ============================================================
function define(cls) {
  // 静态字段 → 元数据
  const id = cls.name
  const label = cls.label || cls.name
  const description = cls.description || ''
  const inputs = cls.inputs || []
  const outputs = cls.outputs || []

  // 实例化 → 属性默认值（假定无参构造）
  let properties = {}
  try {
    const instance = new cls()
    for (const key of Object.getOwnPropertyNames(instance)) {
      properties[key] = instance[key]
    }
  } catch (e) {
    // 有参构造或不安全 → 从 prototype 找初值
    // 回退：扫描原型上已定义的
    const proto = cls.prototype
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof proto[key] !== 'function') {
        properties[key] = proto[key]
      }
    }
  }

  // 原型 → 方法
  const methods = {}
  for (const key of Object.getOwnPropertyNames(cls.prototype)) {
    if (key === 'constructor') continue
    const fn = cls.prototype[key]
    if (typeof fn === 'function') {
      methods[key] = fn
    }
  }

  return { id, label, description, inputs, outputs, properties, methods }
}

// ============================================================
// 序列化（存储 / URL 传输）
// ============================================================

// 方法体序列化：函数 → 源码字符串
function serializeMethod(fn) {
  const src = fn.toString()
  // 从 function name(args) { body } 提取 body
  const m = src.match(/\{([\s\S]*)\}$/)
  const body = m ? m[1] : ''
  // 推断参数名
  const pm = src.match(/\(([^)]*)\)/)
  const params = pm ? pm[1].split(',').map(s => s.trim()).filter(Boolean) : []
  return { params, body }
}

// define 产物 → 代码字符串（存到 JSON 的 code 字段）
function toCode(def) {
  let out = `define(class ${def.id} {\n`
  // 静态元数据
  out += `  static label = ${JSON.stringify(def.label)}\n`
  if (def.description) out += `  static description = ${JSON.stringify(def.description)}\n`
  if (def.inputs.length) out += `  static inputs = ${JSON.stringify(def.inputs)}\n`
  if (def.outputs.length) out += `  static outputs = ${JSON.stringify(def.outputs)}\n`
  // 属性
  for (const [k, v] of Object.entries(def.properties)) {
    out += `  ${k} = ${JSON.stringify(v)}\n`
  }
  // 方法
  for (const [name, fn] of Object.entries(def.methods)) {
    const { params, body } = serializeMethod(fn)
    out += `  ${name}(${params.join(', ')}) {\n`
    // 缩进 body
    const indented = body.split('\n').map(l => '    ' + l).join('\n')
    out += indented + '\n  }\n'
  }
  out += '})'
  return out
}

// ============================================================
// 反序列化（加载 JSON / URL hash）
// ============================================================

function fromCode(code) {
  try {
    const fn = new Function('define', 'return (' + code + ')')
    const result = fn(define)
    return result
  } catch (e) {
    console.error('fromCode 失败:', e.message)
    console.error('  代码开头:', code.slice(0, 100))
    return null
  }
}

// ============================================================
// 存储节点格式
// ============================================================

// 把 define 产物转成统一的 NodeView（渲染器/面板统一读这个）
function toNodeView(def, x = 200, y = 200) {
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    inputs: def.inputs,
    outputs: def.outputs,
    properties: def.properties,
    methods: def.methods,         // 真实函数对象
    computed: {},
    error: null,
    x, y,
  }
}

// ============================================================
// 执行引擎（替换现有 compileClass）
// ============================================================

function propagate(nodeViews) {
  // 简单版：遍历节点，调用 output 方法
  for (const nv of nodeViews) {
    delete nv.error
    const ctx = { ...nv.properties, ...nv.computed }
    for (const out of nv.outputs) {
      const fn = nv.methods[out.id]
      if (!fn) continue
      try {
        // 收集输入
        const inputs = {}
        for (const e of deriveEdges(nodeViews)) {
          if (e.target_node === nv.id && e.target_port === out.id) {
            const src = nodeViews.find(x => x.id === e.source_node)
            if (src && src.computed && src.computed[e.source_port] !== undefined) {
              inputs[e.target_port] = src.computed[e.source_port]
            }
          }
        }
        nv.computed[out.id] = fn.call(ctx, inputs)
      } catch (e) {
        nv.error = e.message
      }
    }
    // 把 computed 流到下游
    for (const e of deriveEdges(nodeViews)) {
      if (e.target_node === nv.id && e.target_port) {
        const src = nodeViews.find(x => x.id === e.source_node)
        if (src && src.computed && src.computed[e.source_port] !== undefined) {
          nv.computed[e.target_port] = src.computed[e.source_port]
        }
      }
    }
  }
}

function deriveEdges(nodeViews) {
  const edges = []
  for (const nv of nodeViews) {
    for (const out of nv.outputs) {
      if (out.target && out.target_port) {
        edges.push({
          id: nv.id + '>' + out.id,
          source_node: nv.id,
          source_port: out.id,
          target_node: out.target,
          target_port: out.target_port,
        })
      }
    }
  }
  return edges
}

// ============================================================
// 演示
// ============================================================

// 快速验证：new Function 能否处理 class 语法
try {
  const testFn = new Function('return class Test {}')
  const TestClass = testFn()
  console.log('new Function + class 正常:', typeof TestClass)
} catch (e) {
  console.log('new Function + class 失败:', e.message)
}

console.log('=== 1. AI 可以写出这样的代码 ===')
console.log()

const aiCode = `define(class population {
  static label = '人口'
  static description = '城市常住人口，受出生、死亡、移民影响'
  static inputs = [{ id: 'immigration', label: '移民配额' }]
  static outputs = [{ id: 'housing_demand', target: 'housing', target_port: 'demand' }, { id: 'labor', target: 'economy', target_port: 'workers' }]

  current = 350
  growthRate = 0.02

  housing_demand(inputs) {
    const base = this.current * 0.3
    if (this.current > 1000) {
      return base + this.current * 0.1
    }
    return base
  }

  labor(inputs) {
    return this.current * 0.6
  }

  tick(dt, inputs) {
    this.current += this.current * this.growthRate * dt
  }
})`

console.log(aiCode)
console.log()

console.log('=== 2. 加载到内存 ===')
console.log()

const def = fromCode(aiCode)
console.log('id:', def.id)
console.log('label:', def.label)
console.log('description:', def.description)
console.log('inputs:', JSON.stringify(def.inputs))
console.log('outputs:', JSON.stringify(def.outputs))
console.log('properties:', JSON.stringify(def.properties))
console.log('methods:', Object.keys(def.methods).join(', '))
for (const [name, fn] of Object.entries(def.methods)) {
  console.log('  ' + name + ':', typeof fn, fn.length + ' 参数')
}

console.log()
console.log('=== 3. 渲染器视角 ===')
console.log()

const nv = toNodeView(def, 300, 200)
console.log('NodeView 直接给 renderer:')
console.log('  label:', nv.label, '| description:', nv.description)
console.log('  端口:', nv.inputs.length, '入', nv.outputs.length, '出')
console.log('  属性:', Object.keys(nv.properties).join(', '))
console.log('  方法:', Object.keys(nv.methods).length)
console.log('  如上图，renderer 不接触 code 字符串')

console.log()
console.log('=== 4. 序列化回 code（存 JSON / URL） ===')
console.log()

const serialized = toCode(def)
console.log(serialized)
console.log()

console.log('=== 5. Round-trip 验证 ===')
console.log()

const def2 = fromCode(serialized)
const roundtripOk = (
  def.id === def2.id &&
  def.label === def2.label &&
  JSON.stringify(def.inputs) === JSON.stringify(def2.inputs) &&
  JSON.stringify(def.outputs) === JSON.stringify(def2.outputs) &&
  JSON.stringify(def.properties) === JSON.stringify(def2.properties) &&
  Object.keys(def.methods).join(',') === Object.keys(def2.methods).join(',')
)
console.log('  round-trip:', roundtripOk ? '✅' : '❌')

console.log()
console.log('=== 6. 执行引擎（替代 compileClass） ===')
console.log()

const housingCode = `define(class housing {
  static label = '住房'
  static description = '住房供应与需求'
  static inputs = [{ id: 'demand', label: '需求量' }]
  supply = 100
})`

const popView = toNodeView(fromCode(aiCode), 200, 200)
const housingView = toNodeView(fromCode(housingCode), 400, 200)

const views = [popView, housingView]
console.log('初始:', popView.id, 'current =', popView.properties.current)
console.log()

// 改属性后传播
popView.properties.current = 500
propagate(views)

console.log('改 current=500 后:')
console.log('  population.housing_demand computed:', popView.computed.housing_demand)

const edges = deriveEdges(views)
const housingEdge = edges.find(e => e.target_node === 'housing')
console.log('  housing.demand 收到值:', housingEdge ? housingView.computed.demand : '(无边)')

console.log()
console.log('=== 7. L3 演化 ===')
console.log()

popView.properties.current = 100
for (let t = 0; t < 5; t++) {
  const fn = popView.methods.tick
  if (fn) fn.call(popView.properties, 1, {})
  console.log('  第', (t+1) + ' 步: current =', popView.properties.current)
}
