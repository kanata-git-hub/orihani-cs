import type { AnalysisResult } from './types';

export const INVALID_PATIENT_MESSAGE = '환자 문자와 직원 안내를 구분할 수 없습니다. 다시 생성해 주세요.';

export function normalizePatientMessage(text: string): string {
  // Decode only line breaks, including double escapes. Leave other backslashes alone.
  return text.replace(/\\+([nr])/g, (_, code) => code === 'n' ? '\n' : '\r').replace(/\r\n?/g, '\n');
}

export function parseAnalysisResult(text: string): AnalysisResult {
  const sections = text.split(/(###\d+###)/);
  if (sections.length !== 7 || sections[1] !== '###1###' ||
      sections[3] !== '###2###' || sections[5] !== '###3###') {
    throw new Error(INVALID_PATIENT_MESSAGE);
  }

  const responseDraft = normalizePatientMessage(sections[4]).trim();
  if (!responseDraft) throw new Error(INVALID_PATIENT_MESSAGE);
  return { strategy: sections[2].trim(), responseDraft, staffTip: sections[6].trim() };
}
