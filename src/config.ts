import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'data', 'config.json');

export interface AppConfig {
  /** WebUI 登录 token，首次自动生成 */
  token: string;
  /** SnowLuma WebSocket 连接地址 */
  wsUrl: string;
  /** SnowLuma access_token */
  wsToken: string;
  /** 触发命令正则（第一个捕获组为头衔文本） */
  commandRegex: string;
  /** 冷却时间（秒），群级别共享 */
  cooldownSeconds: number;
  /** 黑名单词列表 */
  blacklistWords: string[];
  /** 是否发送黑名单触发提示 */
  enableBlacklistTip: boolean;
  /** 黑名单触发时的提示消息 */
  blacklistDenyMsg: string;
  /** 无视 CD 的 QQ 号列表 */
  cdWhitelistQQs: string[];
  /** 是否发送设置成功提示 */
  enableSuccessTip: boolean;
  /** 是否引用回复消息 */
  enableReplyQuote: boolean;
  /** 是否发送 CD 提示 */
  enableCdTip: boolean;
  /** 是否启用群主权限检查 */
  enablePermissionCheck: boolean;
  /** 是否发送权限不足提示 */
  enablePermissionDenyTip: boolean;
  /** 权限不足时的提示消息 */
  permissionDenyMsg: string;
  /** WebUI 监听端口 */
  webuiPort: number;
}

const defaultConfig: AppConfig = {
  token: randomBytes(16).toString('hex'),
  wsUrl: 'ws://127.0.0.1:3001/',
  wsToken: '',
  commandRegex: '^[#\uFF03]头衔\\s*(.*)',
  cooldownSeconds: 30,
  blacklistWords: [],
  enableBlacklistTip: true,
  blacklistDenyMsg: '头衔包含禁止词汇',
  cdWhitelistQQs: [],
  enableSuccessTip: true,
  enableReplyQuote: false,
  enableCdTip: true,
  enablePermissionCheck: true,
  enablePermissionDenyTip: true,
  permissionDenyMsg: '非群主权限无法设置头衔',
  webuiPort: 30519,
};

let _config: AppConfig | null = null;

/** 加载配置，文件不存在时自动创建默认配置 */
export function loadConfig(): AppConfig {
  if (_config) return _config;

  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = readFileSync(CONFIG_PATH, 'utf-8');
      const loaded = JSON.parse(raw) as Partial<AppConfig>;
      _config = { ...defaultConfig, ...loaded };
      // token 不能被覆盖为空
      if (!_config.token) {
        _config.token = defaultConfig.token;
      }
      // 兼容旧字段 command / commandPrefix → commandRegex
      if (!_config.commandRegex) {
        const oldCmd = (loaded as Record<string, unknown>).command
          || (loaded as Record<string, unknown>).commandPrefix;
        if (oldCmd) {
          const escaped = String(oldCmd).replace(/^[#＃]/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          _config.commandRegex = `^[#\uFF03]${escaped}\\s*(.*)`;
        }
      }
    } catch {
      console.error('[Config] 配置文件解析失败，使用默认配置');
      _config = { ...defaultConfig };
    }
  } else {
    _config = { ...defaultConfig };
  }

  saveConfig();
  return _config;
}

/** 保存配置到文件 */
export function saveConfig(config?: AppConfig): void {
  if (config) _config = config;
  if (!_config) return;

  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(_config, null, 2), 'utf-8');
}

/** 获取当前配置（只读） */
export function getConfig(): AppConfig {
  if (!_config) throw new Error('Config not loaded');
  return _config;
}

/** 更新配置（部分字段） */
export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  _config = { ...getConfig(), ...patch };
  saveConfig();
  return _config;
}
