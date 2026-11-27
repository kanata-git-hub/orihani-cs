/** Clinic-approved aliases. These are internal prescription references, never patient copy. */
export const CLINIC_PRESCRIPTIONS = [
  {
    name: '오리속편환',
    components: ['육군자탕', '향소산', '반하후박탕', '복령음', '이진탕', '평위산', '청심연자음'],
  },
  {
    name: '오리원기탕',
    components: ['청서익기탕', '청심연자음', '소요산'],
  },
] as const;

export const clinicPrescriptionNames: readonly string[] = CLINIC_PRESCRIPTIONS.map(formula => formula.name);

const compact = (value: string) => value.normalize('NFKC').replace(/[\s\u200B-\u200D\uFEFF]+/gu, '');

export function getClinicPrescription(name: string) {
  return CLINIC_PRESCRIPTIONS.find(formula => formula.name === compact(name));
}

/** Include only approved aliases actually referenced in this request. No patient data or doses. */
export function buildClinicPrescriptionContext(names: readonly string[]): string {
  const selected = [...new Set(names.map(name => getClinicPrescription(name)).filter(formula => formula !== undefined))];
  if (!selected.length) return '';
  return `
[원장 승인 원내 처방 구성 — 내부 참고 전용]
${selected.map(formula => `${formula.name} = ${formula.components.join(' + ')}`).join('\n')}
위 이름은 구성이 확인된 원내 처방의 별칭이다. 이름만 보고 식별 불가한 자체 처방으로 취급하지 않는다. 각 별칭을 하나의 합방으로 이해하고 구성 처방들의 작용을 종합해 환자가 알아들을 말로 설명한다. 구성 처방마다 별도 문장을 나열하지 말고 이번 안내에 필요한 핵심 작용을 자연스럽게 연결한다. 효과 검수 항목은 입력된 별칭 하나당 하나이며, 내부 구성 처방의 수만큼 늘리지 않는다.
두 원내 처방 모두 중복 약재의 용량을 더하지 않고 구성 처방 중 가장 많은 양 하나에 맞춘다. 합방에 처방이 여러 개 들어간다는 이유로 중복 약재의 총량이나 약효가 배수로 증가한다고 설명하지 않는다. 정확한 약재별 용량은 이 자료에 없으므로 g 수치·총량·복용량을 추정하거나 만들어 내지 않는다.
별칭과 모든 구성 처방명은 내부 치료 정보이며 환자 문자, 상담 요지, 직원 대처 팁에 노출하지 않는다. 이 구성 정보는 환자에게 없던 증상이나 진단, 처방의 확정·복용 사실을 만들어 내는 근거가 아니다. 위 목록에 없는 자체 처방은 승인된 별칭으로 간주하지 않고 기존의 입력 근거 확인 기준을 적용한다.
`;
}
