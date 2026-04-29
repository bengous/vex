# Capture-Only Workflow

Capture-only mode is for checking viewport cuts without model calls.

The point is not just to take screenshots. The point is to see whether a real device viewport slices through important content: a button, a heading, a card, a form, or a block of text. Once the cut is visible, you can adjust spacing, layout, content order, or responsive rules for that device size.

Use it when you want to:

- capture a page across desktop, tablet, and phone presets;
- see where viewport folds land inside a full-page screenshot;
- catch cut CTAs, awkward text breaks, and broken section rhythm;
- add a grid so visual regions are easy to reference;
- compare output with a physical device;
- collect screenshots quickly before deciding whether AI analysis is useful.

## Configure It

`capture-only` is a scan preset mode. Put it in `vex.config.ts`:

```typescript
scanPresets: {
  "mobile-review": {
    urls: ["http://localhost:4321/"],
    devices: ["desktop-1920", "iphone-14-pro-max"],
    mode: "capture-only",
    foldOcclusion: true,
  },
}
```

Run it:

```bash
bun src/cli/index.ts scan --preset mobile-review
```

## What It Produces

For each URL and device, VEX creates:

| File | Use |
| --- | --- |
| `01-screenshot.png` | Full-page page capture. |
| `01-screenshot-viewport-metrics.json` | Browser and viewport measurements used during capture. |
| `02-dom.json` | DOM snapshot for later analysis or locating. |
| `03-with-folds.png` | Screenshot with red viewport fold markers. |
| `04-with-grid.png` | Screenshot with grid overlay for visual references. |
| `state.json` | Artifact metadata for this page/device run. |

## Recommended Review Order

1. Open `03-with-folds.png` to see whether a fold cuts through important UI.
2. Open `04-with-grid.png` when you need to point to a region precisely.
3. Check `01-screenshot-viewport-metrics.json` if fold placement looks surprising.
4. Run AI analysis only if the visual evidence is worth model interpretation.

## Useful Options

- `devices`: choose the viewports to capture.
- `foldOcclusion: true`: adjust later fold lines for repeated sticky/fixed page chrome.
- `frame: "safari-ios"`: add a separate Safari-style frame artifact for first-screen comparison.
- `placeholderMedia: true`: replace images and video with neutral boxes when media content distracts from layout review.

Capture-only should stay boring and repeatable. It is the baseline workflow for checking whether VEX sees the same layout problem you see.
