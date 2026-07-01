// swift-tools-version: 6.0

import PackageDescription

// Mirrors the xtool default app template (xtool-spike/HelloXtool/) but committed
// here as a self-contained fixture so the cross-compile test doesn't depend on
// the external xtool-spike directory.
let package = Package(
    name: "HelloXtoolApp",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "HelloXtoolApp",
            targets: ["HelloXtoolApp"]
        ),
    ],
    targets: [
        .target(
            name: "HelloXtoolApp"
        ),
    ]
)
