import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { analysisEndpoint } from '../analysisApi.ts';
import { HERBAL_FOLLOWUP_SITUATION } from '../src/herbalFollowup.ts';
import { CLINIC_PRESCRIPTIONS } from '../src/clinicPrescriptions.ts';
import { publicReviewContext } from '../src/publicReview.ts';

// Synthetic requests and stubbed AI responses exercise the real request and output boundaries.
const effect = '소화 기능을 도와 불편을 덜어 줍니다.';
const cleanResult = { strategy: '복용 경과를 확인합니다.', responseDraft: effect, staffTip: '불편의 변화를 확인해 주세요.' };
const source = {
  patientName: '테스트', symptoms: '소화불량', input: '이번 처방의 작용을 안내해 주세요.', direction: '',
  prescriptionName: '', selectedTreatments: [] as string[], selectedSituations: [] as string[],
};

async function harness() {
  const state = {
    instruction: '', prompt: '', reviewedName: '', reviewedReferences: [] as string[],
    reviewMode: '', leak: '', leakField: 'responseDraft' as keyof typeof cleanResult,
  };
  const app = express();
  app.use('/generate', analysisEndpoint(async (instruction, prompt) => {
    state.instruction = instruction;
    state.prompt = prompt;
    return prompt.startsWith('{') ? effect : `###1###\n${cleanResult.strategy}\n###2###\n${effect}\n###3###\n${cleanResult.staffTip}`;
  }, (_req, res, next) => { res.locals.isDirectorAccount = true; next(); }, {
    async reviewFree(context) {
      state.reviewMode = 'free';
      state.reviewedName = context.prescriptionName ?? '';
      state.reviewedReferences = context.prescriptionReferences ?? [];
      return state.leak ? { ...cleanResult, [state.leakField]: `${state.leak}을 안내합니다.` } : cleanResult;
    },
    async reviewFixedSymptoms(context) {
      state.reviewMode = 'fixed';
      state.reviewedName = context.prescriptionName ?? '';
      state.reviewedReferences = context.prescriptionReferences ?? [];
      return { terms: ['소화불량'], effectParagraph: state.leak ? `${state.leak}을 안내합니다.` : effect };
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/generate';
  return {
    state,
    post: (prescriptionName: string, fixed = false, extra: Partial<typeof source> = {}) => fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: 'clinic', prompt: '이번 처방 안내',
        patientContext: { ...source, prescriptionName, ...(fixed && { input: '', selectedSituations: [HERBAL_FOLLOWUP_SITUATION] }), ...extra },
      }),
    }),
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

test('ordinary and fixed generation receive exact approved alias compositions and review keeps the entered names', async () => {
  const app = await harness();
  try {
    for (const fixed of [false, true]) {
      for (const formula of CLINIC_PRESCRIPTIONS) {
        const response = await app.post(formula.name, fixed);
        assert.equal(response.status, 200);
        assert.ok(app.state.instruction.includes(`${formula.name} = ${formula.components.join(' + ')}`));
        const other = CLINIC_PRESCRIPTIONS.find(candidate => candidate.name !== formula.name)!;
        assert.ok(!app.state.instruction.includes(`${other.name} =`));
        assert.ok(app.state.instruction.includes('중복 약재의 용량을 더하지 않고'));
        assert.equal(app.state.reviewedName, formula.name);
        assert.ok(app.state.reviewedReferences.includes(formula.name));
        assert.equal(app.state.reviewMode, fixed ? 'fixed' : 'free');
        if (fixed) {
          assert.deepEqual(JSON.parse(app.state.prompt).formulaNames, [formula.name]);
        } else {
          assert.ok(app.state.prompt.includes(JSON.stringify({ prescriptionName: formula.name })));
        }
        const body = JSON.stringify(await response.json());
        for (const name of [formula.name, ...formula.components]) assert.ok(!body.includes(name));
      }
    }
  } finally { await app.close(); }
});

test('combined aliases retain two review identities and ordinary formulas are not expanded into private aliases', async () => {
  const app = await harness();
  try {
    const entered = '오리 속편환 + 오리원기탕 + 맥문동탕';
    for (const fixed of [false, true]) {
      assert.equal((await app.post(entered, fixed)).status, 200);
      assert.equal(app.state.reviewedName, entered);
      assert.deepEqual(app.state.reviewedReferences, ['오리속편환', '오리원기탕', '맥문동탕']);
      for (const formula of CLINIC_PRESCRIPTIONS) {
        assert.ok(app.state.instruction.includes(`${formula.name} = ${formula.components.join(' + ')}`));
      }
      if (fixed) assert.deepEqual(JSON.parse(app.state.prompt).formulaNames, ['오리속편환', '오리원기탕', '맥문동탕']);
    }
    assert.equal((await app.post('청심연자음')).status, 200);
    assert.ok(!app.state.instruction.includes('[원장 승인 원내 처방 구성'));
  } finally { await app.close(); }
});

test('unregistered custom names never receive trusted alias context', async () => {
  const app = await harness();
  try {
    for (const fixed of [false, true]) {
      for (const name of ['오리미등록탕', '오리속편환가미', '오리원기탕2']) {
        assert.equal((await app.post(name, fixed)).status, 200);
        assert.equal(app.state.reviewedName, name);
        assert.ok(!app.state.instruction.includes('[원장 승인 원내 처방 구성'));
        if (fixed) assert.deepEqual(JSON.parse(app.state.prompt).formulaNames, [name]);
      }
    }
  } finally { await app.close(); }
});

test('public review text cannot activate the private formula-composition context', async () => {
  const app = await harness();
  try {
    const response = await app.post('', false, publicReviewContext('오리속편환을 안내받았어요.', ''));
    assert.equal(response.status, 200);
    assert.equal(app.state.reviewedName, '');
    assert.ok(!app.state.instruction.includes('[원장 승인 원내 처방 구성'));
  } finally { await app.close(); }
});

test('the final API boundary rejects aliases and every component name in any returned section', async () => {
  const app = await harness();
  try {
    const allNames = [...new Set(CLINIC_PRESCRIPTIONS.flatMap(formula => [formula.name, ...formula.components]))];
    for (const leak of allNames) {
      app.state.leak = leak;
      for (const field of ['strategy', 'responseDraft', 'staffTip'] as const) {
        app.state.leakField = field;
        const response = await app.post('오리속편환+오리원기탕');
        assert.equal(response.status, 422, `${field}: ${leak}`);
        assert.equal((await response.json()).code, 'PRESCRIPTION_IN_OUTPUT');
      }
      const fixed = await app.post('오리속편환+오리원기탕', true);
      assert.equal(fixed.status, 422, `fixed: ${leak}`);
      assert.equal((await fixed.json()).code, 'PRESCRIPTION_IN_OUTPUT');
    }
  } finally { await app.close(); }
});
