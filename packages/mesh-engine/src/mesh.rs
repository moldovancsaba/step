//! Core MESH geometry: icosahedron construction, subdivision, resolution,
//! containment, neighbours, area, centroid, and the boundary/accuracy policy.

use crate::triangle_id::TriangleId;
use crate::vec3::{LatLon, Vec3};
use crate::{MeshError, CONTAINS_EPS, EARTH_RADIUS_M, TIE_EPS};
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// Icosahedron (step-mesh-v1 orientation, ADR-002)
// ---------------------------------------------------------------------------
//
// Orientation: one vertex at the geographic North Pole, one at the South Pole,
// upper ring of 5 vertices at latitude atan(1/2) with longitudes 0°,72°,…,288°,
// lower ring at latitude −atan(1/2) with longitudes 36°,108°,…,324°.
// Rotation constant about the polar axis: 0° (frozen for v1; OPEN-10 resolved
// here and recorded in docs/geography/STEP_mesh_mathematics.md).
//
// Face order: F00–F04 north polar cap, F05–F09 upper-middle band,
// F10–F14 lower-middle band, F15–F19 south polar cap, each band ordered by
// ascending longitude index. Every face's vertex triple is wound
// counter-clockwise viewed from outside the sphere (det[A,B,C] > 0); the
// constructor enforces this deterministically and a test asserts it.

fn icosahedron_faces() -> &'static [[Vec3; 3]; 20] {
    static FACES: OnceLock<[[Vec3; 3]; 20]> = OnceLock::new();
    FACES.get_or_init(|| {
        let north = Vec3::new(0.0, 0.0, 1.0);
        let south = Vec3::new(0.0, 0.0, -1.0);
        let ring_lat = 0.5_f64.atan(); // atan(1/2) ≈ 26.565°
        let upper: Vec<Vec3> = (0..5)
            .map(|i| {
                LatLon {
                    lat_deg: ring_lat.to_degrees(),
                    lon_deg: 72.0 * i as f64,
                }
                .to_unit_vector()
            })
            .collect();
        let lower: Vec<Vec3> = (0..5)
            .map(|i| {
                LatLon {
                    lat_deg: -ring_lat.to_degrees(),
                    lon_deg: 36.0 + 72.0 * i as f64,
                }
                .to_unit_vector()
            })
            .collect();

        let mut faces: Vec<[Vec3; 3]> = Vec::with_capacity(20);
        for i in 0..5 {
            let j = (i + 1) % 5;
            faces.push([north, upper[i], upper[j]]); // F00..F04
        }
        for i in 0..5 {
            let j = (i + 1) % 5;
            faces.push([upper[i], lower[i], upper[j]]); // F05..F09
        }
        for i in 0..5 {
            let j = (i + 1) % 5;
            faces.push([lower[i], upper[j], lower[j]]); // F10..F14
        }
        for i in 0..5 {
            let j = (i + 1) % 5;
            faces.push([lower[i], south, lower[j]]); // F15..F19
        }

        let mut out = [[Vec3::new(0.0, 0.0, 0.0); 3]; 20];
        for (k, f) in faces.into_iter().enumerate() {
            // Deterministic CCW (outward) winding fix: swap B and C if needed.
            let det = f[0].dot(f[1].cross(f[2]));
            out[k] = if det >= 0.0 { f } else { [f[0], f[2], f[1]] };
        }
        out
    })
}

/// Child vertex triples of a triangle (A,B,C): canonical subdivision per
/// SYS §7.4 — child 0 near A, 1 near B, 2 near C, 3 centre. Each child keeps
/// CCW winding (verified by test `subdivision_preserves_winding`).
fn child_vertices(t: &[Vec3; 3]) -> [[Vec3; 3]; 4] {
    let [a, b, c] = *t;
    let mab = (a + b).normalized();
    let mbc = (b + c).normalized();
    let mca = (c + a).normalized();
    [[a, mab, mca], [b, mbc, mab], [c, mca, mbc], [mab, mbc, mca]]
}

/// Signed containment margin of unit point `p` in spherical triangle (A,B,C):
/// the minimum, over the three oriented great-circle edge planes, of the sine
/// of the angular distance from `p` to that plane. Positive = inside.
fn margin(p: Vec3, t: &[Vec3; 3]) -> f64 {
    let [a, b, c] = *t;
    let m1 = p.dot(a.cross(b).normalized());
    let m2 = p.dot(b.cross(c).normalized());
    let m3 = p.dot(c.cross(a).normalized());
    m1.min(m2).min(m3)
}

/// Vertices of an arbitrary triangle, walking the subdivision path from its
/// base face. Deterministic: identical recomputation everywhere.
fn vertices_of(id: &TriangleId) -> [Vec3; 3] {
    let mut tri = icosahedron_faces()[id.face() as usize];
    for &d in id.path() {
        tri = child_vertices(&tri)[d as usize];
    }
    tri
}

