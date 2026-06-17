//! Golden vector generator (DEV §7.3 "golden coordinate tests").
//!
//! Writes `golden/golden_vectors.tsv`: the committed cross-language conformance
//! contract. Swift and TypeScript bindings replay this exact file; any
//! divergence from the canonical Rust engine fails CI (ADR-004).
//!
//! Regenerate ONLY on an intentional, versioned mesh-spec change:
//! `cargo run -p step-mesh-engine --bin golden-gen`

use std::fmt::Write as _;
use step_mesh_engine::{lat_lon_to_triangle, MESH_SPEC_VERSION};

/// Deterministic LCG so regeneration is reproducible.
struct Lcg(u64);
impl Lcg {
    fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn main() {
    let named: &[(&str, f64, f64)] = &[
        ("budapest", 47.4979, 19.0402),
        ("london", 51.5074, -0.1278),
        ("new_york", 40.7128, -74.0060),
        ("tokyo", 35.6762, 139.6503),
        ("sydney", -33.8688, 151.2093),
        ("san_francisco", 37.7749, -122.4194),
        ("rio", -22.9068, -43.1729),
        ("cape_town", -33.9249, 18.4241),
        ("reykjavik", 64.1466, -21.9426),
        ("singapore", 1.3521, 103.8198),
        ("auckland", -36.8485, 174.7633),
        ("anchorage", 61.2181, -149.9003),
        ("mcmurdo", -77.8419, 166.6863),
        ("longyearbyen", 78.2232, 15.6267),
        ("quito", -0.1807, -78.4678),
        ("suva_near_antimeridian", -18.1248, 178.4501),
        ("north_pole", 90.0, 0.0),
        ("south_pole", -90.0, 0.0),
        ("antimeridian_e", 0.0, 180.0),
        ("antimeridian_w", 0.0, -180.0),
        ("antimeridian_n", 45.0, 179.99999),
        ("antimeridian_s", -45.0, -179.99999),
        ("equator_prime", 0.0, 0.0),
    ];
    let levels: &[u8] = &[1, 2, 5, 10, 15, 21];

    let mut out = String::new();
    writeln!(out, "# STEP golden vectors — mesh spec {MESH_SPEC_VERSION}").unwrap();
    writeln!(out, "# columns: name\tlat_deg\tlon_deg\tlevel\ttriangle_id").unwrap();
    writeln!(out, "# DO NOT EDIT BY HAND; regenerate via golden-gen on spec change only").unwrap();

    for (name, lat, lon) in named {
        for &level in levels {
            let id = lat_lon_to_triangle(*lat, *lon, level).unwrap();
            writeln!(out, "{name}\t{lat:.7}\t{lon:.7}\t{level}\t{id}").unwrap();
        }
    }

    let mut rng = Lcg(0x57E9_0001);
    for i in 0..100 {
        // Area-uniform random points on the sphere.
        let lat = (rng.next_f64() * 2.0 - 1.0).asin().to_degrees();
        let lon = rng.next_f64() * 360.0 - 180.0;
        for &level in &[10u8, 21u8] {
            let id = lat_lon_to_triangle(lat, lon, level).unwrap();
            writeln!(out, "rand_{i:03}\t{lat:.7}\t{lon:.7}\t{level}\t{id}").unwrap();
        }
    }

    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("golden");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("golden_vectors.tsv");
    std::fs::write(&path, out).unwrap();
    println!("wrote {}", path.display());
}
