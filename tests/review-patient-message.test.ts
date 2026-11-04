import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { reviewFixedSymptoms, reviewFree } from '../reviewPatientMessage.ts';
import { PUBLIC_REVIEW_GREETING } from '../src/publicReview.ts';

const input = { patientName: '김하민', symptoms: '눈 주위 가려움, 온청음, 새 원내 제제, 지속되는 왼손 부기',
  input: '자녀 김별하님의 눈 주위 가려움, 왼손 부기를 문의함. 온청음은 한약명.', direction: '',
  selectedTreatments: ['한약'], selectedSituations: ['일반한약 첫 15일 마무리 안내'] };

function provider(t: TestContext, verdict: unknown, options: { version?: string; upstream?: number; finish?: string } = {}) {
  const original = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  t.after(() => { if (original === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = original; });
  return t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], _options?: RequestInit) => new Response(JSON.stringify({
    modelVersion: options.version ?? 'gemini-4-argon',
    candidates: [{ finishReason: options.finish ?? 'STOP', content: { parts: [{ text: JSON.stringify(verdict) }] } }],
  }), { status: options.upstream ?? 200 }));
}

const clean = { strategy: '속마음: 시간을 문의했습니다.\n\n가이드: 확인 후 답합니다.',
  responseDraft: '안녕하세요.', staffTip: '거절 시: 희망 시간을 여쭙습니다.\n\n핵심: 예약 확정 전입니다.' };
const keep = { status: 'keep', strategy: '', responseDraft: '', staffTip: '' };
const freeInput = { ...input, input: '자녀 김별하님의 눈 주위 가려움과 왼손 부기를 문의함.' };

test('public review uses the published words and a separate editorial brief for Argon', async t => {
  const context = { ...freeInput, input: '한약을 받으러 갔는데 기다리는 동안 아무 안내가 없어서 아쉬웠습니다.',
    patientName:'기록전용이름', symptoms:'기록전용증상', selectedSituations:['리뷰 답변'], selectedTreatments:['한약'],
    prescriptionReferences:['원내Q27'], direction:'짧게' };
  const draft = { ...clean, responseDraft:'후기 감사합니다. 저희 치료에 만족하셔서 다행입니다. 한약은 하루 두 번 드세요.' };
  const final = { strategy:'속마음: 대기 중 안내가 없었다는 후기입니다.\n\n가이드: 불편하셨던 대목에 답합니다.',
    responseDraft:PUBLIC_REVIEW_GREETING + '\n기다리시는 동안 안내를 받지 못해 답답하셨겠습니다. 다음에는 대기 상황을 더 세심하게 안내드리겠습니다.',
    staffTip:'거절 시: 답글에서 논쟁하지 않습니다.\n\n핵심: 대기 안내에 대한 의견을 확인합니다.' };
  const mock = provider(t, {status:'revise', ...final});
  assert.deepEqual(await reviewFree(context, draft), final);
  const body = JSON.parse(String(mock.mock.calls[0].arguments[1]?.body));
  assert.equal(mock.mock.callCount(), 1);
  const instruction = body.systemInstruction.parts[0].text;
  assert.match(instruction, /공개 리뷰 답글/);
  assert.match(instruction, /불만/);
  assert.doesNotMatch(instruction, /formulaEffects|처방을 명시했다면/);
  const evidence = JSON.parse(body.contents[0].parts[0].text);
  assert.equal(evidence.review, context.input);
  assert.equal(evidence.tone, '짧게');
  assert.equal(evidence.context, undefined);
  assert.doesNotMatch(body.contents[0].parts[0].text, /기록전용|원내Q27/);
  assert.ok(!body.generationConfig.responseSchema.required.includes('formulaEffects'));
});

test('public replies keep one owner greeting and never need to expand prescription names from reviews', async t => {
  const form = { ...freeInput, selectedSituations:['원장','리뷰 답변'], selectedTreatments:['다이어트'],
    input:'오령산을 받으러 갔는데 직원분들이 친절했어요.' };
  const message = PUBLIC_REVIEW_GREETING + '\n직원들의 안내를 좋게 봐주셔서 감사합니다.';
  await t.test('valid reply is kept', async st => {
    provider(st, keep);
    assert.equal((await reviewFree(form, { ...clean, responseDraft:message })).responseDraft, message);
  });
  for (const [label, responseDraft] of [['desk greeting', '안녕하세요, 오리한의원입니다. 감사합니다.'],
    ['greeting only', PUBLIC_REVIEW_GREETING], ['duplicate greeting', message + '\n' + PUBLIC_REVIEW_GREETING],
    ['disclosed formula', message + ' 오령산도 잘 복용해 주세요.']]) {
    await t.test(label, async st => {
      provider(st, keep);
      await assert.rejects(reviewFree(form, { ...clean, responseDraft }), { status:503 });
    });
  }
});

