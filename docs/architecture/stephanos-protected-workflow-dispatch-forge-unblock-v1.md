# Forge Commissioning Unblock via Protected Workflow Dispatch V1

The first real Forge commissioning attempt reached a source-ready Podman prerequisite repair (#1805) but could not dispatch its required protected merge workflow from the active ChatGPT connector. The connector offered a direct merge mutation, which was correctly rejected as a governance bypass.

This control-plane repair allows the canonical #1507 Battle Bridge mailbox to dispatch the existing protected merge workflow after exact clean-review validation. It does not authorize the #1805 merge by itself and does not authorize Podman installation or Forge runtime execution.

Once this repair is independently reviewed and merged, the commissioning sequence can continue without changing surfaces:

1. dispatch and prove protected merge of #1805;
2. synchronize the resulting exact `main` to the Battle Bridge;
3. run the separately authorized prerequisite-only `INSTALL_FORGE_SHADOW_M2` path;
4. prove fixed user-scope Podman 6.0.2 and obtain the resolver-produced Forgejo digest;
5. run fresh M2;
6. prepare M3 artifacts;
7. execute one bounded M3 proof;
8. publish measured Foundry capacity;
9. complete one genuine bounded Stephanos machinery task through Forge without Remote Codex.
