/** Bounded back-and-forth movement; no duplicated interactive categories. */
export function advanceCarousel(position: number, direction: 1 | -1, distance: number, maximum: number) {
  const limit = Math.max(0, maximum);
  const next = Math.min(limit, Math.max(0, position + direction * Math.max(0, distance)));
  return { position: next, direction: (next >= limit ? -1 : next <= 0 ? 1 : direction) as 1 | -1 };
}
