// 非正则 Class 解析器 demo
// 字符扫描 + 括号深度计数 + 位置关联注释
//
// 用法: node scripts/parse-class-demo.mjs [file]
//       不带文件则跑内置测试

import { readFileSync } from 'fs'

// ============================================================
// Token / 位置类型
// ============================================================
class Cursor {
  constructor(code) {
    this.code = code
    this.pos = 0
    this.line = 1
    this.col = 1
  }
  peek(offset = 0) { return this.code[this.pos + offset] ?? '' }
  next() {
    const c = this.code[this.pos]
    if (c === '\n') { this.line++; this.col = 1 }
    else this.col++
    this.pos++
    return c
  }
  eof() { return this.pos >= this.code.length }
  skipWS() {
    while (!this.eof() && /\s/.test(this.peek())) this.next()
  }
  error(msg) {
    throw new Error(`${msg} at ${this.line}:${this.col}`)
  }
}

// ============================================================
// 注释扫描
// ============================================================
// 返回 { startPos, endPos, text } 或 null
function scanComment(c) {
  if (c.peek() !== '/') return null
  const saved = c.pos
  c.next() // consume /
  if (c.peek() === '/') {
    // 行注释 // 到行尾
    const startPos = saved
    let text = ''
    c.next() // consume /
    while (!c.eof() && c.peek() !== '\n') text += c.next()
    return { startPos, endPos: c.pos, text: text.trim(), type: 'line' }
  }
  if (c.peek() === '*') {
    c.next() // consume *
    // 区分 /** 和 /*
    let text = ''
    const isJSDoc = c.peek() === '*'
    if (isJSDoc) {
      c.next() // consume second *
      if (c.peek() !== '/') text += '*'
      else { c.next(); return { startPos: saved, endPos: c.pos, text: '', type: 'jsdoc' } }
    }
    const startPos = saved
    // 扫描到 */
    while (!c.eof()) {
      if (c.peek() === '*' && c.peek(1) === '/') {
        c.next(); c.next() // consume */
        return { startPos, endPos: c.pos, text: text.trim(), type: isJSDoc ? 'jsdoc' : 'block' }
      }
      text += c.next()
    }
    c.error('未闭合的注释块')
  }
  // 不是注释，回退
  c.pos = saved
  return null
}

// 提取 JSDoc 的纯文本（去掉每行开头的 *）
function cleanJSDoc(raw) {
  return raw.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join('\n')
}

// ============================================================
// 字符串/模板字面量跳过
// ============================================================
function skipString(c, quote) {
  while (!c.eof()) {
    const ch = c.next()
    if (ch === '\\') c.next() // 转义，跳下一个
    else if (ch === quote) return
  }
  c.error('未闭合的字符串：' + quote)
}

function skipTemplateLiteral(c) {
  while (!c.eof()) {
    const ch = c.next()
    if (ch === '\\') c.next()
    else if (ch === '`') return
    else if (ch === '$' && c.peek() === '{') {
      c.next() // consume {
      skipBracketed(c, '{', '}')
    }
  }
  c.error('未闭合的模板字面量')
}

// ============================================================
// 花括号/方括号/括号跳过
// ============================================================
function skipBracketed(c, open, close) {
  let depth = 1
  while (!c.eof()) {
    const ch = c.next()
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return
    }
    else if (ch === '/') { const cm = scanComment(c); if (cm) continue }
    else if (ch === "'" || ch === '"') skipString(c, ch)
    else if (ch === '`') skipTemplateLiteral(c)
  }
  c.error(`未闭合的 ${close}`)
}

// ============================================================
// 扫描标识符
// ============================================================
function scanIdentifier(c) {
  let id = ''
  while (!c.eof() && /\w/.test(c.peek())) id += c.next()
  return id
}

