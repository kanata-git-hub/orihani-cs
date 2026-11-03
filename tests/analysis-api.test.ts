import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { analysisEndpoint } from '../analysisApi.ts';
import { buildHerbalFollowup, HERBAL_FOLLOWUP_SITUATION } from '../src/herbalFollowup.ts';
import { parseAnalysisResult } from '../src/patientMessageText.ts';

test('authenticated generation returns only reviewed free messages and canonical fixed messages', async () => {
  const app = express();
  let calls = 0, freeChecks = 0, fixedChecks = 0;
  let seenDraft = '', seenRules = '', seenReference = '', seenSymptoms = '';
  let seenTreatments: string[] = [], seenPrescriptions: string[] = [];
  const sensitive = 'synthetic-private-record';
  const encode = (s: string) => '###1###\n내부 안내\n###2###\n' + s + '\n###3###\n내부 팁';
  app.use('/api/generate-analysis', analysisEndpoint(async (instruction, prompt) => {
    calls++;
    seenRules = instruction;
    if (prompt === sensitive) throw Object.assign(new Error(sensitive), { status: 429 });
    if (prompt === 'malformed') return '문자와 가이드가 구분되지 않습니다.';
    return encode(prompt);
  }, (req, res, next) => { if (req.headers.authorization === 'test') next(); else res.sendStatus(401); }, {
    async reviewFree(context, draft) {
      freeChecks++;
      seenDraft = draft.responseDraft;
      assert.equal(draft.strategy, '내부 안내');
      assert.equal(draft.staffTip, '내부 팁');
      seenReference = context.clinicReference ?? '';
      seenSymptoms = context.symptoms;
      seenTreatments = context.selectedTreatments;
      seenPrescriptions = context.prescriptionReferences ?? [];
      if (draft.responseDraft === 'review-error') throw new Error('private-test-error');
      if (draft.responseDraft === 'bad-format') return { ...draft, staffTip:'###1### 숨겨진 내부 지시' };
      if (draft.responseDraft.includes('온청음')) return { strategy:'경과를 확인합니다.', responseDraft:'가상님, 안녕하세요.\\n\\n눈 가려움은 어떠신가요?', staffTip:'증상의 변화만 전달해 주세요.' };
      return draft;
    },
    async reviewFixedSymptoms(context, _draft) {
      fixedChecks++;
      if (context.symptoms === '미확인입력') return [];
      if (context.symptoms === '피부 붉어짐, 소화불량') return ['피부 붉어짐'];
      assert.equal(context.symptoms, '눈 주위 가려움, 피로');
      return ['눈 주위 가려움', '피로'];
    }
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const root = 'http://127.0.0.1:' + (server.address() as {port: number}).port;
  const post = (body: string, auth = 'test', path = '/api/generate-analysis') =>
    fetch(root + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body });
  const request = (prompt: string, extra: object = {}) => post(JSON.stringify({ systemInstruction: 'clinic', prompt, ...extra }));
  const context = { patientName: '가상', symptoms: '눈 주위 가려움, 온청음',
    selectedTreatments: ['한약', '피로'], selectedSituations: [HERBAL_FOLLOWUP_SITUATION], input: '', direction: '' };
  try {
    assert.equal((await post('{', '')).status, 401);
    assert.equal((await post('{', '', '/unknown')).status, 404);
    assert.equal((await post('{')).status, 400);
    assert.equal((await request('ok', {patientContext: { ...context, selectedTreatments: '한약' }})).status, 400);
    assert.equal((await request('ok', {patientContext: null})).status, 400);
    assert.equal((await request('ok', {prescriptionNames: {}})).status, 400);
    assert.equal((await post(JSON.stringify({ systemInstruction: 'clinic', prompt: {} }))).status, 400);
    assert.equal((await request('a'.repeat(65537))).status, 400);
    assert.equal((await request('a'.repeat(300000))).status, 413);
    assert.equal(calls + freeChecks + fixedChecks, 0);

    const fixed = await request('ignored', {patientContext: context});
    assert.equal(fixed.status, 200);
    const fixedResult = await fixed.json();
    assert.equal(fixedResult.reviewed, true);
    assert.equal(fixedResult.reviewVersion, 2);
    assert.equal(fixedResult.symptoms, '눈 주위 가려움, 피로');
    assert.equal(fixedResult.text, buildHerbalFollowup({ ...context, symptoms: '눈 주위 가려움, 피로', selectedTreatments: ['한약'] }));
    assert.equal((await request('ignored', {patientContext: { ...context, symptoms:'온청음', selectedTreatments:[] }})).status, 422);
    assert.equal((await request('ignored', {patientContext: { ...context, symptoms:'미확인입력', selectedTreatments:[] }})).status, 422);
    const partial = await request('ignored', {patientContext: { ...context, symptoms:'피부 붉어짐, 소화불량', selectedTreatments:['한약'] }});
    assert.equal(partial.status, 422);
    const blocked = await partial.json();
    assert.equal(blocked.code, 'PATIENT_INPUT');
    assert.equal(blocked.text, undefined);
    assert.deepEqual([calls,freeChecks,fixedChecks],[0,0,3]);

    const reviewed = await request('온청음 증상', {patientContext: {...context, symptoms:'눈 주위 가려움, 온청음',
      selectedTreatments:['피로', '한약'], selectedSituations:['원장','한약 복용/경과'], clinicReference:'FAKE_REVIEW_POLICY'}});
    const final = await reviewed.json();
    assert.equal(reviewed.status, 200);
    assert.equal(final.reviewed, true);
    assert.equal(final.reviewVersion, 2);
    assert.equal(parseAnalysisResult(final.text).strategy,'경과를 확인합니다.');
    assert.equal(parseAnalysisResult(final.text).staffTip,'증상의 변화만 전달해 주세요.');
    assert.equal(seenDraft, '온청음 증상');
    assert.equal(seenSymptoms, '눈 주위 가려움, 피로');
    assert.deepEqual(seenTreatments, ['한약']);
    assert.deepEqual(seenPrescriptions, ['온청음']);
    assert.notEqual(seenRules, 'clinic');
    assert.doesNotMatch(seenReference, /FAKE_REVIEW_POLICY/);
    assert.match(seenReference, /냉장/);
    assert.equal(parseAnalysisResult(final.text).responseDraft, '가상님, 안녕하세요.\n\n눈 가려움은 어떠신가요?');
    const legacy = await request('hello');
    assert.equal((await legacy.json()).reviewed, true);
    assert.equal(seenRules, 'clinic');

    for (const [prompt, prescriptionNames] of [['반하사심탕을 드셨나요?', []], ['원내A방', ['원내A방']]]) {
      const blocked = await request(String(prompt), { prescriptionNames });
      assert.equal(blocked.status, 422); const result = await blocked.json();
      assert.equal(result.code, 'PRESCRIPTION_IN_OUTPUT'); assert.equal(result.text, undefined);
    }
    for (const [prompt,status] of [['review-error',503], ['bad-format',422], ['malformed',422], [sensitive,429]] as const) {
      const response = await request(prompt);
      assert.equal(response.status,status); const result = await response.json();
      assert.equal(result.text,undefined); assert.equal(result.reviewed,undefined);
      assert.doesNotMatch(JSON.stringify(result), /synthetic-private-record|private-test-error/);
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
