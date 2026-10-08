# Workshop hub geometry for Cursor

Reference: approved `albert-blue-workshop.png`. This is a coordinate/layout specification, not a replacement for the component’s state, handlers, or live data. Do not replace the orb renderer or introduce screenshot imagery.

## Coordinate contract

Use **`viewBox="0 0 700 640"`**, with the CSS stage at **`aspect-ratio: 700 / 640`**. Orb center **(350,250)**, visual sphere radius **145**. This is intentionally above the stage midpoint, leaving the lower center open. SVG rings and the HTML orb dock must use this SAME center. The dock should be `left:50%; top:39.0625%; width:41.428571%; height:45.3125%; transform:translate(-50%,-50%)`. These percentages describe one 290×290 square in the 700×640 coordinate system.

The current `CY=320`, square stage, and `top:47%` contract must be replaced together. A CSS-only move will make the orb and SVG rings misalign.

Destination cards are six individually drawn silhouettes, not annular sectors. Use explicit paths below; retain the existing `go(item.id)` routing, keyboard activation, `aria-label`, `aria-current`, and focus style.

## Drop-in destination data

```tsx
const CX = 350
const CY = 250
const ORB_RIM = 149

// Coordinates are measured in the 700×640 stage. Each icon/text anchor is
// chosen inside its card; the top silhouettes taper toward the orb.
const RING = [
  {
    id: 'conversation', label: 'Talk', icon: 'talk',
    d: 'M184 10 Q188 6 192 11 L232 94 Q170 130 141 219 Q140 224 135 223 L34 204 Q28 203 30 198 Q70 77 184 10 Z',
    iconX: 130, iconY: 109, textX: 110, labelY: 158,
    hints: ['Voice & text', 'conversation'], hintXs: [100, 95], hintY: 176,
  },
  {
    id: 'missions', label: 'Missions', icon: 'missions',
    d: 'M516 10 Q512 6 508 11 L468 94 Q530 130 559 219 Q560 224 565 223 L666 204 Q672 203 670 198 Q630 77 516 10 Z',
    iconX: 570, iconY: 109, textX: 591, labelY: 158,
    hints: ['Plan, research', 'and take action'], hintXs: [600, 606], hintY: 176,
  },
  {
    id: 'settings', label: 'Settings', icon: 'settings',
    d: 'M23 298 L120 273 Q125 271 126 277 Q138 353 178 399 Q181 403 177 407 L101 475 Q98 479 94 474 Q29 405 19 305 Q18 300 23 298 Z',
    iconX: 82, iconY: 338, textX: 100, labelY: 389,
    hints: ['Personality,', 'voice, provider'], hintXs: [108, 107], hintY: 407,
  },
  {
    id: 'memory', label: 'Memory', icon: 'memory',
    d: 'M677 298 L580 273 Q575 271 574 277 Q562 353 522 399 Q519 403 523 407 L599 475 Q602 479 606 474 Q671 405 681 305 Q682 300 677 298 Z',
    iconX: 618, iconY: 338, textX: 600, labelY: 389,
    hints: ['What Albert', 'remembers'], hintXs: [592, 595], hintY: 407,
  },
  {
    id: 'computer', label: 'Computer', icon: 'computer',
    d: 'M155 445 L216 488 Q221 491 223 498 L266 616 Q268 623 260 623 L202 623 Q136 583 87 514 Q83 509 88 505 Z',
    iconX: 175, iconY: 518, textX: 190, labelY: 566,
    hints: ['Browse & act', 'Use tools'], hintXs: [202, 213], hintY: 585,
  },
  {
    id: 'activity', label: 'Activity', icon: 'activity',
    d: 'M542 445 L480 488 Q475 491 473 498 L432 616 Q430 623 438 623 L497 623 Q561 581 611 514 Q615 509 610 505 Z',
    iconX: 525, iconY: 518, textX: 505, labelY: 566,
    hints: ['Your history', 'Progress'], hintXs: [493, 484], hintY: 585,
  },
] as const
```

The top labels deliberately sit a little outward from their icons, as in the approved image. The lower-card hints shift inward as their silhouettes taper. This keeps both hint lines within their cards. Do not derive their centers from a single radial angle again.

## Card rendering inside existing interactive group

```tsx
<path d={item.d} className="ring-segment" />
<path
  d={item.d}
  transform={`translate(${item.iconX} ${item.iconY}) scale(.968) translate(${-item.iconX} ${-item.iconY})`}
  className="ring-segment-inner"
/>
<g transform={`translate(${item.iconX} ${item.iconY})`} aria-hidden="true">
  <circle className="ring-well" r="31" />
  <g transform="translate(-15 -15) scale(1.875)">
    <RingGlyph name={item.icon} />
  </g>
</g>
<text className="ring-label" x={item.textX} y={item.labelY} textAnchor="middle">
  {item.label}
</text>
<text className="ring-hint" x={item.hintXs[0]} y={item.hintY} textAnchor="middle" aria-hidden="true">
  {item.hints.map((line, index) => (
    <tspan key={line} x={item.hintXs[index]} dy={index ? 14 : 0}>{line}</tspan>
  ))}
</text>
```

Use the existing real active/hover/focus state. The approved Computer card has a brighter edge, but do not create a fake selected state just to reproduce the fixture. If keeping its special accent, make it decorative and do not set aria-current unless truly current.

## Mission arc

Use the existing polar helper with the new CX/CY. The visible mission arc runs from **124° to 236°** beneath the sphere. Inner radius **169**, outer radius **208**. This is a substantial arc, not the current narrow 164°–196° slot.

To put the first real mission step on the LEFT, progress angles right-to-left in the data calculation:

