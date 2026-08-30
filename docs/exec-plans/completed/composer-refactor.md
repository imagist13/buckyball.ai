# Composer 重构 + 单聊天权限 + 远程桥接联动

## 状态: 🟡 进行中

## 概述
重构聊天输入区为两层结构，新增 session 级权限档位，桥接联动，上下文占用指示器。

## 轨道拆分

### Track 1: Backend & Data（数据层）
- [ ] db.ts: chat_sessions 新增 permission_profile TEXT NOT NULL DEFAULT 'default'
- [ ] types/index.ts: Session 类型新增 permission_profile 字段
- [ ] api/chat/sessions/route.ts: 创建 session 时写入 default
- [ ] api/chat/sessions/[id]/route.ts: GET 返回 permission_profile, PATCH 支持更新
- [ ] api/chat/route.ts: bypassPermissions = global || session.permission_profile === 'full_access'
- [ ] lib/model-context.ts: 新建模型 contextWindow 常量表
- [ ] api/providers/models/route.ts: 返回可选 contextWindow 字段
- [ ] i18n/en.ts + zh.ts: 新增所有翻译 key

### Track 2: Composer UI 重构
- [ ] MessageInput.tsx: 内部 footer 只保留文件、模型、slash、发送
- [ ] 移除 mode toggle（保留后端逻辑）
- [ ] 新建 ChatComposerActionBar.tsx: 输入框外部操作栏容器
- [ ] 新建 SlashCommandButton.tsx: 复用现有 slash 逻辑
- [ ] ImageGenToggle 改文案"设计 Agent"，移到 action bar
- [ ] ChatView.tsx + page.tsx: 集成新布局

### Track 3: 权限选择器 + 上下文指示器
- [ ] 新建 ChatPermissionSelector.tsx: default/full_access 切换 + 危险确认
- [ ] 新建 ContextUsageIndicator.tsx: 圆圈 + HoverCard
- [ ] 新建 hooks/useContextUsage.ts: 解析 usage、计算 ratio
- [ ] 集成到 ChatComposerActionBar

### Track 4: Bridge 联动
- [ ] permission-broker.ts: 检查 session permission_profile
- [ ] bridge-manager.ts: full_access 时不发权限通知
- [ ] conversation-engine.ts: full_access 时跳过权限卡片
- [ ] 处理切换时已存在的 pending permission 失效

## 依赖关系
- Track 2/3/4 都依赖 Track 1 的类型和 DB 字段
- Track 2 和 Track 3 可并行，最后在 ChatView 集成
- Track 4 独立于 UI 轨道

## 测试清单
- [ ] session 级 permission_profile 持久化
- [ ] slash 按钮触发现有命令流程
- [ ] full_access 下本地不显示权限确认
- [ ] full_access 下 bridge 不发权限通知
- [ ] context hover 展示明细
- [ ] composer 布局回归
