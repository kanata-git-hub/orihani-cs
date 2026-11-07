import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectReviewFor, IncompleteEffectReview, type EffectReviewFailure } from '../prescriptionEffectReview.ts';

// Synthetic evidence-matching fixtures, not patient records or clinical recommendations.
const prescriptions = '오령산+보중익기탕+반하사심탕';
const symptoms = '구내염, 피로, 부종';
type Effect = { index: number; kind: string; action: string; patientQuote: string; sourceQuote: string };
function fixture() {
  const review = effectReviewFor('이번 처방에 관한 안내를 작성해 주세요.', '', prescriptions);
  const actions = ['수분 배출을 도와', '기운을 보충해', '속의 자극을 가라앉혀'];
  const formulaEffects: Effect[] = actions.map((action, index) => ({
    index, kind: 'explained', action,
    patientQuote: `검증용 문장입니다. ${action} 불편을 덜도록 구성했습니다.`, sourceQuote: '',
  }));
  return { review, formulaEffects, patientText: formulaEffects.map(item => item.patientQuote).join('\n') };
}
function rejected(run: () => unknown, reason: EffectReviewFailure, index?: number) {
  assert.throws(run, error => {
    assert.ok(error instanceof IncompleteEffectReview);
    assert.equal(error.status, 503);
    assert.equal(error.reason, reason);
    assert.equal(error.index, index);
    return true;
  });
}

test('every entered formula has its own verified action', () => {
  const { review, formulaEffects, patientText } = fixture();
  assert.deepEqual(review.names, prescriptions.split('+'));
  assert.deepEqual(review.validate({ formulaEffects }, patientText, symptoms), formulaEffects.map(item => item.patientQuote));
});

test('meal-related symptom effects are not mistaken for dosing directions', () => {
  for (const action of ['기운을 보충해 식후 졸림을 덜어', '속의 자극을 가라앉혀 식전 불편을 덜어', '한약 복용으로 기운을 보충해 피로를 덜어 줍니다']) {
    const { review, formulaEffects } = fixture();
    formulaEffects[1].action = action;
    formulaEffects[1].patientQuote = `검증용 문장입니다. ${action} 편안하게 지내도록 구성했습니다.`;
    const patientText = formulaEffects.map(item => item.patientQuote).join('\n');
    assert.equal(review.validate({ formulaEffects }, patientText, symptoms).length, 3);
  }
});

test('dosing, storage, invitations and symptom-list promises still cannot stand in for actions', () => {
  for (const action of [
    '하루 2번 식후 복용', '하루 두 번 식후', '하루 두 번 식후에 드세요', '하루 2회 식후 복용',
    '식후에 드세요', '6시간 이상 간격을 지켜주세요', '냉장 보관', '약을 복용하세요', '규칙적으로 복용하세요', '한약을 복용해 주세요',
    '정해진 시간에 복용해 주세요', '안내된 용량대로 복용해 주세요', '매일 정해진 양을 복용해 주세요',
    '식후 일정한 시간에 복용해 주세요', '오늘 정확한 용량을 시간에 맞춰 복용해 주세요',
    '오늘 드시지 않는 약은 냉장 보관해 주세요', '편한 시간에 내원해 주세요',
    '구내염, 피로, 부종을 함께 개선하기 위해', '식전 또는 식후',
  ]) {
    const { review, formulaEffects } = fixture();
    formulaEffects[1].action = action;
    formulaEffects[1].patientQuote = `검증용 문장입니다. ${action}.`;
    rejected(() => review.validate({ formulaEffects }, formulaEffects.map(item => item.patientQuote).join('\n'), symptoms), 'nonspecific_action', 1);
  }
});

test('explicit indices allow array reordering while preserving formula identity', () => {
  const { review, formulaEffects, patientText } = fixture();
  const reordered = [formulaEffects[2], formulaEffects[0], formulaEffects[1]];
  assert.deepEqual(review.validate({ formulaEffects: reordered }, patientText, symptoms), formulaEffects.map(item => item.patientQuote));
});

test('duplicate, fractional, out-of-range and string indices remain invalid', () => {
  for (const index of [0, -1, 3, 1.5, '1', NaN]) {
    const { review, formulaEffects, patientText } = fixture();
    const invalid = formulaEffects.map(item => ({ ...item }));
    Object.assign(invalid[1], { index });
    rejected(() => review.validate({ formulaEffects: invalid }, patientText, symptoms), 'invalid_index');
  }
});

test('missing entries and malformed data remain invalid', () => {
  const { review, formulaEffects, patientText } = fixture();
  rejected(() => review.validate({}, patientText, symptoms), 'missing_entries');
  rejected(() => review.validate({ formulaEffects: formulaEffects.slice(1) }, patientText, symptoms), 'missing_entries');
  rejected(() => review.validate({ formulaEffects: [null, ...formulaEffects.slice(1)] }, patientText, symptoms), 'invalid_entry');
  rejected(() => review.validate({ formulaEffects: [{ ...formulaEffects[0], action: 3 }, ...formulaEffects.slice(1)] }, patientText, symptoms), 'invalid_entry', 0);
});

