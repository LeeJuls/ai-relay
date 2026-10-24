import { createHash, randomBytes } from 'node:crypto';
import { RelayError } from './errors.mjs';

const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|constructor|prototype)$/;
const types = new Set(['question', 'answer', 'result', 'fyi']);

export function address(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(value) || reserved.test(value)) {
    throw new RelayError('INVALID_ADDRESS');
  }
  return value;
}

export function id(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new RelayError('INVALID_ID');
  return value;
}

export function validateMessage(m) {
  if (!m || m.schemaVersion !== 1) throw new RelayError('INVALID_MESSAGE');
  id(m.id); address(m.from); address(m.to);
  if (!types.has(m.type)) throw new RelayError('INVALID_TYPE');
  if (typeof m.body !== 'string' || !m.body.trim() || Buffer.byteLength(m.body, 'utf8') > 1048576) {
    throw new RelayError('INVALID_BODY');
  }
  if (typeof m.task !== 'string' || !m.task.trim() || m.task.length > 120 || typeof m.wake !== 'boolean') {
    throw new RelayError('INVALID_MESSAGE');
  }
  if (m.replyTo !== null) id(m.replyTo);
  if (m.review !== undefined) {
    if (Buffer.byteLength(m.body, 'utf8') > 65536) throw new RelayError('REVIEW_REQUEST_TOO_LARGE');
    const r = m.review;
    if (!r || typeof r !== 'object' || Array.isArray(r) || m.replyTo !== null || m.type !== 'question' ||
        !['review', 'followup'].includes(r.mode) || Object.keys(r).some(k => !['mode', 'previousId'].includes(k))) throw new RelayError('INVALID_MESSAGE');
    if (r.mode === 'followup') id(r.previousId);
    else if (r.previousId !== undefined) throw new RelayError('INVALID_MESSAGE');
  }
  if (typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt)) || new Date(m.createdAt).toISOString() !== m.createdAt) {
    throw new RelayError('INVALID_MESSAGE');
  }
  return m;
}

export function message({ from, to, body, type = 'question', task = 'default', wake = false, id: value, replyTo = null, review }) {
  return validateMessage({
    schemaVersion: 1, id: value ?? randomBytes(16).toString('hex'), from, to, task, type,
    body, createdAt: new Date().toISOString(), replyTo, wake, ...(review === undefined ? {} : { review }),
  });
}

export function sameContent(a, b) {
  return ['schemaVersion', 'id', 'from', 'to', 'task', 'type', 'body', 'replyTo', 'wake'].every(key => a[key] === b[key]) &&
    a.review?.mode === b.review?.mode && a.review?.previousId === b.review?.previousId;
}

export function replyId(originalId, sender) {
  id(originalId); address(sender);
  return createHash('sha256').update(`reply\0${originalId}\0${sender}`).digest('hex').slice(0, 32);
}
