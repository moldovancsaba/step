//! Deterministic triangle identifiers (Mesh ID v2 — see
//! docs/geography/STEP_mesh_id_v2.md).
//!
//! Public string form is a dotted, 1-indexed path: `<face>[.<child>]*`, where
//! `face ∈ 1..=20` is the base icosahedron triangle and each `child ∈ 1..=4`
//! selects a midpoint-subdivision quarter (1 = corner A, 2 = corner B,
//! 3 = corner C, 4 = centre). The level equals the number of segments: `7` is
//! level 1, `7.3` is level 2, `7.3.2` is level 3. Shorter id ⇒ larger triangle.
//!
//! Internally faces are stored 0–19 and children 0–3 (so the geometry kernel
//! can index arrays directly); the dotted form converts `+1` on serialize and
//! `−1` on parse. The slot (NFT) is NOT part of a TriangleId — it is appended by
//! the mining/NFT layer as `<triangleId>.<slot>` (slot 1..=27).
//!
//! Ordering ("lowest triangle ID wins"): triangles compare by
//! `(level, face, path)`; the protocol only tie-breaks within one level.

use crate::MeshError;
use std::fmt;
use std::str::FromStr;

/// Terminal (finest) mineable level — a fully-mined level-21 triangle is a
/// permanent desert and never subdivides further.
pub const MAX_LEVEL: u8 = 21;

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TriangleId {
    level: u8,
    face: u8,
    path: Vec<u8>,
}

// Field order above (level, face, path) gives the derived Ord exactly the
// documented (level, face, path) lexicographic ordering.

impl TriangleId {
    pub fn new(face: u8, level: u8, path: Vec<u8>) -> Result<Self, MeshError> {
        if face >= 20 {
            return Err(MeshError::InvalidFace(face));
        }
        if !(1..=MAX_LEVEL).contains(&level) {
            return Err(MeshError::InvalidLevel(level));
        }
        if path.len() != (level - 1) as usize {
            return Err(MeshError::InvalidPathLength { level, got: path.len() });
        }
        if path.iter().any(|&d| d > 3) {
            return Err(MeshError::InvalidPathDigit);
        }
        Ok(Self { level, face, path })
    }

    pub fn base_face(face: u8) -> Result<Self, MeshError> {
        Self::new(face, 1, Vec::new())
    }

    pub fn face(&self) -> u8 {
        self.face
    }

    pub fn level(&self) -> u8 {
        self.level
    }

    pub fn path(&self) -> &[u8] {
        &self.path
    }

    pub fn parent(&self) -> Option<TriangleId> {
        if self.level == 1 {
            return None;
        }
        let mut p = self.path.clone();
        p.pop();
        Some(TriangleId { level: self.level - 1, face: self.face, path: p })
    }

    pub fn child(&self, digit: u8) -> Result<TriangleId, MeshError> {
        if digit > 3 {
            return Err(MeshError::InvalidPathDigit);
        }
        if self.level >= MAX_LEVEL {
            return Err(MeshError::InvalidLevel(self.level + 1));
        }
        let mut p = self.path.clone();
        p.push(digit);
        Ok(TriangleId { level: self.level + 1, face: self.face, path: p })
    }

    pub fn children(&self) -> Result<[TriangleId; 4], MeshError> {
        Ok([self.child(0)?, self.child(1)?, self.child(2)?, self.child(3)?])
    }
}

impl fmt::Display for TriangleId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // 1-indexed dotted form: face, then each child quarter. Level is implied
        // by the segment count (see STEP_mesh_id_v2.md).
        write!(f, "{}", self.face + 1)?;
        for d in &self.path {
            write!(f, ".{}", d + 1)?;
        }
        Ok(())
    }
}

impl FromStr for TriangleId {
    type Err = MeshError;

    fn from_str(s: &str) -> Result<Self, MeshError> {
        let parse_err = || MeshError::Parse(s.to_string());
        let mut parts = s.split('.');
        // First segment = face (1..=20 → internal 0..=19).
        let face_1: u8 = parts.next().ok_or_else(parse_err)?.parse().map_err(|_| parse_err())?;
        if !(1..=20).contains(&face_1) {
            return Err(parse_err());
        }
        // Remaining segments = children (1..=4 → internal 0..=3).
        let path: Vec<u8> = parts
            .map(|seg| match seg.parse::<u8>() {
                Ok(c @ 1..=4) => Ok(c - 1),
                _ => Err(parse_err()),
            })
            .collect::<Result<_, _>>()?;
        let level = (path.len() + 1) as u8;
        TriangleId::new(face_1 - 1, level, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_validation() {
        // internal face 6 (→ display 7), children [0,3,2] (→ display 1.4.3), level 4
        let id = TriangleId::new(6, 4, vec![0, 3, 2]).unwrap();
        assert_eq!(id.to_string(), "7.1.4.3");
        assert_eq!("7.1.4.3".parse::<TriangleId>().unwrap(), id);

        let base = TriangleId::base_face(19).unwrap(); // internal 19 → display 20
        assert_eq!(base.to_string(), "20");
        assert_eq!("20".parse::<TriangleId>().unwrap(), base);

        // The very first mine's triangle on a virgin mesh is face 1 = "1".
        assert_eq!(TriangleId::base_face(0).unwrap().to_string(), "1");

        assert!(TriangleId::new(20, 1, vec![]).is_err()); // face out of range (internal max 19)
        assert!(TriangleId::new(0, 2, vec![]).is_err()); // wrong path length
        assert!(TriangleId::new(0, 2, vec![4]).is_err()); // bad digit
        assert!("7.1.5".parse::<TriangleId>().is_err()); // child 5 invalid
        assert!("0.1".parse::<TriangleId>().is_err()); // face 0 invalid (1-indexed)
        assert!("21.1".parse::<TriangleId>().is_err()); // face 21 invalid
        assert!("7.1.X".parse::<TriangleId>().is_err());
        assert!("STEP-4-F07-032".parse::<TriangleId>().is_err()); // old v1 form rejected
    }

    #[test]
    fn parent_child_round_trip() {
        // internal face 2 (→ display 3), children [1,2,0,3] (→ 2.3.1.4), level 5
        let id = TriangleId::new(2, 5, vec![1, 2, 0, 3]).unwrap();
        let child = id.child(2).unwrap();
        assert_eq!(child.parent().unwrap(), id);
        assert_eq!(child.to_string(), "3.2.3.1.4.3");
        assert!(TriangleId::base_face(0).unwrap().parent().is_none());
    }

    #[test]
    fn ordering_is_face_then_path_within_level() {
        let a = TriangleId::new(1, 3, vec![0, 1]).unwrap();
        let b = TriangleId::new(1, 3, vec![0, 2]).unwrap();
        let c = TriangleId::new(2, 3, vec![0, 0]).unwrap();
        assert!(a < b);
        assert!(b < c);
    }
}
