import { authFetch } from '../authFetch';
import { SYSTEM_INSTRUCTION } from "../constants";
import { AnalyzeParams } from "../types";
import { isHerbalFollowup, buildHerbalFollowup } from '../herbalFollowup';
import { resolvePatientSymptoms, SYMPTOM_TREATMENT_OPTIONS } from '../patientSymptoms';

export const analyzePatientMessage = async (params: AnalyzeParams): Promise<string> => {
  if (isHerbalFollowup(params)) return buildHerbalFollowup(params);

  const { input, direction, selectedTreatments, selectedTraits, selectedSituations } = params;
  const symptoms = resolvePatientSymptoms(params);
  const treatments = selectedTreatments.filter(t => !SYMPTOM_TREATMENT_OPTIONS.includes(t));
  const patientContext = [
    params.patientName?.trim() && `환자 이름: ${params.patientName.trim()}`,
    symptoms && `질환·증상: ${symptoms}`
  ].filter(Boolean).join("\n");

  const prompt = `[환자 및 상황 정보]
${patientContext ? patientContext + "\n" : ""}메시지/상황: ${input || "정보 없음"}
선택된 치료: ${treatments.join(", ") || "미지정"}
환자 특징: ${selectedTraits.join(", ") || "미지정"}
응대 상황: ${selectedSituations.join(", ") || "미지정"}
추가 요청: ${direction || "없음"}`;

  const response = await authFetch('/api/generate-analysis', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to generate analysis');
  }

  const data = await response.json();
  return data.text || "";
};
