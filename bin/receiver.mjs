import { runReceiver } from '../lib/service.mjs';
import { RelayError } from '../lib/errors.mjs';
try {
  const [root, address, batch] = process.argv.slice(2);
  const code = await runReceiver({ root, address, batchMs: Number(batch), ready: data => {
    if (process.connected) process.send(data, () => { if (process.connected) process.disconnect(); });
  } });
  if (code) { process.stderr.write(JSON.stringify({ code }) + '\n'); process.exitCode = 2; }
} catch (error) {
  const code = error instanceof RelayError ? error.code : 'IO_ERROR';
  if (process.connected) process.send({ state: 'failed', code }, () => process.disconnect());
  process.stderr.write(JSON.stringify({ code }) + '\n'); process.exitCode = 2;
}
