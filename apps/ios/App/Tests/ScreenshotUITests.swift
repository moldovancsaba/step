// App Store screenshot capture (#33), fastlane-free: drives a fresh launch
// through onboarding (device-local wallet) and the launcher (Mine & explore) to
// the tab shell, then attaches one screenshot per tab. Run per device via
// `xcodebuild test -only-testing:StepAppUITests/ScreenshotUITests ARCHS=arm64`
// and extract the named PNG attachments from the .xcresult.
//
// XCUIApplication()/XCUIScreen are @MainActor in Swift 6, so the test + helper
// are @MainActor and create the app locally (no nonisolated stored default).
import XCTest

final class ScreenshotUITests: XCTestCase {
    @MainActor
    private func capture(_ name: String) {
        let att = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        att.name = name
        att.lifetime = .keepAlways
        add(att)
    }

    @MainActor
    func testCaptureScreens() {
        continueAfterFailure = false
        let app = XCUIApplication()
        // Bypass the login wall: seed a device-local wallet + miner mode (see
        // AppComposition, #if DEBUG) so we land directly on the tab shell.
        app.launchArguments = ["-uiTestSeedWallet"]
        app.launch()

        // Tab shell.
        XCTAssertTrue(app.tabBars.buttons["Mine"].waitForExistence(timeout: 20), "tab shell did not appear")
        sleep(2)
        capture("01-Mine")

        for (tab, name) in [("Map", "02-Map"), ("Wallet", "03-Wallet"), ("Market", "04-Marketplace")] {
            if app.tabBars.buttons[tab].exists {
                app.tabBars.buttons[tab].tap()
                sleep(tab == "Map" ? 6 : 2) // web globe needs render time
                capture(name)
            }
        }
    }
}
