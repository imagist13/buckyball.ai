/**
 * bbagent/features.ts — BB 二开 feature flag 单一入口
 *
 * 所有"二开 vs 上游"差异的开关走这里，避免散落在多处 if 判断。
 * 单一文件改一处即可调整全局行为。
 *
 * 注意：feature flag 关闭 = 默认行为下线（路由 410 / UI 隐藏 / seed 关停），
 * 不等于删代码——旧数据保留以便回滚或将来重开（实验性 override）。
 */

export const BB_FEATURES = {
  /** 二开默认开启：bbdev 注入层（MCP / Skill / Prompt 三注入点） */
  bbdev: true,

  /** 二开默认关闭：图像生成（Gemini / GPT-image / Grok Imagine）。路由 410 / UI 隐藏 / 旧数据保留 */
  imageGeneration: false,

  /** 二开默认关闭：个人助手（AssistantWorkspace / Buddy / Heartbeat）。入口隐藏 / 不再自动 seed / 旧数据保留 */
  personalAssistant: false,
} as const;

export type BbFeatureKey = keyof typeof BB_FEATURES;

/**
 * 查询某个 feature 是否启用
 */
export function isBbFeatureEnabled(key: BbFeatureKey): boolean {
  return BB_FEATURES[key];
}

/**
 * 检查 bbdev 注入层是否启用（最常用，写成单独函数避免到处敲 isBbFeatureEnabled('bbdev')）
 */
export function isBbdevEnabled(): boolean {
  return BB_FEATURES.bbdev;
}