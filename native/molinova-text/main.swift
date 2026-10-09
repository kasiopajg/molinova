// molinova-text : le texte d'un PDF ou d'une image, lu sur le Mac, sans réseau.
//
// PDF : la couche texte d'abord (PDFKit) ; si elle est vide (un scan), les premières pages sont rendues en image
// et lues par la reconnaissance de texte de macOS (Vision). Image : Vision directement.
// Sortie sur stdout, une ligne JSON : {"text": "...", "ocr": true|false, "pages": N}. Erreur : {"error": "..."} et code 1.
//
// Usage : molinova-text <fichier> [--max-chars 6000] [--ocr-pages 2]
//         molinova-text <fichier> --render <sortie.png|.jpg> [--page 1] [--width 1400]   (aperçu : une page, ou l'image)
// Compilé par scripts/native-text.sh dans build/native/darwin-<arch>/molinova-text.
import AppKit
import Foundation
import ImageIO
import PDFKit
import Vision

func emit(_ obj: [String: Any], code: Int32 = 0) -> Never {
  if let data = try? JSONSerialization.data(withJSONObject: obj, options: []), let s = String(data: data, encoding: .utf8) {
    FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!)
  }
  exit(code)
}

let args = CommandLine.arguments
guard args.count >= 2 else { emit(["error": "usage: molinova-text <file> [--max-chars N] [--ocr-pages N]"], code: 1) }
func intArg(_ name: String, _ def: Int) -> Int {
  if let i = args.firstIndex(of: name), i + 1 < args.count, let v = Int(args[i + 1]) { return v }
  return def
}
let path = args[1]
let maxChars = intArg("--max-chars", 6000)
let ocrPages = intArg("--ocr-pages", 2)
let url = URL(fileURLWithPath: path)

/** Le texte reconnu dans une image, ligne par ligne, dans l'ordre de lecture de Vision. */
func recognize(_ image: CGImage, orientation: CGImagePropertyOrientation = .up) -> String {
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = true
  req.recognitionLanguages = ["fr-FR", "en-US", "es-ES"]
  let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
  do { try handler.perform([req]) } catch { return "" }
  return (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

/** Une page de PDF rendue en image, fond blanc, environ 2 400 points sur le grand côté (assez pour l'OCR). */
func render(_ page: PDFPage) -> CGImage? {
  let box = page.bounds(for: .mediaBox)
  guard box.width > 0, box.height > 0 else { return nil }
  let scale = min(4.0, 2400.0 / max(box.width, box.height))
  let w = Int(box.width * scale), h = Int(box.height * scale)
  guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
  ctx.setFillColor(CGColor(gray: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: ctx)
  return ctx.makeImage()
}

/** Une image posée sur fond blanc (une transparence devient noire pour Vision), agrandie si elle est petite. */
func flatten(_ image: CGImage) -> CGImage {
  let long = Double(max(image.width, image.height))
  let scale = long < 1600 ? min(4.0, 1600.0 / long) : 1.0
  let w = Int(Double(image.width) * scale), h = Int(Double(image.height) * scale)
  guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return image }
  ctx.setFillColor(CGColor(gray: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.interpolationQuality = .high
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
  return ctx.makeImage() ?? image
}

func clip(_ s: String) -> String {
  let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
  return t.count > maxChars ? String(t.prefix(maxChars)) : t
}

/** Une image ramenée à `width` points de large au plus, sur fond blanc. */
func fit(_ image: CGImage, width: Int) -> CGImage {
  let scale = min(1.0, Double(width) / Double(max(1, image.width)))
  let w = max(1, Int(Double(image.width) * scale)), h = max(1, Int(Double(image.height) * scale))
  guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return image }
  ctx.setFillColor(CGColor(gray: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.interpolationQuality = .high
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
  return ctx.makeImage() ?? image
}
/** PNG, ou JPEG si le fichier finit par .jpg (aperçu : un scan en couleur pèse dix fois moins). */
func writeImage(_ image: CGImage, to path: String) -> Bool {
  let jpeg = path.lowercased().hasSuffix(".jpg")
  guard let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, (jpeg ? "public.jpeg" : "public.png") as CFString, 1, nil) else { return false }
  CGImageDestinationAddImage(dest, image, jpeg ? [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary : nil)
  return CGImageDestinationFinalize(dest)
}

let ext = url.pathExtension.lowercased()
let isPDF = ext == "pdf" || (try? Data(contentsOf: url, options: .alwaysMapped).prefix(4)) == Data("%PDF".utf8)

// Aperçu : la page demandée d'un PDF, ou l'image elle-même (HEIC compris), en PNG.
if let i = args.firstIndex(of: "--render"), i + 1 < args.count {
  let out = args[i + 1], width = intArg("--width", 1400)
  if isPDF {
    guard let doc = PDFDocument(url: url) else { emit(["error": "pdf illisible"], code: 1) }
    if doc.isLocked { emit(["error": "pdf protégé par un mot de passe"], code: 1) }
    let n = min(max(1, intArg("--page", 1)), max(1, doc.pageCount))
    guard let page = doc.page(at: n - 1), let img = render(page) else { emit(["error": "page illisible"], code: 1) }
    if !writeImage(fit(img, width: width), to: out) { emit(["error": "écriture impossible"], code: 1) }
    emit(["pages": doc.pageCount, "page": n])
  }
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { emit(["error": "image illisible"], code: 1) }
  // La miniature d'ImageIO applique l'orientation EXIF : une photo de téléphone s'affiche droite.
  let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: width * 2]
  guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { emit(["error": "image illisible"], code: 1) }
  if !writeImage(fit(img, width: width), to: out) { emit(["error": "écriture impossible"], code: 1) }
  emit(["pages": 1, "page": 1])
}

if isPDF {
  guard let doc = PDFDocument(url: url) else { emit(["error": "pdf illisible"], code: 1) }
  if doc.isLocked { emit(["error": "pdf protégé par un mot de passe"], code: 1) }
  var text = ""
  for i in 0..<doc.pageCount {
    if text.count >= maxChars { break }
    if let s = doc.page(at: i)?.string { text += s + "\n" }
  }
  // Moins de 40 caractères utiles : c'est un scan (ou une page d'image), on passe à l'OCR.
  if text.filter({ $0.isLetter }).count >= 40 { emit(["text": clip(text), "ocr": false, "pages": doc.pageCount]) }
  var ocr = ""
  for i in 0..<min(ocrPages, doc.pageCount) {
    if let page = doc.page(at: i), let img = render(page) { ocr += recognize(img) + "\n" }
  }
  emit(["text": clip(ocr), "ocr": true, "pages": doc.pageCount])
}

guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { emit(["error": "image illisible"], code: 1) }
// L'orientation EXIF d'une photo de téléphone : sans elle, Vision lit une carte couchée.
let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
let raw = (props?[kCGImagePropertyOrientation] as? UInt32) ?? 1
emit(["text": clip(recognize(flatten(img), orientation: CGImagePropertyOrientation(rawValue: raw) ?? .up)), "ocr": true, "pages": 1])
