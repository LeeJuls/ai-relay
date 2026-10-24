import { createClient, readConfiguration } from './core.mjs';
import { runReview, reviewStatus } from './review.mjs';
import { readJson } from './storage.mjs';

// Machine-only scheduling; neither scan nor recovery starts a production-chat turn.
export function createReviewQueue({ root, address, run = runReview, onError = () => {} }) {
  const scheduled = new Set();
  let queue = Promise.resolve(), closed = false, restored = false, paused = false;
  return {
    async scan() {
      if (closed || !(await readConfiguration({ root })).addresses[address]?.review) return;
      if (paused && await readJson(root, ['reviews', address, 'execution.json'], { corrupt: 'CORRUPT_RECEIPT' })) return;
      paused = false;
      const ids = (await createClient({ root, address }).inbox()).filter(m => m.review).map(m => m.id);
      if (!restored) {
        // client.reply may have archived an original immediately before a crash.
        ids.push(...(await reviewStatus({ root, address })).filter(r => r.state !== 'replied' || r.executionHeld).map(r => r.id));
        restored = true;
      }
      for (const id of ids) {
        if (scheduled.has(id)) continue;
        scheduled.add(id);
        queue = queue.then(() => closed ? undefined : run({ root, address, id })).catch(error => {
          // These refusals occur before an execution claim; enabling/reconciling can resume.
          if (['REVIEW_DISABLED', 'REVIEW_PROCESS_UNCERTAIN'].includes(error.code)) scheduled.delete(id);
          if (error.code === 'REVIEW_PROCESS_UNCERTAIN') paused = true;
          onError({ id, error });
        });
      }
    },
    idle() { return queue; },
    async close() { closed = true; await queue; },
  };
}
