// Deliberately catches large regressions only. Small timing changes need the
// exploratory benchmark, not a noisy shared-runner gate.
export function compare(before, after, field = 'workMs') {
  const values = (samples) => samples.map((s) => s[field]).sort((a, b) => a - b);
  const a = values(before),
    b = values(after);
  if (a.length !== 6 || b.length !== 6 || [...a, ...b].some((v) => !Number.isFinite(v) || v <= 0))
    throw new Error(`Incomplete ${field} samples`);
  const median = (v) => (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  const baseline = median(a),
    candidate = median(b);
  const noise = Math.max(a.at(-1) - a[0], b.at(-1) - b[0]);
  const allowance = field === 'heapBytes' ? Math.max(baseline * 0.5, 1024 * 1024) : Math.max(baseline * 0.3, 30);
  const delta = candidate - baseline;
  return {
    baseline,
    candidate,
    ratio: candidate / baseline,
    noise,
    allowance,
    regression: delta > Math.max(allowance, noise * 2),
    inconclusive: delta > allowance && delta <= noise * 2,
  };
}
