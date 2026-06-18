// Renders the STEP App Store icon (1024×1024, opaque, no alpha / no rounded
// corners — Apple masks the corners itself) with CoreGraphics, so the brand
// asset is reproducible from source rather than a binary blob with no history.
//
//   swift tools/icon/RenderIcon.swift apps/ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png
//
// Motif: the STEP triangular MESH — an upward triangle subdivided once into four
// (the 4-way subdivision), the centre triangle knocked back to read as depth,
// with a presence dot at the centroid. Brand greens mirror StepAppUI/Theme.swift.
import AppKit

let size = 1024
let outURL = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png")

func color(_ r: Int, _ g: Int, _ b: Int) -> CGColor {
    CGColor(red: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1)
}

let space = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else { fatalError("ctx") }

let S = CGFloat(size)

// Background: diagonal brand gradient (deep → bright green), fully opaque.
let grad = CGGradient(colorsSpace: space, colors: [
    color(0x0C, 0x6E, 0x33), color(0x22, 0xAA, 0x33), color(0x39, 0xC4, 0x6B),
] as CFArray, locations: [0, 0.6, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: S), end: CGPoint(x: S, y: 0), options: [])

// Triangle geometry: a centred upward equilateral triangle.
func tri(_ a: CGPoint, _ b: CGPoint, _ c: CGPoint) -> CGPath {
    let p = CGMutablePath(); p.move(to: a); p.addLine(to: b); p.addLine(to: c); p.closeSubpath(); return p
}
func mid(_ a: CGPoint, _ b: CGPoint) -> CGPoint { CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2) }

let inset: CGFloat = S * 0.20
let top = CGPoint(x: S / 2, y: S - inset)
let left = CGPoint(x: inset, y: inset + S * 0.06)
let right = CGPoint(x: S - inset, y: inset + S * 0.06)
let mTL = mid(top, left), mTR = mid(top, right), mLR = mid(left, right)

// Three corner sub-triangles in white; centre sub-triangle translucent (depth).
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.96))
for t in [tri(top, mTL, mTR), tri(mTL, left, mLR), tri(mTR, mLR, right)] {
    ctx.addPath(t); ctx.fillPath()
}
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.28))
ctx.addPath(tri(mTL, mLR, mTR)); ctx.fillPath()

// Presence dot at the centroid.
let cx = (top.x + left.x + right.x) / 3, cy = (top.y + left.y + right.y) / 3
let r: CGFloat = S * 0.052
ctx.setFillColor(color(0x0C, 0x6E, 0x33))
ctx.fillEllipse(in: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
let r2 = r * 0.45
ctx.fillEllipse(in: CGRect(x: cx - r2, y: cy - r2, width: r2 * 2, height: r2 * 2))

guard let image = ctx.makeImage() else { fatalError("image") }
let rep = NSBitmapImageRep(cgImage: image)
guard let png = rep.representation(using: .png, properties: [:]) else { fatalError("png") }
try! png.write(to: outURL)
print("wrote \(outURL.path) (\(png.count) bytes)")
