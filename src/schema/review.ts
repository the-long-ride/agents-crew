import type {
  CrewReview,
  CrewReviewStatus,
  CrewFinding,
  CrewSeverity,
} from '../types';

const REVIEW_STATUSES: readonly CrewReviewStatus[] = ['pass', 'findings', 'needs_human'];

const SEVERITIES: readonly CrewSeverity[] = ['critical', 'high', 'medium', 'low'];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCrewFinding(value: unknown): value is CrewFinding {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    SEVERITIES.includes(obj.severity as CrewSeverity) &&
    isNonEmptyString(obj.file) &&
    Number.isInteger(obj.line) && (obj.line as number) > 0 &&
    isNonEmptyString(obj.title) &&
    isNonEmptyString(obj.evidence) &&
    isNonEmptyString(obj.requiredFix)
  );
}

export function validateCrewReview(input: unknown): CrewReview {
  if (typeof input !== 'object' || input === null) {
    throw new Error('CrewReview must be an object');
  }

  const obj = input as Record<string, unknown>;

  if (!REVIEW_STATUSES.includes(obj.status as CrewReviewStatus)) {
    throw new Error('status must be pass, findings, or needs_human');
  }

  if (!isNonEmptyString(obj.summary)) {
    throw new Error('summary must be a non-empty string');
  }

  if (!Array.isArray(obj.findings)) {
    throw new Error('findings must be an array');
  }

  for (const finding of obj.findings) {
    if (!isCrewFinding(finding)) {
      throw new Error('each finding must have valid severity, file, line, title, evidence, and requiredFix');
    }
  }

  if (obj.status === 'pass' && obj.findings.length > 0) {
    throw new Error('pass review must have empty findings');
  }

  if (obj.status === 'findings' && obj.findings.length === 0) {
    throw new Error('findings review must have at least one finding');
  }

  return {
    status: obj.status as CrewReviewStatus,
    summary: obj.summary,
    findings: obj.findings as CrewFinding[],
  };
}
