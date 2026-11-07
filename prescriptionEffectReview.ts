import { getEffectPrescriptionNames, isKnownPrescriptionName } from './src/prescriptionFields.ts';

const instruction = `
effectPrescriptionNames는 사용한 처방명 칸과 이번 메시지, 추가 요청에서 찾은 내부 참고용 처방명이다. prescriptionName은 직원이 이번 환자에게 사용한 처방을 별도로 입력한 칸이다. 각 이름을 입력 순서대로 하나씩 확인하고 formulaEffects에 기록한다. 본문에서 이름을 숨기되 환자에게 설명할 작용은 숨기지 않는다.
이번에 주는 약, '지난번과 같은 약'으로 다시 주는 약, 또는 질문에서 효과 설명을 요청한 약은 explained다. 합방이면 각 처방의 역할을 파악해 환자가 알아들을 말로 자연스럽게 연결한다. action은 그 처방이 어떻게 돕는지 보여 주는 구체적인 작용 구절이고 patientQuote는 그 구절이 포함된 최종 환자 문장의 원문이다. 두 작용을 한 문장에 담아도 된다. 서로 다른 처방의 역할을 같은 구절의 반복으로 대체하지 않는다. 증상 목록을 되풀이한 '불편을 함께 개선하기 위해 준비했습니다', 복용법, 보관법, 안부와 직원용 조언은 효과 설명이 아니다. 초안이 이 수준이면 환자 문안을 고쳐서 설명을 넣는다.
처방의 일반적인 작용과 환자의 소견을 구분한다. 입력한 증상이 모두 이번 처방의 직접 치료 대상이라고 가정하거나, 없던 증상·원인·검사 소견을 만들어 내지 않는다. 불분명한 자체 처방은 직원이 입력한 작용이 있으면 그 범위에서만 설명한다. 이때 그 작용 구절은 직원 원문에서 그대로 골라 환자 문장에도 사용하고 해당 근거를 sourceQuote에 넣는다. 식별할 수 없고 작용 정보도 없으면 unidentified, 과거·타인·중단 등 이번 안내와 무관한 처방만 background다. 이 두 경우에는 action과 patientQuote는 빈 문자열이고 sourceQuote에 해당 처방과 구분 근거가 담긴 직원 입력을 그대로 발췌한다. 그 밖의 경우 sourceQuote는 빈 문자열이다.\n`;

const effectSchema = { type: 'ARRAY', items: { type: 'OBJECT', properties: {
  index: { type: 'INTEGER' }, kind: { type: 'STRING', enum: ['explained', 'background', 'unidentified'] },
  action: { type: 'STRING' }, patientQuote: { type: 'STRING' }, sourceQuote: { type: 'STRING' },
}, required: ['index', 'kind', 'action', 'patientQuote', 'sourceQuote'] } };

export type EffectReviewFailure = 'missing_entries' | 'invalid_entry' | 'invalid_index' |
  'nonspecific_action' | 'duplicate_action' | 'missing_patient_evidence' |
  'ungrounded_action' | 'missing_source_evidence' | 'invalid_classification';

export class IncompleteEffectReview extends Error {
  readonly status = 503;
  readonly reason: EffectReviewFailure;
  readonly index?: number;
  constructor(reason: EffectReviewFailure = 'missing_entries', index?: number) {
    super('환자 문자에서 한약의 작용 설명을 확인하지 못했습니다. 입력을 유지했으니 다시 생성해 주세요.');
    this.reason = reason;
    this.index = index;
  }
}

function incomplete(reason: EffectReviewFailure, index?: number): never {
  throw new IncompleteEffectReview(reason, index);
}

// Permit layout differences only, and retain the actual text for template checks.
// In particular, punctuation, negation and word order must remain unchanged.
function quotedText(text: string, quote: string): string | undefined {
  const trimmed = quote.trim();
  if (!trimmed) return undefined;
  const pattern = trimmed.split(/\s+/u)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+');
  return new RegExp(pattern, 'u').exec(text)?.[0];
}

