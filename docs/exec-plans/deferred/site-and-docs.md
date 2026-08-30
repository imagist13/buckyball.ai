> **Archive note（2026-06-05，document-system-governance）**：本计划已移出 `active/`，归入 `deferred/`——用户明确暂缓，未来可能重启。**不是当前任务入口**；当前工作入口见 [exec-plans README](../README.md)，重启方式见 [deferred/README.md](README.md)。

# 官网 + 文档站（apps/site）

> ⏸ **本轮重构暂缓**（见 [refactor-closeout.md](../completed/refactor-closeout.md) "暂缓清单"）— Phase 0-3 已完成；Phase 4（packages/ui 抽取）+ Phase 5（桌面端适配 + CI/CD）等大规模官网/文档站工作不主动推进。

> 创建时间：2026-03-10
> 最后更新：2026-03-10

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | Monorepo 基础设施 | ✅ 已完成 | npm workspaces + 共享配置 |
| Phase 1 | apps/site 骨架 + Fumadocs 接入 | ✅ 已完成 | Next.js + Fumadocs + i18n，已 CDP 验证 |
| Phase 2 | 官网页面（首页、下载、社区） | ✅ 已完成 | marketing 页面 + 内容源 |
| Phase 3 | 首批文档内容 | ✅ 已完成 | 7 篇 x 2 语言，已 CDP 验证 |
| Phase 4 | packages/ui 抽取 | 📋 待开始 | 共享组件库 |
| Phase 5 | 桌面端适配 + CI/CD | 📋 待开始 | Electron 改 /chat、Vercel 部署 |

## 决策日志

- 2026-03-10: 官网与文档合并为一个 Next.js 应用 apps/site，与桌面应用分开部署
- 2026-03-10: 文档框架选 Fumadocs（支持 Next.js、DocsLayout、i18n、Orama 搜索）
- 2026-03-10: 部署到 Vercel，桌面应用继续 GitHub Releases
- 2026-03-10: 第一阶段只做 zh + en
- 2026-03-10: packages/ui 放 Phase 4，先让 site 跑起来再抽共享组件
- 2026-03-10: next.config.mjs（Fumadocs MDX 是 ESM-only）
- 2026-03-10: fumadocs-mdx v11 的 toFumadocsSource() 返回 files 为函数，fumadocs-core v15.8 期望数组，需手动调用
- 2026-03-10: 根 tsconfig.json 需排除 apps/ 和 packages/ 避免 typecheck 冲突
- 2026-03-10: @/.source 路径需要在 tsconfig paths 中单独映射（因为 src/ 目录结构）

## 目标目录结构

```
repo/
├── apps/
│   ├── desktop/                    # 现有 Electron + Next.js（迁移自根目录）
│   └── site/                       # 官网 + /docs
│       ├── app/
│       │   ├── [lang]/
│       │   │   ├── (marketing)/
│       │   │   │   ├── page.tsx            # 官网首页
│       │   │   │   ├── download/page.tsx   # 下载页
│       │   │   │   └── community/page.tsx  # 社区页
│       │   │   ├── docs/
│       │   │   │   ├── layout.tsx          # DocsLayout
│       │   │   │   └── [[...slug]]/page.tsx # Fumadocs 文档页
│       │   │   └── layout.tsx              # [lang] layout + RootProvider
│       │   └── api/
│       │       └── search/route.ts         # Orama 搜索 API
│       ├── content/
│       │   ├── docs/
│       │   │   ├── en/                     # 英文文档 MDX
│       │   │   └── zh/                     # 中文文档 MDX
│       │   └── marketing/
│       │       ├── en.ts                   # 英文官网文案
│       │       └── zh.ts                   # 中文官网文案
│       ├── lib/
│       │   ├── source.ts                   # Fumadocs source loader
│       │   ├── i18n.ts                     # i18n 配置
│       │   └── layout.shared.tsx           # 共享 layout 选项
│       ├── components/                     # site 专用组件
│       ├── public/                         # 静态资源
│       ├── source.config.ts                # Fumadocs MDX 配置
│       ├── next.config.mjs                 # ESM Next.js 配置
│       ├── tailwind.css                    # Tailwind v4 + Fumadocs preset
│       ├── tsconfig.json
│       ├── package.json
│       └── middleware.ts                   # i18n middleware
├── packages/
│   ├── ui/                                 # 共享 UI 组件（Phase 4）
│   └── config/                             # 共享 tsconfig/eslint（Phase 4）
├── package.json                            # 根 workspace 配置
└── ... (现有根目录文件保持不动，Phase 5 再迁移)
```

**Phase 0-3 策略：** 不动现有根目录结构。apps/site 作为独立新应用添加，用 npm workspaces 管理。现有桌面应用暂时留在根目录，Phase 5 再考虑是否迁移到 apps/desktop。

