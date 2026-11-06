export interface AnalysisResult {
  strategy: string;
  responseDraft: string;
  staffTip: string;
}

export interface AnalyzeParams {
  patientName?: string;
  symptoms?: string;
  prescriptionName?: string;
  input: string;
  direction: string;
  selectedTreatments: string[];
  selectedSituations: string[];
}
