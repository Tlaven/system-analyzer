// v0.9 scanner 静态分析单元测试
// 模型：scanClass 返回 { description, name, attrs, methods, hasTick }
// 3 个实例级 class field（description / name / attrs），无 static 无 constructor
// v0.9 vs v0.8：删除 edges 字段（边不再在 class 声明）
import { scanClass } from '../src/scanner.js'
import { classifySource } from '../src/parser.js'
import { stripCodeBlock, buildAICopyText } from '../src/utils.js'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : '') }
}

// ==================================================================
console.log('\n=== 区 1：3 个 class field 基本识别 ===')
{
  class A {
    description = "测试"
    name = "测试节点"
    attrs = { value: 1 }
  }
  const scan = scanClass(A)
  check('description 读取', scan.description === '测试', scan.description)
  check('name 读取', scan.name === '测试节点', scan.name)
  check('attrs 含 value=1', scan.attrs.value === 1, scan.attrs)
  check('scan 不含 edges 字段（v0.9 移除）', !('edges' in scan), Object.keys(scan))
}

// ==================================================================
console.log('\n=== 区 2：class 误写 edges 字段时被丢弃 ===')
{
  class B {
    description = "B"
    name = "B"
    edges = [{ name: 'legacy', description: '应被丢弃' }]
    attrs = { v: 0 }
  }
  const scan = scanClass(B)
  check('误写的 edges 不进 scan 结果', !('edges' in scan), Object.keys(scan))
  check('attrs 不含 edges 键', !('edges' in scan.attrs), scan.attrs)
  check('其他 attrs 保留', scan.attrs.v === 0, scan.attrs)
}

// ==================================================================
console.log('\n=== 区 3：缺省 class field 容忍 ===')
{
  class C {
    description = "C"
  }
  const scan = scanClass(C)
  check('description 读取', scan.description === 'C', scan.description)
  check('无 name → 空字符串', scan.name === '', scan.name)
  check('无 attrs → 空对象', typeof scan.attrs === 'object' && Object.keys(scan.attrs).length === 0, scan.attrs)
}

// ==================================================================
console.log('\n=== 区 4：methods 识别（Code 模式）===')
{
  class D {
    description = "D"
    name = "D"
    attrs = { val: 0 }
    process({ dt }) { if (this.edges) for (const e of this.edges) e.target.input = this.val }
    tick({ dt }) { this.val += dt }
  }
  const scan = scanClass(D)
  check('methods 含 process 和 tick',
    scan.methods.includes('process') && scan.methods.includes('tick'), scan.methods)
  check('hasTick=true', scan.hasTick === true, scan.hasTick)
}

// ==================================================================
console.log('\n=== 区 5：attrs 深拷贝隔离 ===')
{
  class F {
    description = ""
    attrs = { config: { a: 1, b: 2 } }
  }
  const scan1 = scanClass(F)
  const scan2 = scanClass(F)
  scan1.attrs.config.a = 100
  check('两次 scanClass 互不影响（深拷贝）', scan2.attrs.config.a === 1, scan2.attrs.config.a)
}

// ==================================================================
console.log('\n=== 区 6：复杂 attrs（嵌套对象 / 数组）===')
{
  class G {
    description = "G"
    attrs = {
      items: [1, 2, 3],
      nested: { x: 10, y: 20 }
    }
  }
  const scan = scanClass(G)
  check('attrs.items 是数组', Array.isArray(scan.attrs.items) && scan.attrs.items.length === 3, scan.attrs.items)
  check('attrs.nested.x=10', scan.attrs.nested.x === 10, scan.attrs.nested)
}

// ==================================================================
console.log('\n=== 区 7：不输出 constructor / static 字段 ===')
{
  class I {
    description = "I"
    name = "I"
    attrs = { v: 0 }
  }
  const scan = scanClass(I)
  check('scan 结果不含 properties（v0.7 残留）', !('properties' in scan), Object.keys(scan))
  check('scan 结果不含 defaults（v0.7 残留）', !('defaults' in scan), Object.keys(scan))
  check('scan 结果不含 edges（v0.8 残留）', !('edges' in scan), Object.keys(scan))
}

