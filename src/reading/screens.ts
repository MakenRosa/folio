export type EdgeReturn = { from: number; to: number } | null;

export function turnScreen(input: {
  top: number;
  max: number;
  height: number;
  scale: number;
  pixelRatio: number;
  direction: number;
  edgeReturn: EdgeReturn;
}): { top: number; edgeReturn: EdgeReturn } {
  const { top: from, max, height, scale, pixelRatio, direction, edgeReturn } = input;
  const overlap = Math.min(height * 0.2, Math.max(32, 32 * scale));
  // Physical pixel alignment prevents accumulated drift at Windows scaling
  // factors such as 125% or 150%. The overlap keeps a cut line on the next screen.
  const step = Math.max(1, Math.floor((height - overlap) * pixelRatio) / pixelRatio);
  let top = Math.max(0, Math.min(max, from + Math.sign(direction) * step));
  if (
    edgeReturn &&
    Math.abs(from - edgeReturn.to) < 1 &&
    Math.sign(direction) === Math.sign(edgeReturn.from - edgeReturn.to)
  ) {
    top = edgeReturn.from;
  }
  // An extra forward press at the end must not forget the previous partial turn.
  if (Math.abs(top - from) < 0.5) return { top: from, edgeReturn };
  return {
    top,
    edgeReturn: Math.abs(top - from) < step - 1 ? { from, to: top } : null,
  };
}
