import { authFetch } from '../authFetch';
import { buildSystemInstruction } from '../constants';
import type { AnalyzeParams } from '../types';
import { MESSAGE_REVIEW_VERSION, INVALID_PATIENT_MESSAGE, normalizePatientMessage } from '../patientMessageText';
import { isHerbalFollowup, herbalFollowupError, buildHerbalFollowup, isFixedEffectParagraph } from '../herbalFollowup';
import { fixedSymptomTerms, retainsAllFixedSymptoms, inspectPatientSymptomInput, resolvePatientSymptoms, symptomInputError, SYMPTOM_TREATMENT_OPTIONS } from '../patientSymptoms';
import { getEffectPrescriptionNames, getReferencedPrescriptions, findDisclosedPrescription } from '../prescriptionFields';

export const PRESCRIPTION_OUTPUT_ERROR = '처방명이 포함된 문안이라 표시할 수 없습니다. 다시 생성해 주세요.';

export const REVIEW_UNAVAILABLE = '검수가 완료되지 않았습니다. 입력을 유지했으니 다시 생성해 주세요.';
export class PatientInputError extends Error {}

export const analyzePatientMessage = async (params: AnalyzeParams) => {
  const field = inspectPatientSymptomInput(params);
  const symptoms = resolvePatientSymptoms(params, field);
  const fieldError = symptomInputError(field, symptoms);
  if (fieldError) throw new PatientInputError(fieldError);
  const fixedError = herbalFollowupError(params);
  if (fixedError) throw new PatientInputError(fixedError);
  const fixed = isHerbalFollowup(params);

  const { input, direction, selectedTreatments, selectedSituations } = params;
  const prescriptionNames = [...new Set([...field.prescriptions, ...getReferencedPrescriptions(input, direction)])];
  const treatments = selectedTreatments.filter(t => !SYMPTOM_TREATMENT_OPTIONS.includes(t));
  const patientFields = [
    params.patientName?.trim() && `환자 이름: ${params.patientName.trim()}`,
    symptoms && `질환·증상: ${symptoms}`,
    field.prescriptions.length > 0 && `참고용 처방명(환자 증상 아님·출력 금지): ${field.prescriptions.join(', ')}`
  ].filter(Boolean).join("\n");

  const prompt = `[환자 및 상황 정보]
${patientFields ? patientFields + "\n" : ""}메시지/상황: ${input || "정보 없음"}
선택된 치료: ${treatments.join(", ") || "미지정"}
응대 상황: ${selectedSituations.join(", ") || "미지정"}
추가 요청: ${direction || "없음"}`;

  const response = await authFetch('/api/generate-analysis', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mode: fixed ? 'fixed' : 'free',
      patientContext: {
        patientName: params.patientName || '', symptoms: params.symptoms || '',
        input, direction, selectedTreatments, selectedSituations
      },
      systemInstruction: buildSystemInstruction(selectedTreatments, selectedSituations, [symptoms, input].filter(Boolean).join('\n')),
      prompt,
      ...(prescriptionNames.length > 0 && { prescriptionNames })
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    if (errorData.code === 'EFFECT_REVIEW_INCOMPLETE') throw new PatientInputError(errorData.error || REVIEW_UNAVAILABLE);
    if (errorData.code === 'PATIENT_INPUT') throw new PatientInputError(errorData.error || '질환·증상을 확인해 주세요.');
    if (errorData.code === 'INVALID_PATIENT_MESSAGE') throw new Error(INVALID_PATIENT_MESSAGE);
    if (errorData.code === 'PRESCRIPTION_IN_OUTPUT') throw new Error(PRESCRIPTION_OUTPUT_ERROR);
    throw new Error(errorData.error || 'Failed to generate analysis');
  }

  const data = await response.json();
  if (data.reviewed !== true || data.reviewVersion !== MESSAGE_REVIEW_VERSION || typeof data.text !== 'string' || !data.text.trim()) {
    throw new Error(REVIEW_UNAVAILABLE);
  }
  const verifiedSymptoms = typeof data.symptoms === 'string' ? data.symptoms : symptoms;
  if (fixed) {
    if (typeof data.symptoms !== 'string' || !retainsAllFixedSymptoms(symptoms, fixedSymptomTerms(data.symptoms))) {
      throw new Error(REVIEW_UNAVAILABLE);
    }
    if (!isFixedEffectParagraph(data.effectParagraph) ||
        (data.effectParagraph && !getEffectPrescriptionNames(input, direction).length)) throw new Error(REVIEW_UNAVAILABLE);
    const canonical = buildHerbalFollowup({ ...params, symptoms: verifiedSymptoms }, data.effectParagraph);
    if (data.text !== canonical) throw new Error(REVIEW_UNAVAILABLE);
  }
  if (findDisclosedPrescription(normalizePatientMessage(data.text), prescriptionNames)) {
    throw new Error(PRESCRIPTION_OUTPUT_ERROR);
  }
  return { text: data.text as string, symptoms: verifiedSymptoms };
};