fn validate_lat_lon(lat_deg: f64, lon_deg: f64) -> Result<(), MeshError> {
    if !lat_deg.is_finite()
        || !lon_deg.is_finite()
        || !(-90.0..=90.0).contains(&lat_deg)
        || !(-180.0..=180.0).contains(&lon_deg)
    {
        return Err(MeshError::InvalidCoordinate { lat_deg, lon_deg });
    }
    Ok(())
}

/// Among candidate triangles, pick the one containing `p` with the documented
/// tie-break: best margin wins; candidates within [`TIE_EPS`] of the best
/// margin tie-break to the lowest index (= lowest triangle ID, because callers
/// pass candidates in ascending ID order). Total: always returns an index.
fn pick_containing(p: Vec3, candidates: &[[Vec3; 3]]) -> usize {
    let margins: Vec<f64> = candidates.iter().map(|t| margin(p, t)).collect();
    let best = margins.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    margins
        .iter()
        .position(|&m| m >= best - TIE_EPS)
        .expect("non-empty candidate set always yields a position")
}

// ---------------------------------------------------------------------------
// Public API (DEV §7.1 required functions)
// ---------------------------------------------------------------------------

/// Resolve a coordinate to its containing triangle at `level`.
pub fn lat_lon_to_triangle(lat_deg: f64, lon_deg: f64, level: u8) -> Result<TriangleId, MeshError> {
    validate_lat_lon(lat_deg, lon_deg)?;
    if !(1..=crate::MAX_LEVEL).contains(&level) {
        return Err(MeshError::InvalidLevel(level));
    }
    let p = LatLon { lat_deg, lon_deg }.to_unit_vector();

    let faces = icosahedron_faces();
    let face = pick_containing(p, faces.as_slice()) as u8;
    let mut id = TriangleId::base_face(face)?;
    let mut tri = faces[face as usize];

    for _ in 1..level {
        let kids = child_vertices(&tri);
        let d = pick_containing(p, &kids) as u8;
        tri = kids[d as usize];
        id = id.child(d)?;
    }
    Ok(id)
}

/// Spherical triangle vertices (A, B, C) in degrees.
pub fn triangle_to_vertices(id: &TriangleId) -> [LatLon; 3] {
    let [a, b, c] = vertices_of(id);
    [
        LatLon::from_unit_vector(a),
        LatLon::from_unit_vector(b),
        LatLon::from_unit_vector(c),
    ]
}

/// True if the coordinate lies inside the triangle (within [`CONTAINS_EPS`]).
pub fn contains_point(id: &TriangleId, lat_deg: f64, lon_deg: f64) -> bool {
    if validate_lat_lon(lat_deg, lon_deg).is_err() {
        return false;
    }
    let p = LatLon { lat_deg, lon_deg }.to_unit_vector();
    margin(p, &vertices_of(id)) >= -CONTAINS_EPS
}

pub fn parent_triangle(id: &TriangleId) -> Option<TriangleId> {
    id.parent()
}

pub fn child_triangles(id: &TriangleId) -> Result<[TriangleId; 4], MeshError> {
    id.children()
}

/// The three edge-adjacent triangles at the same level.
///
/// Implementation: for each edge, take a probe point slightly beyond the edge
/// midpoint (along the centroid→midpoint direction) and resolve it globally at
/// the same level. Pure vector math, so neighbours across base-face boundaries,
/// the antimeridian, and the poles need no special cases.
pub fn neighbour_triangles(id: &TriangleId) -> [TriangleId; 3] {
    let tri = vertices_of(id);
    let centroid = (tri[0] + tri[1] + tri[2]).normalized();
    let edges = [(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])];
    let mut out: Vec<TriangleId> = Vec::with_capacity(3);
    for (u, v) in edges {
        let mid = (u + v).normalized();
        let outward = mid - centroid;
        let probe = (mid + outward.scale(0.25)).normalized();
        let ll = LatLon::from_unit_vector(probe);
        let n = lat_lon_to_triangle(ll.lat_deg, ll.lon_deg, id.level())
            .expect("probe point is a valid coordinate at a valid level");
        debug_assert_ne!(&n, id, "probe escaped across edge");
        out.push(n);
    }
    [out[0].clone(), out[1].clone(), out[2].clone()]
}

/// Spherical area in m² (l'Huilier's spherical excess × R²).
pub fn triangle_area_m2(id: &TriangleId) -> f64 {
    let [va, vb, vc] = vertices_of(id);
    let a = vb.angle_to(vc);
    let b = vc.angle_to(va);
    let c = va.angle_to(vb);
    let s = (a + b + c) / 2.0;
    let t =
        ((s / 2.0).tan() * ((s - a) / 2.0).tan() * ((s - b) / 2.0).tan() * ((s - c) / 2.0).tan())
            .max(0.0);
    let excess = 4.0 * t.sqrt().atan();
    excess * EARTH_RADIUS_M * EARTH_RADIUS_M
}

