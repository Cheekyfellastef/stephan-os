import { createHash } from 'node:crypto';

export const STEPHANOS_AMBIENT_CAPABILITY_QUESTION_SCHEMA_VERSION = 'stephanos.ambient-capability-question.v1';

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_FINGERPRINT = /^[a-z0-9][a-z0-9._:-]{7,191}$/i;
const QUESTION_KEYS = Object.freeze([
  'schemaVersion',
  'questionId',
  'askerParticipantId',
  'targetParticipantId',
  'questionText',
  'questionClass',
  'intentFingerprint',
  'noveltyRefs',
  'contextRefs',
  'expectedEvidenceClass',
  'createdAtUtc',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeId(value) {
  return SAFE_ID.test(text(value));
}

function timestamp(value) {
  const candidate = text(value);
  const parsed = Date.parse(candidate);
  return Boolean(candidate && Number.isFinite(parsed) && new Date(parsed).toISOString() === candidate);
}

function snapshotDataOnly(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(input).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const actual = Object.keys(descriptors).sort();
    const expected = [...QUESTION_KEYS].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return null;
    const output = Object.create(null);
    for (const key of QUESTION_KEYS) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
      Object.defineProperty(output, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function denseStringList(value, minimum = 0) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < minimum || length > 256) return null;
    const keys = Object.keys(descriptors).sort();
    const expected = ['length', ...Array.from({ length }, (_, index) => String(index))].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected)) return null;
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
      const normalized = text(descriptor.value);
      if (!normalized) return null;
      output.push(normalized);
    }
    if (new Set(output).size !== output.length) return null;
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function result(errors, question = null) {
  const unique = Object.freeze([...new Set(errors)]);
  return Object.freeze({
    valid: unique.length === 0,
    question: unique.length === 0 ? question : null,
    errors: unique,
    refusalReason: unique[0] || '',
  });
}

export function validateStephanosAmbientCapabilityQuestion(input, options = {}) {
  const question = snapshotDataOnly(input);
  if (!question) return result(['ambient-question-must-be-exact-data-only-object']);

  const errors = [];
  if (question.schemaVersion !== STEPHANOS_AMBIENT_CAPABILITY_QUESTION_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['questionId', 'askerParticipantId', 'targetParticipantId']) {
    if (!safeId(question[field])) errors.push(`${field}-invalid`);
  }
  const questionText = text(question.questionText);
  if (!questionText) errors.push('questionText-required');
  if (questionText.length > 4096) errors.push('questionText-too-long');
  if (!safeId(question.questionClass)) errors.push('questionClass-invalid');
  if (!SAFE_FINGERPRINT.test(text(question.intentFingerprint))) errors.push('intentFingerprint-invalid');
  const noveltyRefs = denseStringList(question.noveltyRefs, options.requireNoveltyRef ? 1 : 0);
  if (!noveltyRefs) errors.push('noveltyRefs-invalid');
  const contextRefs = denseStringList(question.contextRefs, 0);
  if (!contextRefs) errors.push('contextRefs-invalid');
  if (!safeId(question.expectedEvidenceClass)) errors.push('expectedEvidenceClass-invalid');
  if (!timestamp(question.createdAtUtc)) errors.push('createdAtUtc-invalid');

  if (errors.length > 0) return result(errors);
  return result([], Object.freeze({ ...question, noveltyRefs, contextRefs }));
}

export function canonicalStephanosAmbientQuestionIntentFingerprint(input) {
  const validation = validateStephanosAmbientCapabilityQuestion(input);
  if (!validation.valid) return '';
  const question = validation.question;
  const normalizedQuestionText = text(question.questionText).toLowerCase().replace(/\s+/g, ' ');
  return `intent-${createHash('sha256').update(JSON.stringify({
    questionClass: text(question.questionClass).toUpperCase(),
    questionText: normalizedQuestionText,
    expectedEvidenceClass: text(question.expectedEvidenceClass).toUpperCase(),
  })).digest('hex').slice(0, 40)}`;
}
