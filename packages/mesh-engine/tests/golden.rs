//! Golden vector replay (DEV §7.3). The committed TSV is the cross-language
//! conformance contract: Swift and TS suites replay the same file.

use std::str::FromStr;
use step_mesh_engine::{contains_point, lat_lon_to_triangle, TriangleId};

#[test]
fn golden_vectors_replay() {
    let raw = include_str!("../golden/golden_vectors.tsv");
    let mut checked = 0usize;
    for line in raw.lines() {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split('\t').collect();
        assert_eq!(cols.len(), 5, "malformed golden line: {line}");
        let (name, lat, lon, level, expected) = (
            cols[0],
            cols[1].parse::<f64>().unwrap(),
            cols[2].parse::<f64>().unwrap(),
            cols[3].parse::<u8>().unwrap(),
            cols[4],
        );
        let got = lat_lon_to_triangle(lat, lon, level).unwrap();
        assert_eq!(got.to_string(), expected, "golden mismatch for {name} at level {level}");
        // The resolved triangle must also contain its own resolving point.
        let id = TriangleId::from_str(expected).unwrap();
        assert!(contains_point(&id, lat, lon), "containment failed for {name} at level {level}");
        checked += 1;
    }
    assert!(checked >= 300, "golden file unexpectedly small: {checked} rows");
}
