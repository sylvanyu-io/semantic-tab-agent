# Time Recap Extension Scale Benchmark

Latest run: `time-recap-extension-scale-2026-07-06T16-49-36-734Z-pid94381`

Raw data: `docs/benchmarks/data/time-recap-extension-scale-2026-07-06T16-49-36-734Z-pid94381.json`

This benchmark opens synthetic tab sessions in a real Chromium profile with the unpacked TabRecap extension loaded, seeds local activity/summary/lifecycle records, then calls the extension runtime message `activity:generateTimeRecap`.

It intentionally uses the local recap path (`plannerProvider: fake`) so the result measures browser/runtime/input-construction stability instead of live AI gateway latency.

| Tabs | Windows | Runtime | Included pages | Page summaries | Lifecycle sessions | Themes | Timeline |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30 | 4 | 18ms | 30 | 20 | 30 | 5 | 1 |
| 120 | 4 | 1.96s | 120 | 80 | 120 | 5 | 1 |
| 300 | 4 | 24.79s | 300 | 200 | 300 | 5 | 1 |

## Current Conclusion

- 30/120/300-tab recap input construction is covered by a repeatable real-extension benchmark.
- Latest local recap runtime ranged from 18ms (30 tabs) to 24.79s (300 tabs).
- The benchmark proves local recap assembly and fallback rendering. It does not prove live AI model latency; use gateway live smoke and monitor logs for that layer.
