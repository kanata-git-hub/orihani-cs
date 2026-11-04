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

const rx = loadModule('src/prescriptionFields.ts');
const symptoms = loadModule('src/patientSymptoms.ts', { './prescriptionFields.ts': rx });
const directions = loadModule('src/herbalDirections.ts');
const followup = loadModule('src/herbalFollowup.ts', { './patientSymptoms.ts': symptoms, './herbalDirections.ts': directions });
const constants = loadModule('src/constants/index.ts', {
  '../herbalFollowup.ts': followup, '../patientSymptoms.ts': symptoms, '../herbalDirections.ts': directions
});
const format = loadModule('src/patientMessageText.ts');

function loadService(output) {
  let submitted;
  let calls = 0;
  const service = loadModule('src/services/geminiService.ts', {
    '../patientSymptoms': symptoms,
    '../prescriptionFields': rx,
    '../patientMessageText': format,
    '../herbalFollowup': followup,
    '../constants': constants,
    '../authFetch': { authFetch: async (_url, options) => {
      calls++;
      submitted = JSON.parse(options.body);
      const fields = submitted.patientContext;
      const body = typeof output === 'object' ? output : {
        reviewed: true, reviewVersion: format.MESSAGE_REVIEW_VERSION, symptoms: symptoms.resolvePatientSymptoms(fields),
        effectParagraph: '',
        text: output ?? (followup.isHerbalFollowup(fields) ? followup.buildHerbalFollowup(fields) : 'generated')
      };
      return { ok: true, json: async () => body };
    } }
  });
  return { generate: async p => (await service.analyzePatientMessage(p)).text, raw: service.analyzePatientMessage, request: () => submitted, calls: () => calls };
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
  const withDirections = await service.generate(extra);
  assert.equal(withDirections, followup.buildHerbalFollowup(extra));
  assert.ok(withDirections.includes(directions.HERBAL_DIRECTIONS));
  assert.equal(service.calls(), 2);
  assert.equal(service.request().mode, 'fixed');
  assert.equal(service.request().patientContext.symptoms, '피부 붉어짐, 만성 소화불량');
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

test('a symptom choice keeps its symptom identity and sends the button selection for directions', async () => {
  const service = loadService();
  await service.generate({ ...params, symptoms: '', selectedTreatments: ['피로'] });
  assert.match(service.request().prompt, /질환·증상: 피로/);
  assert.match(service.request().prompt, /선택된 치료: 미지정/);
  assert.deepEqual(service.request().patientContext.selectedTreatments, ['피로']);
});

test('a formula in the symptom list cannot become a symptom in fixed or generated messages', async () => {
  const service = loadService();
  const fields = { ...params, patientName: '가온', symptoms: '소화불량, 반하사심탕' };
  const fixed = { ...fields, selectedSituations: [followup.HERBAL_FOLLOWUP_SITUATION] };
  assert.equal(await service.generate(fixed), followup.buildHerbalFollowup({ ...fixed, symptoms: '소화불량' }));
  assert.equal(service.request().patientContext.symptoms, '소화불량, 반하사심탕');
  assert.equal(service.calls(), 1);
  await service.generate(fields);
  assert.match(service.request().prompt, /^질환·증상: 소화불량$/m);
  assert.match(service.request().prompt, /반하사심탕/);
  for (const p of [fields, fixed]) {
    await assert.rejects(service.generate({ ...p, symptoms: '반하사심탕' }), /증상/);
    await assert.rejects(service.generate({ ...p, symptoms: '반하사심탕 복용 후 구역감' }), /증상|분리|나눠|구분/);
  }
  assert.equal(service.calls(), 2);
  const withButton = { ...fixed, symptoms: '반하사심탕', selectedTreatments: ['소화불량'] };
  assert.equal(await service.generate(withButton), followup.buildHerbalFollowup({ ...withButton, symptoms: '소화불량' }));
});

test('disclosing a formula in a generated response blocks copying, even if only the notes contained it', async () => {
  const service = loadService('###1### 가이드 ###2### 반하사심탕 증상이 어떠신지요? ###3### 안내');
  await assert.rejects(service.generate({ ...params, symptoms: '소화불량', input: '반하사심탕 처방 후 경과 안내' }), /처방|한약/);
});

test('valid symptom words survive unchanged and an explicitly named private formula stays private', () => {
  for (const raw of ['위산 역류', '혈액순환 장애', '기침, 홍조', '피로, 두통', '골반질환']) {
    assert.equal(rx.inspectSymptomField(raw).symptoms, raw);
    assert.equal(rx.findDisclosedPrescription(raw), null);
  }
  const inspection = rx.inspectSymptomField('구역감, 처방명: 원내A방');
  assert.equal(inspection.symptoms, '구역감');
  assert.ok(inspection.prescriptions.includes('원내A방'));
  assert.ok(rx.findDisclosedPrescription('원내A방을 복용하시면', inspection.prescriptions));
});

test('fixed and free responses without successful review cannot be used', async () => {
  const fields = { ...params, patientName: '윤가온', symptoms: '눈 가려움' };
  const legacy = loadService({ text: 'unreviewed' });
  await assert.rejects(legacy.generate(fields), /검수가 완료되지/);
  await assert.rejects(legacy.generate({ ...fields, selectedSituations: [followup.HERBAL_FOLLOWUP_SITUATION] }), /검수가 완료되지/);
});

test('only positively identified prescriptions may be removed and fixed copy must match the approved template', async () => {
  const fields = { ...params, selectedSituations: [followup.HERBAL_FOLLOWUP_SITUATION], patientName: '윤가온', symptoms: '눈 가려움, 원내비공개명', input: '처방명: 원내비공개명' };
  const final = followup.buildHerbalFollowup({ ...fields, symptoms: '눈 가려움' });
  const service = loadService({ reviewed: true, reviewVersion: format.MESSAGE_REVIEW_VERSION, text: final, symptoms: '눈 가려움', effectParagraph: '' });
  const res = await service.raw(fields);
  assert.equal(res.text, final);
  assert.equal(res.symptoms, '눈 가려움');
  const contaminated = loadService({ reviewed: true, reviewVersion: format.MESSAGE_REVIEW_VERSION, text: final + ' 추가 진료', symptoms: '눈 가려움', effectParagraph: '' });
  await assert.rejects(contaminated.generate(fields), /검수가 완료되지/);
});

test('only the reviewed prescription effect slot may extend the fixed template', async () => {
  const fields = { ...params, patientName:'가상', symptoms:'발목 붓기', input:'이번에는 오령산을 드립니다.', selectedSituations:[followup.HERBAL_FOLLOWUP_SITUATION] };
  const effect = '몸속의 남는 수분이 빠져나가도록 도와 발목의 붓기를 줄이기 위한 한약입니다.';
  const data = { reviewed:true, reviewVersion:format.MESSAGE_REVIEW_VERSION, symptoms:fields.symptoms,
    effectParagraph:effect, text:followup.buildHerbalFollowup(fields, effect) };
  assert.equal(await loadService(data).generate(fields), data.text);
  assert.equal(data.text.replace('\n\n' + effect, ''), followup.buildHerbalFollowup(fields));
  await assert.rejects(loadService({ ...data, effectParagraph:'' }).generate(fields), /검수가 완료되지/);
  await assert.rejects(loadService(data).generate({ ...fields, input:'' }), /검수가 완료되지/);
  for (const unsafe of [effect+'\\n추가 문구', effect+'\n\n새 문단', '가이드: '+effect, '###2###', '오령산은 몸속의 남는 수분이 빠져나가도록 돕습니다.']) {
    await assert.rejects(loadService({ ...data, effectParagraph:unsafe, text:followup.buildHerbalFollowup(fields, unsafe) }).generate(fields));
  }
});

test('an earlier release or a partial symptom list cannot supply a copyable response', async () => {
  const fields = { ...params, patientName: '윤가온', symptoms: '피부 붉어짐, 소화불량', selectedSituations: [followup.HERBAL_FOLLOWUP_SITUATION] };
  const partial = followup.buildHerbalFollowup({ ...fields, symptoms: '피부 붉어짐' });
  await assert.rejects(loadService({ reviewed:true, reviewVersion:format.MESSAGE_REVIEW_VERSION, symptoms:'피부 붉어짐',text:partial }).generate(fields), /검수가 완료되지/);
  const currentText = followup.buildHerbalFollowup(fields);
  await assert.rejects(loadService({ reviewed:true, reviewVersion:2, symptoms:fields.symptoms,text:currentText }).generate(fields), /검수가 완료되지/);
  await assert.rejects(loadService({ reviewed:true, text:partial }).generate({ ...params, selectedSituations:['한약 복용/경과'] }), /검수가 완료되지/);
});
