<p align="right">
  <a href="README.en.md">English</a> ·
  <strong>简体中文</strong>
</p>

<p align="center">
  <img src="assets/Qzone-logo.png" alt="QQ空间时光机" width="200">
</p>

<h1 align="center">QQ空间时光机</h1>
<p align="center"><code>QZone-Time-Machine</code></p>

<p align="center">
  <strong>存档回忆，留住感动</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" alt="Node">
  <img src="https://img.shields.io/badge/pnpm-monorepo-F69220?style=flat-square" alt="pnpm">
  <img src="https://img.shields.io/badge/无服务器-本地运行-8B5CF6?style=flat-square" alt="No Server">
</p>

<p align="center">
  在 QQ 空间消失之前，把属于你的回忆完整保存到本地。<br>
  扫码登录、一键备份、离线浏览 —— 全程无需任何服务器。
</p>

---

## 功能特性

- **零服务器架构** — 全程本地运行，不上传任何数据到任何服务器
- **本地扫码登录** — 通过本机 Chromium 完成 QQ 官方登录，凭证仅保存在本地
- **开源透明** — 所有代码公开可审计，不含遥测或追踪
- **完整备份** — 10 大模块全量采集
- **原始画质** — 下载最高可用分辨率的图片和视频
- **断点续传** — 中断后从上次进度继续，已下载文件不会重复下载
- **智能限流** — 自动指数退避重试，规避封号风险
- **离线浏览** — 双击 `index.html` 即可本地查看，无需联网或启动服务器
- **通用格式** — 标准 JSON + 相对路径媒体，方便二次开发
- **QQ 表情存档** — 自动下载所有引用的 QQ 表情到本地，完全离线可用

---

## 支持模块

| 模块 | 内容 | 附加信息 |
|------|------|----------|
| **说说** | 文字、图片、视频、语音 | 评论、地理位置、来源设备、转发数 |
| **日志** | 完整正文（含富文本/图片） | 分类标签、原创/转载标识、评论 |
| **私密日记** | 完整正文 | 仅自己可见的内容 |
| **相册** | 原始分辨率照片、视频 | 相册描述、EXIF、拍摄/上传时间、POI地点、评论 |
| **视频** | 视频文件 | 描述、评论 |
| **留言板** | 完整留言内容 | 回复、多媒体附件 |
| **好友** | 好友列表 | 分组、备注、成为好友时间 |
| **收藏** | 收藏内容 | 来源信息 |
| **分享** | 分享内容 | 来源、评论 |
| **访客** | 访问记录 | 访客信息、访问内容摘要 |

---

## 快速开始

```bash
# 安装依赖
pnpm install

# 构建（CLI + 离线浏览器）
pnpm build

# 第一步：登录（手机 QQ 扫码）
pnpm cli -- login

# 第二步：备份
pnpm cli -- backup 123456789 -n "昵称"

# 转换旧版备份（QZoneExport 格式）
pnpm cli -- convert ./旧数据目录 ./输出目录
```

## 输出结构

每个用户生成一个独立的自包含目录：

```
{QQ号}_{昵称}/
├── index.html              ← 双击打开，离线浏览全部数据
├── data/                   JSON 数据
│   ├── user.json
│   ├── messages.json
│   ├── blogs.json
│   ├── boards.json
│   ├── videos.json
│   ├── diaries.json
│   ├── friends.json
│   ├── favorites.json
│   ├── shares.json
│   ├── visitors.json
│   └── photos/
│       ├── albums.json     相册索引
│       └── {albumId}.json  每个相册的照片列表
└── media/                  下载的图片和视频
    ├── messages/images/
    ├── blogs/images/
    ├── albums/photos/{分类}/{相册名}/
    ├── albums/covers/
    ├── emoji/              QQ 表情（本地化）
    └── videos/videos/
```

## 离线浏览器

备份完成后会自动嵌入一个 React 单页应用到 `index.html`：

- 亮色/暗色模式切换
- 图片点击放大，键盘左右键切换
- 相册 EXIF 信息面板
- 视频原地播放
- 留言板/日志完整渲染（含评论、头像、链接）
- 数据完整性报告
- 传统分页，支持键盘快捷键

## 打包与一键启动器

`pack` 命令把每个用户目录打包成**单个 store 模式（不压缩）zip**，整个归档从海量碎文件变为「每人 1 个 zip」，便于云盘同步；配合免安装启动器即可流畅浏览：

```bash
# 把归档目录下每个用户打包成 <用户>.zip，并生成 _manifest.json
pnpm cli -- pack ./我的备份 --out ./我的备份_packed

# 生成免安装启动器 exe（Windows，基于 Node SEA，单文件）
pnpm --filter @qzone-tools/launcher run exe
```

把生成的 `QQ空间时光机.exe` 放进打包目录，**双击即用**：

- 自动启动本地服务并打开浏览器，展示**全部用户列表**（头像 + 昵称 + 内容数量 + 搜索）
- 点击任意用户即可浏览其完整空间；把单个 `.zip` 拖到 exe 上则只看那一个人
- 媒体（图片/视频）直接从 zip 内按字节偏移**流式读取**，支持 HTTP Range，即便单个相册几十 GB 也不占内存

> store 模式不压缩：jpg/gif/mp4 本身已压缩，store 模式让启动器可随机读取单张图而无需解压整个包。

## 技术架构

```
QZone-Time-Machine (pnpm monorepo)
├── packages/cli          TypeScript CLI + CommonJS 引擎
│   ├── src/index.ts      命令入口 (login / backup / convert)
│   ├── src/convert.ts    旧版数据迁移
│   └── engine/           经实战验证的 JS 采集引擎 (via createRequire)
├── packages/viewer       React + Vite 单页应用
│   ├── 单文件打包 (vite-plugin-singlefile)
│   └── 嵌入 index.html 支持 file:// 协议
└── packages/launcher     免安装本地启动器
    ├── store-zip 随机读取 (yauzl) + HTTP Range 流式
    └── Node SEA 编译单文件 exe（无需安装 Node）
```

## 环境要求

- Node.js 18+
- pnpm 9+
- Chromium / Chrome（用于扫码登录）

## 致谢

本项目的诞生离不开以下开源项目的贡献与启发：

- [QZoneExport](https://github.com/ShunCai/QZoneExport) — QQ空间数据导出浏览器插件
- [QzonePhoto](https://github.com/11273/QzonePhoto) — QQ空间相册下载工具

## 声明

### 安全与隐私
- 本工具**零服务器架构**，全程本地运行，不上传任何数据
- 登录流程使用 QQ 官方页面扫码，凭证仅保存在本地 `cookies.json`
- 仅用于备份**你自己的** QQ 空间数据，请勿用于未经授权地获取他人数据

### 版权
- QQ空间、QQ 等商标属于深圳市腾讯计算机系统有限公司
- QQ空间 Logo 版权归腾讯所有（[来源](https://zh.wikipedia.org/wiki/File:Qzone-logo.png)）
- 本工具与腾讯公司无关联

### 免责
- 本工具按「原样」提供，不作任何明示或暗示的保证
- 使用本工具所产生的一切后果由用户自行承担
- QQ 空间 API 随时可能变更，本工具不保证永久可用

## 许可证

[MIT](LICENSE) (c) 2026 Nix Liu Xin
