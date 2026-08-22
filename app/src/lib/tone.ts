// 语义色调表——就绪门状态与 AI 权限层级共用同一套三态视觉词汇：
// 绿=放行/已就绪，黄=待定/需提案，红=阻断/禁止，灰=不可用。键是语义，不是领域词。
export const SEMANTIC_TONE = {
  positive: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  pending: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
  negative: "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400",
  inactive: "bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400",
} as const;

export type SemanticToneKey = keyof typeof SEMANTIC_TONE;
