import { setTimeout as delay } from 'node:timers/promises';

const endpoint = 'https://orihani-cs-610824131458.asia-northeast1.run.app/api/internal/release-sample-20261104';
const trialVersion = 'cs-release-sample-20261104';
const audience = 'orihani-cs-release-sample-20261104';

async function waitForDeployment() {
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint + '/version', {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
        redirect: 'error',
      });
      if (response.ok && response.headers.get('content-type')?.includes('application/json') &&
          (await response.json()).trial === trialVersion) return;
    } catch {
      // The preceding Cloud Run revision may still serve its HTML fallback.
    }
    await delay(10_000);
  }
  throw new Error('Trial revision was not ready within eight minutes. No cases submitted.');
}

async function getIdentityToken() {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== 'https:' || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error('GitHub Actions workload identity unavailable.');
  }
  url.searchParams.set('audience', audience);
  const response = await fetch(url, {
    headers: { authorization: 'Bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('GitHub identity service returned HTTP ' + response.status);
  const { value } = await response.json();
  if (typeof value !== 'string' || !value) throw new Error('GitHub identity service returned no token.');
  return value;
}

await waitForDeployment();
for (const id of ['fixed', 'free']) {
  const token = await getIdentityToken();
  const response = await fetch(endpoint + '/' + id, {
    method: 'POST', headers: { authorization: 'Bearer ' + token }, redirect: 'error',
    signal: AbortSignal.timeout(225_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.reviewed !== true || typeof data.text !== 'string') {
    console.log('RELEASE_SAMPLE_FAILED ' + JSON.stringify({ id, http: response.status, code: data.code }));
    process.exitCode = 1;
    continue;
  }
  const parts = data.text.split(/###\d###/);
  if (parts.length !== 4 || !parts[2].trim()) throw Error('Missing reviewed patient text');
  console.log('RELEASE_SAMPLE ' + JSON.stringify({ id, patient: parts[2].trim(), symptoms: data.symptoms }));
}
