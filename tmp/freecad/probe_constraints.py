import math
import sys

sys.path.append('/Applications/FreeCAD.app/Contents/Resources/lib')
import FreeCAD as App
import Part
import Sketcher

doc = App.newDocument('ConstraintProbe')
sk = doc.addObject('Sketcher::SketchObject', 'Outline')
V = lambda x, y: App.Vector(x, y, 0)
L, W, R = 250.0, 220.0, 12.0
geometry = [
    Part.LineSegment(V(R, 0), V(L-R, 0)),
    Part.ArcOfCircle(Part.Circle(V(L-R, R), App.Vector(0, 0, 1), R), -math.pi/2, 0),
    Part.LineSegment(V(L, R), V(L, W-R)),
    Part.ArcOfCircle(Part.Circle(V(L-R, W-R), App.Vector(0, 0, 1), R), 0, math.pi/2),
    Part.LineSegment(V(L-R, W), V(R, W)),
    Part.ArcOfCircle(Part.Circle(V(R, W-R), App.Vector(0, 0, 1), R), math.pi/2, math.pi),
    Part.LineSegment(V(0, W-R), V(0, R)),
    Part.ArcOfCircle(Part.Circle(V(R, R), App.Vector(0, 0, 1), R), math.pi, 3*math.pi/2),
]
sk.addGeometry(geometry, False)
constraints = [Sketcher.Constraint('Tangent', i, 2, (i+1)%8, 1) for i in range(8)]
constraints += [Sketcher.Constraint('Horizontal', i) for i in (0, 4)]
constraints += [Sketcher.Constraint('Vertical', i) for i in (2, 6)]
constraints += [Sketcher.Constraint('Equal', 1, i) for i in (3, 5, 7)]
constraints += [
    Sketcher.Constraint('Radius', 1, R),
    Sketcher.Constraint('DistanceX', 0, 1, R),
    Sketcher.Constraint('PointOnObject', 0, 1, -1),
    Sketcher.Constraint('Distance', 0, L-2*R),
    Sketcher.Constraint('Distance', 2, W-2*R),
]
sk.addConstraint(constraints)
doc.recompute()
print('solve', sk.solve(), 'fully', sk.FullyConstrained, 'dof', sk.SolverMessages if hasattr(sk, 'SolverMessages') else '?')
print('bounds', sk.Shape.BoundBox, 'closed', sk.Shape.Wires[0].isClosed())
body = doc.addObject('PartDesign::Body', 'Body')
body.addObject(sk)
pad = body.newObject('PartDesign::Pad', 'Pad')
pad.Profile = sk
pad.Length = 5
doc.recompute()
print('pad', pad.Shape.isValid(), len(pad.Shape.Solids), pad.Shape.Volume, pad.State)
