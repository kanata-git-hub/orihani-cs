import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INVALID_PATIENT_MESSAGE, normalizePatientMessage, parseAnalysisResult } from '../src/patientMessageText.ts';

test('a captured five-paragraph layout is parsed as four real paragraph breaks', () => {
  const paragraphs = [
    "윤가온님 안녕하세요, 오리한의원입니다.",
    "그동안 처방해 드린 한약은 잘 복용하고 계시는지 궁금합니다. 피부의 붉어짐이나 오랫동안 불편하셨던 소화불량 증상은 어떠신지요.",
    "피부 붉어짐과 만성 소화불량 모두 오래된 증상이다 보니, 15일 복용만으로는 충분하지 않을 수 있습니다.",
    "원장님께서는 치료 흐름이 끊기지 않게 한약을 조금 더 이어서 복용하시기를 권하십니다.",
    "편하신 시간에 한의원으로 연락 주시거나 내원해 주시면 감사하겠습니다 :)"
];
  const encoded = paragraphs.join(String.raw`\n\n`);
  const expected = paragraphs.join('\n\n');
  const result = parseAnalysisResult(`###1###\n직원용\n###2###\n${encoded}\n###3###\n직원용\n`);
  assert.equal(result.responseDraft, expected);
  assert.equal(normalizePatientMessage(result.responseDraft), expected);
});

test('single and double escapes, real LF and CRLF and mixed encodings normalize identically', () => {
  for (const separator of ['\n', '\r\n', '\r', String.raw`\n`, String.raw`\\n`,
    String.raw`\r\n`, String.raw`\\r\\n`, '\r' + String.raw`\n`, String.raw`\r` + '\n']) {
    assert.equal(normalizePatientMessage('한' + separator + '글'), '한\n글');
  }
  const literal = '띄어쓰기 · 문장부호!  ' + String.raw`\t / \1` + '\n\n끝.';
  assert.equal(normalizePatientMessage(literal), literal);
});

test('malformed sections cannot send staff-only text to the patient clipboard', () => {
  for (const s of ['직원용 가이드만', '###1###직원용###3###끝', '###2###문자###1###내부###3###안내',
    '###1###A###2###B###2###내부###3###C', '###1###A###2###\\n###3###C']) {
    assert.throws(() => parseAnalysisResult(s), { message: INVALID_PATIENT_MESSAGE });
  }
});
