import CoreGraphics
import XCTest
@testable import UBEYE

final class StoryVideoGeometryNormalizerTests: XCTestCase {
    func testIdentityVideoFillsRenderCanvas() {
        assertPlan(
            naturalSize: CGSize(width: 1080, height: 1920),
            preferredTransform: .identity,
            mirrorsHorizontally: false,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )
    }

    func testMirroredIdentityVideoStillFillsRenderCanvas() {
        let plan = assertPlan(
            naturalSize: CGSize(width: 1080, height: 1920),
            preferredTransform: .identity,
            mirrorsHorizontally: true,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )

        XCTAssertEqual(
            CGPoint(x: 0, y: 0).applying(plan.transform).x,
            1080,
            accuracy: 0.001
        )
        XCTAssertEqual(
            CGPoint(x: 1080, y: 0).applying(plan.transform).x,
            0,
            accuracy: 0.001
        )
    }

    func testRightRotatedPortraitVideoFillsRenderCanvas() {
        let naturalSize = CGSize(width: 1920, height: 1080)
        let preferredTransform = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 1080, ty: 0)

        assertPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: false,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )
    }

    func testMirroredRightRotatedPortraitVideoFillsRenderCanvas() {
        let naturalSize = CGSize(width: 1920, height: 1080)
        let preferredTransform = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 1080, ty: 0)

        let unmirroredPlan = StoryVideoGeometryNormalizer.presentationPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: false
        )
        let mirroredPlan = assertPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: true,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )

        let sourceTopLeft = CGPoint(x: 0, y: 0)
        XCTAssertEqual(
            sourceTopLeft.applying(unmirroredPlan.transform).x +
                sourceTopLeft.applying(mirroredPlan.transform).x,
            mirroredPlan.renderSize.width,
            accuracy: 0.001
        )
    }

    func testLeftRotatedPortraitVideoFillsRenderCanvas() {
        let naturalSize = CGSize(width: 1920, height: 1080)
        let preferredTransform = CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: 1920)

        assertPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: false,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )
    }

    func testMirroredLeftRotatedPortraitVideoFillsRenderCanvas() {
        let naturalSize = CGSize(width: 1920, height: 1080)
        let preferredTransform = CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: 1920)

        assertPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: true,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )
    }

    func testUpsideDownVideoFillsRenderCanvas() {
        let naturalSize = CGSize(width: 1080, height: 1920)
        let preferredTransform = CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: 1080, ty: 1920)

        assertPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: true,
            expectedRenderSize: CGSize(width: 1080, height: 1920)
        )
    }

    @discardableResult
    private func assertPlan(
        naturalSize: CGSize,
        preferredTransform: CGAffineTransform,
        mirrorsHorizontally: Bool,
        expectedRenderSize: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> StoryVideoGeometryNormalizer.PresentationPlan {
        let plan = StoryVideoGeometryNormalizer.presentationPlan(
            naturalSize: naturalSize,
            preferredTransform: preferredTransform,
            mirrorsHorizontally: mirrorsHorizontally
        )

        XCTAssertEqual(plan.renderSize.width, expectedRenderSize.width, accuracy: 0.001, file: file, line: line)
        XCTAssertEqual(plan.renderSize.height, expectedRenderSize.height, accuracy: 0.001, file: file, line: line)
        XCTAssertEqual(plan.renderedSourceRect.minX, 0, accuracy: 0.001, file: file, line: line)
        XCTAssertEqual(plan.renderedSourceRect.minY, 0, accuracy: 0.001, file: file, line: line)
        XCTAssertEqual(plan.renderedSourceRect.width, expectedRenderSize.width, accuracy: 0.001, file: file, line: line)
        XCTAssertEqual(plan.renderedSourceRect.height, expectedRenderSize.height, accuracy: 0.001, file: file, line: line)

        return plan
    }
}
