# Theme Family System / 主题家族系统

## 概述

两层主题系统：`mode`（light/dark/system，由 next-themes 管理）+ `theme family`（色板，由自定义 context + CSS 变量管理）。

## 架构

```
themes/*.json           → 定义色板（OKLCH）、代码主题映射
src/lib/theme/loader.ts → 服务端读取 + 校验 JSON，按 order 排序
src/lib/theme/render-css.ts → 生成 html[data-theme-family="x"] 规则
src/app/layout.tsx      → <head> 注入反闪烁脚本 + <style> 块
src/lib/theme/context.ts + ThemeFamilyProvider → 客户端状态 + localStorage
```

**CSS 特异性**：`html[data-theme-family]` (0,1,0) > `:root` (0,0,1)；`html.dark[data-theme-family]` (0,2,0) > `.dark` (0,1,0)。globals.css 中的 `:root` / `.dark` 块作为兜底。

## 主题 JSON Schema

```jsonc
{
  "id": "night-owl",          // 唯一 ID，对应 data-theme-family 值
  "label": "Night Owl",       // 显示名
  "order": 7,                 // 排序权重
  "description": "...",       // 可选短描述
  "codeTheme": {              // Prism / HLJS 代码高亮
    "light": "coy",           // 键名对应 code-themes.ts 中的 PRISM_THEME_MAP / HLJS_THEME_MAP
    "dark": "nightOwl"
  },
  "shikiTheme": {             // Shiki 代码高亮（ai-elements）
    "light": "night-owl-light",  // 值为 Shiki BundledTheme 名
    "dark": "night-owl"
  },
  "light": { /* 31 个 ThemeColors 键，oklch 值 */ },
  "dark":  { /* 同上 */ }
}
```

## 代码高亮三条渲染链

| 消费组件 | 高亮器 | 解析函数 |
|---------|--------|---------|
| ChatCodeBlock (`CodeBlock.tsx`) | Prism | `resolvePrismStyle()` |
| DocPreview / FilePreview | HLJS | `resolveHljsStyle()` |
| AI Elements CodeBlock (`code-block.tsx`) | Shiki | `resolveShikiThemes()` |
| Settings Preview (`AppearanceSection.tsx`) | Shiki | `codeToHtml()` |

三条链路都通过 `useThemeFamily()` 取得当前 family，再查找对应的 `codeTheme` / `shikiTheme` 映射。

## 当前主题清单（12 个）

| ID | Order | Light Code | Dark Code | Shiki Light | Shiki Dark |
|----|-------|-----------|----------|------------|-----------|
| default | 0 | oneLight | oneDark | github-light | github-dark |
| github | 1 | ghcolors | vscDarkPlus | github-light-default | github-dark-default |
| rose-pine | 2 | duotoneLight | duotoneSea | rose-pine-dawn | rose-pine |
| tokyo-night | 3 | materialLight | materialOceanic | github-light | tokyo-night |
| everforest | 4 | gruvboxLight | duotoneForest | everforest-light | everforest-dark |
| nord | 5 | coldarkCold | nord | github-light | nord |
| kanagawa | 6 | vs | duotoneEarth | kanagawa-lotus | kanagawa-wave |
| night-owl | 7 | coy | nightOwl | night-owl-light | night-owl |
| poimandres | 8 | coldarkCold | coldarkDark | min-light | poimandres |
| vesper | 9 | gruvboxLight | twilight | min-light | vesper |
| horizon | 10 | duotoneLight | materialDark | github-light | horizon |
| synthwave84 | 11 | prism | synthwave84 | min-light | synthwave-84 |

## 新增主题

1. 在 `themes/` 目录创建 JSON 文件，遵循上述 schema
2. 填写所有 31 个 ThemeColors 键（light + dark），值用 OKLCH
3. `codeTheme` 键名必须在 `code-themes.ts` 的 `PRISM_THEME_MAP` / `HLJS_THEME_MAP` 中存在
4. `shikiTheme` 值必须是 Shiki `BundledTheme`
5. Loader 自动发现——无需改代码

## 关键设计决策

- **不用 Catppuccin / Solarized / Monokai 占位**：已删除早期占位主题，只保留有完整 light+dark 对且在两种模式下都有明显差异的 family
- **Rose Pine 合并**：Dawn 是 light 变体，Base 是 dark 变体，Moon 的 light 和 Base 一样 → 只保留一个 rose-pine family
- **Tokyo Night 合并**：Storm 和 Base 在 light 模式几乎无差异 → 只保留一个 tokyo-night family，light 使用真实 TN Light 色板
- **硬编码蓝色清理**：全局 `blue-*` / `indigo-*` Tailwind 类已替换为 `primary` 语义色，保留语义状态色（green/red/yellow）
- **Settings 预览用 Shiki**：与 ai-elements 实际渲染一致，而非 Prism 近似