```tsx
const span = 112 / shownSteps.length
const a1 = 236 - index * span - 1.5
const a0 = 236 - (index + 1) * span + 1.5
const mid = (a0 + a1) / 2
const [nodeX, nodeY] = polar(CX, CY, 176, mid)
const [textX, textY] = polar(CX, CY, 197, mid)
// sectorPath(a0, a1, 169, 208, 4)
// State marker: circle at (nodeX,nodeY), radius10.
// Label: textAnchor=middle at (textX,textY+4), clip to ~12 chars,
// with the full real title retained in aria-label/title.
```

Keep `setStepId`, `aria-pressed`, Enter/Space activation and actual state classes. Empty state must remain truthful; no invented Collect/Compare/Draft steps. When there are no steps, a dim decorative arc is fine, but it must not become a focusable fake control.

Place the mission title in a separate text line at **(350,473)**. Put the status in the lower central notch: its primary line at roughly **(350,529)** and voice line at **(350,554)**. A central text width of **184 units** avoids the inward edge of the lower cards. Long live text may wrap to two lines; do not allow it to span the cards.

If keeping `.workshop-status em` for the title, lift only that child relative to the status block, or render mission title separately. Do not move the entire status block next to the mission arc.

## Matching CSS

```css
.workshop-ring {
  position: relative;
  width: 100%;
  max-width: 700px;
  aspect-ratio: 700 / 640;
  height: auto;
  /* Do not retain max-height independently: it distorts SVG/dock alignment. */
  max-height: none;
  align-self: start;
  container-type: inline-size;
}
.workshop-orb-dock {
  left: 50%; top: 39.0625%;
  width: 41.428571%; height: 45.3125%;
  transform: translate(-50%, -50%);
}
.ring-svg .ring-label { font: 600 17px var(--font-body); }
.ring-svg .ring-hint { fill: #96c9eb; font: 12.5px var(--font-body); }
.ring-well {
  fill: #021422; stroke: #14516e; stroke-width: 1;
  filter: drop-shadow(0 0 7px #16aaf044);
}
.ring-segment {
  fill: url(#sector-fill); stroke: #32c8ff; stroke-width: 1.4;
  filter: drop-shadow(0 0 4px #149ce855);
}
.ring-segment-inner {
  fill: none; stroke: #115781; stroke-width: .8; pointer-events: none;
}
.ring-hit:focus-visible .ring-segment { stroke: #f1fcff; stroke-width: 3; }
.workshop-status {
  left: 50%; top: 79.375%; bottom: auto;
  width: 26.285714%; transform: translateX(-50%);
  gap: 7px; text-align: center;
}
.workshop-status strong {
  font: 600 2.3cqw/1.25 var(--font-body);
  letter-spacing: .03em;
}
.workshop-status span { font: 2cqw/1.25 var(--font-body); }
```

Set the `sector-fill` gradient stops to dark navy, e.g. **#082536 → #051824 → #020e18**, rather than the current saturated opaque blue. Reserve near-white for active edge highlights and the sphere. Ring decoration should be subtle behind the orb: use radii **158, 184, 199, 225**, not a large opaque 318-radius circular outline enclosing everything.

For a stage of width W, the stage height must be W×640/700. Keep the detach button visually at the stage’s top middle (x350,y36) rather than consuming an unrelated top grid row; preferably move it inside the stage and absolutely position it at `left:50%;top:3%`. Keep its existing dock/undock handler unchanged. Voice and activity remain normal-flow rows BELOW the stage. At the approved screenshot’s scale, voice is about 16px below the cards, activity another 14px below voice.

If the viewport is too short for the full stage + voice + activity + composer, use scrolling or the existing narrow-window stacking, not independent stage-height compression. In particular, update the old media-query widths/aspect rules so they cannot silently restore a square stage.

## Checks

1. Orb center and SVG ring center coincide while resizing, docking and undocking.
2. Each of six destinations routes exactly as before using pointer, Enter, and Space.
3. Icon, label and hint never share a baseline or overlap; the lower-center status stays within the notch.
4. Real mission labels and voice state remain live; empty missions show no fixture data.
5. Confirm at the actual app window dimensions, not only a wide synthetic preview.

## Numerical geometry QA (final corrected anchors)

Quadratic path edges were sampled at 80 subdivisions per segment. Each icon disk (r31) and each text rectangle was checked against the polygon. Text widths use Arial/Arial Bold metrics plus **10% width margin** for platform-font variation; label bounds are 14 above/4 below baseline, hints 11 above/3 below. The exact system font still needs final visual QA.

| Card | Minimum icon/text clearance in SVG units | At stage W620 | At stage W512 |
|---|---:|---:|---:|
| Talk | 12.57 | 11.13px | 9.19px |
| Missions | 8.95 | 7.92px | 6.54px |
| Settings | 3.97 | 3.52px | 2.90px |
| Memory | 11.67 | 10.34px | 8.54px |
| Computer | 4.87 | 4.31px | 3.56px |
| Activity | 8.52 | 7.55px | 6.23px |

All six mission-arc/destination intersections are **zero**. The smallest mission/card gap is **19.24 units**, about **17.04px at W620** or **14.07px at W512**. Per-line hint X coordinates intentionally differ to follow tapered paths. Do not flatten the hintXs arrays back to one x value.

The 290px orb canvas, whose renderer draws its visible sphere to 48% of canvas size, yields an actual sphere radius **139.2 units**, with a **9.8-unit gap to the r149 rim**; this is acceptable room for the halo. The r145 target is approximate and must not trigger a renderer/filament redesign. At W620 the sphere radius is123.3px; at W512 it is101.8px.

Typography scales with the SVG. At W620, labels/hints render ~15.1px/11.1px; at W512, ~12.4px/9.1px. Main controls remain legible, but hints at W512 are small; prioritize labels and treat hints as supplemental (never the sole accessible name).
