export const SHARED_WORKSPACE_QA_ANSWER_DIAGNOSTIC_SCHEMA_VERSION = 'stephanos.shared-workspace-qa-answer-diagnostic.v1';

const MAX_CLASSIFICATION_LENGTH = 96;
const MAX_ERROR_COUNT = 8;
const MAX_ERROR_LENGTH = 240;
const CLASSIFICATION_PATTERN = /^[A-Z0-9][A-Z0-9_:-]*$/;
const UNSAFE_DIAGNOSTIC_TEXT = /(?:BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|(?:password|credential|api[_-]?key|private[_-]?key)\s*[:=]|[a-z]:\\|\\\\|\/(?:users|home|workspace|tmp)\/)/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeClassification(value) {
  const normalized = text(value).toUpperCase();
  if (!normalized || normalized.length > MAX_CLASSIFICATION_LENGTH || !CLASSIFICATION_PATTERN.test(normalized)) return '';
  return normalized;
}

function safeError(value) {
  const normalized = text(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || UNSAFE_DIAGNOSTIC_TEXT.test(normalized)) return '';
  return normalized.length > MAX_ERROR_LENGTH ? `${normalized.slice(0, MAX_ERROR_LENGTH - 3)}...` : normalized;
}

export function buildSharedWorkspaceQaAnswerDiagnosticV1(answered = {}) {
  if (!answered || typeof answered !== 'object' || Array.isArray(answered)) return null;
  const classification = safeClassification(answered.classification);
  const errors = [];
  if (Array.isArray(answered.errors)) {
    for (const candidate of answered.errors) {
      const sanitized = safeError(candidate);
      if (sanitized && !errors.includes(sanitized)) errors.push(sanitized);
      if (errors.length >= MAX_ERROR_COUNT) break;
    }
  }
  if (!classification && errors.length === 0) return null;
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_QA_ANSWER_DIAGNOSTIC_SCHEMA_VERSION,
    classification: classification || 'WORKSPACE_QA_COGNITION_REJECTED_UNCLASSIFIED',
    errors: Object.freeze(errors),
  });
}