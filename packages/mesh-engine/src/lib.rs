//! # STEP MESH engine (`step-mesh-v1`)
//!
//! Canonical, deterministic spherical triangular MESH of the Earth.
//!
//! The Earth is modelled as a unit sphere (SYS §7.2 alpha decision: spherical
//! by design; distortion documented in `docs/geography/STEP_mesh_mathematics.md`).
//! Level 1 is a spherical icosahedron of 20 faces; every level-n triangle splits
//! into 4 level-(n+1) children by edge-midpoint subdivision, so
//! `T(n) = 20 × 4^(n-1)` (SYS §6.3).
//!
//! This crate is the single canonical implementation (ADR-004). iOS consumes it
//! as a staticlib via the C FFI in [`ffi`]; web consumes the same FFI compiled
//! to WASM. Cross-language conformance is enforced by the committed golden
//! vectors in `golden/golden_vectors.tsv`.
//!
//! Determinism guarantees (HARD §5.2):
//! - same `(lat, lon, level)` always resolves to the same triangle ID;
//! - boundary points resolve by "lowest triangle ID wins" within the tolerance
//!   band [`TIE_EPS`] (HARD §5.7);
//! - all predicates run in 3D unit-vector space — no lat/lon arithmetic — so
//!   poles and the antimeridian need no special cases.

mod mesh;
mod triangle_id;
mod vec3;

pub mod ffi;

pub use mesh::{
    boundary_policy, child_triangles, contains_point, cover, lat_lon_to_triangle,
    neighbour_triangles, parent_triangle, triangle_area_m2, triangle_centroid, triangle_min_side_m,
    triangle_to_vertices, BoundaryDecision, BoundaryVerdict, CoverResult, CoverTriangle,
};
pub use triangle_id::{TriangleId, MAX_LEVEL};
pub use vec3::{LatLon, Vec3};

/// Mesh specification version committed on-chain in `MeshRegistry`.
pub const MESH_SPEC_VERSION: &str = "step-mesh-v1";

/// Authalic mean Earth radius in metres. Used ONLY for metre-denominated
/// display/threshold conversions (areas, side lengths, edge distances) — never
/// inside containment predicates, which are purely angular.
pub const EARTH_RADIUS_M: f64 = 6_371_008.8;

/// Unit-sphere tolerance band for the lowest-ID boundary tie-break (ADR-002 §6,
/// mirrored in `config/protocol-params.alpha.json` as `mesh.boundary_tie_eps`).
pub const TIE_EPS: f64 = 1e-12;

/// Containment tolerance. Must be ≥ the worst-case margin a tie-broken boundary
/// resolution can produce (−TIE_EPS), so `contains_point(resolve(p), p)` always
/// holds.
pub const CONTAINS_EPS: f64 = 2e-12;

#[derive(Debug, Clone, PartialEq)]
pub enum MeshError {
    InvalidFace(u8),
    InvalidLevel(u8),
    InvalidPathLength { level: u8, got: usize },
    InvalidPathDigit,
    InvalidCoordinate { lat_deg: f64, lon_deg: f64 },
    Parse(String),
}

impl std::fmt::Display for MeshError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MeshError::InvalidFace(face) => write!(f, "invalid base face {face} (must be 0..=19)"),
            MeshError::InvalidLevel(l) => {
                write!(f, "invalid level {l} (must be 1..={})", MAX_LEVEL)
            }
            MeshError::InvalidPathLength { level, got } => {
                write!(f, "path length {got} does not match level {level}")
            }
            MeshError::InvalidPathDigit => write!(f, "path digits must be 0..=3"),
            MeshError::InvalidCoordinate { lat_deg, lon_deg } => {
                write!(f, "invalid coordinate lat={lat_deg} lon={lon_deg}")
            }
            MeshError::Parse(s) => write!(f, "unparseable triangle id: {s}"),
        }
    }
}

impl std::error::Error for MeshError {}

impl MeshError {
    /// Wire-stable error variant name shared with FFI consumers; the Display
    /// string is human-readable detail, this is the contract.
    pub fn code(&self) -> &'static str {
        match self {
            MeshError::InvalidFace(_) => "invalid_face",
            MeshError::InvalidLevel(_) => "invalid_level",
            MeshError::InvalidPathLength { .. } => "invalid_path_length",
            MeshError::InvalidPathDigit => "invalid_path_digit",
            MeshError::InvalidCoordinate { .. } => "invalid_coordinate",
            MeshError::Parse(_) => "parse_error",
        }
    }
}
