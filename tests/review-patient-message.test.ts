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

test('keeps an acceptable address and normalizes copy text without changing its content', async t => {
  const mock = provider(t, { status: 'keep', final: '' });
  for (const name of ['별하님', '김별하님']) {
    const draft = '김하민님, 안녕하세요.\\n\\n' + name + '의 눈가 가려움은 어떠세요?';
    assert.equal(await reviewFree(input, draft), draft.replaceAll('\\n', '\n'));
  }
  const request = mock.mock.calls[0].arguments;
  assert.equal(request[0], 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent');
  assert.match(JSON.parse(String(request[1]?.body)).systemInstruction.parts[0].text, /별하님.*김별하님.*모두 허용/);
});

test('revised patient copy gets real paragraph breaks and only final text', async t => {
  const revised = ['윤가온님 안녕하세요.', '경과를 알려주세요.', '15일 복용을 마치실 시기입니다.', '한약을 이어서 드시기를 권하십니다.', '편하실 때 연락 주세요.'];
  provider(t, { status: 'revise', final: revised.join('\\n\\n') });
  assert.equal(await reviewFree(input, '다음 처방을 준비 중입니다.'), revised.join('\n\n'));
});

test('fixed rendering can only use complete source terms with preserved qualifiers', async t => {
  provider(t, { selected: [0, 3] });
  assert.deepEqual(await reviewFixedSymptoms(input, '승인 문장'), ['눈 주위 가려움', '지속되는 왼손 부기']);
});

test('fixed review can reject every term without inventing a diagnosis', async t => {
  provider(t, { selected: [] });
  assert.deepEqual(await reviewFixedSymptoms({ ...input, symptoms: '원내 제제' }, '승인 문장'), []);
});

test('rejects fabricated, repeated, reordered or known-prescription selections', async t => {
  for (const selected of [[4], [-1], [1], [3, 0], [0, 0], ['가려움'], [1.5]]) {
    await t.test(String(selected), async st => {
      provider(st, { selected });
      await assert.rejects(reviewFixedSymptoms(input, '승인 문장'), { status: 503 });
    });
  }
});

test('malformed, truncated, unreviewed or private patient messages cannot be copied', async t => {
  for (const [name, verdict, options] of [
    ['new text on keep', { status: 'keep', final: '모르는 수신자' }, {}],
    ['empty revised text', { status: 'revise', final: '' }, {}],
    ['prescription disclosed', { status: 'revise', final: '온청음은 어떠세요?' }, {}],
    ['staff sections in output', { status: 'revise', final: '###1###가이드' }, {}],
    ['wrong model', { status: 'keep', final: '' }, { version: 'gemini-3.6-flash' }],
    ['incomplete', { status: 'keep', final: '' }, { finish: 'MAX_TOKENS' }],
  ] as const) {
    await t.test(name, async st => {
      provider(st, verdict, options);
      await assert.rejects(reviewFree(input, '안녕하세요.'), { status: 503 });
    });
  }
});

test('network failures never disclose credentials or patient context', async t => {
  const mock = provider(t, {});
  mock.mock.mockImplementationOnce(async () => { throw new Error('test-key secret visit'); });
  await assert.rejects(reviewFree(input, '안녕하세요.'), (error: Error & { status?: number }) => {
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /test-key|secret|김하민/);
    return true;
  });
});

test('server-separated private prescription references cannot appear in the reviewed text', async t => {
  provider(t, { status: 'revise', final: '원내Q27은 어떠세요?' });
  await assert.rejects(reviewFree({ ...input, prescriptionReferences: ['원내Q27'] }, '문안'), { status: 503 });
});
