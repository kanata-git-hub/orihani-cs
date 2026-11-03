import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { analysisEndpoint } from '../analysisApi.ts';

test('analysis endpoint checks authorization and payload before invoking the provider and redacts errors', async () => {
  const app = express();
  let calls = 0;
  const sensitive = 'synthetic-private-record';
  app.use('/api/generate-analysis', analysisEndpoint(async (_instruction, prompt) => {
    calls++;
    if (prompt === sensitive) throw Object.assign(new Error(sensitive), { status: 429 });
    return 'ok';
  }, (req, res, next) => { if (req.headers.authorization === 'test') next(); else res.sendStatus(401); }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const root = 'http://127.0.0.1:' + (server.address() as {port: number}).port;
  const post = (body: string, auth = 'test', path = '/api/generate-analysis') =>
    fetch(root + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body });
  try {
    assert.equal((await post('{', '')).status, 401);
    assert.equal((await post('{', '', '/unknown')).status, 404);
    assert.equal((await post('{')).status, 400);
    assert.equal((await post(JSON.stringify({ systemInstruction: 'clinic', prompt: {} }))).status, 400);
    assert.equal((await post(JSON.stringify({ systemInstruction: 'clinic', prompt: 'a'.repeat(65537) }))).status, 400);
    assert.equal((await post(JSON.stringify({ systemInstruction: 'clinic', prompt: 'a'.repeat(300000) }))).status, 413);
    assert.equal(calls, 0);
    const ok = await post(JSON.stringify({ systemInstruction: 'clinic', prompt: 'hello' }));
    assert.deepEqual(await ok.json(), { text: 'ok' });
    const response = await post(JSON.stringify({ systemInstruction: 'clinic', prompt: sensitive }));
    assert.equal(response.status, 429);
    assert.ok(!(await response.text()).includes(sensitive));
    assert.equal(calls, 2);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
