# Group Special Title Client QQ群自助头衔

[English](README_en.md) | 中文

一个基于 [SnowLuma](https://github.com/Luma-Dream/SnowLuma) QQ机器人框架的群自助头衔客户端，支持群成员通过发送命令自助设置群专属头衔，并提供 WebUI 配置面板。

<div align="center">

  [![GitHub license](https://img.shields.io/github/license/VanillaNahida/group_special_title_client?style=flat-square)](https://github.com/VanillaNahida/group_special_title_client/blob/main/LICENSE)
  [![GitHub stars](https://img.shields.io/github/stars/VanillaNahida/group_special_title_client?style=flat-square)](https://github.com/VanillaNahida/group_special_title_client/stargazers)
  [![GitHub forks](https://img.shields.io/github/forks/VanillaNahida/group_special_title_client?style=flat-square)](https://github.com/VanillaNahida/group_special_title_client/network)
  [![GitHub issues](https://img.shields.io/github/issues/VanillaNahida/group_special_title_client?style=flat-square)](https://github.com/VanillaNahida/group_special_title_client/issues)
  [![Platform](https://img.shields.io/badge/Platform-Windows-blue.svg?style=flat-square)]()
  [![Node](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg?style=flat-square)]()
  [![Author](https://img.shields.io/badge/%E4%BD%9C%E8%80%85-VanillaNahida-green)](https://github.com/VanillaNahida)

</div>

<!-- <div align="center">
  <img width="800" alt="screenshot" src="https://github.com/user-attachments/assets/39363a81-47cf-4470-8a74-9408f1913fa3" />
  <p>WebUI 配置面板</p>
</div> -->

# TODO 待实现的功能

- [x] 群自助头衔设置
- [x] 黑名单词过滤
- [x] 黑名单用户控制
- [x] CD 冷却控制
- [x] WebUI 配置面板
- [x] `#status` 系统状态截图
- [ ] 其他...

# 功能特性

- **自助头衔**：群成员发送 `#头衔 <头衔文本>` 即可自助设置群专属头衔。
- **黑名单词过滤**：可配置禁止词汇，头衔包含禁止词汇时拒绝设置。
- **黑名单用户**：可按 QQ 号封禁特定用户，禁止其设置头衔。
- **CD 冷却控制**：群级别冷却时间，防止刷屏；支持 CD 白名单。
- **权限检查**：可强制要求 Bot 账号为群主才能设置头衔。
- **宽度限制**：中文字/全角字符计为 2，ASCII 计为 1，最大宽度 12。
- **WebUI 配置面板**：内置 Web 管理界面，支持在线修改所有配置，无需重启。
- **系统状态**：`#status` 命令可查看 Bot 运行状态截图。

# 使用方法

## 环境要求

- Windows 操作系统
- Node.js >= 18
- Chrome 浏览器
- [SnowLuma](https://github.com/SnowLuma/SnowLuma)
- [NapCat](https://github.com/NapNeko/NapCatQQ)

## 使用说明

1. 下载本项目，安装依赖：

```bash
npm install
```

2. 启动 SnowLuma 或 NapCat 框架，确保 WebSocket 服务正常运行。

3. 启动本客户端：

```bash
npm start
```

4. 首次启动会自动生成配置文件 `data/config.json`，并随机生成 WebUI 登录 Token。Token 会在控制台输出。

5. 打开浏览器访问 `http://127.0.0.1:30519`，使用 Token 登录 WebUI 配置面板。

6. 在 WebUI 中配置 SnowLuma 或 NapCat 连接地址和 Access Token，点击保存。

7. 客户端会自动连接 SnowLuma 或 NapCat，连接成功后在群内发送 `#头衔 你的头衔` 即可。

## 命令格式

默认命令格式为 `#头衔 <头衔文本>`，支持全角 `＃` 号。命令正则可在 WebUI 中自定义。

## 注意事项

> [!WARNING]
> Bot 账号需要是群主（或关闭权限检查），才能成功设置群成员头衔。

- 修改 WebUI 配置后按 `Ctrl+S` 保存，配置会热更新，无需重启。
- 头衔宽度限制：最多 6 个中文字或 12 个英文字符。
- 如果连接失败，客户端会自动重试，重试间隔可在 WebUI 中配置。

# 免责声明

本项目仅供学习交流和研究目的，禁止用于任何违法违规用途。

# 问题 & Bug 反馈

如果在使用过程中遇到任何问题和 bug，请通过以下方式反馈：

- [GitHub Issues](https://github.com/VanillaNahida/group_special_title_client/issues)
- 问题反馈 & 交流群：https://xcnahida.cn/contact

# Star History

[![Star History Chart](https://api.star-history.com/svg?repos=VanillaNahida/group_special_title_client&type=Date)](https://star-history.com/#VanillaNahida/group_special_title_client&Date)
