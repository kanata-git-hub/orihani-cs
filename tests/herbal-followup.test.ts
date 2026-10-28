import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHerbalFollowup, herbalFollowupError, HERBAL_FOLLOWUP_SITUATION } from '../src/herbalFollowup.ts';
import { resolvePatientSymptoms } from '../src/patientSymptoms.ts';
import type { AnalyzeParams } from '../src/types/index.ts';

const params: AnalyzeParams = {
  patientName: '김○○', symptoms: '만성 소화불량', input: '', direction: '',
  selectedTreatments: ['한약'], selectedTraits: [], selectedSituations: [HERBAL_FOLLOWUP_SITUATION]
};

test('first contact matches the supplied five-paragraph template exactly', () => {
  const message = buildHerbalFollowup(params).split(/###\d###/)[2].trim();
  assert.equal(message, `김○○님, 안녕하세요. 오리한의원입니다.

지난번 처방받으신 한약은 잘 챙겨 드시고 계실까요? 15일간 한약을 복용하시면서 소화가 한결 편해지셨을 것 같은데, 아직 불편한 증상이 남아 있지는 않으신지 궁금하여 연락드립니다.

만성 소화불량은 증상이 호전되기까지 꾸준한 치료가 중요하며, 충분한 개선과 안정적인 상태 유지를 위해서는 보통 2~3개월 정도 치료를 이어가며 경과를 살펴보는 것이 좋습니다.

현재 드시던 한약이 마무리되는 시기가 다가오고 있습니다. 내원해 주시면 그동안의 변화와 남아 있는 증상을 확인하고, 앞으로의 한약 치료에 대해서도 안내해 드리겠습니다.

김○○님의 편안한 일상을 위해 오리한의원이 꾸준히 함께하겠습니다. 감사합니다.`);
});

test('name and symptoms are enough without a patient response or situation', () => {
  assert.equal(herbalFollowupError(params), null);
  assert.match(buildHerbalFollowup({ ...params, patientName: ' 이○○님 ', symptoms: '만성피로' }), /이○○님, 안녕하세요/);
  assert.match(buildHerbalFollowup({ ...params, symptoms: '만성피로' }), /만성피로는 증상이/);
  assert.doesNotMatch(buildHerbalFollowup({ ...params, patientName: '이○○님' }), /님님/);
});

test('general herbal conditions are not restricted to fatigue and indigestion', () => {
  for (const symptoms of ['피부 가려움', '생리통', '불면', '두통 및 소화불량']) {
    const result = buildHerbalFollowup({ ...params, symptoms });
    assert.ok(result.includes(symptoms));
    assert.match(result, /내원해 주시면/);
    assert.match(result, /2~3개월/);
  }
});

test('the fixed template cannot drift with additional traits or directions', () => {
  assert.equal(
    buildHerbalFollowup({ ...params, direction: '아주 짧게', input: '임의의 상황 메모', selectedTraits: ['만성/유착(1개월↑)'], selectedSituations: [HERBAL_FOLLOWUP_SITUATION, '원장'] }),
    buildHerbalFollowup(params)
  );
});

test('traffic accident and diet treatments cannot use the general herbal template', () => {
  for (const treatment of ['교통사고', '다이어트']) {
    const excluded = { ...params, selectedTreatments: ['한약', treatment] };
    assert.match(herbalFollowupError(excluded)!, /제외한 일반한약/);
    assert.throws(() => buildHerbalFollowup(excluded), /제외한 일반한약/);
  }
});

test('missing template fields are rejected but ordinary scenarios remain optional', () => {
  assert.match(herbalFollowupError({ ...params, patientName: ' ' })!, /환자 이름/);
  assert.match(herbalFollowupError({ ...params, symptoms: '' })!, /질환·증상/);
  assert.equal(herbalFollowupError({ ...params, patientName: '', symptoms: '', selectedSituations: ['신환 상담/문의'] }), null);
});

test('each symptom button is identical to typing that symptom for the first contact', () => {
  for (const symptom of ['소화불량', '피로']) {
    const selected = { ...params, symptoms: '', selectedTreatments: ['한약', symptom] };
    assert.equal(herbalFollowupError(selected), null);
    assert.equal(buildHerbalFollowup(selected), buildHerbalFollowup({ ...params, symptoms: symptom }));
  }
});

test('both symptom buttons and manual additional symptoms are included once', () => {
  const selected = { ...params, symptoms: '피로, 두통', selectedTreatments: ['소화불량', '피로'] };
  assert.equal(resolvePatientSymptoms(selected), '피로, 두통, 소화불량');
  assert.match(buildHerbalFollowup(selected), /피로, 두통, 소화불량은/);
  assert.equal(resolvePatientSymptoms({ ...params, symptoms: '', selectedTreatments: ['소화불량', '피로'] }), '소화불량, 피로');
});

test('deselecting buttons preserves typed symptoms and restores required validation', () => {
  const selected = { ...params, symptoms: '불면', selectedTreatments: ['한약', '피로'] };
  assert.equal(resolvePatientSymptoms(selected), '불면, 피로');
  assert.equal(selected.symptoms, '불면');
  assert.equal(resolvePatientSymptoms({ ...selected, selectedTreatments: ['한약'] }), '불면');
  assert.match(herbalFollowupError({ ...params, symptoms: '', selectedTreatments: ['한약'] })!, /질환·증상/);
});

test('shortcuts do not infer chronic diagnoses or remove qualified manual symptoms', () => {
  assert.equal(resolvePatientSymptoms({ ...params, symptoms: '', selectedTreatments: ['피로'] }), '피로');
  assert.equal(resolvePatientSymptoms({ ...params, symptoms: '오후 피로', selectedTreatments: ['피로'] }), '오후 피로, 피로');
  assert.equal(resolvePatientSymptoms({ ...params, symptoms: '두통\n불면', selectedTreatments: ['한약'] }), '두통\n불면');
});

test('symptom buttons do not bypass accident and diet exclusions', () => {
  for (const treatment of ['교통사고', '다이어트']) {
    const selected = { ...params, symptoms: '', selectedTreatments: ['소화불량', '피로', treatment] };
    assert.match(herbalFollowupError(selected)!, /제외한 일반한약/);
  }
});
