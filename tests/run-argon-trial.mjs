import { setTimeout as delay } from 'node:timers/promises';

const endpoint = 'https://orihani-cs-610824131458.asia-northeast1.run.app/api/internal/argon-trial-v2';
const trialVersion = 'cs-argon-trial-v2';
const audience = 'orihani-cs-argon-trial-v2';

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

async function reviewCase(caseId) {
  const token = await getIdentityToken();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ caseId }),
    redirect: 'error',
    signal: AbortSignal.timeout(145_000),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    return { caseId, httpStatus: response.status, error: 'Unexpected non-JSON response.' };
  }
  const data = await response.json();
  if (!response.ok) {
    // Only emit error codes from the app, never an upstream error body or request headers.
    const code = typeof data.code === 'string' && /^[a-z0-9_-]{1,64}$/i.test(data.code) ? data.code : undefined;
    return { caseId, httpStatus: response.status, error: 'Trial endpoint rejected the case.', code };
  }
  if (!data || data.caseId !== caseId) return { caseId, error: 'Result did not match submitted case.' };
  return data;
}

await waitForDeployment();
for (let i = 1; i <= 17; i++) {
  const caseId = 'c' + String(i).padStart(2, '0');
  let result;
  try {
    result = await reviewCase(caseId);
  } catch {
    result = { caseId, error: 'Identity, network, timeout, or response decoding failure.' };
  }
  // One JSON line per synthetic case. Text from the model cannot become a workflow command.
  console.log('ARGON_TRIAL ' + JSON.stringify(result));
  if (result.error) {
    process.exitCode = 1;
    if (result.httpStatus === 401 || result.httpStatus === 403 || result.httpStatus === 429) break;
  }
}
