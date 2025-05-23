export const degToRad = (degrees: number): number => degrees * Math.PI / 180;
export const radToDeg = (radians: number): number => radians * 180 / Math.PI;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const lerp = (start: number, end: number, t: number): number =>
  start + (end - start) * t;

export const distance = (p1: [number, number], p2: [number, number]): number => {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  return Math.sqrt(dx * dx + dy * dy);
};

export const normalizeAngle = (angle: number): number => {
  angle = angle % 360;
  return angle < 0 ? angle + 360 : angle;
};

export const scaleValue = (value: number, fromRange: [number, number], toRange: [number, number]): number => {
  const [fromMin, fromMax] = fromRange;
  const [toMin, toMax] = toRange;
  const normalized = (value - fromMin) / (fromMax - fromMin);
  return toMin + normalized * (toMax - toMin);
};

export const createMatrix4 = (): number[] => {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
};

export const multiplyMatrices = (a: number[], b: number[]): number[] => {
  const result = createMatrix4();
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      result[i * 4 + j] = 
        a[i * 4 + 0] * b[0 * 4 + j] +
        a[i * 4 + 1] * b[1 * 4 + j] +
        a[i * 4 + 2] * b[2 * 4 + j] +
        a[i * 4 + 3] * b[3 * 4 + j];
    }
  }
  return result;
};

export const createTranslationMatrix = (x: number, y: number, z: number): number[] => {
  const m = createMatrix4();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
};

export const createRotationMatrix = (rx: number, ry: number, rz: number): number[] => {
  const m = createMatrix4();
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  m[0] = cy * cz;
  m[1] = -cy * sz;
  m[2] = sy;

  m[4] = cx * sz + cz * sx * sy;
  m[5] = cx * cz - sx * sy * sz;
  m[6] = -cy * sx;

  m[8] = sx * sz - cx * cz * sy;
  m[9] = cz * sx + cx * sy * sz;
  m[10] = cx * cy;

  return m;
};

export const createScaleMatrix = (s: number): number[] => {
  const m = createMatrix4();
  m[0] = s;
  m[5] = s;
  m[10] = s;
  return m;
};

export const transformPoint = (point: [number, number, number], matrix: number[]): [number, number, number] => {
  const [x, y, z] = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w
  ];
};
