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
  while (!c.eof() && /\w/.test(c.peek())) id += c.next()
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
