import express, { type Express } from 'express';
import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { argonTrialCases } from './argonTrialCases.ts';
import { reviewSyntheticCase } from './argonTrialJudge.ts';

const issuer = 'https://token.actions.githubusercontent.com';
const repo = 'kanata-git-hub/orihani-cs';
const path = '/api/internal/argon-trial';
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
        c.iss !== issuer || c.aud !== 'orihani-cs-argon-trial-v1' ||
        c.repository !== repo || c.repository_id !== '1232647337' || c.repository_owner_id !== '280428079' ||
        c.workflow_ref !== repo + '/.github/workflows/argon-trial.yml@refs/heads/main' ||
        c.ref !== 'refs/heads/main' || c.event_name !== 'push' || c.run_attempt !== '1' ||
        !Number.isFinite(c.iat) || !Number.isFinite(c.exp) || !Number.isFinite(c.nbf) ||
        c.iat > now + 30 || now - c.iat > 600 || c.nbf > now + 30 || c.exp <= now) return false;
    const key = (await githubKeys()).find(k => k.kid === jwt.kid && k.kty === 'RSA');
    return !!key && verify('RSA-SHA256', Buffer.from(h + '.' + p),
      createPublicKey({ key, format: 'jwk' }), Buffer.from(s, 'base64url'));
  } catch { return false; }
}

export function mountArgonTrial(app: Express) {
  const used = new Set<string>();
  app.get(path + '/version', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ trial: 'cs-argon-trial-v1' });
  });
  app.post(path, async (req, res, next) => {
    if (!await allowed(req.get('authorization'))) { res.status(403).json({ code: 'DENIED' }); return; }
    next();
  }, express.json({ limit: '256b' }), async (req, res) => {
    const id = req.body?.caseId;
    if (typeof id !== 'string' || !Object.hasOwn(argonTrialCases, id) || Object.keys(req.body).length !== 1) {
      res.status(400).json({ code: 'CASE' }); return;
    }
    if (used.has(id)) { res.status(409).json({ code: 'ALREADY_RUN' }); return; }
    used.add(id);
    const sample = argonTrialCases[id];
    try {
      const result = await reviewSyntheticCase(sample);
      res.set('Cache-Control', 'no-store').json({ caseId: id, draft: sample.draft, ...result });
    } catch (err) {
      const code = err instanceof Error && /^[A-Z0-9_]{1,64}$/.test(err.message) ? err.message : 'REVIEW_FAILED';
      res.status(502).json({ code });
    }
  });
}
