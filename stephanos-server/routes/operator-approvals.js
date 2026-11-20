import express from 'express';
import {
  readOperatorApprovalInbox,
  recordOperatorApprovalDecision,
} from '../services/operatorApprovalInboxService.js';

const DECISION_FIELDS = new Set(['action', 'commandId', 'requestFingerprint', 'reason']);

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function assertClosedWorldBody(body) {
  if (!plainObject(body)) throw Object.assign(new Error('Decision body must be an object.'), { statusCode: 400, code: 'INVALID_DECISION_BODY' });
  const unexpected = Object.keys(body).find((field) => !DECISION_FIELDS.has(field));
  if (unexpected) throw Object.assign(new Error(`Decision field is not allowed: ${unexpected}`), { statusCode: 400, code: 'UNEXPECTED_DECISION_FIELD' });
}

export function createOperatorApprovalsRouter(options = {}) {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      const inbox = await readOperatorApprovalInbox(options);
      res.status(inbox.state === 'unavailable' ? 503 : 200).json(inbox);
    } catch (_error) {
      res.status(503).json({
        schemaVersion: 'stephanos.operator-approval-inbox.v1',
        state: 'unavailable',
        reason: 'OPERATOR_APPROVAL_INBOX_UNAVAILABLE',
        decisions: [],
        maintenanceActions: [],
        actionExecutionAllowed: false,
        protectedActionAuthorityGranted: false,
      });
    }
  });

  router.post('/:decisionId/decision', async (req, res) => {
    try {
      assertClosedWorldBody(req.body);
      const result = await recordOperatorApprovalDecision({
        decisionId: req.params.decisionId,
        action: req.body.action,
        commandId: req.body.commandId,
        requestFingerprint: req.body.requestFingerprint,
        reason: req.body.reason,
      }, options);
      res.status(200).json(result);
    } catch (error) {
      res.status(Number(error?.statusCode) || 500).json({
        ok: false,
        error: error?.code || 'OPERATOR_DECISION_FAILED',
        message: error?.message || 'Operator decision failed.',
        actionExecuted: false,
        protectedActionAuthorityGranted: false,
      });
    }
  });

  return router;
}

export default createOperatorApprovalsRouter();
