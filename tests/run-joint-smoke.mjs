import { setTimeout as delay } from 'node:timers/promises';

const endpoint = 'https://orihani-cs-610824131458.asia-northeast1.run.app/api/internal/joint-review-20261104-final';
const trialVersion = 'cs-joint-review-20261104-final';
const audience = 'orihani-cs-joint-review-20261104-final';

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
for (const id of ['two-symptoms', 'booking-inquiry']) {
  const token = await getIdentityToken();
  const response = await fetch(endpoint + '/' + id, {
    method: 'POST', headers: { authorization: 'Bearer ' + token }, redirect: 'error',
    signal: AbortSignal.timeout(225_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.reviewed !== true || typeof data.text !== 'string') {
    console.log('JOINT_SMOKE_FAILED ' + JSON.stringify({ id, http: response.status, code: data.code }));
    process.exitCode = 1;
    continue;
  }
  const parts = data.text.split(/(###\d+###)/);
  if (parts.length !== 7 || parts[1] !== '###1###' || parts[3] !== '###2###' ||
      parts[5] !== '###3###' || [parts[2], parts[4], parts[6]].some(x => !x.trim())) {
    throw Error('Missing a reviewed section');
  }
  const [strategy, patient, staffTip] = [parts[2].trim(), parts[4].trim(), parts[6].trim()];
  const checks = {
    noEscapedBreaks: !/\\[nr]/.test(data.text),
    noRedundantHonorific: !/말씀해\s*주실\s*수\s*있으실까요/.test(data.text),
  };
  if (id === 'two-symptoms') {
    checks.twoSymptoms = data.symptoms === '눈 주위 가려움, 만성 소화불량' &&
      ['눈 주위 가려움', '만성 소화불량'].every(s => patient.includes(s));
    checks.noPrescription = !data.text.includes('온청음');
    checks.neutral = patient.includes('전과 비교해 어떠신가요') &&
      !/나아지셨을 것|덜해지셨을 것|편해지셨을 것/.test(patient);
  }
  console.log('JOINT_SMOKE ' + JSON.stringify({ id, strategy, patient, staffTip, symptoms: data.symptoms, checks }));
  if (Object.values(checks).some(passed => !passed)) process.exitCode = 1;
}