## 路由设计

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | 官网首页 | 产品介绍、特性展示、CTA |
| `/download` | 下载页 | 跳转 GitHub Releases |
| `/community` | 社区页 | Discord/GitHub 链接 |
| `/docs` | 文档首页 | Getting Started |
| `/docs/[...slug]` | 文档详情 | Fumadocs MDX 渲染 |
| `/zh/` | 中文首页 | 同上中文版 |
| `/zh/docs/[...slug]` | 中文文档 | 同上中文版 |
| `/api/search` | 搜索 API | Orama 全文搜索 |

i18n 策略：en 为默认语言，URL 无前缀（`hideLocale: 'default-locale'`）；zh 有 `/zh/` 前缀。

## Fumadocs 接入点

### 核心依赖
```
fumadocs-core     — 内容加载、搜索、页面树、i18n
fumadocs-ui       — DocsLayout、DocsPage、RootProvider、SearchDialog
fumadocs-mdx      — MDX 构建时加载器、defineDocs、defineConfig
@types/mdx        — MDX 类型支持
```

### 关键配置文件
- `source.config.ts` → `defineDocs({ dir: 'content/docs' })`
- `lib/source.ts` → `loader({ baseUrl: '/docs', source: docs.toFumadocsSource() })`
- `lib/i18n.ts` → `defineI18n({ defaultLanguage: 'en', languages: ['en', 'zh'] })`
- `middleware.ts` → `createI18nMiddleware(i18n)`
- `next.config.mjs` → `createMDX()(config)`

### Tailwind v4 集成
```css
@import "tailwindcss";
@import "fumadocs-ui/css/neutral.css";
@import "fumadocs-ui/css/preset.css";
@source "../../node_modules/fumadocs-ui/dist/**/*.js";
```

## Vercel 部署拓扑

- **Project root directory:** `apps/site`
- **Framework:** Next.js
- **Production branch:** main
- **Preview:** 开启，每个 PR 自动预览
- **域名：** codepilot.xxx/ → 官网，codepilot.xxx/docs → 文档

Vercel 只部署 apps/site，桌面应用继续走 GitHub Actions + GitHub Releases。

## CI/CD 分工

| 触发条件 | 平台 | 产物 |
|----------|------|------|
| apps/site/** 变更 | Vercel | 官网 + 文档站 |
| 桌面应用代码变更 | GitHub Actions | DMG / NSIS 安装包 |
| git tag v* | GitHub Actions | Release + 安装包 |

## 首批文档目录

```
content/docs/en/
├── index.mdx                    # Getting Started
├── installation.mdx             # 安装指南
├── providers/
│   └── index.mdx                # Provider 配置（Anthropic/OpenAI/Google/Bedrock）
├── mcp/
│   └── index.mdx                # MCP 插件系统
├── bridge/
│   └── index.mdx                # 消息桥接（Discord/Telegram/飞书/QQ）
├── assistant-workspace/
│   └── index.mdx                # 助手工作区
└── faq.mdx                      # 常见问题

content/docs/zh/
└── (同上，中文版)
```

## 分阶段实施计划

### Phase 0: Monorepo 基础设施
1. 根 package.json 添加 `workspaces: ["apps/*", "packages/*"]`
2. 创建 apps/site 目录和 package.json
3. 确保现有桌面应用不受影响

### Phase 1: apps/site 骨架 + Fumadocs 接入
1. 初始化 Next.js 应用（next.config.mjs）
2. 安装 fumadocs-core、fumadocs-ui、fumadocs-mdx
3. 配置 source.config.ts + lib/source.ts
4. 配置 i18n（lib/i18n.ts + middleware.ts）
5. 配置 Tailwind v4 + Fumadocs CSS preset
6. 创建 [lang] layout + RootProvider
7. 创建 docs layout（DocsLayout）+ docs page（DocsPage）
8. 创建搜索 API（Orama）
9. 放入 1 篇测试文档验证全链路

### Phase 2: 官网页面
1. 首页（产品介绍、特性网格、CTA）
2. 下载页（平台检测、跳转 Releases）
3. 社区页（Discord/GitHub 链接）
4. 共享导航栏 + 页脚
5. marketing 文案内容源（en.ts / zh.ts）

### Phase 3: 首批文档内容
1. Getting Started
2. Installation
3. Providers
4. MCP
5. Bridge
6. Assistant Workspace
7. FAQ
8. 中文翻译

### Phase 4: packages/ui 抽取
1. 从 src/components/ui/ 抽取到 packages/ui
2. 桌面应用和 site 都消费 packages/ui
3. 共享 tsconfig/eslint 配置到 packages/config

### Phase 5: 桌面端适配 + CI/CD
1. Electron loadURL 改为直接打开 /chat
2. 桌面端根路径不再 redirect（或保持 redirect）
3. Vercel 项目配置
4. GitHub Actions 调整（monorepo 感知）
