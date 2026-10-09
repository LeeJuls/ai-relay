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
  if (typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt)) || new Date(m.createdAt).toISOString() !== m.createdAt) {
    throw new RelayError('INVALID_MESSAGE');
  }
  return m;
}

export function message({ from, to, body, type = 'question', task = 'default', wake = false, id: value, replyTo = null }) {
  return validateMessage({
    schemaVersion: 1, id: value ?? randomBytes(16).toString('hex'), from, to, task, type,
    body, createdAt: new Date().toISOString(), replyTo, wake,
  });
}

export function sameContent(a, b) {
  return ['schemaVersion', 'id', 'from', 'to', 'task', 'type', 'body', 'replyTo', 'wake'].every(key => a[key] === b[key]);
}

export function replyId(originalId, sender) {
  id(originalId); address(sender);
  return createHash('sha256').update(`reply\0${originalId}\0${sender}`).digest('hex').slice(0, 32);
}
