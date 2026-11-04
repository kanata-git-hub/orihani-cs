import { setTimeout as delay } from 'node:timers/promises';

const endpoint = 'https://orihani-cs-610824131458.asia-northeast1.run.app/api/internal/rx-effects-20261104-v1';
const trialVersion = 'cs-rx-effects-20261104-v1';
const audience = 'orihani-cs-rx-effects-20261104-v1';

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
for (const id of ['free-combination', 'fixed-effect']) {
  const token = await getIdentityToken();
  const response = await fetch(endpoint + '/' + id, {
    method: 'POST', headers: { authorization: 'Bearer ' + token }, redirect: 'error',
    signal: AbortSignal.timeout(225_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.reviewed !== true || typeof data.text !== 'string') {
    console.log('RX_EFFECT_SMOKE_FAILED ' + JSON.stringify({ id, http: response.status, code: data.code }));
    process.exitCode = 1;
    continue;
  }
  const parts = data.text.split(/(###\d+###)/);
  if (parts.length !== 7 || parts[1] !== '###1###' || parts[3] !== '###2###' ||
      parts[5] !== '###3###' || [parts[2], parts[4], parts[6]].some(x => !x.trim())) {
    throw Error('Missing a reviewed section');
  }
  const patient = parts[4].trim();
  const checks = {
    noEscapedBreaks: !/\\[nr]/.test(data.text),
    noPrivateNames: !/오\s*령\s*산|온\s*청\s*음|五苓散|[溫温]清[飮飲]|gorei[- ]?san|unsei[- ]?in/i.test(data.text),
    doseOnce: patient.split('한약은 하루 두 번 식후에 복용하시고, 냉장 보관해 주세요.').length === 2,
  };
  if (id === 'fixed-effect') {
    checks.originalTemplate = patient.includes('전과 비교해 어떠신가요?');
    checks.checkedParagraph = typeof data.effectParagraph === 'string' && data.effectParagraph.trim().length > 0 &&
      patient.includes(data.effectParagraph);
  }
  console.log('RX_EFFECT_SMOKE ' + JSON.stringify({ id, patient, checks }));
  if (Object.values(checks).some(passed => !passed)) process.exitCode = 1;
}