// 跳过任意表达式直到遇到 stopChar（stopChar 不消费）
function skipExprTo(c, stopChar, stopWord) {
  let depthParen = 0, depthBracket = 0, depthBrace = 0
  while (!c.eof()) {
    const ch = c.peek()
    if (stopWord && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      const word = scanIdentifier(c)
      if (word === stopWord) {
        c.pos -= stopWord.length
        c.col -= stopWord.length
        return
      }
      continue
    }
    if (depthParen === 0 && depthBracket === 0 && depthBrace === 0 && ch === stopChar) return
    const ch2 = c.next()
    if (ch2 === '(') depthParen++
    else if (ch2 === ')') depthParen--
    else if (ch2 === '[') depthBracket++
    else if (ch2 === ']') depthBracket--
    else if (ch2 === '{') depthBrace++
    else if (ch2 === '}') depthBrace--
    else if (ch2 === "'" || ch2 === '"') skipString(c, ch2)
    else if (ch2 === '`') skipTemplateLiteral(c)
    else if (ch2 === '/') scanComment(c)
  }
}

// ============================================================
// 端口数组解析
// ============================================================
function parsePortArray(c) {
  const ports = []
  // 扫描到 [
  while (!c.eof()) {
    if (c.peek() === '[') { c.next(); break }
    if (c.peek() === '/') { scanComment(c); continue }
    if (/\s/.test(c.peek())) { c.next(); continue }
    c.next()
  }
  // 扫描数组内容
  let braceDepth = 1
  while (!c.eof() && braceDepth > 0) {
    const ch = c.peek()
    if (ch === ']') { braceDepth--; if (braceDepth === 0) { c.next(); break }; c.next() }
    else if (ch === '[') { braceDepth++; c.next() }
    else if (ch === '{') {
      ports.push(parsePortObject(c))
    }
    else if (ch === '/') { scanComment(c); continue }
    else if (ch === "'" || ch === '"') skipString(c, c.next())
    else if (ch === '`') skipTemplateLiteral(c)
    else c.next()
  }
  // 解析 "…" 退后到端口对象本身
  return ports
}

