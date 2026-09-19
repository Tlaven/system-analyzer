// 非正则 Class 解析器（从 scripts/parse-class-demo.mjs 迁移）
// 字符扫描 + 括号深度计数 + 位置关联注释
// v0.6 扩展：识别 static description；新增 splitSource 切分 class 段与 bootstrap 段

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

function scanComment(c) {
  if (c.peek() !== '/') return null
  const saved = c.pos
  c.next()
  if (c.peek() === '/') {
    const startPos = saved
    let text = ''
    c.next()
    while (!c.eof() && c.peek() !== '\n') text += c.next()
    return { startPos, endPos: c.pos, text: text.trim(), type: 'line' }
  }
  if (c.peek() === '*') {
    c.next()
    let text = ''
    const isJSDoc = c.peek() === '*'
    if (isJSDoc) {
      c.next()
      if (c.peek() !== '/') text += '*'
      else { c.next(); return { startPos: saved, endPos: c.pos, text: '', type: 'jsdoc' } }
    }
    const startPos = saved
    while (!c.eof()) {
      if (c.peek() === '*' && c.peek(1) === '/') {
        c.next(); c.next()
        return { startPos, endPos: c.pos, text: text.trim(), type: isJSDoc ? 'jsdoc' : 'block' }
      }
      text += c.next()
    }
    c.error('未闭合的注释块')
  }
  c.pos = saved
  return null
}

function cleanJSDoc(raw) {
  return raw.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join('\n')
}

function skipString(c, quote) {
  while (!c.eof()) {
    const ch = c.next()
    if (ch === '\\') c.next()
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
      c.next()
      skipBracketed(c, '{', '}')
    }
  }
  c.error('未闭合的模板字面量')
}

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

function scanIdentifier(c) {
  let id = ''
  while (!c.eof() && /[\p{L}\p{N}_]/u.test(c.peek())) id += c.next()
  return id
}

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

function parsePortArray(c) {
  const ports = []
  while (!c.eof()) {
    if (c.peek() === '[') { c.next(); break }
    if (c.peek() === '/') { scanComment(c); continue }
    if (/\s/.test(c.peek())) { c.next(); continue }
    c.next()
  }
  let braceDepth = 1
  while (!c.eof() && braceDepth > 0) {
    const ch = c.peek()
    if (ch === ']') { braceDepth--; if (braceDepth === 0) { c.next(); break }; c.next() }
    else if (ch === '[') { braceDepth++; c.next() }
    else if (ch === '{') ports.push(parsePortObject(c))
    else if (ch === '/') { scanComment(c); continue }
    else if (ch === "'" || ch === '"') skipString(c, c.next())
    else if (ch === '`') skipTemplateLiteral(c)
    else c.next()
  }
  return ports
}

function parsePortObject(c) {
  const obj = {}
  c.next()
  while (!c.eof()) {
    const ch = c.peek()
    if (ch === '}') { c.next(); break }
    if (ch === '/') { scanComment(c); continue }
    if (/\s/.test(ch) || ch === ',') { c.next(); continue }
    let key = ''
    if (ch === "'" || ch === '"') {
      const q = c.next()
      while (!c.eof() && c.peek() !== q) { if (c.peek() === '\\') { key += c.next(); key += c.next() } else key += c.next() }
      c.next()
    } else {
      while (!c.eof() && /\w/.test(c.peek())) key += c.next()
    }
    if (!key) { c.next(); continue }
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
        while (!c.eof() && c.peek() !== q) val += c.next()
        val += c.next(); continue
      }
      if (vch === '`') { val += c.next(); while (!c.eof() && c.peek() !== '`') val += c.next(); val += c.next(); continue }
      val += c.next()
    }
    obj[key.trim()] = val.trim().replace(/^['"]|['"]$/g, '').replace(/\\"/g, '"')
  }
  return obj
}

