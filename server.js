// ============================================================
// 番茄农技助手 · 后端代理（零依赖 Node）
// 作用：① 托管前端静态页面  ② 把 /api/chat 请求代理到 Coze /v3/chat SSE 流
// 安全：PAT 只从环境变量读取，绝不写入前端代码或本文件。
// 运行：node server.js   （默认 http://localhost:3000）
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const COZE_API = process.env.COZE_API || 'https://api.coze.cn/v3/chat';
const BOT_ID = process.env.COZE_BOT_ID || '2133432403';
// PAT 令牌：务必通过环境变量注入，例如：
//   PowerShell:  $env:COZE_TOKEN="pat_xxxx";  node server.js
//   CMD:         set COZE_TOKEN=pat_xxxx && node server.js
const COZE_TOKEN = process.env.COZE_TOKEN || '';

const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- 静态资源服务 ----------
function serveStatic(req, res, urlPath) {
  let filePath = path.join(PUBLIC_DIR, urlPath);
  if (urlPath === '/' || urlPath === '') filePath = path.join(PUBLIC_DIR, 'index.html');

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------- 代理到 Coze /v3/chat（SSE 流） ----------
function proxyToCoze(req, res) {
  if (!COZE_TOKEN) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '服务端未配置 COZE_TOKEN，请在启动前设置环境变量。' }));
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let payload;
    try { payload = JSON.parse(body); }
    catch { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: '请求体不是合法 JSON' })); return; }

    const cozeBody = {
      bot_id: BOT_ID,
      user_id: payload.user_id || 'tomato_user_001',
      stream: true,
      auto_save_history: true,
      additional_messages: payload.messages || [],
    };

    const bodyStr = JSON.stringify(cozeBody);
    const https = require('https');
    const apiUrl = new URL(COZE_API);
    apiUrl.searchParams.set('stream', 'true');

    const upstream = https.request({
      hostname: apiUrl.hostname,
      port: 443,
      path: apiUrl.pathname + apiUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + COZE_TOKEN,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (up) => {
      // 告诉前端这是 SSE 流，透传
      res.writeHead(up.statusCode, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      up.pipe(res);
    });
    upstream.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '连接 Coze 失败：' + e.message }));
    });
    upstream.write(bodyStr);
    upstream.end();
  });
}

// ---------- 上传图片到 Coze，拿 file_id ----------
function uploadToCoze(req, res) {
  if (!COZE_TOKEN) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '服务端未配置 COZE_TOKEN' }));
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let payload;
    try { payload = JSON.parse(body); }
    catch { res.writeHead(400); res.end(JSON.stringify({ error: '请求体不是合法 JSON' })); return; }

    const dataUrl = payload.dataUrl || '';
    const m = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!m) {
      res.writeHead(400); res.end(JSON.stringify({ error: '图片格式不对，需要 base64 data URL' }));
      return;
    }
    const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    const imgBuf = Buffer.from(m[2], 'base64');

    // 拼 multipart/form-data
    const boundary = '----TomatoBoundary' + Date.now().toString(16);
    const head = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="tomato.${ext}"\r\n` +
      `Content-Type: image/${m[1].toLowerCase()}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const postBody = Buffer.concat([head, imgBuf, tail]);

    const https = require('https');
    const upstream = https.request({
      hostname: 'api.coze.cn',
      port: 443,
      path: '/v1/files/upload',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + COZE_TOKEN,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': postBody.length,
      },
    }, (up) => {
      let resp = '';
      up.on('data', (c) => (resp += c));
      up.on('end', () => {
        try {
          const j = JSON.parse(resp);
          if (j.code === 0 && j.data && j.data.id) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ file_id: j.data.id }));
          } else {
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Coze 上传失败: ' + (j.msg || resp) }));
          }
        } catch (e) {
          res.writeHead(502); res.end(JSON.stringify({ error: 'Coze 返回异常: ' + resp }));
        }
      });
    });
    upstream.on('error', (e) => {
      res.writeHead(502); res.end(JSON.stringify({ error: '连接 Coze 上传接口失败: ' + e.message }));
    });
    upstream.write(postBody);
    upstream.end();
  });
}

// ---------- 路由 ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/api/chat') {
    proxyToCoze(req, res);
  } else if (req.method === 'POST' && pathname === '/api/upload') {
    uploadToCoze(req, res);
  } else if (req.method === 'GET') {
    serveStatic(req, res, pathname);
  } else {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('405 Method Not Allowed');
  }
});

server.listen(PORT, () => {
  console.log('番茄农技助手已启动 → http://localhost:' + PORT);
  console.log('Bot ID:', BOT_ID);
  if (!COZE_TOKEN) console.log('⚠ 尚未设置 COZE_TOKEN，聊天将不可用。请先设置环境变量后重启。');
});
