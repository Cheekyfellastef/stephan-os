# Exact-commit reviewer execution custody (#1574 / PR #3090)

Structural design review: repeated path rehashes cannot close verify-to-import
TOCTOU. The invariant is that **no candidate entry or dependency evaluates from
worktree bytes**. Both fixed launchers now serialize installed-parent loader code
into Node argv. The loader authenticates raw commit, tree and blob objects by
Git object hash, walks only the closed module inventory, and captures the entire
graph in memory before evaluation. It serves those bytes through ESM hooks;
unknown modules, aliases, query URLs, symlinks, replacement objects, missing or
corrupt objects fail closed. There is no executable staging directory to swap.
Worktree/source checks remain useful denial checks, not execution trust roots.

The trusted base is the independently installed Commander/Windows bridge and its
loader dependency, the fixed OS Node/Git binaries and authenticated request head.
Installation must independently protect and version that parent closure. Running
an arbitrary copy of Commander from a hostile checkout does not establish this
precondition. The candidate cannot enroll or attest that trusted base itself.
Native child environments exclude Node preload/module-path injection. The fixed
loader Git environment disables grafts, replacement objects, lazy fetch, hooks
and helper execution; object hashing also rejects mutated object-store content.

Tests execute real fixture Git repositories under hostile skip-worktree content,
entry/dependency replacement after argv construction, replacement refs, changed
HEAD, unknown imports, missing objects and corrupt blob content. Both production
graphs initialize from their committed bytes with absent identity and HOLD,
without model inference. Hosted Windows/Linux jobs check the exact PR head and
use no model/review-provider meter. These tests establish source execution
custody, not physical WSL invocation or independent specialist acceptance.

Separate gates remain: qualified current-head specialist review; protected
operator merge; independently installed parent protection and OS identities;
Battle Bridge WSL/native acceptance; installed Ollama digest support; protected
signer enrollment. Candidate results remain unqualified. No R7 lease authority,
reviewer self-approval, automatic merge, gaming override or deployment is added.

Follow-up closure: the calibration's own Git identity check now also uses the
canonical fixed execution boundary, not merely the bridge's trusted preflight.
It disables replacements/grafts/lazy fetch, global configuration, hooks,
fsmonitor and credential helpers. A real hostile-repository regression combines
replace refs, substituted worktree/index bytes and an executable fsmonitor;
inspection must HOLD without executing that helper or changing any source.
This is meter-free source hardening, not a substitute for independent review or
physical installed-Ollama digest-addressing proof.
