//! Fraud risk scoring v1 (POP-006, HARD §6.5).
//!
//! Alpha signal set: speed/teleport plausibility, accuracy anomaly, integrity
//! mode. Wallet clustering and validator-affinity analytics are MVP-scope
//! (they need cross-claim history the node accumulates over time and are
//! flagged, not implemented, here — see requirements matrix POP-006).

use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviousClaim {
    pub latitude: f64,
    pub longitude: f64,
    pub timestamp_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FraudSignal {
    pub signal: String,
    pub value: f64,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FraudScore {
    pub score: f64,
    pub signals: Vec<FraudSignal>,
}

/// Great-circle distance in metres (haversine on the authalic sphere).
pub fn distance_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (la1, lo1, la2, lo2) = (
        lat1.to_radians(),
        lon1.to_radians(),
        lat2.to_radians(),
        lon2.to_radians(),
    );
    let dlat = la2 - la1;
    let dlon = lo2 - lo1;
    let a = (dlat / 2.0).sin().powi(2) + la1.cos() * la2.cos() * (dlon / 2.0).sin().powi(2);
    2.0 * a.sqrt().asin() * step_mesh_engine::EARTH_RADIUS_M
}

fn parse_ts(s: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(s, &Rfc3339).ok()
}

/// Assemble the fraud score for a claim. Deterministic given identical inputs.
pub fn score_claim(
    claim_lat: f64,
    claim_lon: f64,
    claim_ts: &str,
    accuracy_m: f64,
    integrity_attested: bool,
    previous: Option<&PreviousClaim>,
    max_plausible_speed_mps: f64,
) -> FraudScore {
    let mut signals = Vec::new();

    // Teleport / impossible-travel check against the last accepted claim.
    if let (Some(prev), Some(now_ts)) = (previous, parse_ts(claim_ts)) {
        if let Some(prev_ts) = parse_ts(&prev.timestamp_utc) {
            let dt = (now_ts - prev_ts).as_seconds_f64();
            let d = distance_m(prev.latitude, prev.longitude, claim_lat, claim_lon);
            if dt > 0.0 {
                let speed = d / dt;
                if speed > max_plausible_speed_mps {
                    signals.push(FraudSignal {
                        signal: "speed_violation".into(),
                        value: 1.0,
                        detail: format!(
                            "{speed:.1} m/s over {d:.0} m exceeds limit {max_plausible_speed_mps:.1} m/s"
                        ),
                    });
                }
            } else if dt < 0.0 {
                // Claim timestamped before the previous accepted claim.
                signals.push(FraudSignal {
                    signal: "teleport".into(),
                    value: 1.0,
                    detail: "claim predates previous accepted claim".into(),
                });
            } else if d > accuracy_m.max(25.0) {
                // Identical second-granularity timestamps but materially
                // different locations: instantaneous teleport. Without this
                // branch, two same-second claims from different cities would
                // evade both the speed and backdating checks.
                signals.push(FraudSignal {
                    signal: "teleport".into(),
                    value: 1.0,
                    detail: format!("{d:.0} m displacement at identical timestamp"),
                });
            }
        }
    }

    // Suspiciously perfect accuracy is a spoofing tell on real GNSS hardware.
    if accuracy_m < 0.5 {
        signals.push(FraudSignal {
            signal: "accuracy_anomaly".into(),
            value: 0.5,
            detail: format!("reported accuracy {accuracy_m:.2} m below plausible GNSS floor"),
        });
    }

    if !integrity_attested {
        signals.push(FraudSignal {
            signal: "unattested".into(),
            value: 0.4,
            detail: "claim lacks app/device attestation".into(),
        });
    }

    // Score: hard signals dominate; soft signals accumulate.
    let score = signals
        .iter()
        .map(|s| s.value)
        .fold(0.0_f64, |acc, v| (acc + v).min(1.0));

    FraudScore { score, signals }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn teleport_is_flagged() {
        // Budapest → London in 60 seconds ≈ 24 km/s.
        let prev = PreviousClaim {
            latitude: 47.4979,
            longitude: 19.0402,
            timestamp_utc: "2026-06-12T10:00:00Z".into(),
        };
        let s = score_claim(
            51.5074,
            -0.1278,
            "2026-06-12T10:01:00Z",
            8.0,
            true,
            Some(&prev),
            69.4,
        );
        assert!(s.score >= 0.7, "teleport must breach threshold: {s:?}");
        assert!(s.signals.iter().any(|x| x.signal == "speed_violation"));
    }

    #[test]
    fn normal_movement_is_clean() {
        // 500 m in 10 minutes.
        let prev = PreviousClaim {
            latitude: 47.4979,
            longitude: 19.0402,
            timestamp_utc: "2026-06-12T10:00:00Z".into(),
        };
        let s = score_claim(
            47.5024,
            19.0402,
            "2026-06-12T10:10:00Z",
            8.0,
            true,
            Some(&prev),
            69.4,
        );
        assert_eq!(s.score, 0.0, "clean claim must score zero: {s:?}");
    }

    #[test]
    fn backdated_claim_is_flagged() {
        let prev = PreviousClaim {
            latitude: 47.4979,
            longitude: 19.0402,
            timestamp_utc: "2026-06-12T10:00:00Z".into(),
        };
        let s = score_claim(
            47.4979,
            19.0402,
            "2026-06-12T09:59:00Z",
            8.0,
            true,
            Some(&prev),
            69.4,
        );
        assert!(s.signals.iter().any(|x| x.signal == "teleport"));
    }

    #[test]
    fn distance_sanity() {
        // Budapest–London ≈ 1450 km.
        let d = distance_m(47.4979, 19.0402, 51.5074, -0.1278);
        assert!((1_400_000.0..1_500_000.0).contains(&d), "got {d}");
    }
}
