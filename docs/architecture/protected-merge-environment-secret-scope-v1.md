# Protected Merge Environment Secret Scope V1

This bounded repair restores the existing `operator-merge-approval` environment binding to the three personal-repository protected lifecycle jobs that mint the existing ruleset-proof GitHub App token.

The repair is evidence-driven by failed protected merge run `33311009624`, job `99255935971`, where `actions/create-github-app-token@v2` failed with `appId option is required` before any merge action. The current workflow references `STEPHANOS_RULESET_PROOF_APP_ID` and `STEPHANOS_RULESET_PROOF_APP_PRIVATE_KEY`; historical protected configuration activation bound the token-minting jobs to the protected environment.

No credential values change. No permissions widen. No direct merge, deployment, runtime mutation, arbitrary workflow, shell, or provider authority is added. The current native ready lifecycle remains intact.