// Remove symptom labels and generic promises before accepting the reviewer's cited action.
function hasSpecificAction(action: string, symptoms: string): boolean {
  // '식후 졸림' is a symptom, not a dosing instruction. Reject actual directions
  // instead of rejecting every mention of a meal's timing.
  if (action.length < 4 || /보관|연락|예약|내원|준비해|드세요|드십시오|드시기|드시고|먹어\s*주|먹으세요|하루\s*(?:\d+|한|두|세)\s*(?:번|회)|(?:\d+|한|두|세)\s*시간\s*(?:이상\s*)?간격/u.test(action)) return false;
  let remaining = action;
  const labels = symptoms.match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const label of labels.sort((a,b) => b.length - a.length)) remaining = remaining.replaceAll(label, ' ');
  return (remaining.match(/[\p{L}\p{N}]+/gu) ?? []).some(word => word.length >= 2 &&
    !/^(?:관련|증상|질환|불편|모두|모든|함께|동시|개선|완화|치료|해결|호전|회복|도움|돕기|돕는|도와|위한|위해|있도록|있게|이번|한약|처방|준비|목표|효과|꾸준|전반|전신|몸의|몸을|상태|균형을|잡아|그리고|또는|식후|식전|복용|약을|약은|약과|정해|정량|규칙|오늘|매일|정확|용량|시간|간격|일정|안내|양을|양은|대로|맞춰|주세요|주십|부탁|하거나|하고|하는|합니다|드립니다|있습니다|위하|시키|해드|드리|줄여|덜어|대한|에서|으로|까지|에도)/u.test(word));
}

type EffectItem = { index?: unknown; kind?: unknown; action?: unknown; patientQuote?: unknown; sourceQuote?: unknown };
type EffectVerdict = { formulaEffects?: unknown };

export function effectReviewFor(message: string, direction: string, prescriptionName = '') {
  const names = getEffectPrescriptionNames(message, direction, prescriptionName);
  const sources = [message, direction, prescriptionName];
  function validate(verdict: EffectVerdict, patientText: string, symptoms = ''): string[] {
    if (!names.length) return [];
    const items = verdict.formulaEffects;
    if (!Array.isArray(items) || items.length !== names.length) return incomplete('missing_entries');
    const indexed = new Map<number, EffectItem>();
    for (const item of items as EffectItem[]) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return incomplete('invalid_entry');
      if (typeof item.index !== 'number' || !Number.isInteger(item.index) ||
          item.index < 0 || item.index >= names.length || indexed.has(item.index)) {
        return incomplete('invalid_index');
      }
      indexed.set(item.index, item);
    }
    const quotes = new Set<string>(), actions = new Set<string>();
    for (const [index, name] of names.entries()) {
      const item = indexed.get(index);
      if (!item || typeof item.action !== 'string' ||
          typeof item.patientQuote !== 'string' || typeof item.sourceQuote !== 'string') return incomplete('invalid_entry', index);
      const action = item.action.trim(), quote = item.patientQuote.trim(), source = item.sourceQuote.trim();
      if (item.kind === 'explained') {
        const key = action.replace(/[\p{P}\s]/gu, '');
        if (!hasSpecificAction(action, symptoms)) return incomplete('nonspecific_action', index);
        if (actions.has(key)) return incomplete('duplicate_action', index);
        const patientQuote = quotedText(patientText, quote);
        if (quote.length < 8 || !patientQuote || !quotedText(patientQuote, action)) {
          return incomplete('missing_patient_evidence', index);
        }
        if (!isKnownPrescriptionName(name) && (!quotedText(source, action) ||
            !sources.some(s => quotedText(s, source)))) return incomplete('ungrounded_action', index);
        actions.add(key);
        quotes.add(patientQuote);
        continue;
      }
      if (action || quote || !source || !sources.some(s => quotedText(s, source)) ||
          !(getEffectPrescriptionNames(source, '', quotedText(prescriptionName, source) ? source : '').includes(name) || source.trim() === name)) return incomplete('missing_source_evidence', index);
      if (item.kind === 'unidentified' && !isKnownPrescriptionName(name)) continue;
      if (item.kind === 'background' &&
          /이전|예전|과거|당시|지난|전에는|전에|중단|보류|않|아니|다른|가족|보호자|비교|제외|무관|미정|아직|예약|문의만|검토|예시|알레르기/u.test(source) &&
          !/(?:이전|지난번|예전)과\s*(?:같|동일)|이번에도\s*(?:같|동일)/u.test(source)) continue;
      return incomplete('invalid_classification', index);
    }
    return [...quotes];
  }
  return { names, instruction: names.length ? instruction : '',
    properties: names.length ? { formulaEffects: effectSchema } : {}, required: names.length ? ['formulaEffects'] : [], validate };
}
