import AppKit
import ApplicationServices
import Foundation
import Darwin

// JSON-lines transport. No permission prompts, shell, clipboard, or private AX API.
struct BridgeError: Error { let code: String; let message: String }
func fail(_ code: String, _ message: String) throws -> Never { throw BridgeError(code: code, message: message) }
var interrupted: sig_atomic_t = 0
func checkCancelled() throws { if interrupted != 0 { try fail("cancelled", "Desktop work was stopped.") } }
func attr(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success ? value : nil
}
func textAttr(_ e: AXUIElement, _ key: String) -> String { (attr(e, key) as? String) ?? "" }
func boolAttr(_ e: AXUIElement, _ key: String, default fallback: Bool = false) -> Bool { (attr(e, key) as? NSNumber)?.boolValue ?? fallback }
func elementAttr(_ e: AXUIElement, _ key: String) -> AXUIElement? {
    guard let v = attr(e, key), CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(v, to: AXUIElement.self)
}
func children(_ e: AXUIElement) -> [AXUIElement] { attr(e, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func bounds(_ e: AXUIElement) -> CGRect? {
    guard let p = attr(e, kAXPositionAttribute), CFGetTypeID(p) == AXValueGetTypeID(),
          let s = attr(e, kAXSizeAttribute), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero; var size = CGSize.zero
    let pv = unsafeBitCast(p, to: AXValue.self), sv = unsafeBitCast(s, to: AXValue.self)
    guard AXValueGetType(pv) == .cgPoint, AXValueGetType(sv) == .cgSize,
          AXValueGetValue(pv, .cgPoint, &point), AXValueGetValue(sv, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}
func box(_ r: CGRect) -> [String: Double] { ["x":r.minX,"y":r.minY,"width":r.width,"height":r.height] }
func clipped(_ s: String) -> String { String(s.prefix(500)) }
func secure(_ e: AXUIElement) -> Bool {
    let role = textAttr(e, kAXRoleAttribute), subrole = textAttr(e, kAXSubroleAttribute)
    return role == "AXSecureTextField" || subrole == "AXSecureTextField" || boolAttr(e, "AXProtectedContent")
}
func editable(_ e: AXUIElement) -> Bool { ["AXTextField", "AXTextArea", "AXComboBox"].contains(textAttr(e, kAXRoleAttribute)) }
func settable(_ e: AXUIElement) -> Bool { var v = DarwinBoolean(false); return AXUIElementIsAttributeSettable(e, kAXValueAttribute as CFString, &v) == .success && v.boolValue }
func actionNames(_ e: AXUIElement) -> [String] { var a: CFArray?; return AXUIElementCopyActionNames(e, &a) == .success ? (a as? [String] ?? []) : [] }
func fingerprint(_ e: AXUIElement) -> [String] {
    [textAttr(e,kAXRoleAttribute),textAttr(e,kAXSubroleAttribute),textAttr(e,kAXIdentifierAttribute),textAttr(e,kAXTitleAttribute),clipped(textAttr(e,kAXDescriptionAttribute)),secure(e) ? "[protected]" : clipped(textAttr(e,kAXValueAttribute))]
}
func requiredString(_ args: [String:Any], _ key: String) throws -> String {
    guard let s = args[key] as? String, !s.isEmpty, s.count <= 10000 else { try fail("invalid_argument", "\(key) must be a nonempty string.") }; return s
}
func number(_ args: [String:Any], _ key: String, default fallback: Double? = nil) throws -> Double {
    if args[key] == nil, let fallback { return fallback }
    guard let n = args[key] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { try fail("invalid_argument", "\(key) must be a finite number.") }; return n.doubleValue
}
func trusted() throws { guard AXIsProcessTrusted() else { try fail("accessibility_required", "The ALBERT desktop controller needs Accessibility access. Open ALBERT → Systems for controller setup, then restart ALBERT after granting access.") } }
struct WindowRecord { let id: String; let pid: pid_t; let app: String; let launch: Date?; let element: AXUIElement; let created: Date }
struct NodeRecord { let element: AXUIElement; let identity: [String]; let actions: [String]; let editable: Bool }
struct Snapshot { let id: String; let window: WindowRecord; let rect: CGRect; let created: Date; let nodes: [String:NodeRecord]; let focusedElement: AXUIElement?; let focusedIdentity: [String]? }
var inventory: [String:WindowRecord] = [:]
var snapshots: [String:Snapshot] = [:]
let allowedActions: Set<String> = ["AXPress","AXShowMenu","AXConfirm","AXCancel","AXIncrement","AXDecrement","AXRaise","AXPick"]
func fresh(_ date: Date) -> Bool { Date().timeIntervalSince(date) < 60 }
func prune() { inventory = inventory.filter { fresh($0.value.created) }; snapshots = snapshots.filter { fresh($0.value.created) } }
func captureWindowId(_ w: WindowRecord) -> Any {
    guard let r=bounds(w.element),let list=CGWindowListCopyWindowInfo([.optionAll,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] else { return NSNull() }
    let title=textAttr(w.element,kAXTitleAttribute)
    let candidates=list.filter { row in
        guard (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == w.pid,
              let b=row[kCGWindowBounds as String] as? NSDictionary,
              let rect=CGRect(dictionaryRepresentation:b) else { return false }
        let matching=abs(r.minX-rect.minX)<2 && abs(r.minY-rect.minY)<2 && abs(r.width-rect.width)<2 && abs(r.height-rect.height)<2
        let cgTitle=row[kCGWindowName as String] as? String ?? ""
        return matching && (title.isEmpty || cgTitle.isEmpty || cgTitle==title)
    }
    guard candidates.count==1,let id=candidates[0][kCGWindowNumber as String] as? NSNumber else { return NSNull() }; return id
}
func live(_ w: WindowRecord) throws -> AXUIElement {
    guard fresh(w.created), let app = NSRunningApplication(processIdentifier: w.pid), app.launchDate == w.launch else { try fail("stale_snapshot", "Window observation expired or application restarted; list and inspect again.") }
    let ae = AXUIElementCreateApplication(w.pid); AXUIElementSetMessagingTimeout(ae, 0.1)
    guard let windows = attr(ae, kAXWindowsAttribute) as? [AXUIElement], windows.contains(where: { CFEqual($0,w.element) }) else { try fail("stale_snapshot", "The observed window no longer exists; list windows again.") }; return ae
}
func windowFrom(_ args: [String:Any]) throws -> WindowRecord {
    if let sid = args["snapshotId"] as? String { guard let s = snapshots[sid], fresh(s.created) else { try fail("stale_snapshot", "Snapshot expired; inspect the window again.") }; return s.window }
    let id = try requiredString(args,"windowId"); guard let w = inventory[id], fresh(w.created) else { try fail("stale_snapshot", "Unknown or expired windowId; list windows again.") }; return w
}
func snapshotFrom(_ args: [String:Any]) throws -> Snapshot {
    let id = try requiredString(args,"snapshotId")
    guard let s = snapshots[id], fresh(s.created) else { try fail("stale_snapshot", "Snapshot is expired or already used; inspect the window again.") }
    _ = try live(s.window); return s
}
func verifyFront(_ s: Snapshot) throws -> AXUIElement {
    let ae = try live(s.window)
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == s.window.pid,
          let fw = elementAttr(ae, kAXFocusedWindowAttribute), CFEqual(fw,s.window.element) else { try fail("wrong_window", "The observed window is not focused. Focus it, then inspect again before acting.") }
    return ae
}
func belongs(_ node: AXUIElement, to window: AXUIElement) -> Bool {
    var current: AXUIElement? = node
    for _ in 0..<64 { guard let e = current else { return false }; if CFEqual(e,window) { return true }; current = elementAttr(e,kAXParentAttribute) }; return false
}
func nodeFrom(_ args: [String:Any], _ s: Snapshot) throws -> NodeRecord {
    let id = try requiredString(args,"elementId")
    guard let n = s.nodes[id], fingerprint(n.element) == n.identity, belongs(n.element,to:s.window.element) else { try fail("stale_snapshot", "That control changed or left the observed window. Inspect again.") }
    guard !secure(n.element) else { try fail("secure_field", "Protected fields cannot be read or modified by desktop tools.") }
    guard boolAttr(n.element,kAXEnabledAttribute,default:true) else { try fail("disabled_control", "That control is disabled.") }; return n
}
func focused(_ ae: AXUIElement, _ s: Snapshot, textOnly: Bool = false) throws -> AXUIElement {
    guard let e = elementAttr(ae,kAXFocusedUIElementAttribute), belongs(e,to:s.window.element) else { try fail("wrong_focus", "No focused control belongs to the observed window.") }
    guard !secure(e) else { try fail("secure_field", "Keyboard input to protected fields is not supported.") }
    guard let observed=s.focusedElement, let identity=s.focusedIdentity,
          keyboardFocusMatches(sameElement:CFEqual(e,observed),current:fingerprint(e),observed:identity) else {
        try fail("stale_focus", "The focused control changed since inspection. Inspect the window again before keyboard input.")
    }
    if textOnly && !editable(e) { try fail("wrong_focus", "Focus an editable text field before typing.") }; return e
}
// Value changes from our own typing are expected; role, identity, and label must stay stable.
func keyboardIdentity(_ identity: [String]) -> [String] { Array(identity.prefix(5)) }
func keyboardFocusMatches(sameElement: Bool, current: [String], observed: [String]) -> Bool {
    sameElement && keyboardIdentity(current) == keyboardIdentity(observed)
}
func displayRows() -> [[String:Any]] {
    var ids = [CGDirectDisplayID](repeating: 0,count:32); var count: UInt32 = 0
    guard CGGetActiveDisplayList(32,&ids,&count) == .success else { return [] }
    return ids.prefix(Int(count)).map { id in
        let r = CGDisplayBounds(id); let scale = r.width > 0 ? Double(CGDisplayPixelsWide(id))/r.width : 1
        return ["id":id,"bounds":box(r),"scaleFactor":scale]
    }
}
func onDisplay(_ p: CGPoint) -> Bool {
    displayRows().contains { row in guard let b = row["bounds"] as? [String:Double] else { return false }; return CGRect(x:b["x"]!,y:b["y"]!,width:b["width"]!,height:b["height"]!).contains(p) }
}
func validPoint(_ p: CGPoint, _ rect: CGRect) -> Bool { p.x.isFinite && p.y.isFinite && rect.contains(p) }
func targetPoint(_ args: [String:Any], _ x: String, _ y: String, _ s: Snapshot) throws -> CGPoint {
    let p = CGPoint(x:try number(args,x),y:try number(args,y))
    guard let current = bounds(s.window.element), abs(current.minX-s.rect.minX)<1, abs(current.minY-s.rect.minY)<1, abs(current.width-s.rect.width)<1, abs(current.height-s.rect.height)<1 else { try fail("stale_snapshot", "The window moved or resized; inspect and capture it again.") }
    guard validPoint(p,s.rect), onDisplay(p) else { try fail("invalid_argument", "Coordinates must be inside the observed window and a connected display.") }; return p
}
func source() throws -> CGEventSource { guard let s = CGEventSource(stateID:.hidSystemState) else { try fail("event_failed","Cannot create input source.") }; return s }
func mouse(_ type: CGEventType, _ p: CGPoint, _ b: CGMouseButton, _ source: CGEventSource, clicks: Int64 = 1) throws {
    guard let e = CGEvent(mouseEventSource:source,mouseType:type,mouseCursorPosition:p,mouseButton:b) else { try fail("event_failed","Cannot create pointer event.") }; e.setIntegerValueField(.mouseEventClickState,value:clicks); e.post(tap:.cghidEventTap)
}
func flags(_ args: [String:Any]) throws -> CGEventFlags {
    guard args["modifiers"] == nil || args["modifiers"] is [String] else { try fail("invalid_argument","modifiers must be an array of strings.") }
    var f: CGEventFlags = []
    for m in args["modifiers"] as? [String] ?? [] {
        switch m.lowercased() { case "command","cmd": f.insert(.maskCommand); case "option","alt":f.insert(.maskAlternate); case "control","ctrl":f.insert(.maskControl); case "shift":f.insert(.maskShift); default:try fail("invalid_argument","Unsupported modifier: \(m)") }
    }; return f
}
let keyCodes: [String:CGKeyCode] = ["a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,"q":12,"w":13,"e":14,"r":15,"y":16,"t":17,"1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"=":24,"9":25,"7":26,"-":27,"8":28,"0":29,"]":30,"o":31,"u":32,"[":33,"i":34,"p":35,"return":36,"enter":36,"l":37,"j":38,"'":39,"k":40,";":41,"\\":42,",":43,"/":44,"n":45,"m":46,".":47,"tab":48,"space":49,"`":50,"delete":51,"backspace":51,"escape":53,"esc":53,"f1":122,"f2":120,"f3":99,"f4":118,"f5":96,"f6":97,"f7":98,"f8":100,"f9":101,"f10":109,"f11":103,"f12":111,"home":115,"pageup":116,"forwarddelete":117,"end":119,"pagedown":121,"left":123,"right":124,"down":125,"up":126]
func pressKey(_ code: CGKeyCode, _ f: CGEventFlags, _ src: CGEventSource) throws {
    guard let down = CGEvent(keyboardEventSource:src,virtualKey:code,keyDown:true), let up = CGEvent(keyboardEventSource:src,virtualKey:code,keyDown:false) else { try fail("event_failed","Cannot create key event.") }
    down.flags=f; up.flags=f; down.post(tap:.cghidEventTap); up.post(tap:.cghidEventTap)
}
func handle(_ args:[String:Any]) throws -> [String:Any] {
    try checkCancelled(); prune(); let op = try requiredString(args,"op")
    if op == "permissions" { return ["accessibility":AXIsProcessTrusted(),"screenRecording":CGPreflightScreenCaptureAccess()] }
    try trusted()
    switch op {
    case "list_windows":
        var rows: [[String:Any]] = []
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
            try checkCancelled(); let ae = AXUIElementCreateApplication(app.processIdentifier); AXUIElementSetMessagingTimeout(ae,0.1)
            for w in attr(ae,kAXWindowsAttribute) as? [AXUIElement] ?? [] {
                guard let r = bounds(w),r.width>0,r.height>0 else { continue }
                let id = UUID().uuidString; let record = WindowRecord(id:id,pid:app.processIdentifier,app:app.localizedName ?? "Application",launch:app.launchDate,element:w,created:Date()); inventory[id]=record
                rows.append(["windowId":id,"pid":record.pid,"app":record.app,"title":clipped(textAttr(w,kAXTitleAttribute)),"bounds":box(r),"minimized":boolAttr(w,kAXMinimizedAttribute),"captureWindowId":captureWindowId(record),"frontmost":NSWorkspace.shared.frontmostApplication?.processIdentifier == record.pid])
            }
        }
        if inventory.count > 1000 { let ids=Set(rows.compactMap { $0["windowId"] as? String }); inventory = inventory.filter { ids.contains($0.key) } }
        return ["windows":rows,"displays":displayRows(),"coordinateSpace":"desktop-points"]
    case "inspect_window":
        let w = try windowFrom(args); let ae = try live(w); guard let rect = bounds(w.element) else { try fail("window_unavailable","Window bounds are unavailable.") }
        var nodes:[String:NodeRecord]=[:], rows:[[String:Any]]=[]; var queue:[(AXUIElement,Int)]=[(w.element,0)]; var cursor=0; let started=Date(); var seen=Set<CFHashCode>(); var truncated=false
        while cursor<queue.count {
            try checkCancelled()
            if rows.count>=500 || Date().timeIntervalSince(started)>3 { truncated=true; break }
            let (e,depth)=queue[cursor]; cursor+=1; let hash=CFHash(e); if seen.contains(hash) { continue }; seen.insert(hash)
            let role=textAttr(e,kAXRoleAttribute); if role.isEmpty { continue }; let id="e\(rows.count+1)"; let isSecure=secure(e); let acts=actionNames(e).filter { allowedActions.contains($0) }; let canSet = !isSecure && editable(e) && settable(e)
            nodes[id]=NodeRecord(element:e,identity:fingerprint(e),actions:acts,editable:canSet)
            var row:[String:Any] = ["elementId":id,"role":role,"subrole":textAttr(e,kAXSubroleAttribute),"title":clipped(textAttr(e,kAXTitleAttribute)),"description":clipped(textAttr(e,kAXDescriptionAttribute)),"enabled":boolAttr(e,kAXEnabledAttribute,default:true),"secure":isSecure,"actions":isSecure ? [] : acts,"settable":canSet]
            if !isSecure, let v=attr(e,kAXValueAttribute) { if let s=v as? String { row["value"]=clipped(s) } else if let n=v as? NSNumber { row["value"]=n } }
            if let b=bounds(e) { row["bounds"]=box(b) }; rows.append(row)
            if !isSecure { if depth<12 { queue.append(contentsOf:children(e).prefix(500).map { ($0,depth+1) }) } else if !children(e).isEmpty { truncated=true } }
        }
        let observedFocus=elementAttr(ae,kAXFocusedUIElementAttribute)
        let safeFocus=observedFocus.flatMap { belongs($0,to:w.element) && !secure($0) ? $0 : nil }
        let sid=UUID().uuidString; snapshots[sid]=Snapshot(id:sid,window:w,rect:rect,created:Date(),nodes:nodes,focusedElement:safeFocus,focusedIdentity:safeFocus.map { fingerprint($0) })
        if snapshots.count>8 { let keep=snapshots.values.sorted { $0.created>$1.created }.prefix(8); snapshots=Dictionary(uniqueKeysWithValues:keep.map { ($0.id,$0) }) }
        return ["snapshotId":sid,"windowId":w.id,"pid":w.pid,"app":w.app,"title":clipped(textAttr(w.element,kAXTitleAttribute)),"bounds":box(rect),"elements":rows,"truncated":truncated,"expiresInMs":60000,"coordinateSpace":"desktop-points","captureWindowId":captureWindowId(w)]
    case "validate_snapshot":
        let s=try snapshotFrom(args)
        guard let r=bounds(s.window.element),abs(r.minX-s.rect.minX)<1,abs(r.minY-s.rect.minY)<1,abs(r.width-s.rect.width)<1,abs(r.height-s.rect.height)<1 else { try fail("stale_snapshot","Window moved or resized; inspect again.") }
        return ["snapshotId":s.id,"windowId":s.window.id,"pid":s.window.pid,"app":s.window.app,"title":clipped(textAttr(s.window.element,kAXTitleAttribute)),"bounds":box(r),"captureWindowId":captureWindowId(s.window),"coordinateSpace":"desktop-points"]
    case "focus_window":
        let w=try windowFrom(args); let ae=try live(w); defer { snapshots.removeAll() }
        guard let app=NSRunningApplication(processIdentifier:w.pid) else { try fail("stale_snapshot","Application closed.") }
        if boolAttr(w.element,kAXMinimizedAttribute) { _=AXUIElementSetAttributeValue(w.element,kAXMinimizedAttribute as CFString,kCFBooleanFalse) }
        app.activate(options:[]); _=AXUIElementPerformAction(w.element,kAXRaiseAction as CFString); _=AXUIElementSetAttributeValue(ae,kAXFocusedWindowAttribute as CFString,w.element)
        for _ in 0..<12 { try checkCancelled(); if NSWorkspace.shared.frontmostApplication?.processIdentifier==w.pid, let fw=elementAttr(ae,kAXFocusedWindowAttribute), CFEqual(fw,w.element) { return ["focused":true,"windowId":w.id] }; usleep(25000) }
        try fail("focus_failed","Application did not confirm the requested window is focused.")
    case "perform_action","set_value","pointer","key","type_text":
        let s=try snapshotFrom(args); let ae=try verifyFront(s); defer { snapshots.removeAll() }
        if op == "perform_action" {
            let n=try nodeFrom(args,s); let action=try requiredString(args,"action")
            guard n.actions.contains(action),allowedActions.contains(action),actionNames(n.element).contains(action) else { try fail("unsupported_action","Action was not observed on this control.") }
            try checkCancelled(); let result=AXUIElementPerformAction(n.element,action as CFString)
            guard result == .success else { try fail("action_failed","Accessibility action failed (\(result.rawValue)); inspect again.") }; return ["performed":action]
        }
        if op == "set_value" {
            let n=try nodeFrom(args,s); guard let value=args["value"] as? String,value.utf16.count<=8000,n.editable,settable(n.element),editable(n.element) else { try fail("invalid_argument","Value must be at most 8000 UTF16 units and target an observed editable control.") }
            try checkCancelled(); guard AXUIElementSetAttributeValue(n.element,kAXValueAttribute as CFString,value as CFString) == .success else { try fail("action_failed","Cannot set this control's value.") }; return ["updated":true]
        }
        if op == "key" {
            _=try focused(ae,s); let key=try requiredString(args,"key").lowercased(); guard let code=keyCodes[key] else { try fail("invalid_argument","Unsupported key; use type_text for Unicode text.") }; let f=try flags(args); try checkCancelled(); try pressKey(code,f,try source()); return ["pressed":key]
        }
        if op == "type_text" {
            _=try focused(ae,s,textOnly:true); let text=try requiredString(args,"text"); guard text.utf16.count<=8000 else { try fail("invalid_argument","Text is too long (max 8000 UTF16 units).") }; let src=try source(); let scalars=Array(text.unicodeScalars); var cursor=0
            while cursor<scalars.count {
                try checkCancelled(); _=try verifyFront(s); _=try focused(ae,s,textOnly:true)
                let end=min(cursor+32,scalars.count); let units=Array(String(String.UnicodeScalarView(scalars[cursor..<end])).utf16)
                guard let down=CGEvent(keyboardEventSource:src,virtualKey:0,keyDown:true),let up=CGEvent(keyboardEventSource:src,virtualKey:0,keyDown:false) else { try fail("event_failed","Cannot create Unicode input.") }
                down.keyboardSetUnicodeString(stringLength:units.count,unicodeString:units); up.keyboardSetUnicodeString(stringLength:units.count,unicodeString:units); down.post(tap:.cghidEventTap); up.post(tap:.cghidEventTap); cursor=end
            }; return ["typed":text.count]
        }
        let kind=try requiredString(args,"kind"); guard ["click","move","scroll","drag"].contains(kind) else { try fail("invalid_argument","Unknown pointer kind.") }; let p=try targetPoint(args,"x","y",s); let src=try source(); let button=args["button"] as? String ?? "left"
        guard ["left","right"].contains(button) else { try fail("invalid_argument","button must be left or right.") }; let b:CGMouseButton=button=="right" ? .right:.left; let down:CGEventType=b == .right ? .rightMouseDown:.leftMouseDown; let up:CGEventType=b == .right ? .rightMouseUp:.leftMouseUp; let drag:CGEventType=b == .right ? .rightMouseDragged:.leftMouseDragged
        if kind == "move" { try mouse(.mouseMoved,p,b,src) }
        if kind == "click" { let count=try number(args,"clicks",default:1); guard count==1 || count==2 else { try fail("invalid_argument","clicks must be 1 or 2.") }; for c in 1...Int(count) { try checkCancelled(); _=try verifyFront(s); try mouse(down,p,b,src,clicks:Int64(c)); try mouse(up,p,b,src,clicks:Int64(c)); if count==2 { usleep(50000) } } }
        if kind == "scroll" { let dx=try number(args,"deltaX",default:0),dy=try number(args,"deltaY",default:0); guard abs(dx)<=2000,abs(dy)<=2000,dx != 0 || dy != 0 else { try fail("invalid_argument","Scroll deltas must be nonzero and between -2000 and 2000.") }; try mouse(.mouseMoved,p,.left,src); guard let e=CGEvent(scrollWheelEvent2Source:src,units:.pixel,wheelCount:2,wheel1:Int32(dy),wheel2:Int32(dx),wheel3:0) else { try fail("event_failed","Cannot create scroll event.") }; e.location=p; e.post(tap:.cghidEventTap) }
        if kind == "drag" { let to=try targetPoint(args,"toX","toY",s); let duration=try number(args,"durationMs",default:500); guard duration>=50,duration<=2000 else { try fail("invalid_argument","durationMs must be between 50 and 2000.") }; var last=p; try mouse(down,p,b,src); defer { try? mouse(up,last,b,src) }; let steps=max(2,Int(duration/16)); for i in 1...steps { try checkCancelled(); _=try verifyFront(s); let t=Double(i)/Double(steps); last=CGPoint(x:p.x+(to.x-p.x)*t,y:p.y+(to.y-p.y)*t); try mouse(drag,last,b,src); usleep(useconds_t(duration*1000/Double(steps))) } }
        return ["performed":kind]
    default: try fail("invalid_operation","Unsupported operation: \(op)")
    }
}
var testCount=0
func expect(_ condition: Bool) throws { testCount += 1; if !condition { try fail("self_test_failed","Pure validation check \(testCount) failed.") } }
func selfTest() throws {
    try expect(validPoint(CGPoint(x:-500,y:50),CGRect(x:-1000,y:0,width:900,height:700)))
    try expect(!validPoint(CGPoint(x:900,y:50),CGRect(x:0,y:0,width:900,height:700)))
    try expect(!validPoint(CGPoint(x:Double.nan,y:50),CGRect(x:0,y:0,width:900,height:700)))
    let n=try number(["x":2.5],"x"); try expect(n == 2.5)
    for args:[String:Any] in [["x":true],["x":"3"],["x":Double.infinity]] { do { _=try number(args,"x"); throw BridgeError(code:"test_failed",message:"Invalidnumberaccepted") } catch let e as BridgeError { try expect(e.code=="invalid_argument") } }
    let f=try flags(["modifiers":["cmd","shift"]]); try expect(f == [.maskCommand,.maskShift])
    do { _=try flags(["modifiers":["typo"]]); throw BridgeError(code:"test_failed",message:"Invalidmodifieraccepted") } catch let e as BridgeError { try expect(e.code=="invalid_argument") }
    try expect(keyCodes["f12"]==111 && keyCodes["not-a-key"]==nil)
    try expect(allowedActions.contains("AXPress") && !allowedActions.contains("AXDelete"))
    let field=["AXTextField","","message","Message Albert","Composer",""]
    try expect(keyboardFocusMatches(sameElement:true,current:field,observed:field))
    try expect(!keyboardFocusMatches(sameElement:false,current:field,observed:field))
    try expect(!keyboardFocusMatches(sameElement:true,current:["AXTextField","","search","Search","Search", ""],observed:field))
    var typedField=field; typedField[5]="Text already typed by this action"
    try expect(keyboardFocusMatches(sameElement:true,current:typedField,observed:field))
    print("{\"ok\":true,\"tests\":\(testCount),\"scope\":\"pure validation; no desktop access\"}")
}
if CommandLine.arguments.contains("--self-test") { do { try selfTest() } catch { fputs("Selftest failed: \(error)\n",stderr); exit(1) }; exit(0) }
signal(SIGTERM) { _ in interrupted=1 }; signal(SIGINT) { _ in interrupted=1 }
while let line=readLine() {
    if interrupted != 0 { break }
    var id:Any=NSNull(); var response:[String:Any]
    do {
        guard line.utf8.count<=100000, let data=line.data(using:.utf8),let args=try JSONSerialization.jsonObject(with:data) as? [String:Any] else { try fail("invalid_json","Expected a JSON object under 100KB.") }
        id=args["id"] ?? NSNull(); let result=try handle(args); response=["id":id,"ok":true,"result":result]
    } catch let e as BridgeError { response=["id":id,"ok":false,"error":["code":e.code,"message":e.message]] }
    catch { response=["id":id,"ok":false,"error":["code":"native_error","message":String(describing:error)]] }
    if let data=try? JSONSerialization.data(withJSONObject:response,options:[.sortedKeys,.fragmentsAllowed]),let text=String(data:data,encoding:.utf8) { print(text); fflush(stdout) }
}