// ==================================================================
console.log('\n=== 区 8：classifySource 白名单分类(ADR-008)===')
{
  check('纯声明式 → declarative', classifySource(`class A {
  description = 'A'
  name = 'A'
  attrs = { v: 1 }
}
const A_1 = GraphStarter.add(A, 'A_1')
A_1.v = 2
A_1.edges = [
  { target: null, description: 'x', transform: "target['v'] = source['v']" }
]`) === 'declarative')

  check('字符串含 if( / fetch( 不误伤(transform 常见)', classifySource(`class A { attrs = { s: "if (x) fetch(1)" } }
const A_1 = GraphStarter.add(A, 'A_1')`) === 'declarative')

  check('注释含 for( 不误伤', classifySource(`// for(;;) 注释
class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')`) === 'declarative')

  check('方法体 → programmatic', classifySource(`class A {
  attrs = { v: 1 }
  tick() { this.v = this.v + 1 }
}
const A_1 = GraphStarter.add(A, 'A_1')`) === 'programmatic')

  check('顶层控制流 → programmatic', classifySource(`class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')
for (let i = 0; i < 3; i++) A_1.v = A_1.v + 1`) === 'programmatic')

  check('constructor → programmatic', classifySource(`class A {
  attrs = { v: 1 }
  constructor() { this.v = 2 }
}
const A_1 = GraphStarter.add(A, 'A_1')`) === 'programmatic')

  check('顶层 fetch 调用 → unknown', classifySource(`class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')
fetch('https://example.com/' + localStorage.sa_data)`) === 'unknown')

  check('顶层 alert → unknown', classifySource(`class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')
alert(1)`) === 'unknown')

  check('模板串插值 → unknown', classifySource('class A { attrs = { v: 1 } }\nconst A_1 = GraphStarter.add(A, \'A_1\')\nA_1.v = `${1+1}`') === 'unknown')

  check('__proto__ 键 → unknown', classifySource(`class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')
A_1.v = { __proto__: { x: 1 } }`) === 'unknown')

  check('未知 class 字段(static) → unknown', classifySource(`class A {
  static description = 'x'
  attrs = { v: 1 }
}
const A_1 = GraphStarter.add(A, 'A_1')`) === 'unknown')

  check('裸引用赋值 → declarative', classifySource(`class A { attrs = { v: 1 } }
class B { attrs = { v: 0 } }
const A_1 = GraphStarter.add(A, 'A_1')
const B_1 = GraphStarter.add(B, 'B_1')
B_1.ref = A_1`) === 'declarative')

  check('quoted key 赋值 → declarative', classifySource(`class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')
A_1['a b'] = 2`) === 'declarative')

  check('edges = [] → declarative', classifySource(`class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')
A_1.edges = []`) === 'declarative')

  check('数字边界(-1/1.5/1e+21/Infinity/NaN/undefined)→ declarative', classifySource(`class A { attrs = { a: -1, b: 1.5, c: 1e+21, d: Infinity, e: NaN, f: undefined } }
const A_1 = GraphStarter.add(A, 'A_1')`) === 'declarative')

  check('未闭合字符串 → unknown', classifySource("class A { attrs = { s: 'oops } }") === 'unknown')

  check('import 语句 → unknown', classifySource(`import x from 'y'
class A { attrs = { v: 1 } }`) === 'unknown')

  check('空串 → declarative', classifySource('') === 'declarative')
}

// ==================================================================
console.log('\n=== 区 9：AI 传输文本工具(ADR-009)===')
{
  const src = "class A { attrs = { v: 1 } }\nconst A_1 = GraphStarter.add(A, 'A_1')"
  check('stripCodeBlock 剥围栏', stripCodeBlock('```js\n' + src + '\n```') === src)
  check('stripCodeBlock 剥标记', stripCodeBlock('// sa-edit: 123\n' + src) === src)
  check('stripCodeBlock 围栏+标记', stripCodeBlock('```js\n// sa-edit: 123\n' + src + '\n```') === src)
  check('stripCodeBlock 无围栏原样', stripCodeBlock(src) === src)
  check('stripCodeBlock 块内 ``` 不误剥', stripCodeBlock('```js\n' + src + '\nconst s = "```"\n```') === src + '\nconst s = "```"')
  const text = buildAICopyText(src, 42)
  check('buildAICopyText 首行标记', text.startsWith('```js\n// sa-edit: 42\n'))
  check('buildAICopyText 尾部围栏', text.endsWith('\n```\n'))
  check('往返:build → strip 还原源码', stripCodeBlock(text) === src)
}

console.log(`\n总计: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
