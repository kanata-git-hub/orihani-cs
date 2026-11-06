import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { analysisEndpoint } from '../analysisApi.ts';
import { buildHerbalFollowup, HERBAL_FOLLOWUP_SITUATION } from '../src/herbalFollowup.ts';
import { MESSAGE_REVIEW_VERSION, parseAnalysisResult } from '../src/patientMessageText.ts';
import { DIET_HERBAL_DIRECTIONS, HERBAL_DIRECTIONS } from '../src/herbalDirections.ts';
import { PUBLIC_REVIEW_GREETING } from '../src/publicReview.ts';
import { getEnteredPrescriptionNames, getEffectPrescriptionNames } from '../src/prescriptionFields.ts';
import { inspectPatientSymptomInput } from '../src/patientSymptoms.ts';

test('entered prescription names retain private names and named compounds', () => {
  assert.deepEqual(getEnteredPrescriptionNames(' 인진오령산 + 오령산，원내 A방 / 원내 B방；없음\n오령산'), ['인진오령산','오령산','원내A방','원내B방']);
  assert.deepEqual(getEffectPrescriptionNames('', '', '인진오령산 + 원내 A방'), ['인진오령산','원내A방']);
  assert.deepEqual(getEnteredPrescriptionNames(' 처방명: 오령산 +  한약명: 온청음 '), ['오령산', '온청음']);
  assert.deepEqual(getEnteredPrescriptionNames(''), []);
  assert.deepEqual(inspectPatientSymptomInput({ symptoms:'부종, 봄 제제', selectedTreatments:[], prescriptionName:'봄 제제' }),
    { symptoms:'부종', prescriptions:['봄 제제'], error:null });
});

