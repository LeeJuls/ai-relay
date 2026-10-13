import { runReceiver } from '../lib/service.mjs';
import { RelayError } from '../lib/errors.mjs';
try {
  const [root, address, batch,probe='30000',keep='false'] = process.argv.slice(2);
  const code = await runReceiver({ root, address, batchMs: Number(batch),probeMs:Number(probe),keepPending:keep==='true', ready: data => {
    if (process.connected) process.send(data, () => { if (process.connected) process.disconnect(); });
  } });
  if (code) { process.stderr.write(JSON.stringify({ code }) + '\n'); process.exitCode = 2; }
} catch (error) {
  const code = error instanceof RelayError ? error.code : 'IO_ERROR';
  if (process.connected) process.send({ state: 'failed', code }, () => process.disconnect());
  process.stderr.write(JSON.stringify({ code }) + '\n'); process.exitCode = 2;
}
