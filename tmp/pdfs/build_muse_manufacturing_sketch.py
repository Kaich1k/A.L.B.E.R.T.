from math import cos, pi, sin
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle


OUT = Path("output/pdf/muse-bot-base-manufacturing-sketch.pdf")
PAGE_W, PAGE_H = landscape(A3)

INK = colors.HexColor("#16313F")
MID = colors.HexColor("#4F6975")
BLUE = colors.HexColor("#007AA6")
CYAN = colors.HexColor("#00A9CF")
ORANGE = colors.HexColor("#E77728")
PALE = colors.HexColor("#EAF4F7")
PALE_BLUE = colors.HexColor("#DDF2F8")
GRID = colors.HexColor("#B9CBD2")
WHITE = colors.white


def arrow(c, x, y, dx, dy, size=4.2):
    mag = (dx * dx + dy * dy) ** 0.5 or 1
    ux, uy = dx / mag, dy / mag
    nx, ny = -uy, ux
    c.setFillColor(BLUE)
    p = c.beginPath()
    p.moveTo(x, y)
    p.lineTo(x + ux * size + nx * size * 0.48, y + uy * size + ny * size * 0.48)
    p.lineTo(x + ux * size - nx * size * 0.48, y + uy * size - ny * size * 0.48)
    p.close()
    c.drawPath(p, fill=1, stroke=0)


def dim_h(c, x1, x2, dim_y, witness_y, label, font=7):
    c.saveState()
    c.setStrokeColor(BLUE)
    c.setLineWidth(0.55)
    c.line(x1, witness_y, x1, dim_y)
    c.line(x2, witness_y, x2, dim_y)
    c.line(x1, dim_y, x2, dim_y)
    arrow(c, x1, dim_y, 1, 0)
    arrow(c, x2, dim_y, -1, 0)
    tw = stringWidth(label, "Helvetica-Bold", font)
    c.setFillColor(WHITE)
    c.rect((x1 + x2 - tw) / 2 - 2, dim_y - 4, tw + 4, 8, fill=1, stroke=0)
    c.setFillColor(BLUE)
    c.setFont("Helvetica-Bold", font)
    c.drawCentredString((x1 + x2) / 2, dim_y - 2.4, label)
    c.restoreState()


def dim_v(c, y1, y2, dim_x, witness_x, label, font=7):
    c.saveState()
    c.setStrokeColor(BLUE)
    c.setLineWidth(0.55)
    c.line(witness_x, y1, dim_x, y1)
    c.line(witness_x, y2, dim_x, y2)
    c.line(dim_x, y1, dim_x, y2)
    arrow(c, dim_x, y1, 0, 1)
    arrow(c, dim_x, y2, 0, -1)
    c.translate(dim_x + 3, (y1 + y2) / 2)
    c.rotate(90)
    tw = stringWidth(label, "Helvetica-Bold", font)
    c.setFillColor(WHITE)
    c.rect(-tw / 2 - 2, -4, tw + 4, 8, fill=1, stroke=0)
    c.setFillColor(BLUE)
    c.setFont("Helvetica-Bold", font)
    c.drawCentredString(0, -2.4, label)
    c.restoreState()


def center_mark(c, x, y, r=3):
    c.saveState()
    c.setStrokeColor(BLUE)
    c.setLineWidth(0.45)
    c.line(x - r, y, x + r, y)
    c.line(x, y - r, x, y + r)
    c.circle(x, y, r * 0.45, fill=0, stroke=1)
    c.restoreState()


def label(c, x, y, text, size=6.3, color=INK, bold=False, angle=0):
    c.saveState()
    c.translate(x, y)
    c.rotate(angle)
    c.setFillColor(color)
    c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
    c.drawString(0, 0, text)
    c.restoreState()


def leader(c, x1, y1, x2, y2, text, align="left"):
    c.saveState()
    c.setStrokeColor(MID)
    c.setFillColor(MID)
    c.setLineWidth(0.45)
    c.line(x1, y1, x2, y2)
    c.circle(x1, y1, 1.4, fill=1, stroke=0)
    c.setFont("Helvetica", 6.4)
    if align == "right":
        c.drawRightString(x2 - 2, y2 + 2, text)
    else:
        c.drawString(x2 + 2, y2 + 2, text)
    c.restoreState()


