import { createError, ERROR_CODES } from './errors.js';
import { knowledgeGraphService } from './knowledgeGraphService.js';
import { proposalStore } from './proposalStore.js';
import { makeId, nowIso } from './storageUtils.js';
import { activityLogService } from './activityLogService.js';

function proposalProvenance(proposal, confirmedBy = 'user') {
  return {
    source_type: proposal.source_subsystem,
    source_ids: proposal.related_memory_ids ?? [],
    proposal_id: proposal.id,
    created_by: proposal.source_subsystem,
    confirmed_by: confirmedBy,
    confirmation_timestamp: nowIso(),
  };
}

class ProposalService {
  list() {
    return proposalStore.readProposals().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  create({ type, sourceSubsystem = 'memory_service', summary, payload = {}, relatedMemoryIds = [] }) {
    if (!type) throw createError(ERROR_CODES.CMD_INVALID, 'Proposal type is required.');
    const now = nowIso();
    const proposal = {
      id: makeId('proposal'),
      type,
      source_subsystem: sourceSubsystem,
      status: 'pending',
      summary: summary ?? type,
      payload,
      related_memory_ids: relatedMemoryIds,
      created_at: now,
      updated_at: now,
      decision: null,
    };
    const proposals = proposalStore.readProposals();
    proposals.push(proposal);
    proposalStore.writeProposals(proposals);
    activityLogService.record({ type: 'proposal_created', subsystem: 'proposal_queue', summary: proposal.summary, payload: { proposal_id: proposal.id, type: proposal.type } });
    return proposal;
  }

  getById(id) {
    const proposal = this.list().find((entry) => entry.id === id);
    if (!proposal) throw createError(ERROR_CODES.PROPOSAL_NOT_FOUND, `Proposal '${id}' was not found.`, { status: 404 });
    return proposal;
  }

  updateStatus(id, status, decision) {
    const proposals = proposalStore.readProposals();
    const index = proposals.findIndex((entry) => entry.id === id);
    if (index < 0) throw createError(ERROR_CODES.PROPOSAL_NOT_FOUND, `Proposal '${id}' was not found.`, { status: 404 });
    const item = proposals[index];
    if (item.status !== 'pending') throw createError(ERROR_CODES.PROPOSAL_INVALID_STATE, `Proposal '${id}' is already ${item.status}.`);
    const updated = { ...item, status, decision: { ...decision, decided_at: nowIso() }, updated_at: nowIso() };
    proposals[index] = updated;
    proposalStore.writeProposals(proposals);
    return updated;
  }

  accept(id, confirmedBy = 'user') {
    const proposal = this.getById(id);
    if (proposal.status !== 'pending') throw createError(ERROR_CODES.PROPOSAL_INVALID_STATE, `Proposal '${id}' is already ${proposal.status}.`);

    let mutationResult = null;
    const provenance = proposalProvenance(proposal, confirmedBy);

    if (proposal.type === 'create_graph_node') mutationResult = knowledgeGraphService.createNode({ ...proposal.payload, provenance });
    else if (proposal.type === 'update_graph_node') mutationResult = knowledgeGraphService.updateNode(proposal.payload.id, { ...proposal.payload, provenance });
    else if (proposal.type === 'create_graph_edge') mutationResult = knowledgeGraphService.createEdge({ ...proposal.payload, provenance });
    else if (proposal.type === 'link_memory_to_node') mutationResult = knowledgeGraphService.updateNode(proposal.payload.nodeId, { metadata: { memory_links: proposal.related_memory_ids }, provenance });
    else throw createError(ERROR_CODES.PROPOSAL_INVALID_STATE, `Unsupported proposal type '${proposal.type}'.`);

    const updated = this.updateStatus(id, 'accepted', { decision: 'accept', confirmed_by: confirmedBy, mutation: mutationResult });
    activityLogService.record({ type: 'proposal_accepted', subsystem: 'proposal_queue', summary: `Accepted proposal ${id}.`, payload: { proposal_id: id, type: proposal.type } });
    return { proposal: updated, mutation: mutationResult };
  }

  reject(id, reason = 'rejected by user', confirmedBy = 'user') {
    const proposal = this.getById(id);
    if (proposal.status !== 'pending') throw createError(ERROR_CODES.PROPOSAL_INVALID_STATE, `Proposal '${id}' is already ${proposal.status}.`);
    const updated = this.updateStatus(id, 'rejected', { decision: 'reject', confirmed_by: confirmedBy, reason });
    activityLogService.record({ type: 'proposal_rejected', subsystem: 'proposal_queue', summary: `Rejected proposal ${id}.`, payload: { proposal_id: id, reason } });
    return updated;
  }

  stats() {
    const all = this.list();
    return {
      total: all.length,
      pending: all.filter((entry) => entry.status === 'pending').length,
      accepted: all.filter((entry) => entry.status === 'accepted').length,
      rejected: all.filter((entry) => entry.status === 'rejected').length,
    };
  }

  getStatus() {
    return { state: 'live', ...proposalStore.getStatus(), stats: this.stats() };
  }
}

export const proposalService = new ProposalService();
