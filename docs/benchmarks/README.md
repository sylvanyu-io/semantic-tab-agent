# Benchmark Index

这个目录只保留当前仍应直接阅读的 benchmark 结论。旧的单次试跑报告已移到 `archive/2026-06-26/`；原始 JSON 数据仍保留在 `data/`，用于复核和重新分析。

## 当前读这些

1. [Current planner decision](01-current-planner-decision.md) - 当前默认 planner 路线、前后对比、保留风险。
2. [Current planner quality](02-current-planner-quality.md) - synthetic fixture truth 下的 Topic/Family F1 质量报告。
3. [Model routing](03-model-routing.md) - 模型路由和 fallback 决策。
4. [Model matrix 2026-06-26](04-model-matrix-2026-06-26.md) - 模型/思考强度矩阵记录。
5. [Gateway model availability](05-gateway-model-availability-2026-06-26.md) - 网关可用模型诊断。
6. [Activation flow evidence](06-activation-flow-evidence.md) - 标签页切换、停留和回到锚点等行为证据的设计与验证边界。
7. [Real session evidence snapshots](07-real-session-evidence-snapshots.md) - 真实浏览会话的脱敏快照，用于判断是否具备继续做 live A/B 的证据质量。

## 当前关键结论

- 小规模低信号页面摘要场景和中大规模 metadata-only 场景不能直接按 tab 数横向比较；模型路线、页面摘要 payload、输出清单长度和思考强度才是主要耗时因子。
- 33 tabs 页面摘要场景是低信号样本，最终路线为 `gpt-5.5 high` 分组 + `gpt-5.3-codex-spark low` 清理，耗时 `41.3s`，Topic F1 保持 `98.7%`。
- 50/120/300 tabs 当前规模测试是 `task_bursts` metadata-only 场景，主要走 spark 路线，分别为 `11.8s / 36.6s / 69.9s`。
- 当前优化结论是“同条件下更快且质量不降”，不是“tab 数越少一定越快”。
- 行为证据已接入 planner payload，并新增 `behavior_flow` synthetic fixture；2026-07-06 的单次 live A/B 中，带行为证据 Topic F1 为 `100.0%`，剥离后为 `84.9%`。这支持继续保留该路线，但仍需要更多真实浏览会话验证。
- 行为证据现在包含 directed transition rows。48-tab 本地 fixture 中新增 36 条转移行，payload 增加 2,855 bytes / 20.4%，换来更直接的 `tab A -> tab B` 证据。
- 真实会话验证应先导出 redacted evidence snapshot；只有 lifecycle events、activation runs 和 summary coverage 足够时，live A/B 结论才有解释价值。

## 原始数据

关键 raw JSON：

- 33 tabs baseline: `data/planner-scale-2026-06-26T20-27-14-111Z-pid91961.json`
- 33 tabs final: `data/planner-scale-2026-06-26T21-07-15-117Z-pid65535.json`
- 50 tabs final: `data/planner-scale-2026-06-26T20-54-51-676Z-pid40765.json`
- 120/300 tabs final: `data/planner-scale-2026-06-26T20-52-24-931Z-pid36868.json`
- Activation flow A/B with flow: `data/planner-scale-2026-07-06T10-31-52-720Z-pid19058.json`
- Activation flow A/B without flow: `data/planner-scale-2026-07-06T10-34-02-822Z-pid21095.json`
