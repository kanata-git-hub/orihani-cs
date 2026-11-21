import { authFetch } from '../authFetch';
import { buildSystemInstruction } from '../constants';
import type { AnalyzeParams } from '../types';
import { MESSAGE_REVIEW_VERSION, INVALID_PATIENT_MESSAGE, normalizePatientMessage } from '../patientMessageText';
import { canStartHerbalCheckIn, isStaffHerbalProgress, staffHerbalProgressContext, isHerbalFollowup, herbalFollowupError, buildHerbalFollowup, isFixedEffectParagraph } from '../herbalFollowup';
import { buildPrivatePatientPrompt } from '../patientPrompt';
import { fixedSymptomTerms, retainsAllFixedSymptoms, inspectPatientSymptomInput, resolvePatientSymptoms, symptomInputError } from '../patientSymptoms';
import { getEnteredPrescriptionNames, getEffectPrescriptionNames, getReferencedPrescriptions, findDisclosedPrescription } from '../prescriptionFields';
import { isPublicReview, publicReviewContext, publicReviewPrompt, REVIEW_FOLLOWUP_CONFLICT } from '../publicReview';

export const PRESCRIPTION_OUTPUT_ERROR = '처방명이 포함된 문안이라 표시할 수 없습니다. 다시 생성해 주세요.';

export const REVIEW_UNAVAILABLE = '검수가 완료되지 않았습니다. 입력을 유지했으니 다시 생성해 주세요.';
export class PatientInputError extends Error {}

export const analyzePatientMessage = async (form: AnalyzeParams) => {
  const publicReply = isPublicReview(form.selectedSituations);
  if (publicReply && isHerbalFollowup(form)) throw new PatientInputError(REVIEW_FOLLOWUP_CONFLICT);
  if (publicReply && !form.input.trim()) throw new PatientInputError('방문자가 남긴 리뷰 원문이나 별점을 입력해 주세요.');
  const submitted = publicReply ? publicReviewContext(form.input, form.direction) : form;
  const field = inspectPatientSymptomInput(submitted);
  const staffProgress = isStaffHerbalProgress(submitted.selectedSituations);
  const params = staffProgress ? staffHerbalProgressContext(submitted, field.symptoms) : submitted;
  const symptoms = resolvePatientSymptoms(params, field);
  const fieldError = symptomInputError(field, symptoms, !staffProgress);
  if (fieldError) throw new PatientInputError(fieldError);
  const fixedError = herbalFollowupError(params);
  if (fixedError) throw new PatientInputError(fixedError);
  const fixed = isHerbalFollowup(params);

  const { input, direction, selectedTreatments, selectedSituations } = params;
  const herbalCheckIn = !input.trim() && canStartHerbalCheckIn(params, symptoms);
  const prescriptionName = params.prescriptionName || '';
  const symptomPrescriptions = staffProgress ? [] : field.prescriptions;
  const prescriptionNames = [...new Set([...symptomPrescriptions, ...getEnteredPrescriptionNames(prescriptionName), ...getReferencedPrescriptions(input, direction)])];
  const prompt = publicReply ? publicReviewPrompt(input, direction) : buildPrivatePatientPrompt(params, symptoms, symptomPrescriptions);

  const response = await authFetch('/api/generate-analysis', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mode: fixed ? 'fixed' : 'free',
      patientContext: {
        patientName: params.patientName || '', symptoms: params.symptoms || '', prescriptionName,
        input, direction, selectedTreatments, selectedSituations
      },
      systemInstruction: buildSystemInstruction(selectedTreatments, selectedSituations, [symptoms, input].filter(Boolean).join('\n'), herbalCheckIn),
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
        (data.effectParagraph && !getEffectPrescriptionNames(input, direction, prescriptionName).length)) throw new Error(REVIEW_UNAVAILABLE);
    const canonical = buildHerbalFollowup({ ...params, symptoms: verifiedSymptoms }, data.effectParagraph);
    if (data.text !== canonical) throw new Error(REVIEW_UNAVAILABLE);
  }
  const privateNames = staffProgress ? [...prescriptionNames, ...field.prescriptions, ...getEnteredPrescriptionNames(form.prescriptionName)] : prescriptionNames;
  if (findDisclosedPrescription(normalizePatientMessage(data.text), privateNames)) {
    throw new Error(PRESCRIPTION_OUTPUT_ERROR);
  }
  return { text: data.text as string, symptoms: verifiedSymptoms };
};
