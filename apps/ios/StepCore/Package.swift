// swift-tools-version: 5.9
// StepCore — the iOS miner app's protocol core (DEV §6.2 Core/ modules).
//
// Cross-platform by design: every module here compiles and tests on macOS via
// `swift test`, which is how CI verifies it without an iOS simulator. The
// SwiftUI app target (StepAppUI) consumes these modules unchanged.
import PackageDescription

let package = Package(
    name: "StepCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "StepCore", targets: ["StepCore"]),
        .library(name: "StepAppUI", targets: ["StepAppUI"]),
    ],
    dependencies: [
        // Audited secp256k1 bindings (DEV §6.1 "audited secp256k1 library
        // where EVM signing is required").
        .package(url: "https://github.com/GigaBitcoin/secp256k1.swift.git", exact: "0.15.0")
    ],
    targets: [
        .target(
            name: "StepCore",
            dependencies: [.product(name: "secp256k1", package: "secp256k1.swift")]
        ),
        .target(name: "StepAppUI", dependencies: ["StepCore"]),
        .testTarget(
            name: "StepCoreTests",
            dependencies: ["StepCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
