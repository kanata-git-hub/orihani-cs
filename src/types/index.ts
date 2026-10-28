export interface AnalysisResult {
  strategy: string;
  responseDraft: string;
  staffTip: string;
}

export interface AnalyzeParams {
  patientName?: string;
  symptoms?: string;
  input: string;
  direction: string;
  selectedTreatments: string[];
  selectedTraits: string[];
  selectedSituations: string[];
}
