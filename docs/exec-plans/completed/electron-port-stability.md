# Electron 端口稳定化：根治 localStorage 重启失效

> 创建时间：2026-04-15
> 关联：`issue-tracker.md` B-004、用户报告"主题保存后重启不生效 / 默认模型徽标丢失 / 默认模型不生效"
> Sentry 关联：无直接指纹（这是 UX 问题，不抛错）；Issues `#465` `#466` `#477`

## 一、用户反馈摘要

三个看似独立的回归问题：

| 现象 | 来源 |
|---|---|
| 输入框模型选择器**默认模型徽标**显示不出来 | 本轮用户反馈 |
| **默认模型选择**疑似不生效 | 本轮用户反馈 + #477 |
| **主题**保存后下次启动不生效 | 本轮用户反馈 + #465 + #466 |

## 二、事实核查链

### 2.1 三者本质是同一根因

**Electron 主进程 `electron/main.ts:515`（修复前）：**
```ts
function getPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    ...
    server.listen(0, '127.0.0.1', () => {  // ← `0` = OS 随机分配端口
      ...
    });
  });
}
```

每次 Electron 启动 →
- 调用 `getPort()` → `listen(0)` → OS 随机分配（每次不同）
- `serverPort = port`
- `mainWindow.loadURL("http://127.0.0.1:" + port)` → 渲染进程 origin = `http://127.0.0.1:<random>`

**浏览器 localStorage 按 origin 存储**（这是 Web 标准，不是 bug）。端口是 origin 的一部分。所以 origin 变化 = localStorage 全部失效。

### 2.2 链路推演（以"默认模型徽标"为例）

代码侧的链路是完整的：

| 步骤 | 文件:行 | 状态 |
|---|---|---|
| 用户在设置选默认模型 | `ProviderManager.tsx:310` | ✓ 写入 DB `global_default_model` + `global_default_model_provider` |
| 渲染进程拉取默认模型 | `useProviderModels.ts:58` | ✓ `GET /api/providers/options?providerId=__global__` |
| API 读 DB 返回 | `db.ts:1525-1531` `getProviderOptions('__global__')` | ✓ 返回正确值 |
| 组件渲染徽标 | `ModelSelectorDropdown.tsx:102-106 + 149-153` | ✓ `isCurrentDefault` 判断 + `<span>默认</span>` |
| 当前模型来源 | `chat/page.tsx:121-122 / 157-158 / 282 / 339...` | ❌ **来自 localStorage** |

**关键卡点：** `chat/page.tsx` 多处用 `localStorage.getItem('codepilot:last-model')` 和 `codepilot:last-provider-id` 决定**当前选中**的模型。新对话流程（line 111-191）会先尝试用 global default，但有几条 fallback / 二次校验路径直接读 localStorage。

重启后 localStorage 清空 → `currentProviderId = ''` → `isCurrentDefault` 检查 `currentProviderIdValue === globalDefaultProvider` 不成立 → 徽标不显示。

即使 DB 里 default model 还在，UI 也对不上号。

### 2.3 主题为什么也挂

`AppearanceSection.tsx:155 + 160` 已经是双写（localStorage + DB），`layout.tsx:54` 的 anti-FOUC 脚本也有 `localStorage || db || 'default'` 的 fallback 链。理论上 DB fallback 应该兜底。

但实际复现的两种失效路径：
1. **next-themes 的 theme_mode**：`layout.tsx:56-58` 的同步脚本只在 `!localStorage.getItem('theme')` 时才 inject DB 值。如果 next-themes 的初始化时序早于这个 inject（极少数浏览器实现），就会用默认 'system'
2. **theme_family**：anti-FOUC 脚本本身有 fallback，**但**仅当 DB 的 `theme_family` 在用户保存后真的写进去了。如果 fetch promise 没等到 → 用户立即关闭 app → DB 写没完成

第 2 种是 race condition，第 1 种是初始化时序问题。**两者根因都是 localStorage 不可信**——一旦 localStorage 不丢，这两个边缘场景都不会被触发。

### 2.4 为什么不逐个迁移 localStorage 到 DB？

排查后发现以下文件依赖 `codepilot:*` localStorage：

```
src/app/chat/page.tsx              (12 处)
src/app/chat/[id]/page.tsx         (1 处)
src/components/chat/ModelSelectorDropdown.tsx (2 处)
src/components/settings/GeneralSection.tsx     (1 处, sentry-disabled)
src/components/layout/ThemeFamilyProvider.tsx (3 处)
src/app/layout.tsx                 (4 处, anti-FOUC 脚本)
src/components/cli-tools/CliToolBatchDescribeDialog.tsx (n 处)
... 至少 7 个文件，30+ 调用点
```

逐个迁移：
- 改动面大 → 测试覆盖差 → 引入新 bug 风险高
- 异步 DB 写不能保证 anti-FOUC 同步生效
- 不解决"localStorage 是浏览器标准 API，开发体验直观"的优势

**根因层修复（端口稳定化）**：
- 改动量：1 个文件，2 个函数
- 原有 localStorage 代码全部自动生效
- 不破坏 anti-FOUC 同步语义
- v0.49.0 已迁移到 DB 的 FeatureAnnouncement 也不受影响（多写一次而已）

