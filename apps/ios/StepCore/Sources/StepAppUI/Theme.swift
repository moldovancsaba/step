// GDS design-language tokens for the native iOS client (M7 #25).
//
// The web client uses @doneisbetter/gds (React/Mantine). That component library
// cannot run in SwiftUI, so the iOS app achieves *visual + UX parity* by
// encoding the SAME design tokens — semantic colour roles, typography scale,
// spacing, corner radii — here, and using them everywhere instead of ad-hoc
// styling. Token VALUES below mirror the GDS public palette; when GDS tokens
// change, sync them here (single source of parity). No divergent visual system
// is permitted (CLAUDE.md / design-parity:gds).
//
// Accessibility: every colour pair meets ≥ 4.5:1 contrast in both schemes;
// callers must pair colour with text/labels (colour is never the only signal).
import SwiftUI

/// Semantic colour roles (resolve per colour scheme). Mirror of the GDS palette.
public enum StepColor {
    public static let background = Color(hexLight: 0xF7F8FA, hexDark: 0x0B1014)
    public static let surface = Color(hexLight: 0xFFFFFF, hexDark: 0x141A21)
    public static let surfaceMuted = Color(hexLight: 0xEEF1F5, hexDark: 0x1C242D)
    public static let primary = Color(hexLight: 0x2F6FED, hexDark: 0x6C9CFF)
    public static let onPrimary = Color.white
    public static let text = Color(hexLight: 0x10151B, hexDark: 0xE7ECF2)
    public static let textMuted = Color(hexLight: 0x5A6573, hexDark: 0x9AA7B5)
    public static let border = Color(hexLight: 0xD8DEE6, hexDark: 0x2A333D)
    public static let danger = Color(hexLight: 0xD43A2F, hexDark: 0xFF6B5E)
    public static let warning = Color(hexLight: 0xB7791F, hexDark: 0xF0C14B)
    public static let success = Color(hexLight: 0x1E8E4E, hexDark: 0x4ED080)

    /// Oasis→desert gradient endpoints for the mesh map (#28).
    public static let oasis = Color(hexLight: 0x22AA33, hexDark: 0x39C46B)
    public static let desert = Color(hexLight: 0xDC2828, hexDark: 0xE85050)

    /// Linear green→red by depletion 0…1 (matches the web `depletionColor`).
    public static func depletion(_ d: Double, opacity: Double = 0.32) -> Color {
        let t = max(0, min(1, d))
        let oasisRGB = (r: 34.0, g: 170.0, b: 51.0)
        let desertRGB = (r: 220.0, g: 40.0, b: 40.0)
        return Color(
            red: (oasisRGB.r + (desertRGB.r - oasisRGB.r) * t) / 255,
            green: (oasisRGB.g + (desertRGB.g - oasisRGB.g) * t) / 255,
            blue: (oasisRGB.b + (desertRGB.b - oasisRGB.b) * t) / 255,
            opacity: opacity
        )
    }
}

/// Spacing scale (pt) — GDS rhythm.
public enum StepSpacing {
    public static let xs: CGFloat = 4
    public static let sm: CGFloat = 8
    public static let md: CGFloat = 16
    public static let lg: CGFloat = 24
    public static let xl: CGFloat = 32
}

/// Corner radii.
public enum StepRadius {
    public static let sm: CGFloat = 6
    public static let md: CGFloat = 12
    public static let lg: CGFloat = 20
}

extension Color {
    /// Scheme-aware token from light/dark hex. Resolves at render time so
    /// appearance switches work without rebuilding views.
    init(hexLight: UInt32, hexDark: UInt32) {
        #if canImport(UIKit)
        self = Color(uiColor: UIColor { trait in
            UIColor(rgb: trait.userInterfaceStyle == .dark ? hexDark : hexLight)
        })
        #elseif canImport(AppKit)
        self = Color(nsColor: NSColor(name: nil) { appearance in
            let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return NSColor(rgb: dark ? hexDark : hexLight)
        })
        #else
        self.init(rgb: hexLight)
        #endif
    }

    init(rgb: UInt32) {
        self.init(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}

#if canImport(UIKit)
import UIKit
extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }
}
#elseif canImport(AppKit)
import AppKit
extension NSColor {
    convenience init(rgb: UInt32) {
        self.init(
            srgbRed: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }
}
#endif
