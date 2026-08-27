import http from 'node:http';

const HOST = process.env.AQI_CORE_PROBE_HOST?.trim() || '127.0.0.1';
const PORT = Number.parseInt(process.env.AQI_CORE_PROBE_PORT || '8788', 10);

const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'capacitor://localhost'
]);

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!ALLOWED_ORIGINS.has(origin)) return false;

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Polaris-Device-Id'
  );
  return true;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendSseChunk(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function completionChunk(content, finishReason = null) {
  return {
    id: 'chatcmpl-aqi-core-probe',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'aqi-core-probe',
    choices: [
      {
        index: 0,
        delta: content === undefined ? {} : { content },
        finish_reason: finishReason
      }
    ]
  };
}

async function readJsonBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) {
      throw new Error('request_too_large');
    }
  }

  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid_json');
  }
}

async function handleChat(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error instanceof Error && error.message === 'request_too_large') {
      sendJson(res, 413, {
        error: { message: 'Request body too large.', type: 'invalid_request' }
      });
      return;
    }

    sendJson(res, 400, {
      error: { message: 'Request body must be valid JSON.', type: 'invalid_request' }
    });
    return;
  }

  const stream = payload?.stream !== false;

  if (!stream) {
    sendJson(res, 200, {
      id: 'chatcmpl-aqi-core-probe',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'aqi-core-probe',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '阿栖收到 ovo' },
          finish_reason: 'stop'
        }
      ]
    });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sendSseChunk(res, completionChunk('阿栖收到 '));
  await new Promise((resolve) => setTimeout(resolve, 120));
  sendSseChunk(res, completionChunk('ovo'));
  sendSseChunk(res, completionChunk(undefined, 'stop'));
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = http.createServer(async (req, res) => {
  if (!applyCors(req, res)) {
    sendJson(res, 403, {
      error: { message: 'Origin not allowed.', type: 'forbidden' }
    });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
    sendJson(res, 200, {
      ok: true,
      service: 'aqi-home-core-probe',
      mode: 'contract-probe',
      note: 'temporary development probe; not Aqi Home Core'
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/completions') {
    await handleChat(req, res);
    return;
  }

  sendJson(res, 404, {
    error: { message: 'Not found.', type: 'not_found' }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`🐆 Aqi Home Core probe listening on http://${HOST}:${PORT}`);
  console.log('   GET  /health');
  console.log('   POST /api/chat/completions');
  console.log('   This probe intentionally does not call a model or persist chat history.');
});
