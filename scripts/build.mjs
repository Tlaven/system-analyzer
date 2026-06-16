import * as esbuild from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

async function build() {
  const result = await esbuild.build({
    entryPoints: [resolve(root, 'src', 'main.js')],
    bundle: true,
    minify: true,
    write: false,
  })

  let html = readFileSync(resolve(root, 'src', 'index.html'), 'utf-8')

  const bundleCode = result.outputFiles[0].text
  // Use function replacement so $& in bundleCode is not interpreted as a replacement pattern
  html = html.replace(
    '<script type="module" src="main.js"></script>',
    () => `<script>${bundleCode}</script>`
  )

  const distDir = resolve(root, 'dist')
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })
  writeFileSync(resolve(distDir, 'index.html'), html)

  // Copy llms.txt (AI-facing documentation)
  const llmsSrc = resolve(root, 'src', 'llms.txt')
  if (existsSync(llmsSrc)) {
    writeFileSync(resolve(distDir, 'llms.txt'), readFileSync(llmsSrc, 'utf-8'))
    console.log('✓ Copied dist/llms.txt')
  }

  console.log('✓ Built dist/index.html')
}

build().catch(e => { console.error(e); process.exit(1) })
