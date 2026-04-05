class IntentProposalStore {
  constructor() {
    this.activeProposal = null;
  }

  setActiveProposal(proposal) {
    this.activeProposal = proposal && typeof proposal === 'object' ? { ...proposal } : null;
    return this.activeProposal;
  }

  getActiveProposal() {
    return this.activeProposal ? { ...this.activeProposal } : null;
  }

  clear() {
    this.activeProposal = null;
  }
}

export const intentProposalStore = new IntentProposalStore();