test('keeps all three acceptable sections and same-child address, normalizing the patient copy', async t => {
  const mock = provider(t, keep);
  for (const name of ['별하님', '김별하님']) {
    const draft = { ...clean, responseDraft: '김하민님, 안녕하세요.\\n\\n' + name + '의 눈가 가려움은 어떠세요?' };
    assert.deepEqual(await reviewFree(freeInput, draft), { ...draft, responseDraft: draft.responseDraft.replaceAll('\\n', '\n') });
  }
  const request = mock.mock.calls[0].arguments;
  assert.equal(request[0], 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent');
  const data = JSON.parse(String(request[1]?.body));
  assert.match(data.systemInstruction.parts[0].text, /별하님.*김별하님.*모두 허용/);
  assert.ok(!data.generationConfig.responseSchema.required.includes('formulaEffects'));
  assert.equal(JSON.parse(data.contents[0].parts[0].text).draft.staffTip, clean.staffTip);
});

test('one reviewer call corrects contradictory patient and staff directions together', async t => {
  const wrong = { strategy: '가이드: 다음 처방이 준비됐다고 안내한다.',
    responseDraft: '다음 처방을 준비했습니다.', staffTip: '핵심: 준비된 약을 찾으시도록 연락한다.' };
  const corrected = { strategy: '가이드: 내원 후 다음 처방 결정 안내.',
    responseDraft: '안녕하세요.\\n\\n내원하시면 다음 처방을 상담하겠습니다.',
    staffTip: '핵심: 다음 처방은 아직 결정되지 않았습니다.' };
  const mock = provider(t, { ...corrected, status: 'revise' });
  assert.deepEqual(await reviewFree({ ...input, input: '다음 처방은 내원 후 결정하기로 했다.' }, wrong),
    { ...corrected, responseDraft: corrected.responseDraft.replaceAll('\\n', '\n') });
  assert.equal(mock.mock.callCount(), 1);
  const body = JSON.parse(String(mock.mock.calls[0].arguments[1]?.body));
  assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).draft, wrong);
});

test('staff-only correction preserves valid patient copy and does not reuse unreviewed staff advice', async t => {
  const wrong = { ...clean, staffTip: '핵심: 예약이 확정됐다고 안내한다.' };
  provider(t, { ...clean, status: 'revise' });
  assert.deepEqual(await reviewFree(freeInput, wrong), clean);
});

test('fixed results account for every term and preserve both complete symptom descriptions', async t => {
  provider(t, { items: [{ index: 0, kind: 'symptom' }, { index: 1, kind: 'prescription' }, { index: 2, kind: 'symptom' }] });
  const symptoms = '눈 주위 가려움, 온청음, 지속되는 왼손 부기';
  assert.deepEqual(await reviewFixedSymptoms({ ...input, input: '', symptoms }, '승인 문장'), { terms: ['눈 주위 가려움', '지속되는 왼손 부기'], effectParagraph: '' });
});

test('fixed review accepts positively identified custom prescriptions without inventing a diagnosis', async t => {
  provider(t, { items: [{ index: 0, kind: 'prescription' }] });
  assert.deepEqual(await reviewFixedSymptoms({ ...input, symptoms: '원내Q27', input: '', prescriptionReferences: ['원내Q27'] }, '승인 문장'), { terms: [], effectParagraph: '' });
});

test('fixed review fails closed when a real symptom is omitted, duplicated, reordered, or undisclosed', async t => {
  const form = { ...input, symptoms: '피부 붉어짐, 소화불량' };
  const first = { index: 0, kind: 'symptom' }, second = { index: 1, kind: 'symptom' };
  for (const items of [[first], [second, first], [first, first], [first, { index: 1, kind: 'ignore' }],
    [first, { index: '1', kind: 'symptom' }], [first, { index: 2, kind: 'symptom' }]]) {
    await t.test(JSON.stringify(items), async st => {
      provider(st, { items });
      await assert.rejects(reviewFixedSymptoms(form, '승인 문장'), { status: 503 });
    });
  }
  for (const kind of ['uncertain', 'prescription']) {
    await t.test('cannot silently drop 소화불량 as '+kind, async st => {
      provider(st, { items: [first, { index: 1, kind }] });
      await assert.rejects(reviewFixedSymptoms(form, '승인 문장'), /질환·증상/);
    });
  }
  await t.test('reject an unrecognized private word even if called a prescription', async st => {
    provider(st, { items: [{ index: 0, kind: 'prescription' }] });
    await assert.rejects(reviewFixedSymptoms({ ...form, symptoms: '민트제제' }, '승인 문장'), /질환·증상/);
  });
  await t.test('a known prescription cannot be rendered if Argon labels it a symptom', async st => {
    provider(st, { items: [{ index: 0, kind: 'symptom' }] });
    await assert.rejects(reviewFixedSymptoms({ ...form, symptoms: '온청음' }, '승인 문장'), /질환·증상/);
  });
});