def note_box(c, x, y, w, h, title, lines, accent=BLUE):
    c.saveState()
    c.setStrokeColor(GRID)
    c.setFillColor(colors.HexColor("#F8FBFC"))
    c.roundRect(x, y, w, h, 4, fill=1, stroke=1)
    c.setFillColor(accent)
    c.roundRect(x, y + h - 17, w, 17, 4, fill=1, stroke=0)
    c.rect(x, y + h - 17, w, 5, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x + 7, y + h - 11.5, title)
    ty = y + h - 29
    c.setFillColor(INK)
    c.setFont("Helvetica", 7)
    for line in lines:
        if line == "":
            ty -= 5
            continue
        c.drawString(x + 8, ty, line)
        ty -= 10
    c.restoreState()


def page_header(c, sheet_no, title, subtitle):
    c.saveState()
    c.setStrokeColor(INK)
    c.setLineWidth(0.8)
    c.line(14 * mm, PAGE_H - 16 * mm, PAGE_W - 14 * mm, PAGE_H - 16 * mm)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(14 * mm, PAGE_H - 11 * mm, title)
    c.setFillColor(MID)
    c.setFont("Helvetica", 7.5)
    c.drawString(14 * mm, PAGE_H - 14.2 * mm, subtitle)
    c.setFillColor(BLUE)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawRightString(PAGE_W - 14 * mm, PAGE_H - 11.2 * mm, f"SHEET {sheet_no} OF 3")
    c.restoreState()


def title_block(c, sheet_no, scale_note):
    x, y, w, h = 14 * mm, 7 * mm, PAGE_W - 28 * mm, 16 * mm
    c.saveState()
    c.setStrokeColor(INK)
    c.setLineWidth(0.65)
    c.setFillColor(WHITE)
    c.rect(x, y, w, h, fill=1, stroke=1)
    cuts = [x + 150 * mm, x + 245 * mm, x + 300 * mm, x + 344 * mm]
    for cut in cuts:
        c.line(cut, y, cut, y + h)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(x + 5, y + 9, "MUSE BOT BASE — MANUFACTURING SKETCH")
    c.setFont("Helvetica", 6.5)
    c.setFillColor(MID)
    c.drawString(x + 5, y + 3.5, "Planning drawing; verify purchased hardware before production")
    fields = [
        (cuts[0] + 5, "DRAWING", "MB-BASE-001"),
        (cuts[1] + 5, "REV", "A"),
        (cuts[2] + 5, "UNITS", "mm"),
        (cuts[3] + 5, "SCALE", scale_note),
    ]
    for fx, head, value in fields:
        c.setFont("Helvetica-Bold", 5.8)
        c.setFillColor(MID)
        c.drawString(fx, y + 10.2, head)
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(INK)
        c.drawString(fx, y + 3.5, value)
    c.setFillColor(BLUE)
    c.setFont("Helvetica-Bold", 6.5)
    c.drawRightString(x + w - 5, y + 3.5, f"2026-10-04  •  {sheet_no}/3")
    c.restoreState()


def drawing_frame(c):
    c.saveState()
    c.setStrokeColor(GRID)
    c.setLineWidth(0.4)
    c.rect(7 * mm, 5 * mm, PAGE_W - 14 * mm, PAGE_H - 10 * mm, fill=0, stroke=1)
    c.restoreState()


