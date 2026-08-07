# TabRecap Docs

这里保留长期有用的产品、架构、权限、测试和发布文档。一次性实验记录放在 `benchmarks/archive/`，当前可读结论放在 `benchmarks/README.md`。

## 01-12 稳定文档

1. [Product analysis](01-product-analysis.md) - 产品方向、核心风险和 MVP 边界。
2. [Agent contract](02-agent-contract.md) - AI planner 可用信息、工具能力和执行限制。
3. [Evaluation harness](03-evaluation-harness.md) - 本地测试 harness 和夹具设计。
4. [Permissions and privacy](04-permissions-privacy.md) - Chrome 权限、页面摘要和网关权限策略。
5. [Multi-window feasibility](05-multi-window-feasibility.md) - 跨窗口整理的 API 可行性和边界。
6. [Grouping and cleanup planner](06-grouping-cleanup-planner.md) - 分组推荐与清理推荐的合并 planner。
7. [Planner optimization](07-planner-optimization.md) - 模型路由、并行化和性能优化方向。
8. [Agent harness research](08-agent-harness-research.md) - 外部 agent harness 模式如何映射到 TabRecap。
9. [Release readiness](09-release-readiness.md) - 发布前检查清单和残余风险。
10. [Time recap status](10-time-recap-plan.md) - 基于本地活动和页面摘要生成时间段回顾的产品边界、落地状态与后续增强。
11. [Shared gateway reliability](11-local-origin-gateway-stability.md) - Cloudflare Worker 到 OpenCode Go 的健康检查、限流和失败边界。
12. [Shared gateway runbook](12-default-ai-gateway-runbook.md) - 共享地址、模型、Secret 和部署检查。

## Benchmark 入口

- [Benchmark index](benchmarks/README.md) - 当前结论、质量报告、模型矩阵和原始数据索引。
