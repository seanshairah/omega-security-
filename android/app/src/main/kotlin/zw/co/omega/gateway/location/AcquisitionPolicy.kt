package zw.co.omega.gateway.location

/**
 * Decides, as fixes stream in, when a location check has heard enough. Pure, unit-tested.
 *
 * A cold GPS start often reports its first fix at 100–150 m and tightens to 10–20 m within
 * a few seconds; a single-shot request never sees the improvement and the check ends as
 * `poor_accuracy`. So the monitor listens to every provider at once, keeps the best fix and
 * stops as soon as one of these holds:
 *   - the best fix is "good enough" (≤ goodEnoughM): no point waiting;
 *   - the best fix is usable (≤ acceptableM) and we have listened at least settleMs, giving the
 *     receiver a moment to improve past the boundary band;
 *   - the budget is spent.
 * The accuracy limit itself is not relaxed: a fix worse than acceptableM is still UNKNOWN.
 */
data class AcquisitionPolicy(
    val budgetMs: Long = 60_000L,
    val goodEnoughM: Float = 25f,
    val acceptableM: Float = 100f,
    val settleMs: Long = 15_000L,
)

data class FixSummary(val accuracyM: Float, val timeMs: Long, val provider: String)

enum class Decision { CONTINUE, STOP }

fun decide(policy: AcquisitionPolicy, best: FixSummary?, elapsedMs: Long): Decision = when {
    elapsedMs >= policy.budgetMs -> Decision.STOP
    best == null -> Decision.CONTINUE
    best.accuracyM <= policy.goodEnoughM -> Decision.STOP
    best.accuracyM <= policy.acceptableM && elapsedMs >= policy.settleMs -> Decision.STOP
    else -> Decision.CONTINUE
}

/** Lower accuracy wins; equal accuracy prefers the newer fix. */
fun better(a: FixSummary?, b: FixSummary): FixSummary = when {
    a == null -> b
    b.accuracyM < a.accuracyM -> b
    b.accuracyM == a.accuracyM && b.timeMs >= a.timeMs -> b
    else -> a
}
