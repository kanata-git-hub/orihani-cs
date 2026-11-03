import type { Express } from 'express';
import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { analysisEndpoint } from './analysisApi.ts';
import { buildSystemInstruction } from './src/constants/index.ts';
import type { AnalyzeParams } from './src/types/index.ts';

const issuer = 'https://token.actions.githubusercontent.com';
const repo = 'kanata-git-hub/orihani-cs';
const path = '/api/internal/release-sample-20261104';
const cutoff = Date.parse('2026-11-05T00:00:00Z');
type GithubKey = JsonWebKey & { kid: string };
let keysPromise: Promise<GithubKey[]> | undefined;
let refreshAt = 0;

async function githubKeys(): Promise<GithubKey[]> {
  if (!keysPromise || Date.now() >= refreshAt) {
    refreshAt = Date.now() + 5 * 60_000;
    keysPromise = fetch(issuer + '/.well-known/jwks', { redirect: 'error', signal: AbortSignal.timeout(7000) })
      .then(async response => {
        if (!response.ok) throw Error('OIDC_KEYS');
        return (await response.json()).keys as GithubKey[];
      });
  }
  return keysPromise;
}

async function allowed(header?: string): Promise<boolean> {
  if (!header || header.length > 12_000 || !header.startsWith('Bearer ') || Date.now() > cutoff) return false;
  try {
    const parts = header.slice(7).split('.');
    if (parts.length !== 3) return false;
    const [h, p, s] = parts;
    const jwt = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    const c = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (jwt.alg !== 'RS256' || typeof jwt.kid !== 'string' ||
        c.iss !== issuer || c.aud !== 'orihani-cs-release-sample-20261104' ||
        c.repository !== repo || c.repository_id !== '1232647337' || c.repository_owner_id !== '280428079' ||
        c.workflow_ref !== repo + '/.github/workflows/release-sample.yml@refs/heads/main' ||
        c.ref !== 'refs/heads/main' || c.event_name !== 'push' || c.run_attempt !== '1' ||
        !Number.isFinite(c.iat) || !Number.isFinite(c.exp) || !Number.isFinite(c.nbf) ||
        c.iat > now + 30 || now - c.iat > 600 || c.nbf > now + 30 || c.exp <= now) return false;
    const key = (await githubKeys()).find(k => k.kid === jwt.kid && k.kty === 'RSA');
    return !!key && verify('RSA-SHA256', Buffer.from(h + '.' + p),
      createPublicKey({ key, format: 'jwk' }), Buffer.from(s, 'base64url'));
  } catch { return false; }
}

const cases: Record<string, Required<AnalyzeParams>> = {
  fixed: { patientName: '윤가온', symptoms: '눈 주위 가려움, 온청음', input: '', direction: '',
    selectedTreatments: ['한약'], selectedSituations: ['일반한약 첫 15일 마무리 안내'] },
  free: { patientName: '한가람', symptoms: '피부 붉어짐, 만성 소화불량', selectedTreatments: ['한약'],
    selectedSituations: ['한약 복용/경과'],
    input: '식후 더부룩함은 전보다 줄었지만 피부의 붉은 기운은 비슷하다고 답했다. 다음 처방은 내원 후 결정하기로 했다.',
    direction: '소화가 좋아졌다는 말씀에 답하고 피부가 주로 언제 붉어지는지 물어보세요. 원장님은 한약 복용을 조금 더 이어 가시길 권하십니다. 자세한 치료 계획은 내원 시 상담하도록 안내하세요.' },
};

export function mountReleaseSample(app: Express, generate: Parameters<typeof analysisEndpoint>[0]) {
  const used = new Set<string>();
  app.get(path + '/version', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ trial: 'cs-release-sample-20261104' });
  });
  for (const [id, context] of Object.entries(cases)) {
    const { symptoms, patientName, input, direction, selectedTreatments, selectedSituations } = context;
    const prompt = ['[환자 및 상황 정보]', '환자 이름: ' + patientName,
      '질환·증상: ' + symptoms, '메시지/상황: ' + (input || '정보 없음'),
      '선택된 치료: ' + selectedTreatments.join(', '), '응대 상황: ' + selectedSituations.join(', '),
      '추가 요청: ' + (direction || '없음')].join('\n');
    // Body-free synthetic requests have no way to provide a patient, prompt or instructions.
    app.use(path + '/' + id, analysisEndpoint(generate, async (req, res, next) => {
      if (!await allowed(req.get('authorization'))) { res.status(403).json({ code: 'DENIED' }); return; }
      if (req.get('content-type') || req.get('transfer-encoding') || Number(req.get('content-length') || 0) !== 0) {
        res.status(400).json({ code: 'EMPTY_REQUEST_REQUIRED' }); return;
      }
      if (used.has(id)) { res.status(409).json({ code: 'ALREADY_RUN' }); return; }
      used.add(id);
      req.body = { patientContext: context, prompt,
        systemInstruction: buildSystemInstruction(selectedTreatments, selectedSituations, symptoms + '\n' + input) };
      next();
    }));
  }
}
