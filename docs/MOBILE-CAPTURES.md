# Mobile Captures

Mobile capture in VEX is for finding layout cuts by device size.

The common failure mode is simple: a page is technically responsive, but the viewport cuts through the wrong thing. A CTA is half-visible, a heading breaks at an awkward moment, a card starts below the fold, or a sticky header leaves less usable space than expected.

VEX makes those cuts explicit.

## Browser Emulation Boundary

Mobile capture in VEX is page capture, not a physical phone screenshot.

Playwright can emulate a phone viewport, DPR, touch behavior, user agent, and browser engine preference. It does not include native browser chrome in `page.screenshot()`: no iOS status bar, no Safari address bar, no bottom toolbar, no Android system navigation area.

## What The Red Folds Mean

The red lines in `03-with-folds.png` mark repeated page viewport cuts inside a full-page screenshot.

For mobile review, this answers questions like:

- What is visible on the first screen?
- Where does the second screen begin?
- Does a CTA land before or after a real viewport cut?
- Does a fold slice through a button, card, form, or heading?
- Is the page rhythm different on a small phone, large phone, tablet, and desktop?

## Sticky Headers And Fixed Bars

Pages often have their own sticky header or fixed bottom UI. Those elements repeat while a person scrolls, so later viewport cuts should account for the area they occupy.

Use sticky-aware folds:

```typescript
scanPresets: {
  "phone-capture": {
    urls: ["http://localhost:4321/"],
    devices: ["iphone-14-pro-max"],
    mode: "capture-only",
    foldOcclusion: true,
  },
}
```

Behavior:

- first fold stays at the raw viewport height;
- later folds use the usable viewport height after detected fixed/sticky top and bottom regions;
- detected regions are recorded in `01-screenshot-viewport-metrics.json`.

## Physical Phone Comparison

If you compare VEX with a physical iPhone screenshot, remember:

- the default VEX screenshot is the page only;
- the physical screenshot includes browser UI;
- `frame: "safari-ios"` creates a separate framed artifact for first-screen comparison;
- fold markers on the default artifact should still be based on the page viewport.
