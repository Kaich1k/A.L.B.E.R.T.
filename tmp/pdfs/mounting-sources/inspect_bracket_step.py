import json
import sys
from pathlib import Path

sys.path.append('/Applications/FreeCAD.app/Contents/Resources/lib')
import FreeCAD as App
import Part

shape = Part.Shape()
shape.read(str(Path(__file__).with_name('pololu-2676.step')))
circles = {}
for edge in shape.Edges:
    curve = edge.Curve
    if isinstance(curve, Part.Circle):
        key = tuple(round(v, 6) for v in (curve.Radius, curve.Center.x,
                   curve.Center.y, curve.Center.z, curve.Axis.x, curve.Axis.y, curve.Axis.z))
        circles[key] = {'radius': key[0], 'center': list(key[1:4]), 'axis': list(key[4:])}
print(json.dumps({'valid': shape.isValid(), 'bounds': str(shape.BoundBox),
                  'circular_edges': list(circles.values())}, indent=2))