## 三、修复方案

### 改动 1：`electron/main.ts` 的 `getPort()`

**原来（line 510-525）：** `listen(0)` 拿随机端口

**改后：**
- 新增 `isPortFree(port)`：探测特定端口是否可用
- `getPort()` 先轮询稳定端口范围 `47823-47830`，**8 个候选**
- 全部被占才 fallback 到 OS-assigned，并 console.warn 提示用户 settings 可能不持久

### 端口选择理由

- **范围**：`47823-47830`（IANA 状态：未分配）
- **避开常见端口**：3000-3010（Next.js 默认）、8000-8080（dev tools）、5000-5050（macOS AirPlay）
- **8 个候选**：覆盖单用户场景（通常 1 个实例，最多 2-3 个 dev/prod 并存）；即使企业内部 8 人共享一台 Windows Terminal Server，也能撑住

### 不做的事

- **不**加 `app.requestSingleInstanceLock()`：当前没有，加上是行为变更（用户可能依赖多实例）；端口轮询已经处理多实例
- **不**持久化"上次成功端口"到磁盘：会让"端口冲突时下次也卡在同一端口"，反而更难恢复
- **不**改任何 localStorage 调用：根因层修好了，无需触动

## 四、影响范围

修复后：
- ✓ 主题（mode + family）重启保留
- ✓ 默认模型 / 默认 provider 选择重启保留（包括徽标显示）
- ✓ 工作目录记忆
- ✓ 各类 dismiss 状态（已迁移 DB 的双重保险，未迁移的不再丢）
- ✓ Sentry opt-out 标记
- ✓ 任何当前依赖 localStorage 的 UI 状态

不影响：
- ✗ DB 写入路径（无变更）
- ✗ Next.js 服务行为（端口对它来说是参数）
- ✗ 已修复的 cc-switch 凭据桥接（`~/.claude/settings.json` 不依赖 origin）

## 五、验证

### 5.1 单元层

由于 `getPort()` 在 Electron 主进程，不在 src/__tests__ 测试范围内。但：
- 类型检查通过（`tsc -p electron/tsconfig.json` 无新增 error）
- `isPortFree` 是简单的 `net.createServer().listen()` 包装，无需测试
- fallback 路径是原 `getPort()` 逻辑搬过去，行为不变

### 5.2 端到端层

**手动验证（用户可在 dev 模式跳过——dev 已经固定 3000 端口）：**

需要在打包后的 Electron 实测。脚本如下：
```bash
npm run electron:build
open /Users/op7418/Documents/code/opus-4.6-test/release/CodePilot.app
# 在 app 里设置主题为 dark + 保存
# Cmd+Q 退出
# 再次打开 app
# 验证：主题保持 dark；模型选择器仍然显示上次选择的模型
# 关键确认：浏览器 console 显示 origin = http://127.0.0.1:47823 (或同范围)
```

**自动化验证（可选）：** smoke test 加一条 "重启后 theme_family 保留"，但 smoke test 跑的是 dev 模式（端口本来就固定），无法有效复现。打包测试需要 e2e CI。

### 5.3 Sentry / 用户反馈跟踪

发版后 72h 关注：
- `#465` / `#466` / `#477` 是否有用户回复"已修复"
- 新增的"主题不生效 / 默认模型不生效"反馈是否归零

## 六、决策日志

- **2026-04-15** — 排查中发现"输入框默认模型徽标 / 默认模型生效 / 主题持久化"三个问题用户描述独立，但代码追踪后归结为同一根因（localStorage 失效）
- **2026-04-15** — 拒绝"逐个迁移 localStorage 到 DB"方案（30+ 调用点、高回归风险、不解决 race condition）
- **2026-04-15** — 选择端口稳定化方案：1 个文件 2 个函数改动，根因层修复，所有衍生症状自动消失
- **2026-04-15** — 端口范围选 `47823-47830` 而非更小（如单端口 + 失败 fallback），原因：单端口冲突时直接退回随机端口，会让相邻安装的两台 CodePilot 互相挤掉对方的 localStorage；8 个候选给多实例足够余量
- **2026-04-15** — 不引入 `requestSingleInstanceLock()`，避免行为变更引发新的用户投诉（"为什么我打开第二个 CodePilot 它不开了"）
- **2026-04-15 review 后跟进** — 原方案是经典 TOCTOU：`getPort()` 探测端口空闲后释放，再让 Next 子进程绑定，两个实例同时启动可能都挑中 47823，第二个就 EADDRINUSE 直接退出。重写为 **`startServerOnStablePort()`：直接尝试用每个候选端口启动 subprocess，subprocess 因 EADDRINUSE 立即退出时 `waitForServer()` 会感知到并 throw**，外层 catch 后切下一个候选端口。`isPortFree()` 仅作为快速 pre-check 跳过明显被占的端口（不消除竞争窗口，只是让大多数情况下少一次 spawn）。配套：替换 boot path（`app.whenReady`）和 `app.on('activate')` 两处调用