test('quote and action matching tolerates whitespace only and returns actual patient substrings', () => {
  const { review, formulaEffects, patientText } = fixture();
  formulaEffects[0].action = '수분\t배출을   도와';
  const actualText = patientText.replace('수분 배출을 도와', '수분\r\n배출을\u00a0도와');
  const quotes = review.validate({ formulaEffects }, actualText, symptoms);
  assert.equal(quotes[0], formulaEffects[0].patientQuote.replace('수분 배출을 도와', '수분\r\n배출을\u00a0도와'));
  assert.ok(quotes.every(quote => actualText.includes(quote)));
  let remaining = actualText;
  for (const quote of quotes) remaining = remaining.replace(quote, '');
  assert.equal(remaining.trim(), '');
});

test('matching keeps punctuation literal and does not erase negation or reorder words', () => {
  for (const replacement of ['수분 배출을 도와주지 않아', '배출을 수분 도와', '수분, 배출을 도와']) {
    const { review, formulaEffects, patientText } = fixture();
    rejected(() => review.validate({ formulaEffects }, patientText.replace('수분 배출을 도와', replacement), symptoms), 'missing_patient_evidence', 0);
  }
  const { review, formulaEffects, patientText } = fixture();
  formulaEffects[0].patientQuote = formulaEffects[0].patientQuote.replace('수분 배출', '(수분 배출)');
  rejected(() => review.validate({ formulaEffects }, patientText, symptoms), 'missing_patient_evidence', 0);
});

test('a fabricated action absent from the quoted patient sentence remains invalid', () => {
  const { review, formulaEffects, patientText } = fixture();
  formulaEffects[0].action = '열감을 가라앉혀';
  rejected(() => review.validate({ formulaEffects }, patientText, symptoms), 'missing_patient_evidence', 0);
});

test('distinct actions may share one sentence, but repeated actions cannot cover different formulas', () => {
  const { review, formulaEffects } = fixture();
  const patientText = `검증용 문장입니다. ${formulaEffects.map(item => item.action).join(', ')} 불편을 덜도록 구성했습니다.`;
  formulaEffects.forEach(item => { item.patientQuote = patientText; });
  assert.deepEqual(review.validate({ formulaEffects }, patientText, symptoms), [patientText]);
  formulaEffects[1].action = formulaEffects[0].action.replace(' ', '  ');
  rejected(() => review.validate({ formulaEffects }, patientText, symptoms), 'duplicate_action', 1);
});

test('unknown formula actions must remain grounded in employee input despite layout differences', () => {
  const sourceQuote = '시험용맞춤처방은 속의 자극을 가라앉혀 불편을 덜도록 구성했습니다.';
  const message = sourceQuote.replace('속의 자극을', '속의\n자극을');
  const review = effectReviewFor(message, '', '시험용맞춤처방');
  const patientText = '속의 자극을 가라앉혀 불편을 덜도록 구성했습니다.';
  const effect = { index: 0, kind: 'explained', action: '속의\t자극을 가라앉혀', patientQuote: patientText, sourceQuote };
  assert.deepEqual(review.validate({ formulaEffects: [effect] }, patientText), [patientText]);
  rejected(() => review.validate({ formulaEffects: [{ ...effect, sourceQuote: sourceQuote.replace('가라앉혀', '조절해') }] }, patientText), 'ungrounded_action', 0);
  rejected(() => review.validate({ formulaEffects: [{ ...effect, sourceQuote: '' }] }, patientText), 'ungrounded_action', 0);
});

test('unknown and past formulas retain source and classification checks', () => {
  const unknown = effectReviewFor('', '', '시험용맞춤처방');
  const unidentified = { index: 0, kind: 'unidentified', action: '', patientQuote: '', sourceQuote: '시험용맞춤처방' };
  assert.deepEqual(unknown.validate({ formulaEffects: [unidentified] }, ''), []);
  rejected(() => unknown.validate({ formulaEffects: [{ ...unidentified, sourceQuote: '다른처방' }] }, ''), 'missing_source_evidence', 0);
  const known = effectReviewFor('', '', '오령산');
  rejected(() => known.validate({ formulaEffects: [{ ...unidentified, sourceQuote: '오령산' }] }, ''), 'invalid_classification', 0);
  const background = { index: 0, kind: 'background', action: '', patientQuote: '', sourceQuote: '이전에 오령산을 썼지만 이번에는 중단했습니다.' };
  const past = effectReviewFor(background.sourceQuote.replace('이전에 ', '이전에\n'), '', '오령산');
  assert.deepEqual(past.validate({ formulaEffects: [background] }, ''), []);
  const currentSource = '지난번과 같은 오령산을 이번에도 드립니다.';
  const current = effectReviewFor(currentSource, '', '오령산');
  rejected(() => current.validate({ formulaEffects: [{ ...background, sourceQuote: currentSource }] }, ''), 'invalid_classification', 0);
});

test('default error metadata stays compatible and contains no source text', () => {
  const error = new IncompleteEffectReview();
  assert.equal(error.reason, 'missing_entries');
  assert.equal(error.index, undefined);
  assert.equal(error.status, 503);
  assert.deepEqual(Object.keys(error).sort(), ['index', 'reason', 'status']);
});
