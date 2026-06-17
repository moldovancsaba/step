//! Minimal 3D vector math on the unit sphere.
//!
//! All MESH containment logic happens in 3D unit-vector space (HARD §5.8):
//! no latitude/longitude arithmetic ever occurs in geometric predicates, which
//! is what makes antimeridian and pole handling structurally safe (ADR-002 §7).

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub fn dot(self, o: Vec3) -> f64 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }

    pub fn cross(self, o: Vec3) -> Vec3 {
        Vec3::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }

    pub fn norm(self) -> f64 {
        self.dot(self).sqrt()
    }

    pub fn normalized(self) -> Vec3 {
        let n = self.norm();
        Vec3::new(self.x / n, self.y / n, self.z / n)
    }

    pub fn scale(self, s: f64) -> Vec3 {
        Vec3::new(self.x * s, self.y * s, self.z * s)
    }

    /// Angle in radians between two unit vectors, numerically stable near 0 and π.
    pub fn angle_to(self, o: Vec3) -> f64 {
        self.cross(o).norm().atan2(self.dot(o))
    }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
}

/// Geographic coordinate in degrees (WGS84 lat/lon input; protocol sphere model).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LatLon {
    pub lat_deg: f64,
    pub lon_deg: f64,
}

impl LatLon {
    pub fn to_unit_vector(self) -> Vec3 {
        let lat = self.lat_deg.to_radians();
        let lon = self.lon_deg.to_radians();
        Vec3::new(lat.cos() * lon.cos(), lat.cos() * lon.sin(), lat.sin())
    }

    pub fn from_unit_vector(v: Vec3) -> Self {
        let v = v.normalized();
        LatLon { lat_deg: v.z.asin().to_degrees(), lon_deg: v.y.atan2(v.x).to_degrees() }
    }
}
