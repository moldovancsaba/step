// Lightweight, PII-free observability hook (M7 #33 §14). Subscribes to MetricKit
// and logs delivered metric/diagnostic payloads via os.Logger (no user data, no
// coordinates). A real deployment can forward these to an aggregator; here they
// land in the unified log so crashes/hangs are visible in TestFlight builds.
import Foundation
import os

#if canImport(MetricKit) && os(iOS)
import MetricKit

final class MetricsObserver: NSObject, MXMetricManagerSubscriber {
    static let shared = MetricsObserver()
    private let log = Logger(subsystem: "com.regiominer.miner", category: "metrics")

    func start() { MXMetricManager.shared.add(self) }

    func didReceive(_ payloads: [MXMetricPayload]) {
        for payload in payloads { log.info("metric payload \(payload.timeStampEnd, privacy: .public)") }
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads { log.error("diagnostic payload \(payload.timeStampEnd, privacy: .public)") }
    }
}
#endif

enum Metrics {
    static func start() {
        #if canImport(MetricKit) && os(iOS)
        MetricsObserver.shared.start()
        #endif
    }
}
