import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLINIC_PRESCRIPTIONS, buildClinicPrescriptionContext, getClinicPrescription } from '../src/clinicPrescriptions.ts';
import { findDisclosedPrescription, getEffectPrescriptionNames, getReferencedPrescriptions, inspectSymptomField, isKnownPrescriptionName } from '../src/prescriptionFields.ts';
import { effectReviewFor, IncompleteEffectReview } from '../prescriptionEffectReview.ts';

test('clinic aliases resolve to the exact approved constituent formulas', () => {
  assert.deepEqual(getClinicPrescription('오리속편환')?.components,
    ['육군자탕', '향소산', '반하후박탕', '복령음', '이진탕', '평위산', '청심연자음']);
  assert.deepEqual(getClinicPrescription('오리원기탕')?.components,
    ['청서익기탕', '청심연자음', '소요산']);
  assert.equal(getClinicPrescription('오리 속편환'), getClinicPrescription('오리속편환'));
  assert.equal(getClinicPrescription('오리원기탕가미'), undefined);
  assert.equal(getClinicPrescription('오리미등록탕'), undefined);
});

test('aliases work in the prescription field, combinations and message references without expanding review count', () => {
  assert.deepEqual(getEffectPrescriptionNames('', '', '오리속편환 + 오리 원기탕 / 맥문동탕'),
    ['오리속편환', '오리원기탕', '맥문동탕']);
  assert.deepEqual(getEffectPrescriptionNames('오리속편환을 이번에 드립니다.', '', ''), ['오리속편환']);
  assert.deepEqual(getEffectPrescriptionNames('', '처방명: 오리원기탕', ''), ['오리원기탕']);
  assert.ok(getReferencedPrescriptions('오리 원기탕을 복용했습니다.').includes('오리원기탕'));
  assert.equal(isKnownPrescriptionName('오리속편환'), true);
  assert.equal(isKnownPrescriptionName('오리원기탕'), true);
  assert.equal(isKnownPrescriptionName('오리미등록탕'), false);
});

test('internal context includes only requested approved aliases and the non-additive dose rule', () => {
  const context = buildClinicPrescriptionContext(['오리속편환', '오리 속편환', '미등록처방']);
  assert.ok(context.includes('오리속편환 = 육군자탕 + 향소산 + 반하후박탕 + 복령음 + 이진탕 + 평위산 + 청심연자음'));
  assert.equal(context.split('오리속편환 =').length, 2);
  assert.ok(!context.includes('오리원기탕 ='));
  assert.ok(context.includes('중복 약재의 용량을 더하지 않고'));
  assert.ok(context.includes('가장 많은 양 하나'));
  assert.ok(context.includes('용량은 이 자료에 없으므로'));
  assert.ok(!/\d+\s*g/u.test(context));
  assert.equal(buildClinicPrescriptionContext(['미등록처방']), '');
});

test('review receives the same approved combination and preserves separate aliases when both are used', () => {
  const review = effectReviewFor('이번 처방의 작용을 안내해 주세요.', '', '오리속편환+오리원기탕');
  assert.deepEqual(review.names, ['오리속편환', '오리원기탕']);
  assert.ok(review.instruction.includes('오리속편환 = 육군자탕 + 향소산 + 반하후박탕 + 복령음 + 이진탕 + 평위산 + 청심연자음'));
  assert.ok(review.instruction.includes('오리원기탕 = 청서익기탕 + 청심연자음 + 소요산'));
});

test('approved aliases can have verified explanations without verbatim employee action input', () => {
  // Synthetic evidence-matching fixture; not a clinical recommendation.
  const patientText = '소화 기능을 도와 불편을 덜어 줍니다.';
  for (const name of ['오리속편환', '오리원기탕']) {
    const review = effectReviewFor('', '', name);
    const effect = { index: 0, kind: 'explained', action: '소화 기능을 도와', patientQuote: patientText, sourceQuote: '' };
    assert.deepEqual(review.validate({ formulaEffects: [effect] }, patientText), [patientText]);
    assert.throws(() => review.validate({ formulaEffects: [{ ...effect, kind: 'unidentified', action: '', patientQuote: '', sourceQuote: name }] }, ''),
      (error: unknown) => error instanceof IncompleteEffectReview && error.reason === 'invalid_classification');
  }
});

test('unregistered custom prescriptions still require grounded action evidence', () => {
  const review = effectReviewFor('', '', '오리미등록탕');
  const patientText = '소화 기능을 도와 불편을 덜어 줍니다.';
  assert.throws(() => review.validate({ formulaEffects: [
    { index: 0, kind: 'explained', action: '소화 기능을 도와', patientQuote: patientText, sourceQuote: '' },
  ] }, patientText), (error: unknown) => error instanceof IncompleteEffectReview && error.reason === 'ungrounded_action');
  assert.deepEqual(review.validate({ formulaEffects: [
    { index: 0, kind: 'unidentified', action: '', patientQuote: '', sourceQuote: '오리미등록탕' },
  ] }, ''), []);
  assert.ok(!review.instruction.includes('[원장 승인 원내 처방 구성'));
});

test('aliases and every constituent name remain private and are not accepted as symptoms', () => {
  for (const formula of CLINIC_PRESCRIPTIONS) {
    for (const name of [formula.name, ...formula.components]) {
      assert.ok(findDisclosedPrescription(`이번 약은 ${name}입니다.`));
    }
    const inspected = inspectSymptomField(`피로, ${formula.name}`);
    assert.equal(inspected.symptoms, '피로');
    assert.deepEqual(inspected.prescriptions, [formula.name]);
    assert.equal(inspected.error, null);
    assert.ok(findDisclosedPrescription(formula.name.split('').join(' ')));
  }
});
