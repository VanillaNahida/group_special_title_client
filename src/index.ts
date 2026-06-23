import {
  SnowLumaWebSocketClient,
  text,
  reply,
} from '@snowluma/sdk';
import { loadConfig, getConfig, updateConfig } from './config.js';
import { startWebServer } from './web-server.js';

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

async function main() {
  // 加载配置
  const config = loadConfig();
  logInfo(`WS: ${config.wsUrl}`);
  logInfo(`WebUI Token: ${config.token}`);
  logInfo(`WebUI 端口: ${config.webuiPort}`);

  // CD 记录：Map<groupId, 上次设置时间戳(ms)>
  const cooldownMap = new Map<number, number>();

  const bot = new SnowLumaWebSocketClient({
    url: config.wsUrl,
    accessToken: config.wsToken || undefined,
    reconnect: true,
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
        `ID:${C.magenta}${messageId}${C.reset} ${raw || '[空消息]'}`,
    );

    // 读取最新配置（WebUI 可能已修改）
    const cfg = getConfig();

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
  });

  bot.on('error', (err) => {
    console.error(`${fmtTimestamp()} ${C.red}ERROR ${C.reset}${C.cyan}[自助头衔Client]${C.reset} WebSocket 错误:`, err);
  });

  /**
   * 带重试的 WebSocket 连接
   * SDK 的 reconnect: true 只处理已连接后的断线重连，
   * 首次连接失败需要自行重试。
   */
  async function connectWithRetry(): Promise<void> {
    const cfg = getConfig();
    const delay = cfg.connectRetryDelay > 0 ? cfg.connectRetryDelay : 10;
    while (true) {
      try {
        await bot.connect();
        return;
      } catch (err) {
        logError(
          `WebSocket 连接失败: ${err instanceof Error ? err.message : '未知错误'}, ${delay}秒后重试...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay * 1000));
      }
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
