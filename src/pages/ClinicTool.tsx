import React, { useState, useRef, useEffect } from 'react';
import { 
  MessageSquare, User as UserIcon, Brain, Send, Copy, Check, ShieldCheck, 
  RefreshCw, PlusCircle, Stethoscope
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TREATMENT_GROUPS, SITUATION_GROUPS } from '../constants';
import { AnalysisResult } from '../types';
import { analyzePatientMessage, PRESCRIPTION_OUTPUT_ERROR, REVIEW_UNAVAILABLE, PatientInputError } from '../services/geminiService';
import { TagSelector } from '../components/TagSelector';
import { ResultCard } from '../components/ResultCard';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { HERBAL_FOLLOWUP_SITUATION, isHerbalFollowup, herbalFollowupTreatmentError } from '../herbalFollowup';
import { isPublicReview, publicReviewContext, REVIEW_FOLLOWUP_CONFLICT } from '../publicReview';
import { inspectPatientSymptomInput, resolvePatientSymptoms, selectedSymptomOptions, symptomInputError } from '../patientSymptoms';
import { MESSAGE_REVIEW_VERSION, INVALID_PATIENT_MESSAGE, normalizePatientMessage, parseAnalysisResult } from '../patientMessageText';

const fieldColors = (invalid: boolean) => invalid
  ? 'border-2 border-red-600 bg-red-50 focus:border-red-700 focus:ring-red-300'
  : 'border border-[#552c24]/20 bg-white focus:border-[#ffcd4a] focus:ring-[#ffcd4a]/50';

