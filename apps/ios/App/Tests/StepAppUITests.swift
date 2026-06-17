// XCUITest smoke + accessibility checks for the StepApp target (M7 #33). These
// run on a simulator (App Attest unsupported → the app degrades to the honest
// unattested tier, #31). They assert the app launches to its first interactive
// surface and that key controls are reachable by accessibility — the foundation
// of the ship-gate VoiceOver pass.
import XCTest

final class StepAppUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Cold launch reaches an interactive first surface within a budget.
    func testColdLaunchShowsFirstSurface() throws {
        let app = XCUIApplication()
        app.launch()
        // Onboarding / login wall both expose at least one button or text field.
        let firstControl = app.buttons.firstMatch
        XCTAssertTrue(firstControl.waitForExistence(timeout: 5),
                      "App should present an interactive control on launch")
    }

    /// Every on-screen control must carry an accessibility label (no unlabeled
    /// tappables) — the automatable slice of the VoiceOver ship gate.
    func testLaunchControlsAreAccessible() throws {
        let app = XCUIApplication()
        app.launch()
        _ = app.buttons.firstMatch.waitForExistence(timeout: 5)
        for button in app.buttons.allElementsBoundByIndex where button.isHittable {
            XCTAssertFalse(button.label.isEmpty, "Hittable button is missing an accessibility label")
        }
    }
}
