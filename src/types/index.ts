export interface AnalysisResult {
  strategy: string;
  responseDraft: string;
  staffTip: string;
}

export interface AnalyzeParams {
  input: string;
  direction: string;
  selectedTreatments: string[];
  selectedTraits: string[];
  selectedSituations: string[];
}
