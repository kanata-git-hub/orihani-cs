import type { AnalyzeParams } from './types/index.ts';
import { SYMPTOM_TREATMENT_OPTIONS } from './patientSymptoms.ts';

export function buildPrivatePatientPrompt(params: AnalyzeParams, symptoms: string, symptomPrescriptions: string[] = []): string {
  const { input, direction, selectedTreatments, selectedSituations } = params;
  const treatments = selectedTreatments.filter(t => !SYMPTOM_TREATMENT_OPTIONS.includes(t));
  const patientFields = [
    params.patientName?.trim() && `환자 이름: ${params.patientName.trim()}`,
    symptoms && `질환·증상: ${symptoms}`,
    symptomPrescriptions.length > 0 && `참고용 처방명(환자 증상 아님·출력 금지): ${symptomPrescriptions.join(', ')}`
  ].filter(Boolean).join("\n");

  return `[환자 및 상황 정보]
${patientFields ? patientFields + "\n" : ""}메시지/상황: ${input.trim() ? input : "정보 없음"}
선택된 치료: ${treatments.join(", ") || "미지정"}
응대 상황: ${selectedSituations.join(", ") || "미지정"}
추가 요청: ${direction || "없음"}`;
}
