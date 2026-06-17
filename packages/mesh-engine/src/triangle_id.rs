//! Deterministic triangle identifiers (SYS §7.3, ADR-002 §5).
//!
//! String form: `STEP-{level}-F{face:02}` for level 1, plus `-{base4path}` for
//! deeper levels, where the path has exactly `level - 1` digits and digit `d`
//! at position `i` selects child `d` at subdivision step `i` (0 = near vertex A,
//! 1 = near B, 2 = near C, 3 = centre — SYS §7.4).
//!
//! Ordering ("lowest triangle ID wins", HARD §5.7): triangles at the same level
//! compare by `(face, path)` lexicographically. Cross-level ordering compares by
//! `(level, face, path)`; the protocol only ever tie-breaks within one level.

use crate::MeshError;
use std::fmt;
use std::str::FromStr;

pub const MAX_LEVEL: u8 = 25;

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
        write!(f, "STEP-{}-F{:02}", self.level, self.face)?;
        if !self.path.is_empty() {
            f.write_str("-")?;
            for d in &self.path {
                write!(f, "{d}")?;
            }
        }
        Ok(())
    }
}

impl FromStr for TriangleId {
    type Err = MeshError;

    fn from_str(s: &str) -> Result<Self, MeshError> {
        let mut parts = s.split('-');
        let parse_err = || MeshError::Parse(s.to_string());
        if parts.next() != Some("STEP") {
            return Err(parse_err());
        }
        let level: u8 = parts.next().ok_or_else(parse_err)?.parse().map_err(|_| parse_err())?;
        let face_part = parts.next().ok_or_else(parse_err)?;
        let face: u8 =
            face_part.strip_prefix('F').ok_or_else(parse_err)?.parse().map_err(|_| parse_err())?;
        let path: Vec<u8> = match parts.next() {
            None => Vec::new(),
            Some(p) => p
                .chars()
                .map(|c| match c {
                    '0'..='3' => Ok(c as u8 - b'0'),
                    _ => Err(parse_err()),
                })
                .collect::<Result<_, _>>()?,
        };
        if parts.next().is_some() {
            return Err(parse_err());
        }
        TriangleId::new(face, level, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_validation() {
        let id = TriangleId::new(7, 4, vec![0, 3, 2]).unwrap();
        assert_eq!(id.to_string(), "STEP-4-F07-032");
        assert_eq!("STEP-4-F07-032".parse::<TriangleId>().unwrap(), id);

        let base = TriangleId::base_face(19).unwrap();
        assert_eq!(base.to_string(), "STEP-1-F19");
        assert_eq!("STEP-1-F19".parse::<TriangleId>().unwrap(), base);

        assert!(TriangleId::new(20, 1, vec![]).is_err());
        assert!(TriangleId::new(0, 2, vec![]).is_err()); // wrong path length
        assert!(TriangleId::new(0, 2, vec![4]).is_err()); // bad digit
        assert!("STEP-4-F07-04X".parse::<TriangleId>().is_err());
        assert!("MESH-4-F07-032".parse::<TriangleId>().is_err());
    }

    #[test]
    fn parent_child_round_trip() {
        let id = TriangleId::new(3, 5, vec![1, 2, 0, 3]).unwrap();
        let child = id.child(2).unwrap();
        assert_eq!(child.parent().unwrap(), id);
        assert_eq!(child.to_string(), "STEP-6-F03-12032");
        assert!(TriangleId::base_face(0).unwrap().parent().is_none());
    }

    #[test]
    fn ordering_is_face_then_path_within_level() {
        let a = TriangleId::new(2, 3, vec![0, 1]).unwrap();
        let b = TriangleId::new(2, 3, vec![0, 2]).unwrap();
        let c = TriangleId::new(3, 3, vec![0, 0]).unwrap();
        assert!(a < b);
        assert!(b < c);
    }
}
