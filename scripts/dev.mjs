import * as esbuild from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

async function dev() {
  const ctx = await esbuild.context({
    entryPoints: [resolve(root, 'src', 'main.js')],
    bundle: true,
    outfile: resolve(root, 'dist', 'bundle.js'),
  })

  await ctx.watch()
  console.log('✓ Watching src/ for changes...')

  const distDir = resolve(root, 'dist')
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })

  let html = readFileSync(resolve(root, 'src', 'index.html'), 'utf-8')
  html = html.replace(
    '<script type="module" src="main.js"></script>',
    '<script src="bundle.js"></script>'
  )
  writeFileSync(resolve(distDir, 'index.html'), html)
  console.log('✓ Wrote dist/index.html')

  const { host, port } = await ctx.serve({
    servedir: resolve(root, 'dist'),
    fallback: resolve(root, 'dist', 'index.html'),
  })
  console.log(`✓ Dev server at http://${host}:${port}`)
}

dev().catch(e => { console.error(e); process.exit(1) })
