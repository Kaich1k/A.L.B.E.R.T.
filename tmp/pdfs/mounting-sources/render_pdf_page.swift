import Foundation
import AppKit
import PDFKit

let args = CommandLine.arguments
guard args.count == 4,
      let doc = PDFDocument(url: URL(fileURLWithPath: args[1])),
      let index = Int(args[2]),
      let page = doc.page(at: index) else {
    fatalError("Usage: render_pdf_page.swift input.pdf zero_based_page output.png")
}
let bounds = page.bounds(for: .mediaBox)
let scale = 2200.0 / max(bounds.width, bounds.height)
let size = NSSize(width: bounds.width * scale, height: bounds.height * scale)
let image = page.thumbnail(of: size, for: .mediaBox)
guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Failed to render page")
}
try png.write(to: URL(fileURLWithPath: args[3]), options: .atomic)
print("Pages: \(doc.pageCount); inspected page: \(index + 1)")
print(page.string ?? "No text layer")
