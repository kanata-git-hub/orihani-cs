import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { buildClinicReference, buildSystemInstruction } from './src/constants/index.ts';
import { buildHerbalFollowup, herbalFollowupError, isHerbalFollowup } from './src/herbalFollowup.ts';
import { MESSAGE_REVIEW_VERSION, INVALID_PATIENT_MESSAGE, normalizePatientMessage, parseAnalysisResult } from './src/patientMessageText.ts';
import { retainsAllFixedSymptoms, inspectPatientSymptomInput, resolvePatientSymptoms, symptomInputError, SYMPTOM_TREATMENT_OPTIONS } from './src/patientSymptoms.ts';
import { findDisclosedPrescription, getReferencedPrescriptions } from './src/prescriptionFields.ts';
import type { AnalyzeParams } from './src/types/index.ts';
import { FixedSymptomInputError, reviewFixedSymptoms, reviewFree } from './reviewPatientMessage.ts';
import { requireUser } from './serverSecurity.ts';

type Context = Required<AnalyzeParams>;
type Generate = (instruction: string, prompt: string) => Promise<string | undefined>;
type Reviewers = { reviewFree: typeof reviewFree; reviewFixedSymptoms: typeof reviewFixedSymptoms };

function isStringList(value: unknown, count: number, length: number): value is string[] {
  return Array.isArray(value) && value.length <= count &&
    value.every(item => typeof item === 'string' && item.trim() && item.length <= length);
}

function isContext(value: unknown): value is Context {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<Context>;
  return typeof c.patientName === 'string' && c.patientName.length <= 160 &&
    typeof c.symptoms === 'string' && c.symptoms.length <= 4096 &&
    typeof c.input === 'string' && c.input.length <= 65536 &&
    typeof c.direction === 'string' && c.direction.length <= 8192 &&
    isStringList(c.selectedTreatments, 64, 160) && isStringList(c.selectedSituations, 64, 160);
}

export function analysisEndpoint(generate: Generate, authenticate: RequestHandler = requireUser,
  reviewers: Reviewers = { reviewFree, reviewFixedSymptoms }) {
  const router = express.Router();
  // Parse only the authenticated endpoint. No other route needs a JSON body.
  router.post('/', authenticate, express.json({ limit: '256kb', inflate: false }), async (req, res) => {
    const { systemInstruction, prompt, prescriptionNames = [], patientContext } = req.body ?? {};
    res.set('Cache-Control', 'no-store');
    if (typeof systemInstruction !== 'string' || !systemInstruction.trim() || systemInstruction.length > 32000 ||
        typeof prompt !== 'string' || !prompt.trim() || prompt.length > 65536 ||
        !isStringList(prescriptionNames, 80, 128) || (patientContext !== undefined && !isContext(patientContext))) {
      res.status(400).json({ error: '입력 내용과 길이를 확인해주세요.' });
      return;
    }

    // Compatibility with already-open older clients. Only the staff's input is evidence for review.
    const context: Context = patientContext ? {
      patientName: patientContext.patientName, symptoms: patientContext.symptoms, input: patientContext.input,
      direction: patientContext.direction, selectedTreatments: patientContext.selectedTreatments, selectedSituations: patientContext.selectedSituations,
    } : { patientName: '', symptoms: '', input: prompt, direction: '', selectedTreatments: [], selectedSituations: [] };
    try {
      const inspected = inspectPatientSymptomInput(context);
      let symptoms = resolvePatientSymptoms(context, inspected);
      const fixed = isHerbalFollowup(context);
      const problem = fixed ? herbalFollowupError(context) : symptomInputError(inspected, symptoms);
      if (problem) {
        res.status(422).json({ code: 'PATIENT_INPUT', error: problem });
        return;
      }
      const prescriptionReferences = [...new Set([...inspected.prescriptions, ...getReferencedPrescriptions(context.input, context.direction)])];
      const privateNames = [...prescriptionNames, ...prescriptionReferences];
      let text: string;
      if (fixed) {
        const draft = parseAnalysisResult(buildHerbalFollowup(context)).responseDraft;
        const terms = await reviewers.reviewFixedSymptoms({ ...context, symptoms, prescriptionReferences }, draft);
        if (!retainsAllFixedSymptoms(symptoms, terms)) throw new FixedSymptomInputError();
        symptoms = terms.join(', ');
        text = buildHerbalFollowup({ ...context, symptoms, selectedTreatments: [] });
        parseAnalysisResult(text);
      } else {
        const treatments = context.selectedTreatments.filter(t => !SYMPTOM_TREATMENT_OPTIONS.includes(t));
        const clinicalText = [symptoms, context.input].filter(Boolean).join('\n');
        const writingRules = patientContext
          ? buildSystemInstruction(treatments, context.selectedSituations, clinicalText) : systemInstruction;
        const draft = parseAnalysisResult(await generate(writingRules, prompt) || '');
        const clinicReference = buildClinicReference(treatments, context.selectedSituations, clinicalText);
        const source = { ...context, symptoms, selectedTreatments: treatments, prescriptionReferences, clinicReference };
        const result = await reviewers.reviewFree(source, draft);
        const sections = [result.strategy, result.responseDraft, result.staffTip];
        if (sections.some(part => typeof part !== 'string' || !part.trim() || /###\d+###/.test(part))) {
          throw new Error(INVALID_PATIENT_MESSAGE);
        }
        const patient = normalizePatientMessage(result.responseDraft).trim();
        text = `###1###\n${result.strategy}\n\n###2###\n${patient}\n\n###3###\n${result.staffTip}`;
      }
      if (findDisclosedPrescription(text, privateNames)) {
        res.status(422).json({ code: 'PRESCRIPTION_IN_OUTPUT', error: '처방명이 포함된 문안이라 표시할 수 없습니다. 다시 생성해 주세요.' });
        return;
      }
      res.json({ text, reviewed: true, reviewVersion: MESSAGE_REVIEW_VERSION, symptoms });
    } catch (error) {
      if (error instanceof FixedSymptomInputError) {
        res.status(422).json({ code: 'PATIENT_INPUT', error: error.message });
        return;
      }
      if (error instanceof Error && error.message === INVALID_PATIENT_MESSAGE) {
        res.status(422).json({ code: 'INVALID_PATIENT_MESSAGE', error: INVALID_PATIENT_MESSAGE });
        return;
      }
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
      // Provider errors can contain request URLs, credentials or patient input.
      console.error('AI provider request failed', typeof status === 'number' ? status : 'unavailable');
      if (status === 429) { res.status(429).json({ error: '429: 요청이 많습니다.' }); return; }
      res.status(503).json({ error: '503: 문자를 생성하고 검수하지 못했습니다. 다시 시도해 주세요.' });
    }
  });
  const invalidBody: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    const status = [400, 413, 415].includes(error.status) ? error.status : 500;
    res.status(status).json({ error: '요청 내용을 확인해주세요.' });
  };
  router.use(invalidBody);
  return router;
}