// 解析单个 class 字符串。
// v0.6 扩展：识别 static description = "..." 并存到 result.description
export function parseClass(code) {
  const c = new Cursor(code)
  const result = {
    className: '',
    description: '',
    ports: { inputs: [], outputs: [] },
    properties: {},
    methods: [],
  }
  let currentComment = null
  let state = 'top'

  while (!c.eof()) {
    const ch = c.peek()

    if (ch === '/') {
      const cm = scanComment(c)
      if (cm) {
        if (cm.type === 'jsdoc') currentComment = { text: cleanJSDoc(cm.text), pos: cm.startPos }
        continue
      }
      c.next()
      continue
    }

    if (/\s/.test(ch)) { c.next(); continue }

    if (state === 'top') {
      if (/[a-zA-Z_$]/.test(ch)) {
        const word = scanIdentifier(c)
        if (word === 'class') {
          state = 'class'
          c.skipWS()
          result.className = scanIdentifier(c)
          c.skipWS()
          // 跳过 extends X
          const savedPos = c.pos
          const maybeExtends = scanIdentifier(c)
          if (maybeExtends === 'extends') {
            c.skipWS()
            scanIdentifier(c)
            c.skipWS()
          } else {
            c.pos = savedPos
          }
          if (c.peek() !== '{') c.error('class 后需要 {')
          c.next()
          continue
        }
      } else {
        c.next()
        continue
      }
    }

    if (state === 'class') {
      if (ch === '}') {
        c.next()
        state = 'top'
        continue
      }

      const word = scanIdentifier(c)
      if (word === 'static') {
        c.skipWS()
        const kw = scanIdentifier(c)
        if (kw === 'inputs') {
          const comment = currentComment?.text; currentComment = null
          c.skipWS()
          result.ports.inputs = parsePortArray(c)
          result.ports.inputComment = comment
        } else if (kw === 'outputs') {
          const comment = currentComment?.text; currentComment = null
          c.skipWS()
          result.ports.outputs = parsePortArray(c)
          result.ports.outputsComment = comment
        } else if (kw === 'description') {
          // v0.6 新增：static description = "..."
          c.skipWS()
          if (c.peek() === '=') {
            c.next()
            c.skipWS()
            let val = ''
            const q = c.peek()
            if (q === "'" || q === '"') {
              c.next()
              while (!c.eof() && c.peek() !== q) {
                if (c.peek() === '\\') { val += c.next(); val += c.next() }
                else val += c.next()
              }
              c.next()
            } else if (q === '`') {
              c.next()
              while (!c.eof() && c.peek() !== '`') {
                if (c.peek() === '\\') { val += c.next(); val += c.next() }
                else val += c.next()
              }
              c.next()
            }
            result.description = val
          }
          currentComment = null
          if (c.peek() === ';') c.next()
        } else {
          skipExprTo(c, ';', null)
        }
        continue
      }

      if (/\w/.test(ch)) {
        const name = word
        c.skipWS()
        if (c.peek() === '(') {
          c.next()
          let params = ''
          let pdepth = 0
          while (!c.eof()) {
            const pc = c.peek()
            if (pc === ')' && pdepth === 0) break
            if (pc === '(') pdepth++
            else if (pc === ')') pdepth--
            if (pc === "'" || pc === '"') {
              const q = c.next()
              while (!c.eof() && c.peek() !== q) { if (c.peek() === '\\') c.next(); c.next() }
              c.next(); continue
            }
            if (pc === '`') {
              c.next()
              while (!c.eof() && c.peek() !== '`') { if (c.peek() === '\\') c.next(); c.next() }
              c.next(); continue
            }
            params += c.next()
          }
          c.next()
          const paramNames = params.split(',').map(s => s.trim()).filter(Boolean)

          c.skipWS()
          if (c.peek() === '{') {
            c.next()
            const bodyStart = c.pos
            skipBracketed(c, '{', '}')
            const body = c.code.slice(bodyStart, c.pos - 1)
            result.methods.push({ name, params: paramNames, body, comment: currentComment })
            currentComment = null
          }
          continue
        } else if (c.peek() === '=') {
          c.next()
          c.skipWS()
          let val = ''
          if (c.peek() === "'" || c.peek() === '"') {
            const q = c.next()
            while (!c.eof() && c.peek() !== q) {
              if (c.peek() === '\\') { val += c.next(); val += c.next() }
              else val += c.next()
            }
            c.next()
          } else if (c.peek() === '`') {
            c.next()
            while (!c.eof() && c.peek() !== '`') {
              if (c.peek() === '\\') c.next()
              val += c.next()
            }
            c.next()
          } else if (c.peek() === '{') {
            c.next()
            const bStart = c.pos
            skipBracketed(c, '{', '}')
            val = c.code.slice(bStart - 1, c.pos)
          } else if (c.peek() === '[') {
            c.next()
            const bStart = c.pos
            skipBracketed(c, '[', ']')
            val = c.code.slice(bStart - 1, c.pos)
          } else {
            while (!c.eof() && !/[\s;]/.test(c.peek())) val += c.next()
          }
          let parsedVal
          try { parsedVal = JSON.parse(val) } catch { parsedVal = val.replace(/^['"]|['"]$/g, '') }
          result.properties[name] = parsedVal
          if (currentComment) {
            result.properties['__comment_' + name] = currentComment.text
          }
          currentComment = null
          if (c.peek() === ';') c.next()
          continue
        }
      }

      c.next()
    }
  }

  return result
}

// v0.6 新增：把整段 sourceCode 切分成 class 段和 bootstrap 段
// 返回 { classes: [{name, source, start, end}], bootstrap: '启动代码段字符串' }
export function splitSource(sourceCode) {
  const c = new Cursor(sourceCode)
  const classRanges = []

  while (!c.eof()) {
    const ch = c.peek()

    if (ch === '/') {
      const cm = scanComment(c)
      if (!cm) c.next()
      continue
    }
    if (ch === "'" || ch === '"') { c.next(); skipString(c, sourceCode[c.pos - 1]); continue }
    if (ch === '`') { c.next(); skipTemplateLiteral(c); continue }

    if (/[a-zA-Z_$]/.test(ch)) {
      const wordStart = c.pos
      const word = scanIdentifier(c)
      if (word === 'class') {
        c.skipWS()
        const className = scanIdentifier(c)
        c.skipWS()
        const savedPos = c.pos
        const maybeExtends = scanIdentifier(c)
        if (maybeExtends === 'extends') {
          c.skipWS()
          scanIdentifier(c)
          c.skipWS()
        } else {
          c.pos = savedPos
        }
        if (c.peek() !== '{') {
          throw new Error(`class ${className} 后需要 '{'`)
        }
        const classStart = wordStart
        c.next()
        skipBracketed(c, '{', '}')
        const classEnd = c.pos
        classRanges.push({ name: className, start: classStart, end: classEnd })
      }
      continue
    }

    c.next()
  }

  const classes = classRanges.map(r => ({
    name: r.name,
    source: sourceCode.slice(r.start, r.end),
    start: r.start,
    end: r.end,
  }))

  let bootstrap = ''
  let lastEnd = 0
  for (const r of classRanges) {
    bootstrap += sourceCode.slice(lastEnd, r.start)
    lastEnd = r.end
  }
  bootstrap += sourceCode.slice(lastEnd)

  return { classes, bootstrap: bootstrap.trim() }
}

// 启发式检测 sourceCode 是否含程序化结构或方法体(UI 模式编辑会丢弃这些)
// 含:for/while/if/switch/function/=> 控制流,或 class 内非 constructor 方法
// input.js(Code→UI 切换 confirm)与 io.js(载入守卫)共用
export function isSourceCodeProgrammatic(code) {
  if (!code) return false
  // 控制流关键字（在 class 外的启动段也算）
  const controlFlowRe = /\b(?:for\s*\(|while\s*\(|if\s*\(|switch\s*\(|function\b|=>)/
  if (controlFlowRe.test(code)) return true
  // class 内非 constructor 方法
  try {
    const { classes } = splitSource(code)
    for (const c of classes) {
      // 匹配 `<ident>(<params>) {` 且不是 constructor
      const methodRe = /\b([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/g
      let m
      while ((m = methodRe.exec(c.source))) {
        if (m[1] !== 'constructor') return true
      }
    }
  } catch (_) { /* splitSource 失败：保守起见视为程序化 */ return true }
  return false
}

// ============================================================
// ADR-008:外部导入可信度分类
// 返回 'declarative' | 'programmatic' | 'unknown'
//   declarative — 只含模型认识的声明式语句,可静默运行
//   programmatic — 控制流/方法体/箭头函数,执行前需用户确认
//   unknown — 无法归类(保守,同样需要确认)
// 注意:这是安全闸门判定,不是完整 JS 解析器。只放行白名单语法,
// 任何无法证明"无函数调用"的构造一律拒绝(宁可误闸,不可误放)。
// 与 isSourceCodeProgrammatic 的分工:后者判"切 UI 模式会丢什么"(粗,可误伤);
// 本函数是安全边界,必须字符串/注释感知(transform 字符串里常见 if( )。
// ============================================================

const _IDENT_START_RE = /[\p{L}_$]/u

function _isIdentStart(ch) { return !!ch && _IDENT_START_RE.test(ch) }

function _skipWSComments(c) {
  while (!c.eof()) {
    if (/\s/.test(c.peek())) { c.next(); continue }
    if (c.peek() === '/') { if (scanComment(c)) continue }
    break
  }
}

function _peekWord(c) {
  if (!_isIdentStart(c.peek())) return null
  const saved = c.pos
  const w = scanIdentifier(c)
  c.pos = saved
  return w
}

function _consumeWord(c, word) {
  if (_peekWord(c) !== word) return false
  for (let i = 0; i < word.length; i++) c.next()
  return true
}

// 把字符串/注释/模板串替换为等长空白,只留可执行骨架(用于控制流关键字检测)
function _stripStringsAndComments(code) {
  const c = new Cursor(code)
  let out = ''
  while (!c.eof()) {
    const ch = c.peek()
    if (ch === '/') {
      const saved = c.pos
      const cm = scanComment(c)
      if (cm) { out += ' '.repeat(cm.endPos - saved); continue }
      out += c.next()
      continue
    }
    if (ch === "'" || ch === '"') {
      const start = c.pos
      c.next()
      skipString(c, ch)
      out += ' '.repeat(c.pos - start)
      continue
    }
    if (ch === '`') {
      const start = c.pos
      c.next()
      skipTemplateLiteral(c)
      out += ' '.repeat(c.pos - start)
      continue
    }
    out += c.next()
  }
  return out
}

// 字面量 / 裸标识符(实例引用)。消费成功返回 true。
// 支持:字符串(单/双引号、无插值模板串)、数字(负/小数/指数/进制)、
// true/false/null/undefined/NaN/Infinity、数组、对象(键为标识符或字符串;
// 拒绝 __proto__)、裸标识符。其余(函数/箭头/成员访问/调用/模板插值/
// 展开/计算键)一律 false → 上层归 unknown。
function _consumeLiteral(c, depth) {
  if (depth > 20) return false
  _skipWSComments(c)
  const ch = c.peek()
  if (!ch) return false
  if (ch === "'" || ch === '"') { c.next(); skipString(c, ch); return true }
  if (ch === '`') {
    c.next()
    while (!c.eof()) {
      const t = c.peek()
      if (t === '\\') { c.next(); c.next(); continue }
      if (t === '$' && c.peek(1) === '{') return false
      if (t === '`') { c.next(); return true }
      c.next()
    }
    return false
  }
  if (ch === '[') {
    c.next()
    while (true) {
      _skipWSComments(c)
      if (c.peek() === ']') { c.next(); return true }
      if (!_consumeLiteral(c, depth + 1)) return false
      _skipWSComments(c)
      if (c.peek() === ',') { c.next(); continue }
      if (c.peek() === ']') { c.next(); return true }
      return false
    }
  }
  if (ch === '{') {
    c.next()
    while (true) {
      _skipWSComments(c)
      if (c.peek() === '}') { c.next(); return true }
      let key = null
      if (_isIdentStart(c.peek())) key = scanIdentifier(c)
      else if (c.peek() === "'" || c.peek() === '"') {
        const q = c.peek(); c.next()
        key = ''
        while (!c.eof() && c.peek() !== q) {
          if (c.peek() === '\\') { c.next(); key += c.next() }
          else key += c.next()
        }
        if (c.eof()) return false
        c.next()
      } else return false
      if (key === '__proto__') return false
      _skipWSComments(c)
      if (c.peek() !== ':') return false
      c.next()
      if (!_consumeLiteral(c, depth + 1)) return false
      _skipWSComments(c)
      if (c.peek() === ',') { c.next(); continue }
      if (c.peek() === '}') { c.next(); return true }
      return false
    }
  }
  if (ch === '-' || ch === '.' || (ch >= '0' && ch <= '9')) {
    const rest = c.code.slice(c.pos)
    const m = rest.match(/^-?(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/)
    if (m) {
      for (let i = 0; i < m[0].length; i++) c.next()
      return true
    }
    if (ch === '-') {
      c.next()
      if (_consumeWord(c, 'Infinity') || _consumeWord(c, 'NaN')) return true
      return false
    }
    return false
  }
  if (_isIdentStart(ch)) { scanIdentifier(c); return true }
  return false
}

// class 体白名单:只允许 description/name/attrs 三个数据字段(值为字面量)。
// 方法/constructor/getter → programmatic;未知字段(static 等)→ unknown。
function _classifyClass(source) {
  const c = new Cursor(source)
  if (!_consumeWord(c, 'class')) return 'unknown'
  _skipWSComments(c)
  if (!_isIdentStart(c.peek())) return 'unknown'
  scanIdentifier(c)
  _skipWSComments(c)
  if (_peekWord(c) === 'extends') {
    _consumeWord(c, 'extends')
    _skipWSComments(c)
    if (!_isIdentStart(c.peek())) return 'unknown'
    scanIdentifier(c)
    _skipWSComments(c)
  }
  if (c.peek() !== '{') return 'unknown'
  c.next()
  while (true) {
    _skipWSComments(c)
    if (c.eof()) return 'unknown'
    if (c.peek() === '}') return 'declarative'
    if (c.peek() === ';') { c.next(); continue }
    if (!_isIdentStart(c.peek())) return 'unknown'
    const field = scanIdentifier(c)
    _skipWSComments(c)
    if (c.peek() === '(') return 'programmatic'
    if (c.peek() !== '=') return 'unknown'
    c.next()
    _skipWSComments(c)
    if (field === 'description' || field === 'name') {
      const q = c.peek()
      if (q !== "'" && q !== '"' && q !== '`') return 'unknown'
      if (!_consumeLiteral(c, 0)) return 'unknown'
    } else if (field === 'attrs') {
      if (!_consumeLiteral(c, 0)) return 'unknown'
    } else {
      return 'unknown'
    }
    _skipWSComments(c)
    if (c.peek() === ';') c.next()
  }
}

// 启动段白名单:GraphStarter.add 声明 + 实例 override/edges 赋值
function _isDeclarativeBootstrap(boot) {
  const c = new Cursor(boot)
  while (true) {
    _skipWSComments(c)
    if (c.eof()) return true
    if (c.peek() === ';') { c.next(); continue }
    const w = _peekWord(c)
    if (w === 'const' || w === 'let' || w === 'var') {
      _consumeWord(c, w)
      _skipWSComments(c)
      if (!_isIdentStart(c.peek())) return false
      scanIdentifier(c)
      _skipWSComments(c)
      if (c.peek() !== '=') return false
      c.next()
      _skipWSComments(c)
      if (!_consumeWord(c, 'GraphStarter')) return false
      _skipWSComments(c)
      if (c.peek() !== '.') return false
      c.next()
      _skipWSComments(c)
      if (!_consumeWord(c, 'add')) return false
      _skipWSComments(c)
      if (c.peek() !== '(') return false
      c.next()
      _skipWSComments(c)
      if (!_isIdentStart(c.peek())) return false
      scanIdentifier(c)
      _skipWSComments(c)
      if (c.peek() === ',') {
        c.next()
        _skipWSComments(c)
        const q = c.peek()
        if (q !== "'" && q !== '"') return false
        c.next(); skipString(c, q)
        _skipWSComments(c)
      }
      if (c.peek() !== ')') return false
      c.next()
      if (c.peek() === ';') c.next()
      continue
    }
    // IDENT.accessor = 字面量/引用
    if (!_isIdentStart(c.peek())) return false
    scanIdentifier(c)
    _skipWSComments(c)
    if (c.peek() === '.') {
      c.next()
      _skipWSComments(c)
      if (!_isIdentStart(c.peek())) return false
      scanIdentifier(c)
    } else if (c.peek() === '[') {
      c.next()
      _skipWSComments(c)
      const q = c.peek()
      if (q !== "'" && q !== '"') return false
      c.next(); skipString(c, q)
      _skipWSComments(c)
      if (c.peek() !== ']') return false
      c.next()
    } else {
      return false
    }
    _skipWSComments(c)
    if (c.peek() !== '=') return false
    c.next()
    if (!_consumeLiteral(c, 0)) return false
    if (c.peek() === ';') c.next()
  }
}

export function classifySource(code) {
  if (typeof code !== 'string') return 'unknown'
  if (!code.trim()) return 'declarative'
  let clean
  try { clean = _stripStringsAndComments(code) } catch (_) { return 'unknown' }
  if (/\b(?:for\s*\(|while\s*\(|if\s*\(|switch\s*\(|function\b|=>)/.test(clean)) return 'programmatic'
  let split
  try { split = splitSource(code) } catch (_) { return 'unknown' }
  for (const c of split.classes) {
    const kind = _classifyClass(c.source)
    if (kind !== 'declarative') return kind
  }
  try {
    if (!_isDeclarativeBootstrap(split.bootstrap)) return 'unknown'
  } catch (_) { return 'unknown' }
  return 'declarative'
}