def top_view(c):
    page_header(c, 1, "GENERAL ARRANGEMENT — TOP VIEW", "Controlled layout dimensions and reserved component envelopes")
    drawing_frame(c)

    x0, y0, s = 18 * mm, 43 * mm, mm
    X = lambda value: x0 + value * s
    Y = lambda value: y0 + value * s

    # Deck and datums
    c.setFillColor(colors.HexColor("#F7FAFB"))
    c.setStrokeColor(INK)
    c.setLineWidth(1.1)
    c.roundRect(X(0), Y(0), 250 * s, 220 * s, 12 * s, fill=1, stroke=1)
    c.setDash(3, 2)
    c.setStrokeColor(GRID)
    c.line(X(0), Y(110), X(250), Y(110))
    c.line(X(165), Y(-13), X(165), Y(233))
    c.setDash()
    label(c, X(2), Y(213), "DATUM A: FRONT EDGE", 6, BLUE, True)
    label(c, X(222), Y(3), "R12", 6.2, BLUE, True)

    # Wheels and motors
    c.setFillColor(INK)
    c.setStrokeColor(INK)
    c.roundRect(X(125), Y(-13), 80 * s, 10 * s, 3 * s, fill=1, stroke=1)
    c.roundRect(X(125), Y(223), 80 * s, 10 * s, 3 * s, fill=1, stroke=1)
    c.setFillColor(colors.HexColor("#D4E1E6"))
    c.setStrokeColor(MID)
    c.roundRect(X(152.5), Y(0), 25 * s, 69 * s, 4 * s, fill=1, stroke=1)
    c.roundRect(X(152.5), Y(151), 25 * s, 69 * s, 4 * s, fill=1, stroke=1)
    label(c, X(158), Y(24), "Ø25 MOTOR", 6, INK, True, 90)
    label(c, X(171), Y(161), "Ø25 MOTOR", 6, INK, True, 90)
    center_mark(c, X(165), Y(-8), 3.5)
    center_mark(c, X(165), Y(228), 3.5)

    # Caster and front sensors
    c.setFillColor(PALE_BLUE)
    c.setStrokeColor(BLUE)
    c.circle(X(35), Y(110), 16 * s, fill=1, stroke=1)
    center_mark(c, X(35), Y(110), 4)
    c.setDash(3, 2)
    c.roundRect(X(22), Y(98), 26 * s, 24 * s, 3 * s, fill=0, stroke=1)
    c.setDash()
    label(c, X(20), Y(88), "CASTER RESERVE", 6, BLUE, True)
    c.setFillColor(ORANGE)
    c.setStrokeColor(ORANGE)
    c.roundRect(X(2), Y(103.5), 18 * s, 13 * s, 2 * s, fill=1, stroke=0)
    label(c, X(2), Y(119), "VL53L1X", 5.8, ORANGE, True)
    c.setLineCap(1)
    c.setStrokeColor(CYAN)
    c.setLineWidth(6.5)
    c.line(X(-10), Y(20), X(-10), Y(200))
    c.setLineWidth(0.6)
    label(c, X(-6), Y(20), "TPU / TUBE BUMPER", 5.8, CYAN, True, 90)

    # Component reservation envelopes
    def envelope(x, y, w, h, title, subtitle, fill=PALE):
        c.setFillColor(fill)
        c.setStrokeColor(MID)
        c.setLineWidth(0.65)
        c.roundRect(X(x), Y(y), w * s, h * s, 3 * s, fill=1, stroke=1)
        label(c, X(x + 3), Y(y + h - 7), title, 6.3, INK, True)
        label(c, X(x + 3), Y(y + h - 13), subtitle, 5.6, MID)

    envelope(47, 18, 75, 60, "UNO R4 RESERVE", "75 × 60 envelope")
    envelope(72.5, 77, 75, 70, "4×AA BATTERY", "75 × 70 reserve")
    envelope(60, 163, 58, 50, "MDD3A", "58 × 50 reserve")
    envelope(145, 77.5, 95, 65, "PI 5 / COOLER", "95 × 65 airflow zone", PALE_BLUE)
    c.setFillColor(ORANGE)
    c.circle(X(42), Y(185), 8 * s, fill=1, stroke=0)
    label(c, X(53), Y(183), "POWER CUTOFF", 6, ORANGE, True)

    # Display hinge and projected footprint
    c.setStrokeColor(CYAN)
    c.setLineWidth(1.4)
    c.line(X(195), Y(15.25), X(195), Y(204.75))
    c.setDash(5, 3)
    c.setFillColor(colors.Color(0, 0.66, 0.81, alpha=0.06))
    c.roundRect(X(195), Y(15.25), 41 * s, 189.5 * s, 2 * s, fill=1, stroke=1)
    c.setDash()
    label(c, X(198), Y(207), "DISPLAY HINGE — 189.5 SPAN", 6.2, CYAN, True)
    label(c, X(198), Y(18), "DASHED = 20° TILT PROJECTION", 5.7, CYAN)

    # Dimensions
    dim_h(c, X(0), X(250), Y(-19), Y(0), "250 DECK")
    dim_h(c, X(0), X(35), Y(14), Y(28), "35")
    dim_h(c, X(0), X(165), Y(236), Y(220), "165 AXLE")
    dim_h(c, X(0), X(195), Y(228), Y(220), "195 HINGE")
    dim_v(c, Y(0), Y(220), X(260), X(250), "220 DECK")
    dim_v(c, Y(-13), Y(233), X(268), X(205), "246 O/A")

    # Coordinate and front direction
    c.setStrokeColor(ORANGE)
    c.setFillColor(ORANGE)
    c.setLineWidth(1.2)
    c.line(X(10), Y(110), X(-3), Y(110))
    arrow(c, X(-3), Y(110), -1, 0, 6)
    label(c, X(4), Y(114), "FRONT", 7, ORANGE, True)

    # Right notes panel
    px = 282 * mm
    pw = 124 * mm
    note_box(c, px, 207 * mm, pw, 60 * mm, "CONTROLLED DIMENSIONS", [
        "Deck: 250 L × 220 W × 5 thick",
        "Corner radius: R12",
        "Drive axle: X = 165 from front datum",
        "Caster center: X = 35, Y = 110",
        "Display hinge: X = 195; centered on Y",
        "Nominal wheel envelope: 246 overall",
    ])
    note_box(c, px, 137 * mm, pw, 61 * mm, "LAYOUT RULES", [
        "Battery low and centered, ahead of axle.",
        "Keep Pi cooler airflow zone unobstructed.",
        "Use slots for caster and motor brackets.",
        "Route motor wiring away from EEG leads.",
        "All electronics on insulating standoffs.",
        "Do not drill from this sheet until verified.",
    ], ORANGE)
    note_box(c, px, 68 * mm, pw, 60 * mm, "DATUM / COORDINATE SYSTEM", [
        "Origin: front-left deck corner.",
        "+X runs front → rear; +Y left → right.",
        "Centerline: Y = 110.",
        "Bottom face of deck is datum Z = 22.",
        "Dimensions are nominal millimetres.",
        "Drawing scale: 1:1 on A3 when printed 100%.",
    ], CYAN)
    note_box(c, px, 27 * mm, pw, 32 * mm, "REV A STATUS", [
        "Layout-ready, not hole-ready.",
        "Measure the actual caster, brackets and",
        "display mounts before the final print.",
    ], INK)

    title_block(c, 1, "1:1")
    c.showPage()


