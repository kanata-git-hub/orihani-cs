import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HERBAL_DIRECTIONS, DIET_HERBAL_DIRECTIONS, herbalDirectionsFor, stripHerbalDirections, applyHerbalDirectionsPolicy } from '../src/herbalDirections.ts';

test('only director voice receives the approved dosing and storage instructions', () => {
  for (const treatments of [['한약'], ['소화불량'], ['피로'], ['교통사고'], ['다이어트']]) {
    assert.equal(herbalDirectionsFor(treatments), '');
    assert.equal(herbalDirectionsFor(treatments, ['한약 복용/경과']), '');
    assert.equal(herbalDirectionsFor(treatments, ['한약 마무리 안내']), '');
    assert.equal(herbalDirectionsFor(treatments, ['원장', '한약 마무리 안내']), '');
    assert.equal(herbalDirectionsFor(treatments, ['원장', '일반한약 첫 15일 마무리 안내']), '');
    assert.equal(herbalDirectionsFor(treatments, ['원장']), treatments.includes('다이어트') ? DIET_HERBAL_DIRECTIONS : HERBAL_DIRECTIONS);
  }
});

test('director completion notices preserve the existing no-directions exception', () => {
  for (const situation of ['한약 마무리 안내', '일반한약 첫 15일 마무리 안내']) {
    assert.equal(applyHerbalDirectionsPolicy('남아 있는 불편은 어떠신가요?', ['한약'], ['원장', situation]), '남아 있는 불편은 어떠신가요?');
    assert.equal(applyHerbalDirectionsPolicy(`남아 있는 불편은 어떠신가요?\n\n${HERBAL_DIRECTIONS}`, ['한약'], ['원장', situation]), '남아 있는 불편은 어떠신가요?');
  }
});

test('staff letters lose copied ordinary and diet directions while retaining the rest of the letter', () => {
  for (const directions of [HERBAL_DIRECTIONS, DIET_HERBAL_DIRECTIONS]) {
    const message = `안녕하세요.\n\n한약은 잘 챙겨 드시고 계실까요?\n\n${directions}\n\n불편한 점이 있으면 말씀해 주세요.`;
    assert.equal(applyHerbalDirectionsPolicy(message, ['한약'], []), '안녕하세요.\n\n한약은 잘 챙겨 드시고 계실까요?\n\n불편한 점이 있으면 말씀해 주세요.');
  }
});

test('staff final guard removes exact diet sentences and the retired automatic copy', () => {
  const fragments = DIET_HERBAL_DIRECTIONS.match(/[^.]+(?:\.|$)/gu).map(sentence => sentence.trim());
  for (const directions of [...fragments, '다이어트 한약은 하루 2번, 오전 9~11시와 오후 4~6시쯤 복용하시고 냉장 보관해 주세요.']) {
    assert.equal(stripHerbalDirections(`안녕하세요.\n\n${directions}\n\n경과를 알려주세요.`), '안녕하세요.\n\n경과를 알려주세요.', directions);
  }
});

test('staff guard retains symptom reports, follow-up questions, and unrelated advice', () => {
  for (const message of [
    '하루 세 번 먹고 속이 아파요.',
    '하루 두 번 드신 뒤 속이 쓰리셨군요.',
    '하루 두 번 복용하고 계신가요?',
    '한약은 잘 챙겨 드시고 계실까요?',
    '꾸준히 복용해 주세요.',
    '식후에 가볍게 산책하시면 좋습니다.',
    '아침 식사는 잘 드시고 충분히 쉬세요.',
    '밥은 하루 세 번 규칙적으로 드세요.',
    '물은 하루 두 번 더 챙겨 드세요.',
    '반찬은 냉장 보관해 주세요.',
    '오늘은 저녁에 한 번만 복용해 주세요.',
    '속이 불편하면 식후에 복용하시면 됩니다.',
    '이번에 따로 드린 약은 실온에 보관하세요.',
    '복용법: 하루 2회, 1회 1포.',
    '오전 9시와 오후 4시 사이에 내원해 주세요.',
    '김철수님.\n한약은 잘 챙겨 드시고 계실까요?\n\n박영희님.\n불편한 점은 없으신가요?',
  ]) assert.equal(stripHerbalDirections(message), message);
});

test('director letters retain the approved instructions exactly once', () => {
  const result = applyHerbalDirectionsPolicy(`안녕하세요.\n\n${HERBAL_DIRECTIONS}\n\n경과를 알려주세요.`, ['한약'], ['원장']);
  assert.equal(result.split(HERBAL_DIRECTIONS).length - 1, 1);
  assert.ok(applyHerbalDirectionsPolicy('안녕하세요.', ['다이어트'], ['원장']).includes(DIET_HERBAL_DIRECTIONS));
});
