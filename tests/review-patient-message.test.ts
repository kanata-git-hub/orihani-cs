import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { reviewFixedSymptoms, reviewFree } from '../reviewPatientMessage.ts';

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

test('keeps all three acceptable sections and same-child address, normalizing the patient copy', async t => {
  const mock = provider(t, keep);
  for (const name of ['별하님', '김별하님']) {
    const draft = { ...clean, responseDraft: '김하민님, 안녕하세요.\\n\\n' + name + '의 눈가 가려움은 어떠세요?' };
    assert.deepEqual(await reviewFree(input, draft), { ...draft, responseDraft: draft.responseDraft.replaceAll('\\n', '\n') });
  }
  const request = mock.mock.calls[0].arguments;
  assert.equal(request[0], 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent');
  const data = JSON.parse(String(request[1]?.body));
  assert.match(data.systemInstruction.parts[0].text, /별하님.*김별하님.*모두 허용/);
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
  assert.deepEqual(await reviewFree(input, wrong), clean);
});

test('fixed results account for every term and preserve both complete symptom descriptions', async t => {
  provider(t, { items: [{ index: 0, kind: 'symptom' }, { index: 1, kind: 'prescription' }, { index: 2, kind: 'symptom' }] });
  const symptoms = '눈 주위 가려움, 온청음, 지속되는 왼손 부기';
  assert.deepEqual(await reviewFixedSymptoms({ ...input, symptoms }, '승인 문장'), ['눈 주위 가려움', '지속되는 왼손 부기']);
});

test('fixed review accepts positively identified custom prescriptions without inventing a diagnosis', async t => {
  provider(t, { items: [{ index: 0, kind: 'prescription' }] });
  assert.deepEqual(await reviewFixedSymptoms({ ...input, symptoms: '원내Q27', input: '처방명: 원내Q27' }, '승인 문장'), []);
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
      await assert.rejects(reviewFree(input, clean), { status: 503 });
    });
  }
});

test('network failures never disclose credentials or patient context', async t => {
  const mock = provider(t, {});
  mock.mock.mockImplementationOnce(async () => { throw new Error('test-key secret visit'); });
  await assert.rejects(reviewFree(input, clean), (error: Error & { status?: number }) => {
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /test-key|secret|김하민/);
    return true;
  });
});

test('server-separated private prescriptions cannot appear in any reviewed section', async t => {
  for (const field of ['strategy','responseDraft','staffTip'] as const) {
    await t.test(field, async st => {
      provider(st, { ...clean, status: 'revise', [field]: '원내Q27 투약이라고 알리세요.' });
      await assert.rejects(reviewFree({ ...input, prescriptionReferences: ['원내Q27'] }, clean), { status: 503 });
    });
  }
});
