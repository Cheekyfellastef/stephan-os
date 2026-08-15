from pathlib import Path

source_path = Path('shared/agents/vrResearchParticipantQaV1.mjs')
test_path = Path('shared/agents/vrResearchParticipantQaV1.test.mjs')
doc_path = Path('docs/architecture/vr-research-participant-qa-v1.md')

source = source_path.read_text()
replacements = [
    (
        "const MAX_CANONICAL_STRING_LENGTH = 16_384;\n",
        "const MAX_CANONICAL_STRING_LENGTH = 16_384;\nconst MAX_DATE_MS = 8_640_000_000_000_000;\n",
    ),
    (
        "function evaluationNowMs(input) {\n  const candidate = readOwnData(input, 'nowMs');\n  return Number.isFinite(candidate) ? candidate : Date.now();\n}\n",
        "function canonicalEvaluationTime(input) {\n  const candidate = readOwnData(input, 'nowMs');\n  const fallback = Date.now();\n  const nowMs = typeof candidate === 'number'\n    && Number.isFinite(candidate)\n    && Math.abs(candidate) <= MAX_DATE_MS\n    ? candidate\n    : fallback;\n  try {\n    return Object.freeze({ nowMs, answeredAtUtc: new Date(nowMs).toISOString() });\n  } catch {\n    const safeNowMs = Date.now();\n    return Object.freeze({ nowMs: safeNowMs, answeredAtUtc: new Date(safeNowMs).toISOString() });\n  }\n}\n\nfunction evaluationNowMs(input) {\n  return canonicalEvaluationTime(input).nowMs;\n}\n",
    ),
    (
        "  const nowMs = evaluationNowMs(input);\n  const freshness = projectionFreshness(projection, nowMs);\n",
        "  const evaluationTime = canonicalEvaluationTime(input);\n  const nowMs = evaluationTime.nowMs;\n  const freshness = projectionFreshness(projection, nowMs);\n",
    ),
    (
        "  const answeredAtCandidate = readOwnData(input, 'answeredAtUtc');\n  return Object.freeze({\n",
        "  const answeredAtCandidate = readOwnData(input, 'answeredAtUtc');\n  const answeredAtUtc = timestamp(answeredAtCandidate)\n    && Date.parse(answeredAtCandidate) === nowMs\n    ? answeredAtCandidate\n    : evaluationTime.answeredAtUtc;\n  return Object.freeze({\n",
    ),
    (
        "    answeredAtUtc: text(answeredAtCandidate || new Date(nowMs).toISOString()),\n",
        "    answeredAtUtc,\n",
    ),
]
for old, new in replacements:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'source replacement count {count} for {old[:80]!r}')
    source = source.replace(old, new, 1)
source_path.write_text(source)

tests = test_path.read_text()
marker = "test('out-of-range evaluation clocks cannot throw through the public answer boundary'"
if marker in tests:
    raise SystemExit('timestamp regression block already present')
tests += r'''

test('out-of-range evaluation clocks cannot throw through the public answer boundary', () => {
  for (const hostileNowMs of [Number.MAX_VALUE, Infinity, -Infinity, NaN]) {
    let result;
    assert.doesNotThrow(() => {
      result = answerVrResearchQuestion(
        request('SOURCE_STACK', 0),
        projection(),
        qaInput({ nowMs: hostileNowMs, answeredAtUtc: 'not-a-timestamp' }),
      );
    });
    assert.equal(result.valid, true);
    assert.equal(Number.isFinite(Date.parse(result.answer.answeredAtUtc)), true);
    assert.equal(new Date(Date.parse(result.answer.answeredAtUtc)).toISOString(), result.answer.answeredAtUtc);
  }
});

test('noncanonical or inconsistent answeredAtUtc falls back to the trusted evaluation timestamp', () => {
  for (const candidate of ['2026-08-14T11:00:00Z', 'not-a-timestamp', '2026-08-14T10:59:59.000Z']) {
    const result = answerVrResearchQuestion(
      request('SOURCE_STACK', 0),
      projection(),
      qaInput({ answeredAtUtc: candidate }),
    );
    assert.equal(result.answer.answeredAtUtc, answeredAtUtc);
  }
});

test('canonical answeredAtUtc consistent with nowMs remains deterministic', () => {
  const first = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection(), qaInput());
  const second = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection(), qaInput());
  assert.equal(first.answer.answeredAtUtc, answeredAtUtc);
  assert.equal(second.answer.answeredAtUtc, answeredAtUtc);
});

test('timestamp accessors are never invoked', () => {
  let nowCalls = 0;
  let answeredCalls = 0;
  const input = { proofVerifier };
  Object.defineProperty(input, 'nowMs', {
    enumerable: true,
    get() {
      nowCalls += 1;
      throw new Error('must not execute');
    },
  });
  Object.defineProperty(input, 'answeredAtUtc', {
    enumerable: true,
    get() {
      answeredCalls += 1;
      throw new Error('must not execute');
    },
  });
  let result;
  assert.doesNotThrow(() => {
    result = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection(), input);
  });
  assert.equal(result.valid, true);
  assert.equal(nowCalls, 0);
  assert.equal(answeredCalls, 0);
});
'''
test_path.write_text(tests)

doc = doc_path.read_text()
anchor = '## Gap observations\n'
if doc.count(anchor) != 1:
    raise SystemExit('unexpected Gap observations anchor count')
section = '''## Trusted answer-time boundary

The public Q&A boundary converts the caller evaluation clock to one ECMAScript-Date-range-safe canonical instant before freshness evaluation or answer serialization. Non-finite and out-of-range `nowMs` values cannot reach `Date#toISOString()` and therefore cannot throw through the adapter.

`answeredAtUtc` is accepted only when it is a canonical ISO timestamp representing that exact trusted evaluation instant. Invalid, noncanonical, inconsistent or accessor-backed values are ignored in favour of the trusted canonical evaluation timestamp.

The same trusted instant drives freshness and the answer timestamp, preventing caller-controlled clock disagreement.

'''
doc = doc.replace(anchor, section + anchor, 1)
doc_path.write_text(doc)
