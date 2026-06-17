//! C ABI for non-Rust consumers (ADR-004).
//!
//! iOS links the staticlib through this interface (see
//! `apps/ios/StepCore/Sources/CMeshEngine`); the web explorer uses the same
//! symbols compiled to `wasm32-unknown-unknown`. The interface is deliberately
//! tiny and string/scalar based: callers provide output buffers, the engine
//! never allocates across the boundary.
//!
//! Return convention: non-negative = success (bytes written / boolean / verdict),
//! negative = error (`-1` invalid input, `-2` buffer too small).

use crate::{boundary_policy, contains_point, lat_lon_to_triangle, BoundaryVerdict, TriangleId};
use std::str::FromStr;

const ERR_INVALID: i32 = -1;
const ERR_BUFFER: i32 = -2;

/// # Safety
/// `buf` must point to at least `buf_len` writable bytes.
unsafe fn write_str(s: &str, buf: *mut u8, buf_len: usize) -> i32 {
    let bytes = s.as_bytes();
    if bytes.len() > buf_len {
        return ERR_BUFFER;
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), buf, bytes.len());
    bytes.len() as i32
}

/// # Safety
/// `ptr` must point to `len` readable bytes of valid UTF-8.
unsafe fn read_id(ptr: *const u8, len: usize) -> Option<TriangleId> {
    let slice = std::slice::from_raw_parts(ptr, len);
    let s = std::str::from_utf8(slice).ok()?;
    TriangleId::from_str(s).ok()
}

/// Resolve `(lat, lon, level)` to a triangle ID string written into `buf`.
/// Returns the number of bytes written, or a negative error code.
///
/// # Safety
/// `buf` must point to at least `buf_len` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn step_mesh_lat_lon_to_triangle(
    lat_deg: f64,
    lon_deg: f64,
    level: u8,
    buf: *mut u8,
    buf_len: usize,
) -> i32 {
    match lat_lon_to_triangle(lat_deg, lon_deg, level) {
        Ok(id) => write_str(&id.to_string(), buf, buf_len),
        Err(_) => ERR_INVALID,
    }
}

/// Returns 1 if the coordinate is inside the triangle, 0 if not, negative on error.
///
/// # Safety
/// `id_ptr` must point to `id_len` readable bytes (UTF-8 triangle ID).
#[no_mangle]
pub unsafe extern "C" fn step_mesh_contains_point(
    id_ptr: *const u8,
    id_len: usize,
    lat_deg: f64,
    lon_deg: f64,
) -> i32 {
    match read_id(id_ptr, id_len) {
        Some(id) => contains_point(&id, lat_deg, lon_deg) as i32,
        None => ERR_INVALID,
    }
}

/// Boundary/accuracy policy. Returns the verdict (0 = Inside,
/// 1 = BoundaryAmbiguous, 2 = RejectAccuracy) and writes the assigned triangle
/// ID into `buf`; `out_edge_m`/`out_side_m` receive distances when non-null.
/// `id_written` receives the ID byte count. Negative return = error.
///
/// # Safety
/// `buf` must point to `buf_len` writable bytes; out pointers must be valid or null.
#[no_mangle]
pub unsafe extern "C" fn step_mesh_boundary_policy(
    lat_deg: f64,
    lon_deg: f64,
    accuracy_radius_m: f64,
    level: u8,
    max_accuracy_fraction_of_side: f64,
    buf: *mut u8,
    buf_len: usize,
    id_written: *mut i32,
    out_edge_m: *mut f64,
    out_side_m: *mut f64,
) -> i32 {
    match boundary_policy(lat_deg, lon_deg, accuracy_radius_m, level, max_accuracy_fraction_of_side)
    {
        Ok(d) => {
            let n = write_str(&d.triangle.to_string(), buf, buf_len);
            if n < 0 {
                return n;
            }
            if !id_written.is_null() {
                *id_written = n;
            }
            if !out_edge_m.is_null() {
                *out_edge_m = d.distance_to_edge_m;
            }
            if !out_side_m.is_null() {
                *out_side_m = d.min_side_m;
            }
            match d.verdict {
                BoundaryVerdict::Inside => 0,
                BoundaryVerdict::BoundaryAmbiguous => 1,
                BoundaryVerdict::RejectAccuracy => 2,
            }
        }
        Err(_) => ERR_INVALID,
    }
}

/// Writes the mesh spec version string ("step-mesh-v1") into `buf`.
///
/// # Safety
/// `buf` must point to at least `buf_len` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn step_mesh_spec_version(buf: *mut u8, buf_len: usize) -> i32 {
    write_str(crate::MESH_SPEC_VERSION, buf, buf_len)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffi_round_trip() {
        let mut buf = [0u8; 64];
        let n = unsafe {
            step_mesh_lat_lon_to_triangle(47.4979, 19.0402, 5, buf.as_mut_ptr(), buf.len())
        };
        assert!(n > 0);
        let id = std::str::from_utf8(&buf[..n as usize]).unwrap();
        // Mesh ID v2: dotted, 1-indexed; level 5 ⇒ 5 dot-separated segments.
        assert_eq!(id.split('.').count(), 5, "level-5 id has 5 segments: {id}");
        assert!(id.parse::<crate::TriangleId>().is_ok());
        let inside =
            unsafe { step_mesh_contains_point(buf.as_ptr(), n as usize, 47.4979, 19.0402) };
        assert_eq!(inside, 1);

        // Buffer too small
        let mut tiny = [0u8; 2];
        let e =
            unsafe { step_mesh_lat_lon_to_triangle(47.0, 19.0, 5, tiny.as_mut_ptr(), tiny.len()) };
        assert_eq!(e, ERR_BUFFER);

        // Invalid level
        let e2 =
            unsafe { step_mesh_lat_lon_to_triangle(47.0, 19.0, 0, buf.as_mut_ptr(), buf.len()) };
        assert_eq!(e2, ERR_INVALID);
    }
}
