# Skill Foundry V2: pinned GitHub skill source intake

Scope: read one pinned GitHub SKILL.md and return a source-bound review candidate. No skill is installed.

V1 accepts separately staged SKILL.md bytes, but cannot prove their claimed source revision. V2 performs one GitHub Contents API GET at an exact commit SHA, validates the file path, size and base64 representation, checks the Git blob SHA1, and records its SHA256. Redirects, invalid Git revisions, bad content, large responses and low API budget fail closed.

Candidate 1: OpenAI Skill Creator at openai/skills, commit 49f948faa9258a0c61caceaf225e179651397431, path skills/.system/skill-creator/SKILL.md.
Candidate 2: OpenAI GitHub CI repair at the same pinned repository revision, path skills/.curated/gh-fix-ci/SKILL.md.
Each directory has a separate LICENSE.txt describing Apache 2.0, but rights, dependencies and ownership must still be independently verified before reuse. The skills include or reference additional resources that this V2 does not download or install.

Example command:
node scripts/skills/fetch-pinned-github-skill-v2.mjs --repo https://github.com/openai/skills --revision 49f948faa9258a0c61caceaf225e179651397431 --path skills/.system/skill-creator/SKILL.md --registry openai --publisher openai --license Apache-2.0 --name skill-creator

Security boundaries:
- One explicit GET to api.github.com, no arbitrary network host, branching, redirects, retries, polling or broad registry scans.
- No raw external instructions in the returned review packet. No shell commands or bundled resources are executed.
- Network response maximum 145 KiB and ten-second timeout, with 20 percent observed GitHub budget reserve.
- Input license and publisher details are claims, not independently verified authority.
- Output is EXTERNAL_DRAFT_NOT_INSTALLED. No Shared Workspace write, OpenClaw Local activation, permissions, protected merge, or Battle Bridge runtime mutation.
- Seed Canopy and Goal Dashboard stay separate. Keep Quest 3 CPU/GPU gaming resource protection.

Next: verify full upstream license, publisher and dependencies, customise into a separately scoped OpenClaw Local skill, perform the existing ten-question exam and security tests, obtain independent review and protected merge, then install using an already qualified target-specific route and capture a fresh runtime proof.

Tests:
node --test shared/skill-forge/pinnedGithubSkillIntakeV2.test.mjs
node --test stephanos-ui/src/components/upliftWorkspaceSurfaces.test.mjs

The existing surface-ignition-tests CI lane imports the new test file. This PR creates no new privileged GitHub workflow.
