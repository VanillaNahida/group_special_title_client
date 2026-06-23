import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from './config.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** MIME 类型映射 */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
};

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? '';
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      result[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  return result;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
  });
}

/** 读取 webui 静态文件 */
function serveStatic(url: string, res: ServerResponse): void {
  const safePath = url.replace(/\.\./g, '');
  const filePath = join(__dirname, 'webui', safePath);
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ext = extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  const content = readFileSync(filePath, 'utf-8');
  res.writeHead(200, { 'Content-Type': mime });
  res.end(content);
}

/** 读取 login.html 并注入 token */
function serveLoginPage(token: string, res: ServerResponse): void {
  const filePath = join(__dirname, 'webui', 'login.html');
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const content = readFileSync(filePath, 'utf-8').replace('__TOKEN__', token);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(content);
}

export function startWebServer(
  getCfg: () => AppConfig,
  onConfigUpdate: (patch: Partial<AppConfig>) => AppConfig,
  log: (msg: string) => void,
): void {
  const cfg = getCfg();
  const port = cfg.webuiPort;

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // 静态资源 /assets/*
    if (url.startsWith('/assets/')) {
      serveStatic(url.slice('/assets/'.length), res);
      return;
    }

    // Cookie 鉴权检查
    const cookies = parseCookies(req);
    const isLogin = cookies['snowluma_token'] === getCfg().token;

    // 登录 API
    if (url === '/api/login' && method === 'POST') {
      const body = await readBody(req);
      try {
        const { token } = JSON.parse(body);
        if (token === getCfg().token) {
          res.writeHead(200, { 'Set-Cookie': `snowluma_token=${token}; Path=/; HttpOnly; SameSite=Strict` });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(401);
          res.end(JSON.stringify({ ok: false, error: 'Invalid token' }));
        }
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
      return;
    }

    // 登出
    if (url === '/api/logout' && method === 'POST') {
      res.writeHead(200, { 'Set-Cookie': 'snowluma_token=; Path=/; Max-Age=0' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // 获取配置 API
    if (url === '/api/config' && method === 'GET') {
      if (!isLogin) { res.writeHead(401); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getCfg()));
      return;
    }

    // 更新配置 API
    if (url === '/api/config' && method === 'POST') {
      if (!isLogin) { res.writeHead(401); res.end(); return; }
      const body = await readBody(req);
      try {
        const patch = JSON.parse(body) as Partial<AppConfig>;
        // 不允许通过 API 修改 token 和 port（需手动编辑配置文件修改）
        delete patch.token;
        delete patch.webuiPort;
        const updated = onConfigUpdate(patch);
        log('[WebUI] 配置已更新');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updated));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
      return;
    }

    // 主页面
    if (url === '/' || url === '/index.html') {
      if (!isLogin) {
        serveLoginPage(getCfg().token, res);
      } else {
        serveStatic('index.html', res);
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, '0.0.0.0', () => {
    log(`WebUI 已启动: http://0.0.0.0:${port}/`);
  });
}