const renderWithBoldLabels = (text: string) => {
  if (!text) return text;
  const parts = text.split(/(속마음:|가이드:|거절 시:|핵심:)/g);
  return parts.map((part, index) => {
    if (["속마음:", "가이드:", "거절 시:", "핵심:"].includes(part)) {
      return <strong key={index} className="font-extrabold text-lg sm:text-2xl text-[#552c24]">{part}</strong>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
};

export function ClinicTool() {
  const { user } = useAuth();
  const [patientName, setPatientName] = useLocalStorage<string>('app_patient_name', '');
  const [symptoms, setSymptoms] = useLocalStorage<string>('app_symptoms', '');
  const [prescriptionName, setPrescriptionName] = useLocalStorage<string>('app_prescription_name', '');
  const [input, setInput] = useLocalStorage<string>('app_input', "");
  const [direction, setDirection] = useLocalStorage<string>('app_direction', "");
  const [selectedTreatments, setSelectedTreatments] = useLocalStorage<string[]>('app_treatments', []);
  const [selectedSituations, setSelectedSituations] = useLocalStorage<string[]>('app_situations', []);
  const [isLoading, setIsLoading] = useState(false);
  const [savedResult, setResult] = useLocalStorage<(AnalysisResult & { reviewVersion: number; owner: string }) | null>('app_result', null);
  const editVersion = useRef(0);
  const pending = useRef(false);
  useEffect(() => () => { editVersion.current++; }, []);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const resultRef = useRef<HTMLDivElement>(null);
  const params = { patientName, symptoms, prescriptionName, input, direction, selectedTreatments, selectedSituations };
  const symptomField = inspectPatientSymptomInput(params);
  const effectiveSymptoms = resolvePatientSymptoms(params, symptomField);
  const publicReply = isPublicReview(selectedSituations);
  const symptomError = publicReply ? null : symptomInputError(symptomField, effectiveSymptoms);
  const symptomChoices = selectedSymptomOptions(selectedTreatments);
  const showResolvedSymptoms = !symptomError && Boolean(effectiveSymptoms) &&
    (symptomChoices.length > 0 || symptomField.prescriptions.length > 0);
  const isFollowup = isHerbalFollowup(params);
  const conflictingModes = publicReply && isFollowup;
  const nameIssue = isFollowup && !publicReply && !patientName.trim() ? '환자 이름을 입력해 주세요.' : null;
  const symptomIssue = symptomError || (isFollowup && !publicReply && !effectiveSymptoms
    ? '질환·증상을 입력하거나 아래에서 소화불량·피로를 선택해 주세요.' : null);
  const treatmentIssue = publicReply ? null : herbalFollowupTreatmentError(params);
  const messageIssue = !isFollowup && !input.trim()
    ? (publicReply ? '방문자가 남긴 리뷰 원문이나 별점을 입력해 주세요.' : '환자 메시지나 응대할 상황을 입력해 주세요.') : null;
  const issues = [
    { id: 'patient-name', label: '환자 이름', problem: nameIssue },
    { id: 'patient-symptoms', label: '질환·증상', problem: symptomIssue },
    { id: 'treatment-options', label: '치료 종류', problem: treatmentIssue },
    { id: 'situation-options', label: '응대 상황', problem: conflictingModes },
    { id: 'patient-situation', label: publicReply ? '공개 리뷰' : '환자 메시지 또는 상황', problem: messageIssue },
  ].filter(field => field.problem);
  const canSubmit = issues.length === 0;
  const formEmpty = !patientName && !symptoms && !prescriptionName && !input && !direction && !selectedTreatments.length && !selectedSituations.length;
  const cached = user && formEmpty && savedResult?.reviewVersion === MESSAGE_REVIEW_VERSION && savedResult.owner === user.uid ? savedResult : null;
  const patientText = typeof cached?.responseDraft === 'string' ? normalizePatientMessage(cached.responseDraft) : '';
  const result = patientText.trim() ? cached : null;
  const showIssues = !result && !isLoading;

  function invalidateResult() {
    editVersion.current++;
    setResult(null);
    setCopied(false);
    setError(null);
  }

  const toggleTreatment = (t: string) => {
    invalidateResult();
    setSelectedTreatments(prev => prev.includes(t) ? prev.filter(i => i !== t) : [...prev, t]);
  };
  const toggleSituation = (s: string) => {
    invalidateResult();
    setSelectedSituations(prev => {
      if (prev.includes(s)) return prev.filter(i => i !== s);
      const incompatible = s === '리뷰 답변' ? HERBAL_FOLLOWUP_SITUATION : s === HERBAL_FOLLOWUP_SITUATION ? '리뷰 답변' : undefined;
      return [...prev.filter(i => i !== incompatible), s];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending.current || !user || !canSubmit) return;
    pending.current = true;
    const submittedVersion = editVersion.current;
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const reviewed = await analyzePatientMessage(params);
      if (editVersion.current !== submittedVersion) return;
      const newResult = parseAnalysisResult(reviewed.text);
      clearTextFields();
      setSelectedTreatments([]);
      setSelectedSituations([]);
      setResult({ ...newResult, reviewVersion: MESSAGE_REVIEW_VERSION, owner: user.uid });

      try {
        await addDoc(collection(db, 'analyses'), {
          userId: user.uid,
          ...(publicReply ? publicReviewContext(input, direction) : { ...params, symptoms: reviewed.symptoms }),
          result: newResult,
          createdAt: serverTimestamp()
        });
      } catch {
        if (editVersion.current === submittedVersion) setError('문자는 복사할 수 있지만 생성 기록을 저장하지 못했습니다.');
      }
    } catch (err: any) {
      if (editVersion.current !== submittedVersion) return;
      if (err instanceof PatientInputError || [PRESCRIPTION_OUTPUT_ERROR, INVALID_PATIENT_MESSAGE, REVIEW_UNAVAILABLE].includes(err.message)) {
        setError(err.message);
      } else if (err.message?.includes("429") || err.message?.includes("quota")) {
        setError("API 사용량이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
      } else if (err.message?.includes("503")) {
        setError("현재 서버 부하가 높습니다. 잠시 후 다시 시도해 주세요.");
      } else {
        setError("분석 중 오류가 발생했습니다. 다시 시도해 주세요.");
      }
    } finally {
      pending.current = false;
      setIsLoading(false);
      if (submittedVersion === editVersion.current) setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(patientText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('문자를 복사하지 못했습니다. 다시 눌러 주세요.');
    }
  };

  const clearTextFields = () => {
    setPatientName('');
    setSymptoms('');
    setPrescriptionName('');
    setInput('');
    setDirection('');
  };

  return (
    <>
      <section className="max-w-5xl mx-auto space-y-6">
        <form noValidate onSubmit={handleSubmit} onChange={invalidateResult} className="space-y-5 sm:space-y-6">
          <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
            <span id="clear-inputs-help" className="order-2 sm:order-none text-sm text-[#552c24]/85 sm:text-[#552c24]/70">선택한 메뉴는 유지됩니다.</span>
            <button type="button" onClick={() => { invalidateResult(); clearTextFields(); }} aria-describedby="clear-inputs-help"
              className="min-h-12 sm:min-h-11 inline-flex items-center justify-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-base font-semibold sm:font-bold text-gray-700 hover:bg-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffcd4a] focus-visible:ring-offset-2">
              <RefreshCw size={16} aria-hidden="true" />
              입력 내용 전체 지우기
            </button>
          </div>
          {!publicReply && <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="patient-name" className="text-lg sm:text-xl font-bold text-[#552c24] flex items-center gap-2">
                <UserIcon size={20} /> 환자 이름
              </label>
              <input id="patient-name" type="text" value={patientName}
                onChange={e => setPatientName(e.target.value)}
                placeholder="예: 김○○" autoComplete="off" maxLength={100}
                required={isFollowup} aria-invalid={showIssues && Boolean(nameIssue)} aria-describedby={showIssues && nameIssue ? 'name-error' : undefined}
                className={`w-full min-w-0 scroll-mt-20 p-4 sm:p-5 rounded-2xl focus:ring-2 outline-none text-lg sm:text-xl ${fieldColors(showIssues && Boolean(nameIssue))}`} />
              {showIssues && nameIssue && <p id="name-error" className="text-base font-bold text-red-800">{nameIssue}</p>}
            </div>
            <div className="space-y-2">
              <label htmlFor="patient-symptoms" className="text-lg sm:text-xl font-bold text-[#552c24] flex items-center gap-2">
                <Stethoscope size={20} /> 질환·증상
              </label>
              <input id="patient-symptoms" type="text" value={symptoms}
                onChange={e => setSymptoms(e.target.value)}
                placeholder={symptomChoices.length ? "추가 증상이 있으면 입력해 주세요 (선택)" : "증상 직접 입력 또는 아래 버튼 선택"} autoComplete="off" maxLength={300}
                required={isFollowup && symptomChoices.length === 0} aria-invalid={showIssues && Boolean(symptomIssue)}
                aria-describedby={showIssues && symptomIssue ? 'symptom-error' : showResolvedSymptoms ? 'selected-symptoms' : undefined}
                className={`w-full min-w-0 scroll-mt-20 p-4 sm:p-5 rounded-2xl focus:ring-2 outline-none text-lg sm:text-xl ${fieldColors(showIssues && Boolean(symptomIssue))}`} />
              {showIssues && symptomIssue && <p id="symptom-error" className="text-base font-bold text-red-800">{symptomIssue}</p>}
            </div>
          </div>
          {symptomField.prescriptions.length > 0 && !symptomError && (
            <p className="text-base text-[#552c24]" role="status">
              {isFollowup ? '처방명을 고정 안내 문자에서 제외했습니다.' : '처방명은 질환·증상에서 분리해 참고용으로만 사용합니다.'}
            </p>
          )}
          {showResolvedSymptoms && (
            <p id="selected-symptoms" className="text-base sm:text-sm font-semibold sm:font-bold text-[#552c24] leading-7 sm:leading-5" role="status">
              반영할 질환·증상: {effectiveSymptoms}
            </p>
          )}
          <div className="space-y-2">
            <label htmlFor="patient-prescription" className="text-lg sm:text-xl font-bold text-[#552c24] flex items-center gap-2">
              <Stethoscope size={20} /> 사용한 처방명 (선택)
            </label>
            <input id="patient-prescription" type="text" value={prescriptionName}
              onChange={e => setPrescriptionName(e.target.value)}
              placeholder="예: 온청음 + 오령산" autoComplete="off" maxLength={500}
              aria-describedby="prescription-help"
              className="w-full min-w-0 p-4 sm:p-5 bg-white border border-[#552c24]/20 rounded-2xl focus:ring-2 focus:ring-[#ffcd4a]/50 focus:border-[#ffcd4a] outline-none text-lg sm:text-xl" />
            <p id="prescription-help" className="text-sm sm:text-base text-[#552c24]/80">
              처방명은 내부 참고용입니다. 환자 문안에는 이름을 숨기고 효과를 설명합니다.
            </p>
          </div>
          </>}

          <div className="space-y-4">
            {!publicReply && <TagSelector id="treatment-options" error={showIssues ? treatmentIssue : null} icon={Stethoscope} title="치료 종류" groups={TREATMENT_GROUPS} tone="teal" selectedOptions={selectedTreatments} onToggle={toggleTreatment} />}
            <TagSelector id="situation-options" error={showIssues && conflictingModes ? REVIEW_FOLLOWUP_CONFLICT : null} icon={MessageSquare} title="응대 상황" groups={SITUATION_GROUPS} tone="amber" optionLabels={{ 원장: "원장 명의로 작성" }} selectedOptions={selectedSituations} onToggle={toggleSituation} />
          </div>

          <div className="space-y-2">
            <label htmlFor="patient-situation" className="text-lg sm:text-xl font-bold sm:tracking-widest text-[#552c24] flex items-center gap-2">
              <MessageSquare size={20} className="shrink-0" /> {publicReply ? "방문자가 남긴 공개 리뷰" : "환자 메시지 또는 상황" + (isFollowup ? " (선택)" : "")}
            </label>
            <textarea id="patient-situation"
              value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={publicReply ? "리뷰 원문 또는 별점 (예: 별점 5점)" : isFollowup ? "추가로 전달할 상황이 있으면 입력해 주세요." : "환자의 메시지를 붙여넣거나 상황을 적어 주세요."}
              className={`w-full scroll-mt-20 h-40 sm:h-48 p-4 sm:p-6 rounded-2xl sm:rounded-3xl focus:ring-2 outline-none resize-y text-lg sm:text-2xl leading-[1.8] sm:leading-relaxed shadow-sm font-medium ${fieldColors(showIssues && Boolean(messageIssue))}`}
              aria-invalid={showIssues && Boolean(messageIssue)} aria-describedby={showIssues && messageIssue ? 'message-error' : undefined}
              required={!isFollowup}
            />
            {showIssues && messageIssue && <p id="message-error" className="text-base font-bold text-red-800">{messageIssue}</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="response-direction" className="text-lg sm:text-xl font-bold sm:tracking-widest text-[#552c24] flex items-center gap-2">
              <PlusCircle size={20} /> {publicReply ? "답글의 말투나 길이 (선택)" : "특별히 원하는 방향 (선택)"}
            </label>
            <input
              id="response-direction" type="text" value={direction} onChange={(e) => setDirection(e.target.value)}
              placeholder={publicReply ? "예: 두 문장으로 짧고 따뜻하게" : isFollowup ? "고정 안내 문자에는 반영되지 않습니다." : "예: 방문 유도, 부드러운 거절, 비용 안내 등"}
              className="w-full p-4 sm:p-5 bg-white border border-[#552c24]/20 rounded-2xl focus:ring-2 focus:ring-[#ffcd4a]/50 focus:border-[#ffcd4a] outline-none transition-all shadow-sm text-lg sm:text-xl font-medium"
            />
          </div>

          {showIssues && issues.length > 0 && <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-bold text-red-800">
            <span>확인할 곳</span>
            {issues.map(field => <a key={field.id} href={`#${field.id}`} className="underline underline-offset-4">{field.label}</a>)}
          </div>}
          <button type="submit" disabled={isLoading || !canSubmit}
            className={`w-full py-4 sm:py-6 rounded-2xl sm:rounded-full flex items-center justify-center gap-3 font-bold text-lg sm:text-2xl transition-all shadow-xl ${
              isLoading || !canSubmit ? 'bg-[#552c24]/10 text-[#552c24]/40 cursor-not-allowed' : 'bg-[#ffcd4a] text-[#552c24] hover:bg-[#ffcd4a]/90 active:scale-[0.98] shadow-[#ffcd4a]/20'
            }`}
          >
            {isLoading ? (<><RefreshCw className="animate-spin" size={20} />문안 생성 및 검수 중...</>) : (<><Send size={20} />{publicReply ? "공개 리뷰 답글 만들기" : isFollowup ? "안내 문자 만들기" : "분석 시작하기"}</>)}
          </button>
        </form>
      </section>

      {error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-5xl mx-auto mt-6 p-4 bg-red-50 text-red-600 rounded-2xl text-center text-sm font-bold">
          {error}
        </motion.div>
      )}

      <AnimatePresence>
        {result && (
          <motion.div ref={resultRef} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="mt-8 sm:mt-12 grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 pb-12 items-start scroll-mt-24">
            <ResultCard className="order-2 lg:order-1" icon={Brain} title="🧠 환자 심리 & 원장님 가이드" content={renderWithBoldLabels(result.strategy)} />
            <ResultCard className="order-1 lg:order-2" icon={MessageSquare} title="✍️ 검수 완료 문자" content={patientText} isHighlighted={true} actionButton={
                <button onClick={handleCopy} aria-label={copied ? "복사 완료" : "문자 복사"} className="shrink-0 flex items-center gap-1.5 min-h-12 sm:min-h-11 px-3 py-2 text-base sm:text-sm whitespace-nowrap bg-[#ffcd4a] text-[#552c24] rounded-full hover:bg-[#ffcd4a]/80 transition-all shadow-md active:scale-95">
                  {copied ? <Check size={18} /> : <Copy size={18} />}
                  <span>{copied ? "복사 완료" : "문자 복사"}</span>
                </button>
              } />
            <ResultCard className="order-3" icon={ShieldCheck} title="🛡️ 데스크 실전 대처 팁" content={renderWithBoldLabels(result.staffTip)} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
