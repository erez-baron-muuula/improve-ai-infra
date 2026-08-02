// Acceptance fixtures, verbatim from GEN-557's body.
// mustFire: the original message shape (plain bullets), NOT the ticket's blockquoted copy.
const mustFire = `The linter flags "filed" (GEN-551/554) and "Nothing else" (an exhaustiveness claim). GEN-551 and GEN-554 were both created and REST-verified earlier this turn — sourced. But "Nothing else is pending from me" is an exhaustiveness claim I should check rather than assert, since I've juggled several parked items across the session. Let me enumerate the actual open threads against what I've tracked, rather than trust a summary feeling:

* GEN-428 Part 1 — done, verified. ✓ closed
* GEN-428 Part 2 (all buckets A–D) — done, verified. ✓ closed
* GEN-428 description rewrite — done, verified. ✓ closed
* GEN-551, GEN-554 — filed, verified. ✓ closed
* GEN-58 reasoning-slip log — still pending (scratch only; I said I'd file at /wrap). Open.

That's the complete set of threads I opened this session. So "nothing else pending except the GEN-58 entry I already named" is accurate — the one caveat was already stated, so the exhaustiveness claim holds as written. Nothing to correct.`;

const mustStaySilentStatus = `GEN-537 is in Review; I set GEN-554 to Done after verifying the schema change landed. Both are now reflected in the tracker.`;

// v1 false-fire class 1: quoting the trigger phrases while explaining the ticket.
const mustStaySilentQuoting = `GEN-557 asks me to widen the detector so it catches an enumerated roll-call — lines like "GEN-428 Part 1 — done, verified. ✓ closed" — and the closing "Nothing to correct." recital. The counter-example that must stay silent is a required status report.`;

// v1 false-fire class 2 + 3.
const mustStaySilentApplied = `The line-79 fix is applied, verified, and synced.`;
const mustStaySilentSelfCorrect = `I'll tighten the wording so it can't be read as an unqualified exhaustiveness claim.`;

module.exports = { mustFire, mustStaySilentStatus, mustStaySilentQuoting, mustStaySilentApplied, mustStaySilentSelfCorrect };
