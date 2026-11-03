const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loadModule(path, imports = {}) {
  const exported = {};
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(source, {
    exports: exported,
    require(id) {
      if (Object.hasOwn(imports, id)) return imports[id];
      throw new Error(`Unexpected import ${id} in ${path}`);
    }
  });
  return exported;
}

const symptoms = loadModule('src/patientSymptoms.ts');
const followup = loadModule('src/herbalFollowup.ts', { './patientSymptoms.ts': symptoms });
const constants = loadModule('src/constants/index.ts', { '../herbalFollowup': followup, '../patientSymptoms': symptoms });

function loadService() {
  let submitted;
  let calls = 0;
  const service = loadModule('src/services/geminiService.ts', {
    '../patientSymptoms': symptoms,
    '../herbalFollowup': followup,
    '../constants': constants,
    '../authFetch': { authFetch: async (_url, options) => {
      calls++;
      submitted = JSON.parse(options.body);
      return { ok: true, json: async () => ({ text: 'generated' }) };
    } }
  });
  return { generate: service.analyzePatientMessage, request: () => submitted, calls: () => calls };
}

const params = { input: '예약 문의입니다.', direction: '', selectedTreatments: ['침'], selectedSituations: ['신환 상담/문의'] };

test('common patient fields reach ordinary response generation', async () => {
  const service = loadService();
  await service.generate({ ...params, patientName: '김○○', symptoms: '허리 통증' });
  assert.match(service.request().prompt, /환자 이름: 김○○/);
  assert.match(service.request().prompt, /질환·증상: 허리 통증/);
  assert.match(service.request().prompt, /메시지\/상황: 예약 문의입니다./);
  assert.equal(service.calls(), 1);
});

test('blank common fields preserve the existing prompt without extra labels', async () => {
  const service = loadService();
  await service.generate(params);
  assert.equal(service.request().prompt, `[환자 및 상황 정보]
메시지/상황: 예약 문의입니다.
선택된 치료: 침
응대 상황: 신환 상담/문의
추가 요청: 없음`);
});

test('first 15-day situation always selects the original fixed text, even in a restored draft', async () => {
  const service = loadService();
  const ordinary = { ...params, patientName: '김○○', symptoms: '피부 붉어짐, 만성 소화불량',
    selectedTreatments: [], selectedSituations: [followup.HERBAL_FOLLOWUP_SITUATION] };
  const expected = followup.buildHerbalFollowup(ordinary);
  const extra = { ...ordinary, input: '다른 상황 메모', direction: '자세히', selectedTraits: ['고령/기력저하'],
    selectedTreatments: ['한약', '도침'], selectedSituations: ['원장', followup.HERBAL_FOLLOWUP_SITUATION, '한약 복용/경과'] };
  assert.equal(await service.generate(ordinary), expected);
  assert.equal(await service.generate(extra), expected);
  assert.equal(service.calls(), 0);
});

test('invalid first 15-day requests fail without falling back to AI', async () => {
  const service = loadService();
  const request = { ...params, selectedSituations: [followup.HERBAL_FOLLOWUP_SITUATION] };
  await assert.rejects(service.generate(request), /환자 이름/);
  for (const treatment of ['교통사고', '다이어트']) {
    await assert.rejects(service.generate({ ...request, patientName: '김○○', symptoms: '피로', selectedTreatments: [treatment] }), /제외한 일반한약/);
  }
  assert.equal(service.calls(), 0);
});

test('restored trait selections cannot reach the ordinary AI request', async () => {
  const service = loadService();
  const ordinary = { ...params, selectedTreatments: ['한약'], selectedSituations: ['한약 복용/경과'], input: '소화는 편해졌고 피부 붉어짐은 그대로입니다.' };
  await service.generate(ordinary);
  const clean = service.request();
  await service.generate({ ...ordinary, selectedTraits: ['고령/기력저하', '만성/유착(1개월↑)'] });
  assert.deepEqual(service.request(), clean);
  assert.doesNotMatch(clean.prompt, /환자 특징|고령|유착/);
  assert.ok(clean.prompt.includes(ordinary.input));
});

test('ordinary herbal inquiries receive grounded guidance without procedure or accident scripts', async () => {
  const service = loadService();
  await service.generate({ ...params, symptoms: '피부 붉어짐, 만성 소화불량', selectedTreatments: ['한약'], selectedSituations: ['한약 복용/경과'] });
  const instruction = service.request().systemInstruction;
  assert.match(instruction, /입력에서 확인한 사실/);
  assert.match(instruction, /한약명 비공개/);
  assert.doesNotMatch(instruction, /근골격계 시술 패키지|초음파약침 안내|교통사고 안내|부위별 시술 안내/);

  await service.generate({ ...params, selectedTreatments: ['도침'], selectedSituations: ['비용/패키지 상담'] });
  assert.match(service.request().systemInstruction, /근골격계 시술 패키지/);
});

test('an untagged shoulder inquiry keeps its specific guidance from either clinical input field', async () => {
  const service = loadService();
  for (const clinicalInput of [{ symptoms: '오십견' }, { input: '석회성 건염 치료 문의' }]) {
    await service.generate({ ...params, selectedTreatments: [], ...clinicalInput });
    assert.match(service.request().systemInstruction, /초음파약침 안내/);
  }
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