test('fixed follow-up can add only a reviewed name-free effect while retaining approved copy', async t => {
  const form = { ...input, input:'이번에는 오령산을 드립니다.', symptoms:'발목 붓기' };
  const effectParagraph = '수분 흐름을 조절해 발목의 붓기가 가라앉도록 돕습니다.';
  const items = [{ index:0, kind:'symptom' }];
  const formulaEffects = [{ index:0, kind:'explained', action:'수분 흐름을 조절해', patientQuote:effectParagraph, sourceQuote:'' }];
  await t.test('effect and symptoms are reviewed together once', async st => {
    const mock = provider(st, { items, formulaEffects, effectParagraph });
    assert.deepEqual(await reviewFixedSymptoms(form, '승인된 고정 본문'), { terms:['발목 붓기'], effectParagraph });
    assert.equal(mock.mock.callCount(), 1);
    const request = JSON.parse(String(mock.mock.calls[0].arguments[1]?.body));
    assert.deepEqual(JSON.parse(request.contents[0].parts[0].text).effectPrescriptionNames, ['오령산']);
  });
  for (const [label, paragraph] of [
    ['missing effect', ''], ['unreviewed extra', effectParagraph + ' 매일 내원하세요.'],
    ['private name', '오령산은 ' + effectParagraph], ['internal text', '가이드: '+effectParagraph],
    ['extra dosing', effectParagraph + ' 하루 두 번 복용하세요.'],
  ]) {
    await t.test(label, async st => {
      provider(st, { items, formulaEffects, effectParagraph:paragraph });
      await assert.rejects(reviewFixedSymptoms(form, '고정 본문'), { status:503 });
    });
  }
  await t.test('private unidentified formula cannot introduce an unsupported effect', async st => {
    const unknown = { ...form, input:'처방명: 원내Q27' };
    const formulaEffects = [{ index:0, kind:'unidentified', patientQuote:'', action:'', sourceQuote:'처방명: 원내Q27' }];
    provider(st, { items, formulaEffects, effectParagraph:'' });
    assert.deepEqual(await reviewFixedSymptoms(unknown, '고정 본문'), { terms:['발목 붓기'], effectParagraph:'' });
  });
});

test('incomplete verdicts, private content, and staff text in the patient copy fail closed', async t => {
  for (const [name, verdict, options] of [
    ['new patient text on keep', { ...keep, responseDraft: '모르는 수신자' }, {}],
    ['new staff tip on keep', { ...keep, staffTip: '바로 확정하세요.' }, {}],
    ['empty revised staff guide', { ...clean, status: 'revise', strategy: '' }, {}],
    ['missing revised staff tip', { status: 'revise', strategy: '안내', responseDraft: '문자' }, {}],
    ['empty revised patient text', { ...clean, status: 'revise', responseDraft: '' }, {}],
    ['prescription disclosed to patient', { ...clean, status: 'revise', responseDraft: '온청음은 어떠세요?' }, {}],
    ['prescription leaked in guide', { ...clean, status: 'revise', strategy: '가이드: 온청음 처방 확인' }, {}],
    ['marker in staff tips', { ...clean, status: 'revise', staffTip: '###2###문자' }, {}],
    ['staff label in patient output', { ...clean, status: 'revise', responseDraft: '안녕하세요.\n가이드: 예약 변경 확인' }, {}],
    ['wrong model', keep, { version: 'gemini-3.6-flash' }],
    ['incomplete', keep, { finish: 'MAX_TOKENS' }],
  ] as const) {
    await t.test(name, async st => {
      provider(st, verdict, options);
      await assert.rejects(reviewFree(freeInput, clean), { status: 503 });
    });
  }
});

test('network failures never disclose credentials or patient context', async t => {
  const mock = provider(t, {});
  mock.mock.mockImplementationOnce(async () => { throw new Error('test-key secret visit'); });
  await assert.rejects(reviewFree(freeInput, clean), (error: Error & { status?: number }) => {
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /test-key|secret|김하민/);
    return true;
  });
});

test('server-separated private prescriptions cannot appear in any reviewed section', async t => {
  for (const field of ['strategy','responseDraft','staffTip'] as const) {
    await t.test(field, async st => {
      provider(st, { ...clean, status: 'revise', [field]: '원내Q27 투약이라고 알리세요.' });
      await assert.rejects(reviewFree({ ...freeInput, prescriptionReferences: ['원내Q27'] }, clean), { status: 503 });
    });
  }
});

