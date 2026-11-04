import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHerbalFollowup, herbalFollowupError, HERBAL_FOLLOWUP_SITUATION } from '../src/herbalFollowup.ts';
import { resolvePatientSymptoms } from '../src/patientSymptoms.ts';
import { findDisclosedPrescription, getEffectPrescriptionNames, getReferencedPrescriptions, isKnownPrescriptionName } from '../src/prescriptionFields.ts';
import { HERBAL_DIRECTIONS } from '../src/herbalDirections.ts';
import type { AnalyzeParams } from '../src/types/index.ts';

const params: AnalyzeParams = {
  patientName: '김○○', symptoms: '만성 소화불량', input: '', direction: '',
  selectedTreatments: ['한약'], selectedSituations: [HERBAL_FOLLOWUP_SITUATION]
};

test('effect review sees each supplied formula in order, without treating a nested name as an extra ingredient', () => {
  assert.deepEqual(getEffectPrescriptionNames('이번에도 같은 약(오령산+온청음)을 드립니다.', ''), ['오령산', '온청음']);
  assert.deepEqual(getEffectPrescriptionNames('인진오령산 처방', ''), ['인진오령산']);
  assert.deepEqual(getEffectPrescriptionNames('인진오령산+오령산', '온청음과 오령산'), ['인진오령산', '오령산', '온청음']);
  assert.deepEqual(getEffectPrescriptionNames('처방명: 온청음을 유지합니다.', '처방명: 원내Q27'), ['온청음', '원내Q27']);
  assert.deepEqual(getEffectPrescriptionNames('처방명이 없고 이전과 같은 한약입니다.', ''), []);
  assert.ok(isKnownPrescriptionName('오령산'));
  assert.equal(isKnownPrescriptionName('원내Q27'), false);
  assert.ok(getReferencedPrescriptions('인진오령산').includes('오령산'));
});

test('explicit medicine slots protect named local preparations without classifying dosing or symptom notes', () => {
  const message = '지난번과 같은 약(원내새봄탕+오령산)을 드립니다. 한약（가상환제Q3）도 문의하셨습니다.';
  const names = getReferencedPrescriptions(message);
  assert.deepEqual(getEffectPrescriptionNames(message, ''), ['원내새봄탕', '오령산', '가상환제Q3']);
  assert.equal(findDisclosedPrescription('이번 원내새봄탕은', names), '원내새봄탕');
  assert.equal(findDisclosedPrescription('가상환제Q3을 복용하세요.', names), '가상환제Q3');
  assert.deepEqual(getEffectPrescriptionNames('일반한약(하루 두 번), 약(냉장 보관), 불편(원내새봄탕), 예약(가상환제Q3)', ''), []);
});

test('first contact with the herbal chip includes the clinic directions in the patient template', () => {
  const message = buildHerbalFollowup(params).split(/###\d###/)[2].trim();
  assert.equal(message, `김○○님, 안녕하세요. 오리한의원입니다.

지난번 처방받으신 한약은 잘 챙겨 드시고 계실까요? 15일간 복용하시면서 불편하셨던 증상은 전과 비교해 어떠신가요?

한약은 하루 두 번 식후에 복용하시고, 냉장 보관해 주세요.

만성 소화불량 완화에는 꾸준한 치료가 중요합니다. 보통 2~3개월 정도 치료를 이어가며 증상이 좋아지고 안정적으로 유지되는지 살펴보는 것이 좋습니다.

현재 드시던 한약이 마무리되는 시기가 다가오고 있습니다. 내원해 주시면 그동안의 변화와 남아 있는 증상을 확인하고, 앞으로의 한약 치료에 대해서도 안내해 드리겠습니다.

김○○님의 편안한 일상을 위해 오리한의원이 꾸준히 함께하겠습니다. 감사합니다.`);
});

test('only an eligible treatment selection adds one directions paragraph to fixed patient copy', () => {
  for (const selectedTreatments of [['피로'], ['소화불량'], ['한약', '피로', '소화불량']]) {
    const [, strategy, patient, staffTip] = buildHerbalFollowup({ ...params, selectedTreatments }).split(/###\d###/);
    assert.equal(patient.split(HERBAL_DIRECTIONS).length - 1, 1);
    assert.ok(!strategy.includes(HERBAL_DIRECTIONS) && !staffTip.includes(HERBAL_DIRECTIONS));
  }
  for (const selectedTreatments of [[], ['침']]) {
    const result = buildHerbalFollowup({ ...params, selectedTreatments, symptoms: '피로, 소화불량', input: '한약' });
    assert.ok(!result.includes(HERBAL_DIRECTIONS));
  }
});

test('name and symptoms are enough without a patient response or situation', () => {
  assert.equal(herbalFollowupError(params), null);
  assert.match(buildHerbalFollowup({ ...params, patientName: ' 이○○님 ', symptoms: '만성피로' }), /이○○님, 안녕하세요/);
  assert.match(buildHerbalFollowup({ ...params, symptoms: '만성피로' }), /만성피로 완화에는/);
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

test('the fixed template cannot drift with additional situations or directions', () => {
  assert.equal(
    buildHerbalFollowup({ ...params, direction: '아주 짧게', input: '임의의 상황 메모', selectedSituations: [HERBAL_FOLLOWUP_SITUATION, '원장'] }),
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
  assert.match(buildHerbalFollowup(selected), /피로, 두통, 소화불량 완화에는/);
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

test('fixed 15-day output uses the symptom and strips 온청음 with any extra options', () => {
  const example = { ...params, patientName: '윤가온', symptoms: '눈 주위 가려움, 온청음' };
  const expected = buildHerbalFollowup({ ...example, symptoms: '눈 주위 가려움' });
  assert.equal(buildHerbalFollowup(example), expected);
  assert.doesNotMatch(expected, /온청음|나아지셨을 것|눈 주위 가려움은 증상이/);
  assert.match(expected, /눈 주위 가려움 완화에는/);
  assert.throws(() => buildHerbalFollowup({ ...example, symptoms: '온청음', selectedTreatments: ['한약'] }), /증상/);
  const custom = { ...example, symptoms: '눈 주위 가려움, 원내A방', input: '처방명: 원내A방' };
  assert.equal(buildHerbalFollowup(custom), expected);
});
