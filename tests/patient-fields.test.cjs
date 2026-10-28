const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loadService() {
  let submitted;
  let calls = 0;
  const exported = {};
  const symptomHelpers = {};
  const helperSource = ts.transpileModule(fs.readFileSync('src/patientSymptoms.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(helperSource, { exports: symptomHelpers });
  const source = ts.transpileModule(fs.readFileSync('src/services/geminiService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(source, {
    exports: exported,
    require(id) {
      if (id === '../patientSymptoms') return symptomHelpers;
      if (id === '../authFetch') return { authFetch: async (_url, options) => {
        calls++; submitted = JSON.parse(options.body);
        return { ok: true, json: async () => ({ text: 'generated' }) };
      }};
      if (id === '../constants') return { SYSTEM_INSTRUCTION: 'unchanged system instruction' };
      if (id === '../herbalFollowup') return {
        isHerbalFollowup: p => p.selectedSituations.includes('일반한약 첫 15일 마무리 안내'),
        buildHerbalFollowup: () => 'fixed template'
      };
      throw new Error(id);
    }
  });
  return { generate: exported.analyzePatientMessage, request: () => submitted, calls: () => calls };
}

const params = { input: '예약 문의입니다.', direction: '', selectedTreatments: ['침'], selectedTraits: [], selectedSituations: ['신환 상담/문의'] };

test('common patient fields reach ordinary response generation', async () => {
  const service = loadService();
  await service.generate({ ...params, patientName: '김○○', symptoms: '허리 통증' });
  assert.match(service.request().prompt, /환자 이름: 김○○/);
  assert.match(service.request().prompt, /질환·증상: 허리 통증/);
  assert.match(service.request().prompt, /메시지\/상황: 예약 문의입니다./);
  assert.equal(service.request().systemInstruction, 'unchanged system instruction');
});

test('blank common fields preserve the existing prompt without extra labels', async () => {
  const service = loadService();
  await service.generate(params);
  assert.equal(service.request().prompt, `[환자 및 상황 정보]
메시지/상황: 예약 문의입니다.
선택된 치료: 침
환자 특징: 미지정
응대 상황: 신환 상담/문의
추가 요청: 없음`);
});

test('first 15-day template does not call the generative API', async () => {
  const service = loadService();
  const result = await service.generate({ ...params, patientName: '김○○', symptoms: '만성피로', selectedSituations: ['일반한약 첫 15일 마무리 안내'] });
  assert.equal(result, 'fixed template');
  assert.equal(service.calls(), 0);
});

test('symptom choices produce the same ordinary prompt as direct symptom input', async () => {
  const selected = loadService();
  const typed = loadService();
  await selected.generate({ ...params, symptoms: '', selectedTreatments: ['침', '소화불량', '피로'] });
  await typed.generate({ ...params, symptoms: '소화불량, 피로' });
  assert.equal(selected.request().prompt, typed.request().prompt);
  assert.match(selected.request().prompt, /선택된 치료: 침\n/);
});

test('a symptom choice alone does not invent a herbal treatment', async () => {
  const service = loadService();
  await service.generate({ ...params, symptoms: '', selectedTreatments: ['피로'] });
  assert.match(service.request().prompt, /질환·증상: 피로/);
  assert.match(service.request().prompt, /선택된 치료: 미지정/);
});
