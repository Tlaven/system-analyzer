// v0.6 scanner 静态分析单元测试
// 直接 import src/scanner.js，不复制逻辑（v0.5 是复制版本，过时）
import { scanClass } from '../src/scanner.js'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : '') }
}

// ==================================================================
console.log('\n=== 区 1：scanner 基本写入识别 ===')
{
  class A {
    constructor() { this.target = null; this.value = 1 }
    process({ dt }) { this.target.input = this.value * dt }
  }
  const scan = scanClass(A)
  check('properties 含 target, value', scan.properties.length === 2, scan.properties)
  check('references 含 target', scan.references.includes('target'), scan.references)
  check('emitters 1 条', scan.emitters.length === 1, scan.emitters)
  check('emitter ref=target attr=input', scan.emitters[0].ref === 'target' && scan.emitters[0].attr === 'input', scan.emitters[0])
}

// ==================================================================
console.log('\n=== 区 2：== / === 不算写入 ===')
{
  class B {
    constructor() { this.target = null }
    check({ dt }) {
      if (this.target.input === 5) return
      if (this.target.count == 0) return
      this.target.input = 10
    }
  }
  const scan = scanClass(B)
  check('emitters 仍为 1 条', scan.emitters.length === 1, scan.emitters)
  check('唯一 emitter attr=input', scan.emitters[0].attr === 'input', scan.emitters[0])
}

// ==================================================================
console.log('\n=== 区 3：复合赋值识别 ===')
{
  class C {
    constructor() { this.target = null }
    accumulate({ dt }) { this.target.sum += dt }
    decrement({ dt }) { this.target.sum -= dt * 0.5 }
  }
  const scan = scanClass(C)
  check('emitters 2 条', scan.emitters.length === 2, scan.emitters)
  check('全部 attr=sum', scan.emitters.every(e => e.attr === 'sum'), scan.emitters)
}

// ==================================================================
console.log('\n=== 区 4：多 emitter / 多引用槽 ===')
{
  class D {
    constructor() { this.a = null; this.b = null }
    fanOut({ dt }) {
      this.a.x = 1
      this.b.y = 2
    }
  }
  const scan = scanClass(D)
  check('emitters 2 条', scan.emitters.length === 2, scan.emitters)
  check('references 含 a 和 b', scan.references.includes('a') && scan.references.includes('b'), scan.references)
}

// ==================================================================
console.log('\n=== 区 5：只写 self 不算 emitter ===')
{
  class E {
    constructor() { this.value = 0; this.input = 0 }
    process({ dt }) { this.value = this.input * 2 }
  }
  const scan = scanClass(E)
  check('emitters 0 条', scan.emitters.length === 0, scan.emitters)
  check('references 空', scan.references.length === 0, scan.references)
  check('properties 含 value, input', scan.properties.length === 2, scan.properties)
}

// ==================================================================
console.log('\n=== 区 6：tick 方法识别 ===')
{
  class F {
    constructor() { this.target = null; this.val = 0 }
    process({ dt }) { this.target.input = this.val }
    tick({ dt }) { this.val += dt }
  }
  const scan = scanClass(F)
  check('hasTick=true', scan.hasTick === true, scan.hasTick)
  check('methods 含 process 和 tick',
    scan.methods.includes('process') && scan.methods.includes('tick'), scan.methods)
  check('emitters 1 条（tick 不写下游）', scan.emitters.length === 1, scan.emitters)
}

// ==================================================================
console.log('\n=== 区 7：下划线属性被过滤 ===')
{
  class G {
    constructor() { this._internal = 1; this.public = 2; this.target = null }
    process({ dt }) { this.target.input = this.public }
  }
  const scan = scanClass(G)
  check('properties 不含 _internal', !scan.properties.includes('_internal'), scan.properties)
  check('properties 含 public', scan.properties.includes('public'), scan.properties)
}

// ==================================================================
console.log('\n=== 区 8：条件写入仍算 emitter ===')
{
  class H {
    constructor() { this.target = null; this.mode = 'a' }
    process({ dt }) {
      if (this.mode === 'a') {
        this.target.input = 1
      } else {
        this.target.output = 2
      }
    }
  }
  const scan = scanClass(H)
  check('条件内两个写入都识别（2 条 emitter）', scan.emitters.length === 2, scan.emitters)
  check('attr 分别是 input 和 output',
    scan.emitters.some(e => e.attr === 'input') && scan.emitters.some(e => e.attr === 'output'),
    scan.emitters)
}

// ==================================================================
console.log('\n=== 区 9：static description 不影响 scan（v0.6 由 runSource 单独读） ===')
{
  class I {
    static description = "测试描述"
    constructor() { this.config = { a: 1, b: 2 }; this.target = null }
    process({ dt }) { this.target.input = this.config.a }
  }
  const scan = scanClass(I)
  check('scanClass 不识别 static description（由 runSource 处理）',
    !('description' in scan), scan)
  check('properties 含 config, target', scan.properties.length === 2, scan.properties)
  check('emitters 1 条', scan.emitters.length === 1, scan.emitters)

  // 深拷贝默认值隔离
  const a1 = JSON.parse(JSON.stringify(scan.defaults))
  const a2 = JSON.parse(JSON.stringify(scan.defaults))
  a1.config.a = 100
  check('深拷贝后互不影响', a2.config.a === 1, a2.config.a)
}

console.log(`\n总计: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
