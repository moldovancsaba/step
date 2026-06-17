//! Property, boundary, pole, antimeridian, hierarchy, area, neighbour and
//! precision tests (DEV §7.3, HARD §16.3 "Mesh unit tests").

use std::collections::HashSet;
use step_mesh_engine::*;

/// Deterministic LCG for reproducible pseudo-random sampling (no external deps).
struct Lcg(u64);
impl Lcg {
    fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
    /// Area-uniform random point on the sphere.
    fn point(&mut self) -> (f64, f64) {
        let lat = (self.next_f64() * 2.0 - 1.0).asin().to_degrees();
        let lon = self.next_f64() * 360.0 - 180.0;
        (lat, lon)
    }
}

#[test]
fn resolution_is_deterministic_and_self_consistent() {
    let mut rng = Lcg(42);
    for _ in 0..500 {
        let (lat, lon) = rng.point();
        for level in [1u8, 3, 8, 15, 21] {
            let a = lat_lon_to_triangle(lat, lon, level).unwrap();
            let b = lat_lon_to_triangle(lat, lon, level).unwrap();
            assert_eq!(a, b);
            assert!(
                contains_point(&a, lat, lon),
                "resolve→contains broken at {lat},{lon} L{level}"
            );
            assert_eq!(a.level(), level);
        }
    }
}

#[test]
fn hierarchy_is_consistent() {
    let mut rng = Lcg(7);
    for _ in 0..300 {
        let (lat, lon) = rng.point();
        let deep = lat_lon_to_triangle(lat, lon, 12).unwrap();
        // Walking parents must equal direct resolution at each ancestor level.
        let mut cur = deep.clone();
        for level in (1..12u8).rev() {
            cur = parent_triangle(&cur).unwrap();
            let direct = lat_lon_to_triangle(lat, lon, level).unwrap();
            // Boundary tie-breaks can legitimately differ between a child-walk
            // and a direct resolve only within the tie band; for random points
            // this is measure-zero, so require equality and rely on the seed
            // being fixed (failures here mean real nondeterminism).
            assert_eq!(cur, direct, "ancestor mismatch at level {level} for {lat},{lon}");
        }
        // children(parent) contains the triangle itself.
        let parent = parent_triangle(&deep).unwrap();
        assert!(child_triangles(&parent).unwrap().contains(&deep));
    }
}

#[test]
fn children_partition_parent() {
    // Random points inside a parent must resolve to exactly one of its 4 children.
    let mut rng = Lcg(99);
    for _ in 0..200 {
        let (lat, lon) = rng.point();
        let parent = lat_lon_to_triangle(lat, lon, 9).unwrap();
        let child = lat_lon_to_triangle(lat, lon, 10).unwrap();
        assert_eq!(parent_triangle(&child).unwrap(), parent);
    }
}

#[test]
fn poles_resolve_at_all_levels() {
    for &(lat, lon, tag) in &[
        (90.0, 0.0, "north pole"),
        (90.0, 137.0, "north pole other lon"),
        (-90.0, 0.0, "south pole"),
        (-90.0, -55.0, "south pole other lon"),
        (89.9999, 10.0, "near north"),
        (-89.9999, 10.0, "near south"),
    ] {
        for level in [1u8, 5, 10, 21] {
            let id = lat_lon_to_triangle(lat, lon, level)
                .unwrap_or_else(|e| panic!("{tag} failed at L{level}: {e}"));
            assert!(contains_point(&id, lat, lon), "{tag} containment at L{level}");
        }
    }
    // The exact pole is a 5-face boundary point: all longitudes must resolve to
    // the SAME deterministic triangle (lowest ID wins).
    for level in [1u8, 5, 13] {
        let canon = lat_lon_to_triangle(90.0, 0.0, level).unwrap();
        for lon in [-180.0, -90.0, -1.0, 33.3, 90.0, 179.9] {
            assert_eq!(
                lat_lon_to_triangle(90.0, lon, level).unwrap(),
                canon,
                "north pole nondeterministic at L{level}, lon {lon}"
            );
        }
    }
}

