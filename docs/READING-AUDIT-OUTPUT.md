# Reading Audit Output

Each `scan` creates one audit folder. Inside it, VEX groups results by page and device.

```text
vex-output/
└── audit-YYYYMMDD-HHMM/
    ├── audit.json
    ├── config.used.json
    ├── urls.txt
    └── pages/<host>/<path>/_index/<device>/
        ├── state.json
        ├── 01-screenshot.png
        ├── 01-screenshot-viewport-metrics.json
        ├── 02-dom.json
        ├── 03-with-folds.png
        ├── 04-with-grid.png
        └── 05-analysis.json
```

`05-analysis.json` only exists when the scan runs analysis.

## Audit-Level Files

| File | What it tells you |
| --- | --- |
| `audit.json` | Overall status, URLs, devices, completed runs, failed runs. |
| `config.used.json` | The resolved scan options VEX used. |
| `urls.txt` | The URL list captured in this scan. |

## Page And Device Files

| File | What to open first |
| --- | --- |
| `01-screenshot.png` | Use this when you need the clean page capture. |
| `03-with-folds.png` | Use this when reviewing above-the-fold and repeated viewport cuts. |
| `04-with-grid.png` | Use this when reporting a region such as "B7" or "D12". |
| `state.json` | Use this when checking artifact metadata and exact generated paths. |
| `01-screenshot-viewport-metrics.json` | Use this when mobile viewport or fold behavior needs debugging. |
| `02-dom.json` | Use this when locating code or connecting visual issues to DOM elements. |
| `05-analysis.json` | Use this when AI analysis was enabled. |

## Practical Reading Flow

1. Start at `audit.json` and confirm the run completed.
2. Open the page/device folder you care about.
3. Inspect `03-with-folds.png` for content rhythm and first-screen cuts.
4. Inspect `04-with-grid.png` when you need precise visual references.
5. Use metrics and metadata only when a visual result needs explanation.

The audit folder is meant to be portable evidence: a reviewer should be able to open it later and understand what VEX saw without rerunning the scan.
