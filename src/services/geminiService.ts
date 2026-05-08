import { SYSTEM_INSTRUCTION } from "../constants";
import { AnalyzeParams } from "../types";

export const analyzePatientMessage = async (params: AnalyzeParams): Promise<string> => {
  const { input, direction, selectedTreatments, selectedTraits, selectedSituations } = params;

  const prompt = `[환자 및 상황 정보]
메시지/상황: ${input || "정보 없음"}
선택된 치료: ${selectedTreatments.join(", ") || "미지정"}
환자 특징: ${selectedTraits.join(", ") || "미지정"}
응대 상황: ${selectedSituations.join(", ") || "미지정"}
추가 요청: ${direction || "없음"}`;

  const response = await fetch('/api/generate-analysis', {
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
