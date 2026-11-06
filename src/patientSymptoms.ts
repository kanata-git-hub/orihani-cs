import { getEnteredPrescriptionNames, getReferencedPrescriptions, inspectSymptomField } from './prescriptionFields.ts';
import type { AnalyzeParams } from './types';

export const SYMPTOM_TREATMENT_OPTIONS = ['소화불량', '피로'];

export function selectedSymptomOptions(selectedTreatments: string[]): string[] {
  return SYMPTOM_TREATMENT_OPTIONS.filter(option => selectedTreatments.includes(option));
}

// Both ends compare the same normalized list after confirmed prescription names are removed.
export function fixedSymptomTerms(symptoms: string): string[] {
  return [...new Set(symptoms.split(/[,，、/·;；\n+＋]+/u).map(s => s.trim()).filter(Boolean))];
}

export function retainsAllFixedSymptoms(symptoms: string, reviewed: string[]): boolean {
  const expected = fixedSymptomTerms(symptoms);
  return expected.length > 0 && expected.length === reviewed.length &&
    expected.every((term, index) => term === reviewed[index]);
}

type SymptomInput = Pick<AnalyzeParams, 'symptoms' | 'selectedTreatments'> & Partial<Pick<AnalyzeParams, 'input' | 'direction' | 'prescriptionName'>>;
export function inspectPatientSymptomInput(params: SymptomInput) {
  const names = [...getEnteredPrescriptionNames(params.prescriptionName), ...getReferencedPrescriptions(params.input || '', params.direction || '')];
  return inspectSymptomField(params.symptoms || '', names);
}

export function resolvePatientSymptoms(params: SymptomInput, inspection = inspectPatientSymptomInput(params)): string {
  const manual = inspection.symptoms;
  const selected = selectedSymptomOptions(params.selectedTreatments);
  if (selected.length === 0) return manual;

  const parts = [...manual.split(/[,，/·;\n]+/).map(part => part.trim()).filter(Boolean), ...selected];
  const seen = new Set<string>();
  return parts.filter(part => {
    const key = part.replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(', ');
}

export function symptomInputError(inspection: ReturnType<typeof inspectSymptomField>, effectiveSymptoms: string): string | null {
  if (inspection.error) return inspection.error;
  if (inspection.prescriptions.length && !effectiveSymptoms) {
    return '질환·증상에는 환자가 실제로 겪는 증상을 입력하거나 아래에서 선택해 주세요.';
  }
  return null;
}
