import { execSync } from 'node:child_process';
import os from 'node:os';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import {
  SnowLumaWebSocketClient,
  text,
  reply,
  image,
} from '@snowluma/sdk';
import { loadConfig, getConfig, updateConfig } from './config.js';
import { startWebServer } from './web-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ANSI 颜色码
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

/** 格式化时间戳 [YYYY-MM-DD HH:MM:SS.mmm] */
function fmtTimestamp(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const d = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
  return `${C.dim}[${d} ${t}]${C.reset}`;
}

/** 日志辅助 */
function logInfo(msg: string): void {
  console.log(`${fmtTimestamp()} ${C.green}INFO  ${C.reset}${C.cyan}[自助头衔Client]${C.reset} ${msg}`);
}
function logEvent(msg: string): void {
  console.log(msg);
}
function logError(msg: string): void {
  console.error(`${fmtTimestamp()} ${C.red}ERROR ${C.reset}${C.cyan}[自助头衔Client]${C.reset} ${msg}`);
}

/** 计算标题宽度：中文/全角 = 2，ASCII = 1，最多 12（即中文6字、英文12字） */
function titleWidth(text: string): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += text.charCodeAt(i) > 255 ? 2 : 1;
  }
  return w;
}

/** 格式化秒数为可读时长 */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}小时`);
  if (m > 0) parts.push(`${m}分`);
  parts.push(`${s}秒`);
  return parts.join('');
}

/** 获取 fastfetch 系统信息并渲染为图片，返回图片文件路径 */
async function renderStatusImage(): Promise<string> {
  // 收集系统数据（复用之前解析逻辑得到 key->value 对）
  const rows: Array<{ label: string; value: string }> = [];

  try {
    const output = execSync('fastfetch --json', { encoding: 'utf-8', timeout: 10000 });
    const items = JSON.parse(output) as Array<{ type: string; result?: unknown; error?: string }>;

    const nameMap: Record<string, string> = {
      OS: '系统',
      Host: '主板',
      Kernel: '内核',
      Uptime: '运行时间',
      Shell: '命令行',
      Display: '显示器',
      WM: '窗口管理器',
      WMTheme: '窗口主题',
      Theme: '主题',
      Icons: '图标',
      Font: '字体',
      Cursor: '光标',
      Terminal: '终端',
      TerminalFont: '终端字体',
      CPU: 'CPU',
      GPU: '显卡',
      Memory: '内存',
      Swap: '交换区',
      Disk: '硬盘',
      LocalIp: '本地IP',
      Battery: '电池',
      Locale: '区域',
    };

    function formatResult(type: string, result: unknown): string | null {
      switch (type) {
        case 'OS': {
          const o = result as { prettyName?: string; variant?: string; version?: string };
          return o.prettyName ?? `${o.variant ?? 'Windows'} ${o.version ?? ''}`;
        }
        case 'Host': {
          const h = result as { name?: string; version?: string };
          return h.name ? `${h.name}${h.version ? ` (${h.version})` : ''}` : null;
        }
        case 'Kernel': {
          const k = result as { name?: string; release?: string };
          return k.name && k.release ? `${k.name} ${k.release}` : null;
        }
        case 'Uptime': {
          const u = result as { uptime?: number };
          return u.uptime ? formatUptime(Math.floor(u.uptime / 1000)) : null;
        }
        case 'Shell': {
          const s = result as { prettyName?: string; version?: string };
          return s.prettyName && s.version ? `${s.prettyName} ${s.version}` : s.prettyName ?? null;
        }
        case 'Display': {
          const displays = Array.isArray(result) ? result : [result];
          return displays.map((d: { name?: string; output?: { width?: number; height?: number; refreshRate?: number }; type?: string; scaled?: { width?: number; height?: number } }) => {
            const res = d.scaled ? `${d.scaled.width}x${d.scaled.height}` : (d.output ? `${d.output.width}x${d.output.height}` : '');
            const hz = d.output?.refreshRate ? `${Math.round(d.output.refreshRate)} Hz` : '';
            const typeStr = d.type === 'External' ? '[External]' : d.type === 'Builtin' ? '[Built-in]' : '';
            return [d.name, res, hz, typeStr].filter(Boolean).join(' ');
          }).join('\n');
        }
        case 'WM': {
          const w = result as { prettyName?: string; version?: string };
          return w.prettyName && w.version ? `${w.prettyName} ${w.version}` : w.prettyName ?? null;
        }
        case 'WMTheme':
          return String(result);
        case 'Theme': {
          const t = result as { theme1?: string };
          return t.theme1 ?? null;
        }
        case 'Icons': {
          const i = result as { icons1?: string; icons2?: string };
          return [i.icons1, i.icons2].filter(Boolean).join(', ');
        }
        case 'Font': {
          const f = result as { display?: string };
          return f.display ?? null;
        }
        case 'Cursor': {
          const c = result as { theme?: string; size?: string };
          return `${c.theme ?? ''}${c.size ? ` (${c.size}px)` : ''}`;
        }
        case 'Terminal': {
          const t = result as { prettyName?: string; version?: string };
          return t.prettyName && t.version ? `${t.prettyName} ${t.version}` : t.prettyName ?? null;
        }
        case 'TerminalFont': {
          const tf = result as { font?: { pretty?: string } };
          return tf.font?.pretty ?? null;
        }
        case 'CPU': {
          const c = result as { cpu?: string; cores?: { physical?: number; logical?: number }; frequency?: { base?: number } };
          const name = c.cpu ?? '';
          const cores = c.cores ? `(${c.cores.logical ?? c.cores.physical} 核)` : '';
          const freq = c.frequency?.base ? `@ ${(c.frequency.base / 1000).toFixed(2)} GHz` : '';
          return `${name} ${cores} ${freq}`.trim();
        }
        case 'GPU': {
          const gpus = Array.isArray(result) ? result : [result];
          return gpus.map((g: { name: string; type?: string; memory?: { dedicated?: { total?: number } }; frequency?: number }) => {
            let info = g.name;
            const vram = g.memory?.dedicated?.total ? `${(g.memory.dedicated.total / 1024 / 1024 / 1024).toFixed(2)} GiB` : null;
            if (vram) info += ` (${vram})`;
            if (g.type) info += ` [${g.type}]`;
            if (g.frequency) info += ` @ ${(g.frequency / 1000).toFixed(2)} GHz`;
            return info;
          }).join('\n');
        }
        case 'Memory': {
          const m = result as { used?: number; total?: number };
          if (!m.used || !m.total) return null;
          const usedGiB = m.used / 1024 / 1024 / 1024;
          const totalGiB = m.total / 1024 / 1024 / 1024;
          const pct = ((m.used / m.total) * 100).toFixed(1);
          return `${usedGiB.toFixed(2)} GiB / ${totalGiB.toFixed(2)} GiB (${pct}%)`;
        }
        case 'Swap': {
          const swaps = Array.isArray(result) ? result : [result];
          return swaps.map((s: { used?: number; total?: number }) => {
            const used = s.used ?? 0;
            const total = s.total ?? 0;
            const usedStr = used >= 1073741824 ? `${(used / 1024 / 1024 / 1024).toFixed(2)} GiB` : `${(used / 1024 / 1024).toFixed(2)} MiB`;
            const totalStr = total >= 1073741824 ? `${(total / 1024 / 1024 / 1024).toFixed(2)} GiB` : `${(total / 1024 / 1024).toFixed(2)} MiB`;
            const pct = total > 0 ? ((used / total) * 100).toFixed(1) : '0';
            return `${usedStr} / ${totalStr} (${pct}%)`;
          }).join('\n');
        }
        case 'Disk': {
          const disks = Array.isArray(result) ? result : [result];
          return disks.map((d: { bytes?: { used?: number; total?: number }; mountpoint?: string; filesystem?: string }) => {
            const usedGiB = d.bytes?.used ? (d.bytes.used / 1024 / 1024 / 1024).toFixed(2) : '0.00';
            const totalGiB = d.bytes?.total ? (d.bytes.total / 1024 / 1024 / 1024).toFixed(2) : '0.00';
            const pct = d.bytes?.total && d.bytes.total > 0 ? ((d.bytes.used! / d.bytes.total) * 100).toFixed(0) : '0';
            const fs = d.filesystem ? ` - ${d.filesystem}` : '';
            return `${d.mountpoint ?? ''}: ${usedGiB} GiB / ${totalGiB} GiB (${pct}%)${fs}`;
          }).join('\n');
        }
        case 'LocalIp': {
          const ips = Array.isArray(result) ? result : [result];
          return ips.map((ip: { name?: string; ipv4?: string }) => `${ip.name ?? ''}: ${ip.ipv4 ?? ''}`).join('\n');
        }
        case 'Battery': {
          const bats = Array.isArray(result) ? result : [result];
          return bats.map((b: { capacity?: number; status?: string }) => {
            const cap = b.capacity != null ? `${b.capacity.toFixed(0)}%` : '';
            return [cap, b.status].filter(Boolean).join(' ');
          }).join('\n');
        }
        case 'Locale':
          return String(result);
        default:
          return null;
      }
    }

    for (const item of items) {
      if (item.error) continue;
      const label = nameMap[item.type] ?? item.type;
      const formatted = formatResult(item.type, item.result);
      if (formatted != null) {
        const valueLines = formatted.split('\n');
        valueLines.forEach((v, i) => {
          rows.push({ label: i === 0 ? label : '', value: v });
        });
      }
    }
  } catch {
    rows.push({ label: '系统', value: `${os.platform()} ${os.release()} (${os.arch()})` });
    rows.push({ label: '运行时间', value: formatUptime(os.uptime()) });
  }

  // 读取 HTML 模板并填充行数据
  const templatePath = join(__dirname, 'status-template.html');
  let html = readFileSync(templatePath, 'utf-8');

  const rowsHtml = rows.map((r) => {
    const label = r.label ? `<span class="label">${escapeHtml(r.label)}</span>` : '<span class="label"></span>';
    return `<div class="row">${label}<span class="value">${escapeHtml(r.value)}</span></div>`;
  }).join('\n');

  html = html.replace('{{ROWS}}', rowsHtml);

  // 保存截图
  const dataDir = join(__dirname, '..', 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const imagePath = join(dataDir, 'status.png');

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.setViewport({ width: 650, height: 100 });
    await page.screenshot({ path: imagePath, fullPage: true, type: 'png' });
  } finally {
    await browser.close();
  }

  return imagePath;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function main() {
  // 设置终端窗口标题
  process.title = 'QQ群自助头衔客户端';

  // 加载配置
  const config = loadConfig();
  logInfo(`WS连接地址: ${config.wsUrl}`);
  logInfo(`WebUI Token: ${config.token}`);
  logInfo(`WebUI 端口: ${config.webuiPort}`);

  // CD 记录：Map<groupId, 上次设置时间戳(ms)>
  const cooldownMap = new Map<number, number>();

  const bot = new SnowLumaWebSocketClient({
    url: config.wsUrl,
    accessToken: config.wsToken || undefined,
    reconnect: false,
  });

  // 群名缓存
  const groupNameCache = new Map<number, string>();

  // bot 自身在群内的角色缓存（key: group_id, value: member_role）
  const selfRoleCache = new Map<number, string>();

  async function getGroupName(groupId: number): Promise<string> {
    const cached = groupNameCache.get(groupId);
    if (cached) return cached;
    try {
      const info = await bot.call('get_group_info', { group_id: groupId });
      const name = String(info.group_name ?? groupId);
      groupNameCache.set(groupId, name);
      return name;
    } catch {
      const fallback = String(groupId);
      groupNameCache.set(groupId, fallback);
      return fallback;
    }
  }

  /**
   * 获取 bot 自身在群内的角色
   * 首次查询后缓存，避免重复 API 调用
   */
  async function getSelfRole(groupId: number, selfId: number): Promise<string> {
    const cached = selfRoleCache.get(groupId);
    if (cached) return cached;

    try {
      const info = await bot.call('get_group_member_info', {
        group_id: groupId,
        user_id: selfId,
      });
      const role = String(info.role ?? 'member');
      selfRoleCache.set(groupId, role);
      return role;
    } catch {
      const fallback = 'member';
      selfRoleCache.set(groupId, fallback);
      return fallback;
    }
  }

  // 监听群消息事件
  bot.onGroupMessage(async (event, ctx) => {
    const selfId = event.self_id;
    const userId = event.user_id;
    const groupId = event.group_id;
    const messageId = event.message_id;
    const raw = event.raw_message.trim();
    const displayName = event.sender.card || event.sender.nickname || String(userId);
    const groupName = await getGroupName(groupId);

    // 格式化彩色日志输出
    logEvent(
      `${fmtTimestamp()} ${C.green}OK    ${C.reset}` +
        `${C.yellow}[${selfId}]${C.reset} [Event] ` +
        `群 ${C.cyan}[${groupName}(${groupId})]${C.reset} | ` +
        `${C.blue}[${displayName}(${userId})]${C.reset}: ` +
        `SID:${C.magenta}${messageId}${C.reset} ${raw || '[空消息]'}`,
    );

    // 读取最新配置（WebUI 可能已修改）
    const cfg = getConfig();

    // #status 命令：仅限 bot 自身（当前登录账号）触发，返回系统信息图片
    if (raw === '#status' || raw.startsWith('#status ')) {
      if (userId !== selfId) {
        return;
      }
      try {
        const imagePath = await renderStatusImage();
        await ctx.reply(image(imagePath));
      } catch (err) {
        logError(`渲染系统状态图片失败: ${err instanceof Error ? err.message : '未知错误'}`);
        await ctx.reply(text('系统状态获取失败，请稍后重试'));
      }
      return;
    }

    // 使用配置的正则直接匹配（支持热更新）
    const match = raw.match(new RegExp(cfg.commandRegex, 'u'));

    // 未命中命令
    if (!match) {
      return;
    }

    const title = match[1]?.trim() ?? '';

    // 头衔不能为空
    if (!title) {
      await ctx.reply(
        cfg.enableReplyQuote
          ? reply(messageId).text('使用方法：#头衔 <你想设置的头衔> \n 例如：#头衔百合园圣娅')
          : text('使用方法：#头衔 <你想设置的头衔> \n 例如：#头衔百合园圣娅'),
      );
      return;
    }

    // 黑名单用户检查（cdWhitelistQQs 中的 QQ 跳过）
    const isBlacklistWhitelisted = cfg.cdWhitelistQQs.includes(String(userId));
    if (!isBlacklistWhitelisted && cfg.blacklistUsers.includes(String(userId))) {
      if (cfg.enableBlacklistUserTip && cfg.blacklistUserDenyMsg) {
        await ctx.reply(
          cfg.enableReplyQuote
            ? reply(messageId).text(cfg.blacklistUserDenyMsg)
            : text(cfg.blacklistUserDenyMsg),
        );
      }
      logEvent(
        `${fmtTimestamp()} ${C.yellow}BLOCK ${C.reset}` +
          `${C.yellow}[${selfId}]${C.reset} ` +
          `[黑名单用户] ${C.cyan}群:${groupId}${C.reset} ` +
          `${C.blue}用户:${userId}${C.reset}`,
      );
      return;
    }

    // 黑名单词检查（cdWhitelistQQs 中的 QQ 跳过黑名单检查）
    if (!isBlacklistWhitelisted) {
      const hitWord = cfg.blacklistWords.find((w) => title.includes(w));
      if (hitWord) {
        if (cfg.enableBlacklistTip && cfg.blacklistDenyMsg) {
          await ctx.reply(
            cfg.enableReplyQuote
              ? reply(messageId).text(cfg.blacklistDenyMsg)
              : text(cfg.blacklistDenyMsg),
          );
        }
        logEvent(
          `${fmtTimestamp()} ${C.yellow}BLOCK ${C.reset}` +
            `${C.yellow}[${selfId}]${C.reset} ` +
            `[黑名单] ${C.cyan}群:${groupId}${C.reset} ` +
            `${C.blue}用户:${userId}${C.reset} ` +
            `命中词:"${hitWord}"`,
        );
        return;
      }
    }

    // 权限检查：SnowLuma 登录号必须具有群主（owner）权限才能设置头衔
    if (cfg.enablePermissionCheck) {
      const selfRole = await getSelfRole(groupId, selfId);
      if (selfRole !== 'owner') {
        if (cfg.enablePermissionDenyTip && cfg.permissionDenyMsg) {
          await ctx.reply(
            cfg.enableReplyQuote
              ? reply(messageId).text(cfg.permissionDenyMsg)
              : text(cfg.permissionDenyMsg),
          );
        }
        logEvent(
          `${fmtTimestamp()} ${C.yellow}PERM  ${C.reset}` +
            `${C.yellow}[${selfId}]${C.reset} ` +
            `[权限] ${C.cyan}群:${groupId}${C.reset} ` +
            `${C.blue}用户:${userId}${C.reset} 角色:${selfRole}`,
        );
        return;
      }
    }

    // CD 检查（白名单 QQ 跳过）
    const isCdWhitelisted = cfg.cdWhitelistQQs.includes(String(userId));

    if (!isCdWhitelisted && cfg.cooldownSeconds > 0) {
      const lastSet = cooldownMap.get(groupId);
      const now = Date.now();
      if (lastSet !== undefined) {
        const elapsed = (now - lastSet) / 1000;
        if (elapsed < cfg.cooldownSeconds) {
          const remain = Math.ceil(cfg.cooldownSeconds - elapsed);
          if (cfg.enableCdTip) {
            await ctx.reply(
              cfg.enableReplyQuote
                ? reply(messageId).text(`冷却中，请${remain}秒后重试。`)
                : text(`冷却中，请${remain}秒后重试。`),
            );
          }
          logEvent(
            `${fmtTimestamp()} ${C.yellow}CD    ${C.reset}` +
              `${C.yellow}[${selfId}]${C.reset} ` +
              `[冷却] ${C.cyan}群:${groupId}${C.reset} ` +
              `${C.blue}用户:${userId}${C.reset} 剩余${remain}秒`,
          );
          return;
        }
      }
    }

    // 头衔宽度限制（中文/全角=2，ASCII=1，最多宽度12，即中文6字、英文12字）
    if (titleWidth(title) > 12) {
      const replyMsg = cfg.enableReplyQuote
        ? reply(messageId).text('头衔不能超过6个字（中文6个字，英文12个字符）')
        : text('头衔不能超过6个字（中文6个字，英文12个字符）');
      await ctx.reply(replyMsg);
      return;
    }

    try {
      await bot.call('set_group_special_title', {
        group_id: groupId,
        user_id: userId,
        special_title: title,
      });

      // 更新 CD 记录
      cooldownMap.set(groupId, Date.now());

      logEvent(
        `${fmtTimestamp()} ${C.green}OK    ${C.reset}` +
          `${C.yellow}[${selfId}]${C.reset} ` +
          `[头衔] ${C.cyan}群:${groupId}${C.reset} ` +
          `${C.blue}用户:${userId}${C.reset} ` +
          `${C.magenta}"${title}"${C.reset}`,
      );

      if (cfg.enableSuccessTip) {
        if (cfg.enableReplyQuote) {
          await ctx.reply(
            reply(messageId).text(`已为你设置头衔：${title}`).at(userId),
          );
        } else {
          await ctx.reply(
            text(`已为你设置头衔：${title}`).at(userId),
          );
        }
      }
    } catch (err) {
      logError(
        `[头衔] 群:${groupId} 用户:${userId} ` +
          `${err instanceof Error ? err.message : '未知错误'}`,
      );

      const errorMessage = err instanceof Error ? err.message : '未知错误';
      await ctx.reply(
        cfg.enableReplyQuote
          ? reply(messageId).text(`头衔设置失败：${errorMessage}`)
          : text(`头衔设置失败：${errorMessage}`),
      );
    }
  });

  // 生命周期日志
  bot.on('open', () => {
    logInfo('WebSocket 已连接');
  });

  bot.on('close', () => {
    console.log(`${fmtTimestamp()} ${C.yellow}WARN  ${C.reset}${C.cyan}[自助头衔Client]${C.reset} WebSocket 已断开`);
    // 连接断开后自动重连（避免与已有重连循环冲突）
    if (!isConnecting) {
      connectWithRetry();
    }
  });

  bot.on('error', (err) => {
    console.error(`${fmtTimestamp()} ${C.red}ERROR ${C.reset}${C.cyan}[自助头衔Client]${C.reset} WebSocket 错误:`, err);
  });

  let isConnecting = false;

  /**
   * 包装 bot.connect()，通过监听 error/close 事件可靠检测连接失败
   *（bot.connect() 本身对于非 101 错误可能不会正确 reject）
   */
  function connectBot(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (bot.isConnected) {
        resolve();
        return;
      }

      let settled = false;
      let errorEvent: unknown = null;

      const onError = (err: unknown) => {
        errorEvent = err;
      };

      const onClose = () => {
        if (settled) return;
        settled = true;
        cleanup();
        // 如果有 error 事件优先用它的消息，否则用 close 的默认消息
        reject(errorEvent instanceof Error ? errorEvent : new Error('WebSocket closed before connected'));
      };

      const onOpen = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const cleanup = () => {
        bot.off('error', onError as any);
        bot.off('close', onClose as any);
        bot.off('open', onOpen as any);
      };

      bot.on('error', onError as any);
      bot.once('close', onClose as any);
      bot.once('open', onOpen as any);

      bot.connect().catch((err) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      });
    });
  }

  /**
   * 无限重试循环：按配置间隔反复尝试连接，直到成功
   * 每次重试前先 close() 清除 SDK 内部可能残留的 pending 状态，
   * 防止非 101 错误后 close 事件未触发导致 connectPromise 卡死。
   */
  async function connectWithRetry(): Promise<void> {
    if (isConnecting) return;
    const cfg = getConfig();
    const delay = cfg.connectRetryDelay > 0 ? cfg.connectRetryDelay : 10;
    isConnecting = true;
    try {
      while (true) {
        // 清除 SDK 内部残留状态，确保下一次 connect() 新建连接
        bot.close();
        try {
          await connectBot();
          logInfo('WebSocket 已连接');
          return;
        } catch (err) {
          logError(
            `WebSocket 连接失败: ${err instanceof Error ? err.message : '未知错误'}, ${delay}秒后重试...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay * 1000));
        }
      }
    } finally {
      isConnecting = false;
    }
  }

  await connectWithRetry();
  logInfo('自助头衔工具已启动');

  // 启动 WebUI 服务器
  startWebServer(getConfig, updateConfig, logInfo);
}

main().catch((err) => {
  console.error(`${fmtTimestamp()} ${C.red}FATAL ${C.reset}${C.cyan}[自助头衔Client]${C.reset} 启动失败:`, err);
  process.exit(1);
});
