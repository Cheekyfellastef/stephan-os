# Recovery Mesh Guardian TaskResult width repair

Goal #2519 specialist repair. The existing Windows Recovery Mesh Guardian incorrectly casts Task Scheduler's HRESULT `0x800710E0` (2147946720) to signed 32-bit `[int]`. That can make the Guardian itself exit 1 before it can report and recover the failing task.

The exact final PR shall change only `scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1`: read the result as `[long]` at both read and postcondition checks. Failure remains nonzero; no task creation, shell expansion, elevation, new controller or merge bypass is introduced.

This bootstrap note will be removed from the final source diff to qualify the existing frozen Windows Authority Recovery Mesh Guardian specialist. Run the isolated overflow regression and existing Guardian tests, protected exact-head review, independent security review, then live scheduled task proof. This plan alone is not repair proof.
