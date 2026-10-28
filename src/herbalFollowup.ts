import type { AnalyzeParams } from './types';

export const HERBAL_FOLLOWUP_SITUATION = '일반한약 첫 15일 마무리 안내';

export function isHerbalFollowup(params: Pick<AnalyzeParams, 'selectedSituations'>) {
  return params.selectedSituations.includes(HERBAL_FOLLOWUP_SITUATION);
}

export function herbalFollowupError(params: AnalyzeParams): string | null {
  if (!isHerbalFollowup(params)) return null;
  if (params.selectedTreatments.some(t => t === '교통사고' || t === '다이어트')) {
    return '첫 15일 마무리 안내는 교통사고·다이어트를 제외한 일반한약에 사용해 주세요.';
  }
  if (!params.patientName?.trim() || !params.symptoms?.trim()) {
    return '환자 이름과 질환·증상을 입력해 주세요.';
  }
  return null;
}

function topicParticle(value: string) {
  const code = value.charCodeAt(value.length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 0 ? '는' : '은';
}

export function buildHerbalFollowup(params: AnalyzeParams): string {
  const error = herbalFollowupError(params);
  if (error) throw new Error(error);
  const name = (params.patientName || '').trim().replace(/님$/, '').trim();
  const symptoms = (params.symptoms || '').trim();
  const improvement = /^(만성\s*)?소화불량$/.test(symptoms)
    ? '소화가 한결 편해지셨을 것 같은데'
    : /^(만성\s*)?피로$/.test(symptoms)
      ? '피로가 한결 덜해지셨을 것 같은데'
      : '불편하셨던 증상이 한결 나아지셨을 것 같은데';

  return `###1###
속마음: 첫 15일 복용을 마무리할 시점으로, 환자의 복용 후 반응은 아직 확인하지 않았습니다.

가이드: 일반한약 복용 경과를 처음 확인하고, 내원하여 다음 치료를 상담하도록 안내합니다.

###2###
${name}님, 안녕하세요. 오리한의원입니다.

지난번 처방받으신 한약은 잘 챙겨 드시고 계실까요? 15일간 한약을 복용하시면서 ${improvement}, 아직 불편한 증상이 남아 있지는 않으신지 궁금하여 연락드립니다.

${symptoms}${topicParticle(symptoms)} 증상이 호전되기까지 꾸준한 치료가 중요하며, 충분한 개선과 안정적인 상태 유지를 위해서는 보통 2~3개월 정도 치료를 이어가며 경과를 살펴보는 것이 좋습니다.

현재 드시던 한약이 마무리되는 시기가 다가오고 있습니다. 내원해 주시면 그동안의 변화와 남아 있는 증상을 확인하고, 앞으로의 한약 치료에 대해서도 안내해 드리겠습니다.

${name}님의 편안한 일상을 위해 오리한의원이 꾸준히 함께하겠습니다. 감사합니다.

###3###
거절 시: 현재 상태와 남아 있는 불편함을 먼저 듣고, 경과 확인을 위한 내원을 안내해 주세요.

핵심: 환자 이름과 질환·증상만 반영한 첫 안내 문자입니다. 복용 후 반응은 환자 답변으로 확인해 주세요.`;
}
