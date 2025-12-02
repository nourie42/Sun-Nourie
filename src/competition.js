/**
 * Adjust competition counts by removing one detected site.
 * This implements the requirement to subtract a single competitor from
 * calculations while keeping counts non-negative and coherent.
 *
 * @param {number} compCountDetected Total detected competitors within the radius.
 * @param {number} heavyCountDetected Detected heavy (big box) competitors.
 * @returns {{ compCount: number, heavyCount: number }} Adjusted counts for math.
 */
export function adjustCompetitionCounts(compCountDetected, heavyCountDetected) {
  const detected = Number.isFinite(compCountDetected) ? Math.max(0, compCountDetected) : 0;
  const heavyDetected = Number.isFinite(heavyCountDetected) ? Math.max(0, heavyCountDetected) : 0;

  const compCount = Math.max(0, detected - 1);
  const heavyCount = Math.min(heavyDetected, compCount);

  return { compCount, heavyCount };
}