test('a dedicated prescription reaches ordinary and fixed writing and review, but not a public reply', async () => {
  const app = express();
  let seenPrompt = '', seenName = '';
  let providerCalls = 0;
  const effect = '수분 흐름을 조절해 붓기가 가라앉도록 돕습니다.';
  const draft = { strategy:'가이드', responseDraft:effect, staffTip:'팁' };
  const context = { patientName:'가상', symptoms:'부종', prescriptionName:'오령산', input:'이번 약 안내',
    direction:'', selectedTreatments:[], selectedSituations:[] as string[] };
  app.use('/generate', analysisEndpoint(async (_rules, prompt) => {
    providerCalls++;
    seenPrompt = prompt;
    return prompt.startsWith('{') ? effect : '###1###\n가이드\n###2###\n' + effect + '\n###3###\n팁';
  }, (_req, _res, next) => next(), {
    async reviewFree(source) {
      seenName = source.prescriptionName ?? '';
      if (source.prescriptionName === '원내 A방') return { ...draft, responseDraft:'원내 A방을 드세요.' };
      return draft;
    },
    async reviewFixedSymptoms(source) {
      seenName = source.prescriptionName ?? '';
      assert.equal(source.symptoms, '부종');
      return { terms:['부종'], effectParagraph:effect };
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as {port:number}).port + '/generate';
  const submit = (patientContext: object, prescriptionNames: string[] = []) => fetch(url, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({systemInstruction:'clinic', prompt:'현재 약을 안내해 주세요.', patientContext, prescriptionNames}),
  });
  try {
    const ordinary = await submit(context);
    assert.equal(ordinary.status, 200);
    assert.match(seenPrompt, /prescriptionName.*오령산/);
    assert.equal(seenName, '오령산');
    assert.doesNotMatch(JSON.stringify(await ordinary.json()), /오령산/);

    const fixed = await submit({ ...context, input:'', selectedSituations:[HERBAL_FOLLOWUP_SITUATION] });
    assert.equal(fixed.status, 200);
    assert.equal(seenName, '오령산');
    assert.deepEqual(JSON.parse(seenPrompt).formulaNames, ['오령산']);
    assert.equal((await fixed.json()).effectParagraph, effect);

    const publicResult = await submit({ ...context, selectedSituations:['리뷰 답변'], input:'친절해서 좋았습니다.' });
    assert.equal(publicResult.status, 200);
    assert.equal(seenName, '');
    assert.doesNotMatch(seenPrompt, /오령산|prescriptionName/);

    const leaked = await submit({ ...context, prescriptionName:'원내 A방' });
    assert.equal(leaked.status, 422);
    assert.equal((await leaked.json()).code, 'PRESCRIPTION_IN_OUTPUT');

    const priorCalls = providerCalls;
    for (const prescriptionName of [null, [], 1, '가'.repeat(501)]) {
      assert.equal((await submit({ ...context, prescriptionName })).status, 400);
    }
    assert.equal(providerCalls, priorCalls);
    assert.equal((await submit({ ...context, prescriptionName:undefined })).status, 200);
    assert.equal(seenName, '');
    const longName = '가'.repeat(180);
    assert.equal((await submit({ ...context, prescriptionName:longName }, [longName])).status, 200);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('authenticated generation returns only reviewed free messages and canonical fixed messages', async () => {
  const app = express();
  let calls = 0, freeChecks = 0, fixedChecks = 0;
  let seenDraft = '', seenRules = '', seenReference = '', seenSymptoms = '';
  let seenPrompt = '';
  let seenTreatments: string[] = [], seenPrescriptions: string[] = [];
  const sensitive = 'synthetic-private-record';
  const dietMealAdvice = '다이어트약은 식전에 드시는 것이 좋지만, 약효가 일정하게 유지되는 것이 더 중요하기 때문에 식후에 드셔도 됩니다.';
  const expectedDiet = '한약은 하루 두 번 복용하시고, 한약과 한약 사이에는 6시간 이상 간격을 지켜 주세요. ' +
    dietMealAdvice + ' 오늘 바로 드시지 않는 약은 냉장 보관해 주세요.';
  const obsoleteDietLine = '다이어트 한약은 하루 2번, 오전 9~11시와 오후 4~6시쯤 복용하시고 냉장 보관해 주세요.';
  const appointment = '오후 4시 예약을 확인했습니다.';
  const fixedEffect = '몸에 불필요한 수분이 빠져나가도록 도와 붓기를 줄이는 것이 이번 한약의 목적입니다.';
  const encode = (s: string) => '###1###\n내부 안내\n###2###\n' + s + '\n###3###\n내부 팁';
  app.use('/api/generate-analysis', analysisEndpoint(async (instruction, prompt) => {
    calls++;
    seenRules = instruction;
    seenPrompt = prompt;
    if (instruction.includes('효과 설명 한 문단만')) {
      const basis = JSON.parse(prompt);
      assert.deepEqual(basis.formulaNames, ['오령산']);
      assert.equal(basis.patientName, undefined);
      return '발목의 붓기를 개선하도록 준비했습니다.';
    }
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
      if (context.selectedSituations.includes('리뷰 답변')) {
        assert.deepEqual(context.selectedSituations, ['리뷰 답변']);
        assert.equal(context.patientName, '');
        assert.equal(context.symptoms, '');
        assert.deepEqual(context.selectedTreatments, []);
        return { ...draft, responseDraft: PUBLIC_REVIEW_GREETING + '\n설명을 듣고 궁금한 점이 풀리셨다니 다행입니다.' };
      }
      if (context.direction === 'fixture: reviewed diet') {
        return { ...draft, responseDraft: [appointment, HERBAL_DIRECTIONS, DIET_HERBAL_DIRECTIONS,
          obsoleteDietLine, HERBAL_DIRECTIONS, DIET_HERBAL_DIRECTIONS].join('\n\n') };
      }
      if (draft.responseDraft === 'review-error') throw new Error('private-test-error');
      if (draft.responseDraft === 'bad-format') return { ...draft, staffTip:'###1### 숨겨진 내부 지시' };
      if (draft.responseDraft.includes('온청음')) return { strategy:'경과를 확인합니다.', responseDraft:'가상님, 안녕하세요.\\n\\n눈 가려움은 어떠신가요?', staffTip:'증상의 변화만 전달해 주세요.' };
      return draft;
    },
    async reviewFixedSymptoms(context, _draft, effectDraft) {
      fixedChecks++;
      if (context.symptoms === '미확인입력') return { terms: [], effectParagraph: '' };
      if (context.symptoms === '피부 붉어짐, 소화불량') return { terms: ['피부 붉어짐'], effectParagraph: '' };
      if (context.symptoms === '발목 붓기') {
        assert.equal(effectDraft, '발목의 붓기를 개선하도록 준비했습니다.');
        return { terms: ['발목 붓기'], effectParagraph: fixedEffect };
      }
      assert.equal(context.symptoms, '눈 주위 가려움, 피로');
      return { terms: ['눈 주위 가려움', '피로'], effectParagraph: '' };
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
    assert.equal(fixedResult.reviewVersion, MESSAGE_REVIEW_VERSION);
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

    const withFormula = { ...context, symptoms:'발목 붓기', input:'이번 한약은 오령산입니다.', selectedTreatments:['한약'] };
    const namedFixed = await request('ignored', {patientContext: withFormula});
    assert.equal(namedFixed.status, 200);
    const namedResult = await namedFixed.json();
    assert.equal(namedResult.effectParagraph, fixedEffect);
    assert.equal(namedResult.text.replace('\n\n' + fixedEffect, ''), buildHerbalFollowup(withFormula));
    assert.doesNotMatch(namedResult.text, /오령산/);
    assert.deepEqual([calls,freeChecks,fixedChecks],[1,0,4]);

    const publicContext = { ...context, patientName:'직원전용이름', symptoms:'비공개소견, 원내전용방',
      selectedTreatments:['다이어트','교통사고'], selectedSituations:['리뷰 답변','원장','비용/패키지 상담'],
      input:'설명을 듣고 궁금한 점이 풀렸어요.', direction:'짧게' };
    const publicResponse = await request('구버전 폼이 보낸 개인문자와 진료 메모', {patientContext: publicContext});
    assert.equal(publicResponse.status, 200);
    const publicResult = await publicResponse.json();
    assert.equal(publicResult.symptoms, '');
    const publicCopy = parseAnalysisResult(publicResult.text).responseDraft;
    assert.ok(publicCopy.startsWith(PUBLIC_REVIEW_GREETING));
    assert.match(seenPrompt, /궁금한 점이 풀렸어요/);
    assert.match(seenPrompt, /짧게/);
    for (const value of [seenPrompt, seenRules, seenReference, publicCopy]) {
      assert.doesNotMatch(value, /직원전용이름|비공개소견|구버전 폼|6시간 이상 간격|하루 두 번 식후/);
    }
    const beforePublicErrors = calls + freeChecks + fixedChecks;
    for (const invalid of [{ ...publicContext, input:' ' },
      { ...publicContext, selectedSituations:['리뷰 답변', HERBAL_FOLLOWUP_SITUATION] }]) {
      const response = await request('ignored', { patientContext: invalid });
      assert.equal(response.status, 422);
      assert.equal((await response.json()).code, 'PATIENT_INPUT');
    }
    assert.equal(calls + freeChecks + fixedChecks, beforePublicErrors);

    const reviewed = await request('온청음 증상', {patientContext: {...context, symptoms:'눈 주위 가려움, 온청음',
      selectedTreatments:['피로', '한약'], selectedSituations:['원장','한약 복용/경과'], clinicReference:'FAKE_REVIEW_POLICY'}});
    const final = await reviewed.json();
    assert.equal(reviewed.status, 200);
    assert.equal(final.reviewed, true);
    assert.equal(final.reviewVersion, MESSAGE_REVIEW_VERSION);
    assert.equal(parseAnalysisResult(final.text).strategy,'경과를 확인합니다.');
    assert.equal(parseAnalysisResult(final.text).staffTip,'증상의 변화만 전달해 주세요.');
    assert.equal(seenDraft, '온청음 증상\n\n' + HERBAL_DIRECTIONS);
    assert.equal(seenSymptoms, '눈 주위 가려움, 피로');
    assert.deepEqual(seenTreatments, ['한약']);
    assert.deepEqual(seenPrescriptions, ['온청음']);
    assert.notEqual(seenRules, 'clinic');
    assert.doesNotMatch(seenReference, /FAKE_REVIEW_POLICY/);
    assert.match(seenReference, /냉장/);
    const patient = parseAnalysisResult(final.text).responseDraft;
    assert.ok(patient.includes('가상님, 안녕하세요.\n\n눈 가려움은 어떠신가요?'));
    assert.equal(patient.split(HERBAL_DIRECTIONS).length, 2);
    const legacy = await request('hello');
    assert.equal((await legacy.json()).reviewed, true);
    assert.equal(seenRules, 'clinic');

    // No model has supplied directions. The selected buttons alone determine the final copy.
    const buttons = ['교통사고', '다이어트', '한약', '소화불량', '피로'];
    for (const treatments of [...buttons.map(button => [button]), buttons, ['다이어트', '한약'],
      ['약침', '피로'], ['약침'], []]) {
      const diet = treatments.includes('다이어트');
      const regular = !diet && buttons.some(button => treatments.includes(button));
      const patientContext = { ...context, symptoms: '소화불량, 피로', input: '예약 시간 변경 문의',
        selectedTreatments: treatments, selectedSituations: ['예약 변경/취소'] };
      const baseReply = '희망하시는 시간을 알려주세요.';
      const response = await request(baseReply, { patientContext });
      assert.equal(response.status, 200, treatments.join(','));
      const { text } = await response.json();
      const result = parseAnalysisResult(text);
      assert.ok(result.responseDraft.includes(baseReply));
      assert.equal(result.responseDraft.split(HERBAL_DIRECTIONS).length - 1, Number(regular), treatments.join(','));
      assert.equal(result.responseDraft.split(expectedDiet).length - 1, Number(diet), treatments.join(','));
      assert.equal(result.responseDraft.split(dietMealAdvice).length - 1, Number(diet), treatments.join(','));
      if (diet) assert.doesNotMatch(result.responseDraft, /식후에 복용하/);
      assert.deepEqual([result.strategy, result.staffTip], ['내부 안내', '내부 팁']);
      assert.doesNotMatch(result.responseDraft, /오전 9|오후 4/);
    }
    const withDirections = await request('이번 약을 준비했습니다.\n\n' + HERBAL_DIRECTIONS, {
      patientContext: { ...context, selectedTreatments: ['한약', '피로'], selectedSituations: [] }
    });
    assert.equal(withDirections.status, 200);
    assert.equal(parseAnalysisResult((await withDirections.json()).text).responseDraft.split(HERBAL_DIRECTIONS).length, 2);
    const textOnly = await request('확인해 드리겠습니다.', {
      patientContext: { ...context, selectedTreatments: [], selectedSituations: [], input: '지난번 다이어트 한약 문의' }
    });
    assert.equal(textOnly.status, 200);
    assert.equal(parseAnalysisResult((await textOnly.json()).text).responseDraft, '확인해 드리겠습니다.');
    const dietContext = { ...context, selectedTreatments: ['한약', '다이어트'], selectedSituations: [] };
    for (const direction of ['', 'fixture: reviewed diet']) {
      const olderDraft = [appointment, HERBAL_DIRECTIONS, obsoleteDietLine, DIET_HERBAL_DIRECTIONS].join('\n\n');
      const response = await request(olderDraft, { patientContext: { ...dietContext, direction } });
      assert.equal(response.status, 200);
      const patient = parseAnalysisResult((await response.json()).text).responseDraft;
      assert.ok(patient.includes(appointment));
      assert.doesNotMatch(patient, /식후에 복용하|오전 9|오후 4~6시/);
      assert.equal(patient.split(expectedDiet).length, 2);
      assert.equal(patient.split(dietMealAdvice).length, 2);
    }

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
