'use strict';

function parseMacosSignature(output) {
  const text = typeof output === 'string' ? output : '';
  const teamMatch = text.match(/^TeamIdentifier=(.+)$/m);
  return {
    developerId: /^Authority=Developer ID Application:/m.test(text),
    teamId: teamMatch?.[1]?.trim() || null,
  };
}

function resolveMacosSigningMode({
  signatureOutput,
  requireDeveloperId,
  allowAdhoc,
  expectedTeamId,
}) {
  const signature = parseMacosSignature(signatureOutput);
  const hasDeveloperId = signature.developerId
    && !!signature.teamId
    && signature.teamId !== 'not set';

  if (hasDeveloperId) {
    if (requireDeveloperId && !expectedTeamId) {
      throw new Error('CODEPILOT_APPLE_TEAM_ID is required for distributable macOS packages');
    }
    if (expectedTeamId && signature.teamId !== expectedTeamId) {
      throw new Error(
        `Developer ID TeamIdentifier mismatch: expected ${expectedTeamId}, got ${signature.teamId}`,
      );
    }
    return { mode: 'developer_id', teamId: signature.teamId };
  }

  if (requireDeveloperId) {
    throw new Error('Developer ID Application signature required; refusing ad-hoc package');
  }
  if (!allowAdhoc) {
    throw new Error(
      'No Developer ID signature found. Set CODEPILOT_ALLOW_ADHOC_SIGNING=1 only for an isolated local package.',
    );
  }
  return { mode: 'adhoc', teamId: null };
}

module.exports = {
  parseMacosSignature,
  resolveMacosSigningMode,
};
