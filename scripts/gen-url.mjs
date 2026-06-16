// 生成 System Analyzer URL 工具
// 用法：node scripts/gen-url.mjs <graph.json>
// 输出 URL（含 #base64hash）到 stdout
//
// 这是给 AI 用的工具：AI 按 llms.txt 构造 graph JSON，用这个脚本生成 URL 给用户。

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// 复刻 src/utils.js 的 toB64（UTF-8 safe base64），用 Buffer 实现
function toB64(str) {
  const percentEncoded = encodeURIComponent(str)
  const replaced = percentEncoded.replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  )
  return Buffer.from(replaced, 'latin1').toString('base64')
}

const file = process.argv[2]
if (!file) {
  console.error('用法: node scripts/gen-url.mjs <graph.json>')
  process.exit(1)
}

const jsonStr = readFileSync(resolve(root, file), 'utf-8')

// 验证是有效 JSON
let parsed
try {
  parsed = JSON.parse(jsonStr)
} catch (e) {
  console.error('JSON 解析失败:', e.message)
  process.exit(1)
}

// 统计
const graph = parsed.graphs?.[0] || parsed
const nodeCount = graph.nodes?.length || 0
const edgeCount = graph.edges?.length || 0
const codeCount = (graph.nodes || []).filter(n => n.code && n.code.trim()).length

const enc = toB64(jsonStr)
// 默认 base：file:// 绝对路径（本地测试）。部署后用 SA_BASE_URL 环境变量覆盖
const baseUrl = process.env.SA_BASE_URL || pathToFileURL(resolve(root, 'dist', 'index.html')).href
const url = baseUrl + '#' + enc

console.log('Graph 信息:')
console.log('  标题:', graph.title || '(无)')
console.log('  节点:', nodeCount, ' 边:', edgeCount, ' 含 code:', codeCount)
console.log('  base64 长度:', enc.length, '字符' + (enc.length > 16000 ? ' (超限!)' : ''))
console.log()
console.log('URL:')
console.log(url)