/// Centroid (spherical) for map display.
pub fn triangle_centroid(id: &TriangleId) -> LatLon {
    let [a, b, c] = vertices_of(id);
    LatLon::from_unit_vector((a + b + c).normalized())
}

/// Shortest edge arc length in metres.
pub fn triangle_min_side_m(id: &TriangleId) -> f64 {
    let [a, b, c] = vertices_of(id);
    let arcs = [a.angle_to(b), b.angle_to(c), c.angle_to(a)];
    arcs.into_iter().fold(f64::INFINITY, f64::min) * EARTH_RADIUS_M
}

// ---------------------------------------------------------------------------
// Boundary / accuracy policy (MESH-007, MESH-008)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoundaryVerdict {
    /// Point is clearly inside: nearest edge farther away than the accuracy radius.
    Inside,
    /// The accuracy circle overlaps an edge. The deterministic assignment stands,
    /// but validators may require stronger proof for sponsored claims (HARD §5.7).
    BoundaryAmbiguous,
    /// Accuracy radius is too large relative to the triangle: reject, or offer
    /// the miner a lower (larger) level (MESH-008).
    RejectAccuracy,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BoundaryDecision {
    pub verdict: BoundaryVerdict,
    /// Deterministically assigned triangle (always present, even on Reject,
    /// so downgrade flows can offer alternatives).
    pub triangle: TriangleId,
    /// Distance from the point to the nearest edge great-circle, in metres.
    pub distance_to_edge_m: f64,
    /// Shortest side of the assigned triangle, in metres.
    pub min_side_m: f64,
}

/// Accuracy/boundary policy. `max_accuracy_fraction_of_side` comes from the
/// protocol parameter registry (`mesh.max_accuracy_fraction_of_side`).
pub fn boundary_policy(
    lat_deg: f64,
    lon_deg: f64,
    accuracy_radius_m: f64,
    level: u8,
    max_accuracy_fraction_of_side: f64,
) -> Result<BoundaryDecision, MeshError> {
    let id = lat_lon_to_triangle(lat_deg, lon_deg, level)?;
    let p = LatLon { lat_deg, lon_deg }.to_unit_vector();
    let [a, b, c] = vertices_of(&id);

    // Angular distance to each edge plane; sin(d) = |p · n̂|. For points inside
    // the triangle this is the geodesic distance to the edge's great circle,
    // which lower-bounds the distance to the edge segment.
    let dist_edge_m = [
        a.cross(b).normalized(),
        b.cross(c).normalized(),
        c.cross(a).normalized(),
    ]
    .into_iter()
    .map(|n| p.dot(n).clamp(-1.0, 1.0).asin().abs() * EARTH_RADIUS_M)
    .fold(f64::INFINITY, f64::min);

    let min_side_m = triangle_min_side_m(&id);

    let verdict = if !accuracy_radius_m.is_finite()
        || accuracy_radius_m <= 0.0
        || accuracy_radius_m > max_accuracy_fraction_of_side * min_side_m
    {
        BoundaryVerdict::RejectAccuracy
    } else if dist_edge_m < accuracy_radius_m {
        BoundaryVerdict::BoundaryAmbiguous
    } else {
        BoundaryVerdict::Inside
    };

    Ok(BoundaryDecision {
        verdict,
        triangle: id,
        distance_to_edge_m: dist_edge_m,
        min_side_m,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icosahedron_is_well_formed() {
        let faces = icosahedron_faces();
        for f in faces.iter() {
            for v in f {
                assert!((v.norm() - 1.0).abs() < 1e-15);
            }
            // CCW winding (outward) after constructor fix-up.
            assert!(f[0].dot(f[1].cross(f[2])) > 0.0);
        }
        // All 20 faces together cover the sphere: every probe point is inside
        // at least one face (within numeric tolerance).
        let mut rng = 0x5DEECE66Du64;
        for _ in 0..2000 {
            rng = rng
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let lat = ((rng >> 16) as f64 / u64::MAX as f64 * 2.0 - 1.0)
                .asin()
                .to_degrees();
            rng = rng
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let lon = (rng >> 16) as f64 / (u64::MAX >> 16) as f64 * 360.0 - 180.0;
            let p = LatLon {
                lat_deg: lat,
                lon_deg: lon,
            }
            .to_unit_vector();
            let best = faces
                .iter()
                .map(|f| margin(p, f))
                .fold(f64::NEG_INFINITY, f64::max);
            assert!(best > -1e-9, "sphere coverage gap at lat={lat} lon={lon}");
        }
    }

    #[test]
    fn subdivision_preserves_winding() {
        for f in icosahedron_faces().iter() {
            let mut stack = vec![(*f, 0u8)];
            while let Some((tri, depth)) = stack.pop() {
                assert!(tri[0].dot(tri[1].cross(tri[2])) > 0.0);
                if depth < 4 {
                    for k in child_vertices(&tri) {
                        stack.push((k, depth + 1));
                    }
                }
            }
        }
    }
}