test('free review replaces a list of symptoms with the roles of both current formulas in the patient message', async t => {
  const form = { ...freeInput, patientName: '가상환자', symptoms: '손 부종, 피부 발적, 불면',
    input: '이번에도 같은 약(오령산+온청음)을 드리니 잘 드십시오.', selectedSituations: [], selectedTreatments: [] };
  const generic = '부종과 불면, 피부 불편을 함께 개선할 수 있도록 같은 한약으로 준비해 드렸습니다.';
  const fluid = '몸의 수분 균형을 조절해 손의 붓기를 덜어주도록 했습니다.';
  const redness = '피부의 열을 가라앉혀 붉은 기운을 줄이는 데도 중점을 두었습니다.';
  const original = { ...clean, responseDraft: generic };
  const revised = { ...clean, responseDraft: fluid + ' ' + redness };
  const effects = [
    { index: 0, kind: 'explained', action: '수분 균형을 조절해', patientQuote: fluid, sourceQuote: '' },
    { index: 1, kind: 'explained', action: '피부의 열을 가라앉혀', patientQuote: redness, sourceQuote: '' },
  ];
  await t.test('one call revises the patient copy and accounts for each component without naming it', async st => {
    const mock = provider(st, { status: 'revise', ...revised, formulaEffects: effects });
    const result = await reviewFree(form, original);
    assert.deepEqual(result, revised);
    assert.doesNotMatch(result.responseDraft, /오령산|온청음|불면/);
    assert.equal(mock.mock.callCount(), 1);
    const body = JSON.parse(String(mock.mock.calls[0].arguments[1]?.body));
    assert.ok(body.generationConfig.responseSchema.required.includes('formulaEffects'));
    const request = JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(request.effectPrescriptionNames, ['오령산', '온청음']);
  });
  const vagueAction = '부종과 불면, 피부 불편을 함께 개선';
  for (const [name, draft, verdict] of [
    ['silent keep', original, keep],
    ['missing second effect', revised, { ...keep, formulaEffects: effects.slice(0, 1) }],
    ['misordered component indexes', revised, { ...keep, formulaEffects: [...effects].reverse() }],
    ['staff-only evidence', { ...original, staffTip: fluid + ' ' + redness }, { ...keep, formulaEffects: effects }],
    ['generic symptom recap as one role', { ...clean, responseDraft: generic + ' ' + redness }, { ...keep, formulaEffects: [
      { ...effects[0], patientQuote: generic, action: vagueAction }, effects[1]] }],
    ['same action reused for both roles', revised, { ...keep, formulaEffects: [effects[0], { ...effects[0], index: 1 }] }],
    ['explanation names the formula', { ...revised, responseDraft: '오령산은 ' + revised.responseDraft }, { ...keep, formulaEffects: effects }],
    ['current known formula treated as an unknown', revised, { ...keep, formulaEffects: [
      { ...effects[0], kind: 'unidentified', action: '', patientQuote: '', sourceQuote: '같은 약(오령산+온청음)' }, effects[1]] }],
  ] as const) {
    await t.test(name, async st => {
      provider(st, verdict);
      await assert.rejects(reviewFree(form, draft), { status: 503 });
    });
  }
});

test('free review can omit a previous prescription and an unidentified private formula', async t => {
  for (const [kind, note] of [
    ['background', '예전에만 복용한 오령산은 이번 처방에서 제외했습니다.'],
    ['unidentified', '처방명: 원내Q27'],
  ] as const) {
    await t.test(kind, async st => {
      provider(st, { ...keep, formulaEffects: [{ index: 0, kind, action: '', patientQuote: '', sourceQuote: note }] });
      const result = await reviewFree({ ...freeInput, input: note }, clean);
      assert.deepEqual(result, clean);
      assert.doesNotMatch(result.responseDraft, /오령산|원내Q27/);
    });
  }
});

test('a private formula needs a staff-supplied action to justify an explanation', async t => {
  const action = '수분 흐름을 조절해';
  const patientQuote = action + ' 붓기를 덜도록 돕습니다.';
  const draft = { ...clean, responseDraft: patientQuote };
  const input = { ...freeInput, input: '이번 약(원내새봄탕)을 드립니다.', direction: '' };
  await t.test('reject an invented action', async st => {
    provider(st, { ...keep, formulaEffects: [{ index: 0, kind: 'explained', action, patientQuote, sourceQuote: action }] });
    await assert.rejects(reviewFree(input, draft), { status: 503 });
  });
  await t.test('allow the role specified in additional instructions', async st => {
    provider(st, { ...keep, formulaEffects: [{ index: 0, kind: 'explained', action, patientQuote, sourceQuote: patientQuote }] });
    assert.deepEqual(await reviewFree({ ...input, direction: patientQuote }, draft), draft);
  });
});
