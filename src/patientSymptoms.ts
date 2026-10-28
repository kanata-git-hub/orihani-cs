import type { AnalyzeParams } from './types';

export const SYMPTOM_TREATMENT_OPTIONS = ['소화불량', '피로'];

export function selectedSymptomOptions(selectedTreatments: string[]): string[] {
  return SYMPTOM_TREATMENT_OPTIONS.filter(option => selectedTreatments.includes(option));
}

export function resolvePatientSymptoms(params: Pick<AnalyzeParams, 'symptoms' | 'selectedTreatments'>): string {
  const manual = params.symptoms?.trim() || '';
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
