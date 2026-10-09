import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { sandbox } from './fixture.mjs';

test('preview self-test observes a two-way native-socket exchange and stops its own receivers', async t => {
  const { container } = await sandbox(t), root = path.join(container, 'acceptance');
  const { runAcceptance } = await import('../scripts/acceptance.mjs');
  const result = await runAcceptance({ root });
  assert.equal(result.mode, 'mock-native-pipes'); assert.equal(result.actualAppDeliveryVerified, false);
  assert.equal(result.modelTurnsStarted, 0); assert.equal(result.twoWay, true); assert.equal(result.helpersStopped, true);
  assert.equal(result.observedPosts.claude, 1); assert.equal(result.observedPosts.codex, 1);
  assert.equal(result.answerReplyTo, result.questionId);
  assert.equal(JSON.stringify(result).includes('local-fixture-token'), false);
  assert.ok(JSON.parse(await fs.readFile(path.join(root, 'acceptance-report.json'))).twoWay);
  await assert.rejects(runAcceptance({ root }), { code: 'TEST_DIRECTORY_EXISTS' });
});
