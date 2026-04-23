export function buildOpenClawCandidatePrompts(scanReport = {}) {
  const findings = Array.isArray(scanReport.findings) ? scanReport.findings : [];
  return findings.map((finding, index) => {
    const title = `OpenClaw Candidate ${index + 1}: ${finding.title}`;
    const prompt = [
      'You are working on Stephanos OS.',
      '',
      `MISSION: Address finding \"${finding.title}\" while preserving canonical runtime truth boundaries.`,
      '',
      'CONSTRAINTS (NON-NEGOTIABLE):',
      '- Do not bypass runtimeStatusModel + adjudicator truth flow.',
      '- UI must consume finalRouteTruthView projection, not hidden truth state.',
      '- Keep selected/executable/actual provider semantics distinct.',
      '- Keep reachability/usability/browser compatibility separate.',
      '- Dist is generated output; do not treat apps/stephanos/dist as source truth.',
      '- Propose minimal source changes with targeted tests and verification commands.',
      '',
      'LIKELY FILES:',
      ...(finding.likelyFiles || []).map((file) => `- ${file}`),
      '',
      'REQUIRED VERIFICATION:',
      '- syntax checks for touched JS/MJS files',
      '- targeted tests for affected guardrails',
      '- npm run stephanos:verify',
      '- import guard checks',
      '',
      'DO NOT TOUCH:',
      '- autonomous execution paths',
      '- hidden background tasking',
      '- destructive shell or git actions',
      '- canonical memory truth writes',
    ].join('\n');

    return {
      id: `${scanReport.scanType || 'scan'}-prompt-${index + 1}`,
      title,
      diagnosis: finding.diagnosis,
      candidatePrompt: prompt,
      relevantFiles: finding.likelyFiles || [],
      riskLevel: finding.doctrineRisk || 'low',
      doctrineAlignment: 'Preserves canonical route/provider truth projections and dist/source boundaries.',
      uncertainty: finding.uncertainty || 'Bounded scan can miss hidden or future regressions.',
      safeForReviewOnly: true,
      approvalStatus: 'pending',
    };
  });
}
