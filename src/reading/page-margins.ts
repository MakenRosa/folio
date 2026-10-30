export type Box = [number, number, number, number];

// Work on an unfiltered thumbnail, not on the screen's dark/sepia/warm colors.
// An uncertain background or a blank page keeps its original dimensions.
export function contentRows(data: Uint8ClampedArray, width: number, height: number) {
  if (width < 16 || height < 16 || data.length !== width * height * 4) return null;
  const samples: number[][] = [[], [], []];
  for (const y of [0, height - 1]) {
    for (const x of [0, 1, width - 2, width - 1]) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) samples[c].push(data[i + c]);
    }
  }
  const paper = samples.map((values) => values.sort((a, b) => a - b)[4]);
  if (samples.some((values, c) => values.some((value) => Math.abs(value - paper[c]) > 4)))
    return null;
  let first = height;
  let last = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] && paper.some((value, c) => Math.abs(data[i + c] - value) > 2)) {
        first = Math.min(first, y);
        last = y;
        break;
      }
    }
  }
  return last < first ? null : { first, last: last + 1 };
}

export function validBox(value: unknown): value is Box {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(Number.isFinite) &&
    value[2] > value[0] &&
    value[3] > value[1]
  );
}

export function containedBox(box: Box, original: Box) {
  return (
    box[0] >= original[0] && box[1] >= original[1] && box[2] <= original[2] && box[3] <= original[3]
  );
}
