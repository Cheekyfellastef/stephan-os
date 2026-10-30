#!/usr/bin/env bash
set -uo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <label> <glob> [<glob> ...]" >&2
  exit 64
fi

label="$1"
shift

files=()
for pattern in "$@"; do
  while IFS= read -r match; do
    [[ -n "$match" ]] && files+=("$match")
  done < <(compgen -G "$pattern" || true)
done

if [[ ${#files[@]} -eq 0 ]]; then
  echo "::error title=Shared-agent shard empty::${label} matched no test files"
  exit 65
fi

mapfile -t files < <(printf '%s\n' "${files[@]}" | sort -u)

set +e
node --test --test-reporter=dot "${files[@]}"
status=$?
set -e

if [[ $status -eq 0 ]]; then
  exit 0
fi

safe_label="${label//[^A-Za-z0-9_.-]/_}"
log_file="${RUNNER_TEMP:-/tmp}/shared-agent-${safe_label}-diagnostics.log"

echo "::group::Verbose diagnostics for shared-agent shard ${label}"
set +e
node --test --test-reporter=spec "${files[@]}" 2>&1 | tee "$log_file"
diagnostic_status=${PIPESTATUS[0]}
set -e
echo "::endgroup::"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Shared-agent shard failure: ${label}"
    echo
    echo "Fast shard exit: ${status}; verbose rerun exit: ${diagnostic_status}."
    echo
    echo '```text'
    tail -n 200 "$log_file"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi

echo "::error title=Shared-agent shard failed::${label} failed. Verbose diagnostics were emitted above and to the step summary."
exit "$status"
