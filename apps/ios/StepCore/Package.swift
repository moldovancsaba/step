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
        .package(url: "https://github.com/GigaBitcoin/secp256k1.swift.git", exact: "0.15.0"),
        // Argon2id KDF for the zero-knowledge account vault (#27). CryptoKit
        // provides AES-256-GCM + HKDF but NOT Argon2id; this wraps the reference
        // Argon2 C (RFC 9106, version 0x13) so the client KDF is byte-identical
        // to account-api's @noble/hashes argon2id. Justified per the
        // no-unwanted-deps rule: smallest audited Argon2 with SPM support.
        // Pinned by the 1.0.4 *commit* (reproducible) rather than the version
        // tag because the package's own C dependency (phc-winner-argon2) is
        // branch-pinned, which SPM rejects under a semver requirement.
        .package(
            url: "https://github.com/tmthecoder/Argon2Swift.git",
            revision: "53543623fefe68461b7eeea03d7f96677c2fd76d" // tag 1.0.4
        ),
        .package(
            url: "https://github.com/maplibre/maplibre-native-distribution.git",
            exact: "6.27.0"
        ),
    ],
    targets: [
        .target(
            name: "StepCore",
            dependencies: [
                .product(name: "secp256k1", package: "secp256k1.swift"),
                .product(name: "Argon2Swift", package: "Argon2Swift"),
            ]
        ),
        .target(
            name: "StepAppUI",
            dependencies: [
                "StepCore",
                .product(
                    name: "MapLibre",
                    package: "maplibre-native-distribution",
                    condition: .when(platforms: [.iOS])
                ),
            ]
        ),
        .testTarget(
            name: "StepCoreTests",
            dependencies: ["StepCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