def side_and_front(c):
    page_header(c, 2, "ELEVATIONS & PRINT-BED SPLIT", "Side/front geometry, clearances, display angle and optional two-piece joint")
    drawing_frame(c)

    # SIDE VIEW — 0.72:1
    s = 0.72 * mm
    ox, gy = 20 * mm, 145 * mm
    X = lambda value: ox + (value + 10) * s
    Z = lambda value: gy + value * s
    label(c, 20 * mm, 270 * mm, "SIDE ELEVATION", 9, INK, True)
    label(c, 20 * mm, 266 * mm, "Scale 0.72:1", 6.5, MID)

    c.setStrokeColor(GRID)
    c.setLineWidth(0.7)
    c.line(X(-14), Z(0), X(258), Z(0))
    label(c, X(225), Z(2), "GROUND", 6, MID, True)

    # Wheel and caster
    c.setFillColor(colors.HexColor("#D9E3E7"))
    c.setStrokeColor(INK)
    c.setLineWidth(1.0)
    c.circle(X(165), Z(40), 40 * s, fill=1, stroke=1)
    c.setFillColor(WHITE)
    c.circle(X(165), Z(40), 10 * s, fill=1, stroke=1)
    center_mark(c, X(165), Z(40), 4)
    c.setFillColor(PALE_BLUE)
    c.circle(X(35), Z(16), 16 * s, fill=1, stroke=1)
    center_mark(c, X(35), Z(16), 3)

    # Deck and perimeter lip
    c.setFillColor(colors.HexColor("#F7FAFB"))
    c.setStrokeColor(INK)
    c.rect(X(0), Z(22), 250 * s, 5 * s, fill=1, stroke=1)
    c.setFillColor(PALE)
    c.rect(X(0), Z(27), 3 * s, 22 * s, fill=1, stroke=1)
    c.rect(X(247), Z(27), 3 * s, 22 * s, fill=1, stroke=1)

    # Battery and electronics zones
    c.setFillColor(PALE)
    c.setStrokeColor(MID)
    c.roundRect(X(76), Z(27), 75 * s, 20 * s, 3 * s, fill=1, stroke=1)
    label(c, X(88), Z(35), "4×AA HOLDER", 6, INK, True)
    c.setFillColor(PALE_BLUE)
    c.roundRect(X(157), Z(27), 84 * s, 18 * s, 3 * s, fill=1, stroke=1)
    label(c, X(171), Z(34), "PI / COOLER ZONE", 6, INK, True)

    # Bumper
    c.setFillColor(CYAN)
    c.setStrokeColor(CYAN)
    c.circle(X(-7), Z(34), 7 * s, fill=1, stroke=0)
    leader(c, X(-7), Z(34), X(8), Z(60), "Ø14 TPU / TUBE BUMPER")

    # Screen and bracket
    hinge_x, hinge_z = 195, 57
    theta = 20 * pi / 180
    dx, dz = sin(theta), cos(theta)
    nx, nz = -dz, dx
    half_t = 7.5
    bottom_a = (hinge_x + nx * half_t, hinge_z + nz * half_t)
    bottom_b = (hinge_x - nx * half_t, hinge_z - nz * half_t)
    top_c = (hinge_x + dx * 120 - nx * half_t, hinge_z + dz * 120 - nz * half_t)
    top_d = (hinge_x + dx * 120 + nx * half_t, hinge_z + dz * 120 + nz * half_t)
    p = c.beginPath()
    p.moveTo(X(bottom_a[0]), Z(bottom_a[1]))
    p.lineTo(X(bottom_b[0]), Z(bottom_b[1]))
    p.lineTo(X(top_c[0]), Z(top_c[1]))
    p.lineTo(X(top_d[0]), Z(top_d[1]))
    p.close()
    c.setFillColor(colors.HexColor("#CCEAF2"))
    c.setStrokeColor(CYAN)
    c.setLineWidth(1.1)
    c.drawPath(p, fill=1, stroke=1)
    c.setFillColor(INK)
    c.circle(X(hinge_x), Z(hinge_z), 4 * s, fill=1, stroke=0)
    leader(c, X(hinge_x + 18), Z(hinge_z + 70), X(250), Z(120), "7-IN DISPLAY: 120 × 15 SECTION")

    # Angle reference
    c.setStrokeColor(BLUE)
    c.setDash(2, 2)
    c.line(X(hinge_x), Z(hinge_z), X(hinge_x), Z(hinge_z + 55))
    c.setDash()
    c.setLineWidth(0.7)
    c.arc(X(hinge_x - 25), Z(hinge_z + 12), X(hinge_x + 25), Z(hinge_z + 62), 70, 20)
    label(c, X(202), Z(87), "20°", 7, BLUE, True)

    # Side dimensions
    dim_v(c, Z(0), Z(22), X(55), X(68), "22 CLR")
    dim_v(c, Z(22), Z(27), X(245), X(250), "5")
    dim_v(c, Z(0), Z(172.5), X(262), X(236), "≈172 O/A")
    dim_h(c, X(0), X(165), Z(-14), Z(0), "165 AXLE")
    dim_h(c, X(-10), X(250), Z(-26), Z(0), "260 O/A NOM.")
    dim_h(c, X(0), X(195), Z(61), Z(49), "195 HINGE")
    leader(c, X(125), Z(24.5), X(112), Z(9), "5 mm STRUCTURAL DECK")

    # FRONT VIEW — 0.50:1
    sf = 0.50 * mm
    fx, fg = 20 * mm, 33 * mm
    Y = lambda value: fx + (value + 13) * sf
    FZ = lambda value: fg + value * sf
    c.setStrokeColor(GRID)
    c.line(Y(-18), FZ(0), Y(238), FZ(0))
    c.setFillColor(INK)
    c.setStrokeColor(INK)
    c.roundRect(Y(-13), FZ(0), 10 * sf, 80 * sf, 2 * sf, fill=1, stroke=1)
    c.roundRect(Y(223), FZ(0), 10 * sf, 80 * sf, 2 * sf, fill=1, stroke=1)
    c.setFillColor(colors.HexColor("#F7FAFB"))
    c.rect(Y(0), FZ(22), 220 * sf, 5 * sf, fill=1, stroke=1)
    c.setFillColor(colors.HexColor("#CCEAF2"))
    c.setStrokeColor(CYAN)
    c.rect(Y(15.25), FZ(57), 189.5 * sf, 120 * sf, fill=1, stroke=1)
    c.setFillColor(INK)
    c.circle(Y(110), FZ(57), 3.5 * sf, fill=1, stroke=0)
    c.setDash(3, 2)
    c.setStrokeColor(GRID)
    c.line(Y(110), FZ(0), Y(110), FZ(184))
    c.setDash()
    dim_h(c, Y(-13), Y(233), FZ(-12), FZ(0), "246 O/A NOM.")
    dim_h(c, Y(15.25), Y(204.75), FZ(167), FZ(177), "189.5 DISPLAY")
    dim_h(c, Y(0), Y(220), FZ(33), FZ(27), "220 DECK")
    label(c, Y(63), FZ(90), "DISPLAY CENTERED", 6, CYAN, True)
    label(c, 145 * mm, 118 * mm, "FRONT ELEVATION", 9, INK, True)
    label(c, 145 * mm, 114 * mm, "Scale 0.50:1", 6.5, MID)

    # Split detail panel
    bx, by, bw, bh = 182 * mm, 27 * mm, 224 * mm, 91 * mm
    c.setFillColor(colors.HexColor("#F8FBFC"))
    c.setStrokeColor(GRID)
    c.roundRect(bx, by, bw, bh, 5, fill=1, stroke=1)
    label(c, bx + 8, by + bh - 15, "OPTIONAL TWO-PIECE BASE — FOR BEDS <260 × 230", 8.5, INK, True)
    label(c, bx + 8, by + bh - 27, "Split at X = 125; 30 mm overlapping lap joint", 7, MID)
    jx, jy = bx + 18, by + 28
    js = 2.2
    c.setFillColor(PALE_BLUE)
    c.setStrokeColor(INK)
    p = c.beginPath()
    p.moveTo(jx, jy)
    p.lineTo(jx + 110 * js, jy)
    p.lineTo(jx + 110 * js, jy + 10 * js)
    p.lineTo(jx + 80 * js, jy + 10 * js)
    p.lineTo(jx + 80 * js, jy + 5 * js)
    p.lineTo(jx, jy + 5 * js)
    p.close()
    c.drawPath(p, fill=1, stroke=1)
    c.setFillColor(PALE)
    p = c.beginPath()
    p.moveTo(jx + 80 * js, jy + 5 * js)
    p.lineTo(jx + 190 * js, jy + 5 * js)
    p.lineTo(jx + 190 * js, jy + 10 * js)
    p.lineTo(jx + 110 * js, jy + 10 * js)
    p.lineTo(jx + 110 * js, jy + 15 * js)
    p.lineTo(jx + 80 * js, jy + 15 * js)
    p.close()
    c.drawPath(p, fill=1, stroke=1)
    for hx in (88, 102):
        c.setFillColor(ORANGE)
        c.circle(jx + hx * js, jy + 10 * js, 2.2, fill=1, stroke=0)
    dim_h(c, jx + 80 * js, jx + 110 * js, jy + 26, jy + 15 * js, "30 LAP", 6.5)
    label(c, bx + 8, by + 15, "4× M4 through-bolts + washers; 2× Ø5 alignment dowels. Keep joint clear of battery and axle brackets.", 6.5, INK)

    title_block(c, 2, "AS NOTED")
    c.showPage()


