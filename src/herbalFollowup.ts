import type { AnalyzeParams } from './types';
import { herbalDirectionsFor } from './herbalDirections.ts';
import { inspectPatientSymptomInput, resolvePatientSymptoms, symptomInputError } from './patientSymptoms.ts';

export const HERBAL_FOLLOWUP_SITUATION = '일반한약 첫 15일 마무리 안내';

export function isHerbalFollowup(params: Pick<AnalyzeParams, 'selectedSituations'>) {
  return params.selectedSituations.includes(HERBAL_FOLLOWUP_SITUATION);
}

export function herbalFollowupTreatmentError(params: AnalyzeParams): string | null {
  return isHerbalFollowup(params) && params.selectedTreatments.some(t => t === '교통사고' || t === '다이어트')
    ? '첫 15일 마무리 안내는 교통사고·다이어트를 제외한 일반한약에 사용해 주세요.'
    : null;
}

export function herbalFollowupError(params: AnalyzeParams): string | null {
  if (!isHerbalFollowup(params)) return null;
  const treatmentError = herbalFollowupTreatmentError(params);
  if (treatmentError) return treatmentError;
  const field = inspectPatientSymptomInput(params);
  const symptoms = resolvePatientSymptoms(params, field);
  const inputError = symptomInputError(field, symptoms);
  if (inputError) return inputError;
  if (!params.patientName?.trim() || !symptoms) {
    return '환자 이름과 질환·증상을 입력해 주세요.';
  }
  return null;
}

export function isFixedEffectParagraph(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 650 && value === value.trim() &&
    !/[\x00-\x1F\x7F\\#`*\u2028\u2029]/u.test(value) && !/(속마음|가이드|거절 시|핵심)\s*[:：]/u.test(value) &&
    !/안녕하세요|냉장\s*보관|하루\s*(?:두|세|한|[0-9]+)\s*(?:번|회)|내원해\s*주/u.test(value);
}

export function buildHerbalFollowup(params: AnalyzeParams, effectParagraph = ''): string {
  const error = herbalFollowupError(params);
  if (error) throw new Error(error);
  const name = (params.patientName || '').trim().replace(/님$/, '').trim();
  const symptoms = resolvePatientSymptoms(params);
  const directions = herbalDirectionsFor(params.selectedTreatments);
  return `###1###
속마음: 첫 15일 복용을 마무리하며 남은 불편과 경과를 확인하는 안내입니다.

가이드: 일반한약 복용 경과를 처음 확인하고, 내원하여 다음 치료를 상담하도록 안내합니다.

###2###
${name}님, 안녕하세요. 오리한의원입니다.

지난번 처방받으신 한약은 잘 챙겨 드시고 계실까요? 15일간 복용하시면서 불편하셨던 증상은 전과 비교해 어떠신가요?${effectParagraph ? '\n\n' + effectParagraph : ''}${directions ? '\n\n' + directions : ''}

${symptoms} 완화에는 꾸준한 치료가 중요합니다. 보통 2~3개월 정도 치료를 이어가며 증상이 좋아지고 안정적으로 유지되는지 살펴보는 것이 좋습니다.

현재 드시던 한약이 마무리되는 시기가 다가오고 있습니다. 내원해 주시면 그동안의 변화와 남아 있는 증상을 확인하고, 앞으로의 한약 치료에 대해서도 안내해 드리겠습니다.

${name}님의 편안한 일상을 위해 오리한의원이 꾸준히 함께하겠습니다. 감사합니다.

###3###
거절 시: 현재 상태와 남아 있는 불편함을 먼저 듣고, 경과 확인을 위한 내원을 안내해 주세요.

핵심: 환자 이름과 질환·증상만 반영한 첫 안내 문자입니다. 복용 후 반응은 환자 답변으로 확인해 주세요.`;
}
