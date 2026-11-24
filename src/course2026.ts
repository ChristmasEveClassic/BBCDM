
export type CourseHole = {
  hole: number;
  metres: number;
  par: number;
  si: number;
};

// Clare Golf Club
// Men's white tees
// Par 72, 5,719 metres

const metres = [
  477, 373, 337, 416, 302, 288,
  114, 431, 187, 256, 311, 155,
  467, 127, 335, 305, 369, 469
];

const pars = [
  5, 4, 4, 4, 4, 4,
  3, 5, 3, 4, 4, 3,
  5, 3, 4, 4, 4, 5
];

const si = [
  9, 1, 7, 3, 11, 15,
  17, 13, 5, 18, 2, 12,
  6, 14, 8, 16, 4, 10
];

export const course2026: CourseHole[] =
  metres.map((m, i) => ({
    hole: i + 1,
    metres: m,
    par: pars[i],
    si: si[i]
  }));

export const METRES_TOTAL =
  metres.reduce((a, b) => a + b, 0);

export const MIN_DRIVES = 5;

export const frontNine = course2026.slice(0, 9);
export const backNine = course2026.slice(9);