def paragraph(text, size=7, color=INK, bold=False):
    return Paragraph(
        text,
        ParagraphStyle(
            name="cell",
            fontName="Helvetica-Bold" if bold else "Helvetica",
            fontSize=size,
            leading=size + 2,
            textColor=color,
            alignment=TA_LEFT,
            spaceAfter=0,
            spaceBefore=0,
        ),
    )


def styled_table(c, data, x, y_top, widths, row_heights=None, header=True):
    table = Table(data, colWidths=widths, rowHeights=row_heights, hAlign="LEFT")
    style = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.45, GRID),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("BACKGROUND", (0, 1 if header else 0), (-1, -1), colors.white),
        ("ROWBACKGROUNDS", (0, 1 if header else 0), (-1, -1), [colors.white, colors.HexColor("#F7FAFB")]),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), INK),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
        ]
    table.setStyle(TableStyle(style))
    tw, th = table.wrapOn(c, sum(widths), PAGE_H)
    table.drawOn(c, x, y_top - th)
    return th


def schedules(c):
    page_header(c, 3, "MANUFACTURING SCHEDULE & RELEASE CHECKS", "Material, fit, mounting and verification notes for Rev A")
    drawing_frame(c)

    margin = 15 * mm
    col_gap = 8 * mm
    left_w = 190 * mm
    right_x = margin + left_w + col_gap
    right_w = PAGE_W - margin - right_x

    label(c, margin, 269 * mm, "A. CONTROLLED GEOMETRY", 9, INK, True)
    dims = [
        [paragraph("FEATURE", 6.5, WHITE, True), paragraph("NOMINAL", 6.5, WHITE, True), paragraph("DESIGN INTENT", 6.5, WHITE, True)],
        [paragraph("Main deck"), paragraph("250 × 220 × 5"), paragraph("PA12-CF structural plate; R12 corners")],
        [paragraph("Perimeter wall"), paragraph("3 thick × 22 high"), paragraph("Local wall may be omitted at wheels and hinge")],
        [paragraph("Ground clearance"), paragraph("22"), paragraph("Confirm after caster selection and wheel loading")],
        [paragraph("Drive axle"), paragraph("X = 165; Z = 40"), paragraph("Use adjustable motor-bracket slots")],
        [paragraph("Caster center"), paragraph("X = 35; Y = 110"), paragraph("Reserve Ø32 zone; slot pattern after purchase")],
        [paragraph("Display hinge"), paragraph("X = 195; Z = 57"), paragraph("20° rearward from vertical; 189.5 span")],
        [paragraph("Nominal envelope"), paragraph("260 L × 246 W × 172 H"), paragraph("Includes bumper, wheels and raised display")],
    ]
    h1 = styled_table(c, dims, margin, 264 * mm, [46 * mm, 38 * mm, 106 * mm])

    y2 = 264 * mm - h1 - 11 * mm
    label(c, margin, y2, "B. HARDWARE ENVELOPES", 9, INK, True)
    parts = [
        [paragraph("ITEM", 6.5, WHITE, True), paragraph("REFERENCE SIZE", 6.5, WHITE, True), paragraph("CAD / MOUNT TREATMENT", 6.5, WHITE, True)],
        [paragraph("7-in Touch Display 2"), paragraph("189.5 × 120 × 15"), paragraph("Model exact outer envelope; verify rear boss pattern")],
        [paragraph("Raspberry Pi 5"), paragraph("85 × 56"), paragraph("Reserve 95 × 65 with active-cooler airflow")],
        [paragraph("Arduino Uno R4 WiFi"), paragraph("68.58 × 53.34"), paragraph("Reserve 75 × 60; locate holes from physical board")],
        [paragraph("MDD3A driver"), paragraph("48.26 × 41.66"), paragraph("Reserve 58 × 50; 4× Ø3 board holes")],
        [paragraph("INA260 carrier"), paragraph("22.9 × 22.8 × 2.7"), paragraph("Nylon M2.5/M3 standoffs or adhesive carrier")],
        [paragraph("VL53L1X carrier"), paragraph("13 × 18 × 2"), paragraph("Front-facing; removable two-screw carrier")],
        [paragraph("4×AA holder"), paragraph("≈71 × 65 × 20"), paragraph("Reserve 75 × 70; strap slots, not fixed holes")],
        [paragraph("Gearmotor / wheel"), paragraph("Ø25 × 69 / Ø80 × 10"), paragraph("4 mm shaft; verify hub offset and bracket")],
    ]
    h2 = styled_table(c, parts, margin, y2 - 5 * mm, [53 * mm, 42 * mm, 95 * mm])

    y3 = y2 - 5 * mm - h2 - 10 * mm
    label(c, margin, y3, "C. HOLE & FEATURE STANDARD", 9, INK, True)
    holes = [
        [paragraph("FEATURE", 6.5, WHITE, True), paragraph("SIZE", 6.5, WHITE, True), paragraph("USE", 6.5, WHITE, True)],
        [paragraph("M3 clearance"), paragraph("Ø3.4"), paragraph("Boards and light brackets")],
        [paragraph("M4 clearance"), paragraph("Ø4.5"), paragraph("Split joint and structural brackets")],
        [paragraph("M3 adjustment slot"), paragraph("4 × 12"), paragraph("Motor/display bracket tuning")],
        [paragraph("M4/caster slot"), paragraph("5 × 15"), paragraph("Caster height and tracking adjustment")],
        [paragraph("Cable channel"), paragraph("8 W × 6 D min."), paragraph("Add R2 floor fillets and strain relief")],
    ]
    styled_table(c, holes, margin, y3 - 5 * mm, [55 * mm, 40 * mm, 95 * mm])

    label(c, right_x, 269 * mm, "D. MATERIAL & PRINT PROCESS", 9, INK, True)
    material_lines = [
        "Final structure: PA12-CF (carbon-fibre-filled nylon).",
        "Prototype first in PETG before committing to PA12-CF.",
        "TPU 95A for the bumper and vibration-isolation pads.",
        "Use brass heat-set inserts; pilot diameters must follow the insert supplier.",
        "Starting profile: 0.6 mm hardened nozzle, 5 walls, 6 top/bottom layers, 30–40% gyroid.",
        "Dry PA12-CF and follow the filament maker's enclosure/nozzle guidance.",
        "Use nylon standoffs or insulating washers beneath every circuit board.",
        "Carbon-filled polymers can be electrically conductive: keep copper, solder joints and antennas isolated.",
    ]
    note_box(c, right_x, 193 * mm, right_w, 71 * mm, "RECOMMENDED BUILD", material_lines, BLUE)

    tol_lines = [
        "General printed dimensions: ±0.5 mm unless noted.",
        "Hole position after calibration: ±0.3 mm target.",
        "Minimum wall: 3 mm. Structural deck: 5 mm.",
        "Minimum inside fillet: R2; avoid sharp load-bearing corners.",
        "Moving-part clearance: 0.5 mm per side minimum.",
        "Print this A3 sheet at 100%; do not use 'fit to page'.",
    ]
    note_box(c, right_x, 132 * mm, right_w, 54 * mm, "TOLERANCE / DFM", tol_lines, CYAN)

    split_lines = [
        "If the printer bed is smaller than 260 × 230:",
        "Split the deck at X = 125 with a 30 mm overlap.",
        "Use 4× M4 through-bolts, washers and locknuts.",
        "Add 2× Ø5 dowel features for repeatable alignment.",
        "Keep the seam away from axle brackets and battery strap slots.",
    ]
    note_box(c, right_x, 79 * mm, right_w, 46 * mm, "SMALL-BED OPTION", split_lines, ORANGE)

    release_lines = [
        "□ Place every purchased part on a 1:1 paper print.",
        "□ Measure caster, brackets, wheel hub spacing and display bosses.",
        "□ Confirm wheel clearance through full rotation and deck flex.",
        "□ Check USB, power-switch, battery and SD-card service access.",
        "□ Print a 20 mm corner/hole coupon in the final PA12-CF profile.",
        "□ Update the CAD hole table; then freeze Rev B for manufacture.",
    ]
    note_box(c, right_x, 25 * mm, right_w, 47 * mm, "RELEASE CHECKLIST — REQUIRED BEFORE FINAL PRINT", release_lines, INK)

    c.setFillColor(MID)
    c.setFont("Helvetica-Oblique", 6.5)
    c.drawString(margin, 26 * mm, "Reference sizes derived from the handmade-bci-build-kit and manufacturer envelopes. Purchased hardware governs.")

    title_block(c, 3, "NTS")
    c.showPage()


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle("MUSE Bot Base — Dimensioned Manufacturing Sketch")
    c.setAuthor("A.L.B.E.R.T. for Kai")
    c.setSubject("Rev A manufacturing sketch for a 3D-printed MUSE bot base")
    c.setCreator("ReportLab")
    top_view(c)
    side_and_front(c)
    schedules(c)
    c.save()
    print(OUT.resolve())


if __name__ == "__main__":
    main()
