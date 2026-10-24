import path from 'node:path';
import { RelayError } from './errors.mjs';

export function validateReviewConfig(c) {
  if (c === false) return c;
  if (!c || typeof c !== 'object' || Array.isArray(c) ||
      Object.keys(c).some(k => !['cli', 'model', 'jobRoot', 'evidenceDirs', 'deadlineMs'].includes(k)) ||
      ![c.cli, c.jobRoot].every(p => typeof p === 'string' && path.isAbsolute(p)) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(c.model ?? '') ||
      !Number.isInteger(c.deadlineMs) || c.deadlineMs < 1000 || c.deadlineMs > 600000 ||
      !Array.isArray(c.evidenceDirs) || c.evidenceDirs.length > 8 ||
      c.evidenceDirs.some(p => typeof p !== 'string' || !path.isAbsolute(p)) ||
      (process.platform === 'win32' && !/\.exe$/i.test(c.cli))) throw new RelayError('REVIEW_CONFIG');
  return c;
}
