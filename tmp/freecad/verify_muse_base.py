"""Reopen exported files in a new headless FreeCAD process and test editability."""

import json
import math
import sys
from pathlib import Path

sys.path.append('/Applications/FreeCAD.app/Contents/Resources/lib')
import FreeCAD as App
import Part
import Mesh

folder = Path(__file__).resolve().parents[2] / 'output' / 'freecad'
stem = 'muse-bot-base-rev-a'
doc = App.openDocument(str(folder / (stem + '.FCStd')))
sk = doc.getObject('BaseOutline')
pad = doc.getObject('DeckPad')
params = doc.getObject('Parameters')
doc.recompute()
assert sk.FullyConstrained and sk.solve() == 0
assert pad.Shape.isValid() and len(pad.Shape.Solids) == 1
assert all(abs(actual - wanted) < 1e-7 for actual, wanted in zip(
    (pad.Shape.BoundBox.XLength, pad.Shape.BoundBox.YLength, pad.Shape.BoundBox.ZLength), (250, 220, 5)))
expected_volume = (250 * 220 - (4 - math.pi) * 12 ** 2) * 5
assert abs(pad.Shape.Volume - expected_volume) < 1e-6

# Editing the controlling dimensions must change the solid, not just its label.
for prop, value in [('DeckLength', 260), ('DeckWidth', 230), ('CornerRadius', 15), ('DeckThickness', 6)]:
    setattr(params, prop, value)
doc.recompute()
assert sk.FullyConstrained and sk.solve() == 0
assert pad.Shape.isValid() and len(pad.Shape.Solids) == 1
bounds = pad.Shape.BoundBox
assert all(abs(actual - wanted) < 1e-7 for actual, wanted in zip(
    (bounds.XLength, bounds.YLength, bounds.ZLength), (260, 230, 6)))
assert abs(pad.Shape.Volume - (260 * 230 - (4 - math.pi) * 15 ** 2) * 6) < 1e-6
# Do not save the dimension-change test: the delivered document remains 250×220×5.
App.closeDocument(doc.Name)

step = Part.Shape()
step.read(str(folder / (stem + '.step')))
assert step.isValid() and len(step.Solids) == 1
assert abs(step.Volume - expected_volume) < 1e-5
stl = Mesh.Mesh(str(folder / (stem + '.stl')))
assert stl.isSolid()
assert all(abs(actual - wanted) < 1e-4 for actual, wanted in zip(
    (stl.BoundBox.XLength, stl.BoundBox.YLength, stl.BoundBox.ZLength), (250, 220, 5)))
print(json.dumps({'reopened_fcstd': True, 'parameter_edit_test': True,
                  'step_valid_solid': True, 'stl_watertight': True,
                  'delivered_dimensions_mm': [250, 220, 5]}))
