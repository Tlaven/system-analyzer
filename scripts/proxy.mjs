import * as http from 'http'

const PORT = 3847

const PROVIDERS = {
  openai: {
    url: (body) => 'https://api.openai.com/v1/chat/completions',
    headers: (body) => ({ 'Authorization': `Bearer ${body.apiKey}`, 'Content-Type': 'application/json' }),
    reqBody: (body) => JSON.stringify({ model: body.model || 'gpt-4o', messages: body.messages }),
    resBody: async (resp) => { const d = JSON.parse(await resp.text()); return d.choices?.[0]?.message?.content || JSON.stringify(d) },
  },
  anthropic: {
    url: (body) => 'https://api.anthropic.com/v1/messages',
    headers: (body) => ({ 'x-api-key': body.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }),
    reqBody: (body) => JSON.stringify({ model: body.model || 'claude-sonnet-4-20250514', max_tokens: 4096, messages: body.messages }),
    resBody: async (resp) => { const d = JSON.parse(await resp.text()); return d.content?.[0]?.text || JSON.stringify(d) },
  },
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }

  if (req.method === 'POST' && req.url === '/chat') {
    let raw = ''
    req.on('data', chunk => raw += chunk)
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw)
        const p = PROVIDERS[body.provider]
        if (!p) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'Unknown provider: ' + body.provider })); return }
        if (!body.apiKey) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'Missing apiKey' })); return }

        const resp = await fetch(p.url(body), {
          method: 'POST',
          headers: p.headers(body),
          body: p.reqBody(body),
        })

        const text = await resp.text()
        let result
        try { result = p.resBody({ text: () => text }) } catch (e) { result = text }

        res.writeHead(resp.status, { ...CORS, 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ content: result }))
      } catch (e) {
        res.writeHead(502, CORS)
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  res.writeHead(404, CORS)
  res.end('Not found')
})

server.listen(PORT, () => console.log(`✓ AI proxy at http://localhost:${PORT}`))