#[test]
fn antimeridian_is_stable() {
    // +180 and -180 are the same meridian: identical triangle required.
    for lat in [-60.0, -10.0, 0.0, 33.0, 71.0] {
        for level in [1u8, 8, 21] {
            let east = lat_lon_to_triangle(lat, 180.0, level).unwrap();
            let west = lat_lon_to_triangle(lat, -180.0, level).unwrap();
            assert_eq!(east, west, "±180 mismatch at lat {lat} L{level}");
        }
    }
    // Points immediately either side of ±180 resolve and are contained.
    for lat in [-45.0, 12.0, 64.0] {
        for lon in [179.999999, -179.999999] {
            let id = lat_lon_to_triangle(lat, lon, 21).unwrap();
            assert!(contains_point(&id, lat, lon));
        }
    }
}

#[test]
fn boundary_points_are_deterministic() {
    // Construct exact edge midpoints (true boundary points) and assert stable,
    // repeatable assignment that contains the point within tolerance.
    let mut rng = Lcg(2024);
    for _ in 0..100 {
        let (lat, lon) = rng.point();
        let id = lat_lon_to_triangle(lat, lon, 10).unwrap();
        let [va, vb, _vc] = triangle_to_vertices(&id);
        let a = LatLon { lat_deg: va.lat_deg, lon_deg: va.lon_deg }.to_unit_vector();
        let b = LatLon { lat_deg: vb.lat_deg, lon_deg: vb.lon_deg }.to_unit_vector();
        let mid = LatLon::from_unit_vector((a + b).normalized());

        let first = lat_lon_to_triangle(mid.lat_deg, mid.lon_deg, 10).unwrap();
        for _ in 0..3 {
            assert_eq!(first, lat_lon_to_triangle(mid.lat_deg, mid.lon_deg, 10).unwrap());
        }
        assert!(contains_point(&first, mid.lat_deg, mid.lon_deg));
    }
}

#[test]
fn neighbours_are_sane() {
    let mut rng = Lcg(5);
    for _ in 0..50 {
        let (lat, lon) = rng.point();
        for level in [2u8, 6, 12] {
            let id = lat_lon_to_triangle(lat, lon, level).unwrap();
            let ns = neighbour_triangles(&id);
            let set: HashSet<_> = ns.iter().cloned().collect();
            assert_eq!(set.len(), 3, "neighbours not distinct for {id}");
            assert!(!set.contains(&id), "triangle is its own neighbour: {id}");
            for n in &ns {
                assert_eq!(n.level(), level);
                // Symmetry: id must appear among each neighbour's neighbours.
                assert!(
                    neighbour_triangles(n).contains(&id),
                    "asymmetric adjacency between {id} and {n}"
                );
            }
        }
    }
}

#[test]
fn areas_and_sides_match_theory() {
    // Sum of the 20 base faces ≈ sphere surface.
    let sphere = 4.0 * std::f64::consts::PI * EARTH_RADIUS_M * EARTH_RADIUS_M;
    let total: f64 = (0..20).map(|f| triangle_area_m2(&TriangleId::base_face(f).unwrap())).sum();
    assert!(
        (total - sphere).abs() / sphere < 1e-9,
        "face areas sum to {total}, sphere is {sphere}"
    );

    // Children tile the parent: areas sum within numerical tolerance.
    let parent = lat_lon_to_triangle(47.4979, 19.0402, 8).unwrap();
    let kids = child_triangles(&parent).unwrap();
    let kids_sum: f64 = kids.iter().map(triangle_area_m2).sum();
    let parent_area = triangle_area_m2(&parent);
    assert!(((kids_sum - parent_area) / parent_area).abs() < 1e-6);

    // Side halving law S(n) ≈ S(1)/2^(n-1) within spherical distortion (SYS §6.5).
    let l1 = triangle_min_side_m(&TriangleId::base_face(2).unwrap());
    for level in [5u8, 10, 15] {
        let id = lat_lon_to_triangle(47.4979, 19.0402, level).unwrap();
        let expected = l1 / 2f64.powi(level as i32 - 1);
        let actual = triangle_min_side_m(&id);
        let ratio = actual / expected;
        assert!(
            (0.55..=1.45).contains(&ratio),
            "side length at L{level} = {actual} m, halving law predicts {expected} m (ratio {ratio})"
        );
    }

    // Level 21 is in the documented ~metres range (SYS §6.4 table: ≈7.6 m sides).
    let l21 = lat_lon_to_triangle(47.4979, 19.0402, 21).unwrap();
    let side = triangle_min_side_m(&l21);
    assert!((2.0..=20.0).contains(&side), "level-21 side {side} m outside expected human scale");
}

