/**
 * Adjust competition counts by removing one detected site.
 *
 * Rules:
 * - If any competitors are detected, subtract one (penalty) from the
 *   detected total before calculations.
 * - Special case: when exactly one competitor is detected, subtract 0.8
 *   (so a single competitor still leaves a small competitive impact).
 * - Heavy (big box) competitors cannot exceed the adjusted total.
 *
 * @param {number} compCountDetected Total detected competitors within the radius.
 * @param {number} heavyCountDetected Detected heavy (big box) competitors.
 * @returns {{ compCount: number, heavyCount: number }} Adjusted counts for math.
 */
export function adjustCompetitionCounts(compCountDetected, heavyCountDetected) {
  const detected = Number.isFinite(compCountDetected) ? Math.max(0, compCountDetected) : 0;
  const heavyDetected = Number.isFinite(heavyCountDetected) ? Math.max(0, heavyCountDetected) : 0;

  const penalty = detected === 1 ? 0.8 : 1;
  const compCount = Math.max(0, detected - penalty);
  const heavyCount = Math.min(heavyDetected, compCount);

  return { compCount, heavyCount };
}
