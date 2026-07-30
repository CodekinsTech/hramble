// BUG: ignores the lower bound entirely.
export function clamp(n, min, max) {
  return n > max ? max : n
}