#[test]
fn boundary_policy_verdicts() {
    let (lat, lon) = (47.4979, 19.0402);
    let level = 21u8;
    let max_frac = 1.0;

    // Centroid with tiny accuracy → Inside.
    let id = lat_lon_to_triangle(lat, lon, level).unwrap();
    let c = triangle_centroid(&id);
    let d = boundary_policy(c.lat_deg, c.lon_deg, 0.05, level, max_frac).unwrap();
    assert_eq!(d.verdict, BoundaryVerdict::Inside);
    assert_eq!(d.triangle, id);

    // Same point, accuracy bigger than the triangle → RejectAccuracy.
    let d2 = boundary_policy(c.lat_deg, c.lon_deg, 500.0, level, max_frac).unwrap();
    assert_eq!(d2.verdict, BoundaryVerdict::RejectAccuracy);

    // Accuracy circle overlapping an edge → BoundaryAmbiguous.
    // distance_to_edge < accuracy < side: use accuracy slightly above the
    // centroid's edge distance.
    let amb_acc = d.distance_to_edge_m + 0.01;
    let d3 = boundary_policy(c.lat_deg, c.lon_deg, amb_acc, level, max_frac).unwrap();
    assert_eq!(d3.verdict, BoundaryVerdict::BoundaryAmbiguous);

    // Invalid inputs are rejected, not mis-scored.
    assert!(boundary_policy(91.0, 0.0, 5.0, level, max_frac).is_err());
    let d4 = boundary_policy(lat, lon, f64::NAN, level, max_frac).unwrap();
    assert_eq!(d4.verdict, BoundaryVerdict::RejectAccuracy);
}

#[test]
fn level21_resolution_is_fast_enough() {
    // MESH-009/DEV §7.1 efficiency requirement. Generous CI-safe bound:
    // 1000 level-21 resolutions in under 2 s (~2 ms each; native target <1 ms).
    let mut rng = Lcg(1);
    let points: Vec<(f64, f64)> = (0..1000).map(|_| rng.point()).collect();
    let start = std::time::Instant::now();
    for (lat, lon) in &points {
        let _ = lat_lon_to_triangle(*lat, *lon, 21).unwrap();
    }
    let elapsed = start.elapsed();
    assert!(elapsed.as_secs_f64() < 2.0, "1000 level-21 resolutions took {elapsed:?}");
}

#[test]
fn invalid_inputs_are_rejected() {
    assert!(lat_lon_to_triangle(90.1, 0.0, 5).is_err());
    assert!(lat_lon_to_triangle(0.0, 180.1, 5).is_err());
    assert!(lat_lon_to_triangle(f64::NAN, 0.0, 5).is_err());
    assert!(lat_lon_to_triangle(0.0, 0.0, 0).is_err());
    assert!(lat_lon_to_triangle(0.0, 0.0, MAX_LEVEL + 1).is_err());
    assert!(!contains_point(&TriangleId::base_face(0).unwrap(), f64::INFINITY, 0.0));
}
