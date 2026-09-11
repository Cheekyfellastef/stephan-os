# OpenClaw WhatsApp Agent Commands #1278

## Milestone

```text
MILESTONE_1_COMMAND_REPLACEMENT_DESIGN_READY
```

## Goal

Replace the current ghost-wired WhatsApp command behaviour for `/standalone`, `/scout-coder`, and `/scout_coder` with source-controlled, deterministic OpenClaw command plumbing.

This document is the Milestone 1 design artifact for GitHub issue #1278. It follows the accepted `/stephanos` command plugin pattern and treats the previous `/standalone` and `/scout-coder` behaviour as prototype evidence, not canon.

## Command surface

| Operator command | Canonical role | Target agent id | Notes |
| --- | --- | --- | --- |
| `/standalone` | canonical command | `standalone` | Routes an authorized WhatsApp prompt to the standalone OpenClaw agent lane. |
| `/scout-coder` | canonical command | `stephanos-scout-coder` | Routes an authorized WhatsApp prompt to the scout coder agent lane. |
| `/scout_coder` | required alias | `stephanos-scout-coder` | Alias for `/scout-coder`; must share the same handler, target, validation, timeout, and failure contract. |

Alias marker:

```text
SCOUT_UNDERSCORE_ALIAS_REQUIRED=/scout_coder
```

## Source-controlled plugin shape

Use one combined OpenClaw plugin:

```text
integrations/openclaw/whatsapp-agent-commands/
  openclaw.plugin.json
  package.json
  index.js
  lib/agent-command-contract.mjs
  agent-command-contract.test.mjs
  manifest.test.mjs
```

Use one combined plugin rather than two or three plugins because:

- all commands share one WhatsApp authorization boundary;
- `/scout-coder` and `/scout_coder` must share one deterministic alias path;
- install/status/uninstall should be one reversible unit;
- runtime proof should inspect one plugin id and one command registration set.

Plugin id:

```text
stephanos-whatsapp-agent-commands
```

## Bounded command contract

Each command accepts exactly one text argument payload from an authorized WhatsApp sender:

```text
/<command> <message>
```

Validation:

- reject empty messages with a usage string;
- reject messages over 4000 characters;
- trim whitespace;
- preserve user text exactly after trimming;
- no shell, filesystem, GitHub, Mission Runner, policy, install, uninstall, or mutation tools are granted by this plugin;
- no invisible runtime command registration is preserved as canon.

Runtime request shape:

```json
{
  "targetAgentId": "standalone | stephanos-scout-coder",
  "message": "operator trimmed prompt",
  "source": "openclaw-whatsapp-agent-command",
  "channel": "whatsapp",
  "operatorInitiated": true,
  "command": "/standalone | /scout-coder | /scout_coder",
  "canonicalCommand": "/standalone | /scout-coder",
  "timeoutMs": 90000
}
```

The implementation may adapt this object to the supported OpenClaw agent invocation API found during Milestone 2, but must preserve these semantic fields in tests and proof output.

## Reply contract

Successful replies should return text to the same WhatsApp conversation and may include useful route proof:

```text
[standalone via OpenClaw]
<agent reply>
```

```text
[scout-coder via OpenClaw]
<agent reply>
```

Failure replies must be safe and local:

```text
OpenClaw <command> is unavailable right now. The request was not sent anywhere else. Check the local OpenClaw Gateway and try again.
```

Replies are capped at 7000 characters with a clear truncation note.

## Install/status/uninstall scripts

Add Windows scripts following the accepted `/stephanos` plugin pattern:

```text
scripts/windows/install-openclaw-whatsapp-agent-commands.ps1
scripts/windows/status-openclaw-whatsapp-agent-commands.ps1
scripts/windows/uninstall-openclaw-whatsapp-agent-commands.ps1
```

Install script requirements:

- validate source manifest and entry file exist;
- install linked plugin from repository source using supported OpenClaw plugin route;
- enable plugin;
- restart Gateway;
- print plugin id, plugin root, manifest hash, entry hash, command list, final verdict.

Status script requirements:

- inspect runtime plugin registration;
- prove `/standalone`, `/scout-coder`, and `/scout_coder` registration or deterministic alias mapping;
- print command list, target agent ids, source hashes, Gateway status, final verdict.

Uninstall script requirements:

- disable plugin;
- uninstall plugin;
- restart Gateway;
- preserve `/stephanos` plugin state;
- print final rollback verdict.

## Real WhatsApp acceptance prompts

Milestone 4 must use a real authorized WhatsApp lane.

Required prompts:

```text
/standalone Reply with STANDALONE_WHATSAPP_ACCEPTANCE_OK and identify your route.
```

```text
/scout-coder Reply with SCOUT_CODER_WHATSAPP_ACCEPTANCE_OK and identify your route.
```

```text
/scout_coder Reply with SCOUT_UNDERSCORE_ALIAS_ACCEPTANCE_OK and identify your route.
```

Regression prompts:

```text
/stephanos Reply with STEPHANOS_STILL_WORKS_OK.
```

```text
Plain ChatClean regression: reply normally without using a slash command.
```

## Test plan

Milestone 2 tests must prove:

- plugin manifest id and startup activation;
- no mutation tools or mutation contracts;
- `/standalone` command is registered with `requireAuth: true` and args enabled;
- `/scout-coder` command is registered with `requireAuth: true` and args enabled;
- `/scout_coder` alias maps to the same scout-coder target and handler path;
- request validation rejects empty and oversized input;
- route contract maps commands to exact target agent ids;
- failure responses do not fall back to cloud or another hidden route;
- Windows scripts parse successfully.

## Safety boundaries preserved

- `/stephanos` behaviour from PR #1275 remains untouched.
- Plain ChatClean WhatsApp behaviour remains untouched.
- No broader WhatsApp authorization is added.
- No OpenClaw distribution files are patched directly.
- Runtime data, secrets, sessions, logs, credentials, generated dist, dependency folders, and local proof JSON are not committed.
- Merge remains blocked until exact-head approval is explicitly supplied.

## Next milestone

```text
MILESTONE_2_SOURCE_CONTROLLED_COMMANDS_IMPLEMENTED
```

Milestone 2 should add the combined plugin, scripts, tests, and a draft PR proof comment. Runtime install remains blocked until Milestone 3.
