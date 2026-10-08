# MUSE base — native FreeCAD fit prototype

Open `muse-bot-base-rev-a.FCStd` in FreeCAD. This is an editable native
Sketcher/PartDesign document, not an image imported as a sketch.

## What is modelled

- One rounded plate: **250 mm front-to-rear × 220 mm across × 5 mm thick**, R12 corners.
- A fully constrained outline with tangencies, equal radii, and driving dimensions.
- The `Parameters` object drives length, width, radius, and thickness through expressions.
- Construction-only sketches under `LayoutReferences` preserve the earlier planning
  envelopes and caster/axle/display datums. Open an individual reference sketch to inspect it.
- The STEP and STL exports contain the plate only, never the reference envelopes.

The CAD origin is the virtual front-left bounding corner. +X is rearward, +Y is
across the plate, and Z=0 is the bottom of this standalone part. Construction
references are fixed Rev A planning geometry, not an automatically resizing assembly.

## Important limits

This is a **fit prototype, not a production-ready complete chassis**. There are
no assumed mounting holes, inserts, motor/caster brackets, rim, bumper, or screen
supports. Those need the actual hardware dimensions. The original drawing's
22 mm ground clearance is an assembly target, not verified by this standalone plate.

The 250 × 220 starting envelope comes from the existing build kit's
`docs/display.md`; the R12 corners, 5 mm plate and component locations come from
the existing MB-BASE-001 Rev A planning drawing. They are design proposals, not
measurements of Kai's hardware. The STL uses millimetres; confirm 250 × 220 × 5
in the slicer and check the printer's usable bed plus brim margin.

Prototype in PETG first, as specified in the prior manufacturing sketch. A later
PA12-CF print requires a compatible printer and supplier-specific settings;
carbon-filled nylon is not a carbon-fibre laminate. Neither material nor this
design has been load-, stability-, or print-tested. Keep electronics insulated.

## Editing and validation

Select `Parameters` and edit its dimensions in the Data tab, then recompute.
Keep the radius positive and below half the smaller deck dimension. Double-click
`BaseOutline` to inspect its constraints; `DeckPad` is the thickness feature.

`muse-bot-base-rev-a-validation.json` records the CAD engine and mesh checks.
The native file is independently reopened and all four parameters are changed
in memory to confirm the model recomputes; that test is not saved. STEP and STL
are also independently reloaded and checked.

`build-muse-base.FCMacro` is the reproducible builder. It refuses to overwrite
existing outputs; copy it into a fresh folder before rerunning it.
