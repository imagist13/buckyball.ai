#!/usr/bin/env node

const [confirmedAt, nowInput] = process.argv.slice(2);
if (!confirmedAt) {
  throw new Error('CODEPILOT_IMMUTABLE_RELEASES_CONFIRMED_AT is required (UTC YYYY-MM-DD)');
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmedAt)) {
  throw new Error('Immutable Releases acknowledgement must use UTC YYYY-MM-DD');
}

const confirmedDay = Date.parse(`${confirmedAt}T00:00:00.000Z`);
const now = nowInput ? new Date(nowInput) : new Date();
if (!Number.isFinite(confirmedDay) || Number.isNaN(now.getTime())) {
  throw new Error('Immutable Releases acknowledgement date is invalid');
}
const currentUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
const ageDays = Math.floor((currentUtcDay - confirmedDay) / 86_400_000);
if (ageDays < 0) {
  throw new Error(`Immutable Releases acknowledgement ${confirmedAt} is in the future`);
}
if (ageDays > 1) {
  throw new Error(`Immutable Releases acknowledgement ${confirmedAt} is stale; reconfirm the repository setting`);
}

console.log(`Immutable Releases acknowledgement is fresh: confirmed_at=${confirmedAt} age_days=${ageDays}`);