function parsePortObject(c) {
  const obj = {}
  c.next() // consume {
  while (!c.eof()) {
    const ch = c.peek()
    if (ch === '}') { c.next(); break }
    if (ch === '/') { scanComment(c); continue }
    if (/\s/.test(ch) || ch === ',') { c.next(); continue }
    // 扫描 key
    let key = ''
    if (ch === "'" || ch === '"') {
      const q = c.next()
      while (!c.eof() && c.peek() !== q) { if (c.peek() === '\\') { key += c.next(); key += c.next() } else key += c.next() }
      c.next() // consume closing quote
    } else {
      while (!c.eof() && /\w/.test(c.peek())) key += c.next()
    }
    if (!key) { c.next(); continue }
    // 跳过 :
    c.skipWS()
    if (c.peek() === ':') c.next()
    c.skipWS()
    let val = ''
    let vdepth = 0
    while (!c.eof()) {
      const vch = c.peek()
      if ((vch === ',' || vch === '}' || vch === ']') && vdepth === 0) break
      if (vch === '{') { vdepth++; val += c.next(); continue }
      if (vch === '}') { vdepth--; val += c.next(); continue }
      if (vch === '[') { vdepth++; val += c.next(); continue }
      if (vch === ']') { vdepth--; val += c.next(); continue }
      if (vch === "'" || vch === '"') {
        const q = vch; val += c.next()
        while (!c.eof() && c.peek() !== q) { val += c.next() }
        val += c.next(); continue
      }
      if (vch === '`') { val += c.next(); while (!c.eof() && c.peek() !== '`') { val += c.next() }; val += c.next(); continue }
      val += c.next()
    }
    obj[key.trim()] = val.trim().replace(/^['"]|['"]$/g, '').replace(/\\"/g, '"')
  }
  return obj
}

// ============================================================
// 主解析器
// ============================================================
export function parseClass(code) {
  const c = new Cursor(code)
  const result = { className: '', ports: { inputs: [], outputs: [] }, properties: {}, methods: [] }
  let currentComment = null
  let state = 'top' // top | class | method

  while (!c.eof()) {
    const ch = c.peek()

    // 注释
    if (ch === '/') {
      const cm = scanComment(c)
      if (cm) {
        if (cm.type === 'jsdoc') currentComment = { text: cleanJSDoc(cm.text), pos: cm.startPos }
        continue
      }
      // 不是注释，可能是 /
      c.next()
      continue
    }

    // 跳过空格
    if (/\s/.test(ch)) { c.next(); continue }

    // 跳过非 class 代码（在 class 外）
    if (state === 'top') {
      if (ch === 'c') {
        const saved = c.pos
        const word = scanIdentifier(c)
        if (word === 'class') {
          state = 'class'
          c.skipWS()
          result.className = scanIdentifier(c)
          c.skipWS()
          if (c.peek() !== '{') c.error('class 后需要 {')
          c.next() // consume {
          continue
        }
      } else {
        c.next()
        continue
      }
    }

    // 在 class 体里
    if (state === 'class') {
      if (ch === '}') {
        c.next()
        state = 'top'
        continue
      }

      // 扫描 static
      const saved = c.pos
      const word = scanIdentifier(c)
      if (word === 'static') {
        c.skipWS()
        const kw = scanIdentifier(c) // inputs | outputs
        if (kw === 'inputs') {
          const comment = currentComment?.text; currentComment = null
          c.skipWS()
          const ports = parsePortArray(c)
          result.ports.inputs = ports
          result.ports.inputComment = comment
        } else if (kw === 'outputs') {
          const comment = currentComment?.text; currentComment = null
          c.skipWS()
          const ports = parsePortArray(c)
          result.ports.outputs = ports
          result.ports.outputsComment = comment
        } else {
          // 别的 static 声明，跳过
          skipExprTo(c, ';', null)
        }
        continue
      }

      // 方法 / 属性
      if (/\w/.test(ch)) {
        const name = word
        c.skipWS()
        if (c.peek() === '(') {
          // 方法
          c.next() // consume (
          let params = ''
          let pdepth = 0
          while (!c.eof()) {
            const pc = c.peek()
            if (pc === ')' && pdepth === 0) break
            if (pc === '(') pdepth++
            else if (pc === ')') pdepth--
            if (pc === "'" || pc === '"') { const q = c.next(); while (!c.eof() && c.peek() !== q) { if (c.peek() === '\\') c.next(); c.next() }; c.next(); continue }
            if (pc === '`') { c.next(); while (!c.eof() && c.peek() !== '`') { if (c.peek() === '\\') c.next(); c.next() }; c.next(); continue }
            params += c.next()
          }
          c.next() // consume )
          const paramNames = params.split(',').map(s => s.trim()).filter(Boolean)

          c.skipWS()
          if (c.peek() === '{') {
            c.next() // consume {
            const bodyStart = c.pos
            skipBracketed(c, '{', '}')
            const body = c.code.slice(bodyStart, c.pos - 1)
            result.methods.push({
              name,
              params: paramNames,
              body,
              comment: currentComment,
            })
            currentComment = null
          }
          continue
        } else if (c.peek() === '=') {
          // 属性 name = value
          c.next() // consume =
          c.skipWS()
          let val = ''
          if (c.peek() === "'" || c.peek() === '"') {
            const q = c.next()
            while (!c.eof() && c.peek() !== q) { if (c.peek() === '\\') { val += c.next(); val += c.next() } else val += c.next() }
            c.next() // closing quote
          } else if (c.peek() === '`') {
            c.next()
            while (!c.eof() && c.peek() !== '`') { if (c.peek() === '\\') c.next(); val += c.next() }
            c.next()
          } else if (c.peek() === '{') {
            c.next() // consume {
            const bStart = c.pos
            skipBracketed(c, '{', '}')
            val = c.code.slice(bStart - 1, c.pos)
          } else if (c.peek() === '[') {
            c.next() // consume [
            const bStart = c.pos
            skipBracketed(c, '[', ']')
            val = c.code.slice(bStart - 1, c.pos)
          } else {
            // 单行值
            while (!c.eof() && !/[\s;]/.test(c.peek())) val += c.next()
          }
          // 转类型
          let parsedVal
          try { parsedVal = JSON.parse(val) } catch { parsedVal = val.replace(/^['"]|['"]$/g, '') }
          result.properties[name] = parsedVal
          if (currentComment) {
            result.properties['__comment_' + name] = currentComment.text
          }
          currentComment = null
          // 跳过分号
          if (c.peek() === ';') c.next()
          continue
        }
      }

      // 没认出的东西，跳过
      c.next()
    }
  }

  return result
}

// ============================================================
// 测试
// ============================================================
const TEST_CODE = `class population {
  /**
   * 城市常住人口，受出生、死亡、移民影响
   */
  current = 350
  birthRate = 0.02
  location = { x: 10, y: 20 }

  static inputs = [
    { id: 'immigration', label: '移民配额' },
    { id: 'death_rate', label: '死亡率' }
  ]

  /**
   * 人口越多，住房需求越大
   */
  static outputs = [
    { id: 'housing_demand', label: '住房需求', target: 'housing', target_port: 'demand' },
    { id: 'labor', target: 'economy', target_port: 'workers' }
  ]

  /**
   * 计算住房需求
   */
  housing_demand(inputs) {
    const base = this.current * 0.3
    if (this.current > 1000) {
      const extra = this.current * 0.1
      return base + extra
    }
    return base
  }

  labor(inputs) {
    return this.current * 0.6
  }

  /**
   * 随时间演化
   */
  tick(dt, inputs) {
    this.current += this.current * this.birthRate * dt
    if (this.current < 0) { this.current = 0 }
  }

  helper_test(a, b) {
    return a + b
  }
}`

function main() {
  const file = process.argv[2]
  const code = file ? readFileSync(file, 'utf-8') : TEST_CODE
  const result = parseClass(code)

  console.log('=== 解析结果 ===')
  console.log()
  console.log('Class:', result.className)
  console.log()

  console.log('--- 属性 ---')
  for (const [k, v] of Object.entries(result.properties)) {
    if (k.startsWith('__comment_')) continue
    const cm = result.properties['__comment_' + k]
    if (cm) console.log('  /* ' + cm + ' */')
    console.log('  ' + k + ' =', JSON.stringify(v))
  }

  console.log()
  console.log('--- 输入端口 ---')
  if (result.ports.inputComment) console.log('  /* ' + result.ports.inputComment + ' */')
  for (const p of result.ports.inputs) {
    console.log('  ', JSON.stringify(p))
  }

  console.log()
  console.log('--- 输出端口 ---')
  if (result.ports.outputsComment) console.log('  /* ' + result.ports.outputsComment + ' */')
  for (const p of result.ports.outputs) {
    console.log('  ', JSON.stringify(p))
  }

  console.log()
  console.log('--- 方法 ---')
  for (const m of result.methods) {
    if (m.comment) console.log('  /* ' + m.comment.text + ' */')
    console.log('  ' + m.name + '(' + m.params.join(', ') + ') {')
    const indented = m.body.split('\n').map(l => '    ' + l).join('\n')
    console.log(indented)
    console.log('  }')
  }

  // 验证嵌套 brace
  console.log()
  console.log('--- 正确性验证 ---')
  let ok = true
  for (const m of result.methods) {
    const openCount = (m.body.match(/\{/g) || []).length
    const closeCount = (m.body.match(/\}/g) || []).length
    if (openCount !== closeCount) {
      console.log('  ❌ ' + m.name + ': { 不平衡 (' + openCount + ' vs ' + closeCount + ')')
      ok = false
    } else {
      console.log('  ✅ ' + m.name + ': body 长度 ' + m.body.length + ' 字符，{ 平衡 (' + openCount + ')')
    }
  }
  console.log(ok ? '\n  全部通过' : '\n  有错误')
}

const isEntry = process.argv[1] && (process.argv[1].endsWith('parse-class-demo.mjs') || process.argv[1].endsWith('parse-class-demo'))
if (isEntry) main()
