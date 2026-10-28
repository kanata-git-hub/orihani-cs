import React, { useState, useRef } from 'react';
import { 
  MessageSquare, User as UserIcon, Brain, Send, Copy, Check, ShieldCheck, 
  RefreshCw, PlusCircle, Stethoscope
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TREATMENTS, TRAITS, SITUATIONS, INITIAL_GREETING } from '../constants';
import { AnalysisResult } from '../types';
import { analyzePatientMessage } from '../services/geminiService';
import { TagSelector } from '../components/TagSelector';
import { ResultCard } from '../components/ResultCard';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firebaseUtils';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { isHerbalFollowup, herbalFollowupError } from '../herbalFollowup';
import { resolvePatientSymptoms, selectedSymptomOptions } from '../patientSymptoms';

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
  const [input, setInput] = useLocalStorage<string>('app_input', "");
  const [direction, setDirection] = useLocalStorage<string>('app_direction', "");
  const [selectedTreatments, setSelectedTreatments] = useLocalStorage<string[]>('app_treatments', []);
  const [selectedTraits, setSelectedTraits] = useLocalStorage<string[]>('app_traits', []);
  const [selectedSituations, setSelectedSituations] = useLocalStorage<string[]>('app_situations', []);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useLocalStorage<AnalysisResult | null>('app_result', null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const resultRef = useRef<HTMLDivElement>(null);
  const params = { patientName, symptoms, input, direction, selectedTreatments, selectedTraits, selectedSituations };
  const effectiveSymptoms = resolvePatientSymptoms(params);
  const symptomChoices = selectedSymptomOptions(selectedTreatments);
  const isFollowup = isHerbalFollowup(params);
  const followupError = herbalFollowupError(params);
  const canSubmit = isFollowup ? !followupError : Boolean(input.trim());

  const toggleTreatment = (t: string) => setSelectedTreatments(prev => prev.includes(t) ? prev.filter(i => i !== t) : [...prev, t]);
  const toggleTrait = (t: string) => setSelectedTraits(prev => prev.includes(t) ? prev.filter(i => i !== t) : [...prev, t]);
  const toggleSituation = (s: string) => setSelectedSituations(prev => prev.includes(s) ? prev.filter(i => i !== s) : [...prev, s]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || !canSubmit) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const text = await analyzePatientMessage(params);

      const sections = text.split(/###\d###/);
      let newResult: AnalysisResult;
      
      if (sections.length >= 4) {
        const clean = (str: string) => str.trim();
        newResult = {
          strategy: clean(sections[1]),
          responseDraft: clean(sections[2]),
          staffTip: clean(sections[3])
        };
      } else {
        newResult = {
          strategy: "분석 오류",
          responseDraft: text,
          staffTip: "가이드 내용을 다시 확인해 주세요."
        };
      }
      setResult(newResult);

      if (user && newResult.strategy !== "분석 오류") {
        const pathForWrite = 'analyses';
        try {
          await addDoc(collection(db, pathForWrite), {
            userId: user.uid,
            patientName,
            symptoms: effectiveSymptoms,
            input,
            direction,
            selectedTreatments,
            selectedTraits,
            selectedSituations,
            result: newResult,
            createdAt: serverTimestamp()
          });
        } catch (dbErr) {
          handleFirestoreError(dbErr, OperationType.WRITE, pathForWrite);
        }
      }

    } catch (err: any) {
      console.error(err);
      if (err.message?.includes("429") || err.message?.includes("quota")) {
        setError("API 사용량이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
      } else if (err.message?.includes("503")) {
        setError("현재 서버 부하가 높습니다. 잠시 후 다시 시도해 주세요.");
      } else {
        setError("분석 중 오류가 발생했습니다. 다시 시도해 주세요.");
      }
    } finally {
      setIsLoading(false);
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  };

  const handleCopy = () => {
    if (result) {
      navigator.clipboard.writeText(result.responseDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleReset = () => {
    setPatientName('');
    setSymptoms('');
    setInput('');
    setDirection('');
    setSelectedTreatments([]);
    setSelectedTraits([]);
    setSelectedSituations([]);
    setResult(null);
    setError(null);
  };

  return (
    <>
      <AnimatePresence mode="wait">
        {!result && !isLoading && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="max-w-5xl mx-auto bg-white border border-[#552c24]/10 rounded-2xl sm:rounded-[32px] p-4 sm:p-8 shadow-sm mb-5 sm:mb-10"
          >
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="hidden sm:flex w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden bg-white shadow-sm border border-[#552c24]/10 shrink-0">
                <img src="/icon.png" alt="AI 실장" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="sm:hidden text-base font-bold leading-relaxed">환자 정보와 상황을 입력해 주세요. 오리 실장이 응대 문자를 준비해 드립니다.</p>
                <div className="hidden sm:block whitespace-pre-wrap text-[#552c24] leading-relaxed text-xl font-bold">
                  {INITIAL_GREETING}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="max-w-5xl mx-auto space-y-6">
        <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="patient-name" className="text-base sm:text-xl font-bold text-[#552c24] flex items-center gap-2">
                <UserIcon size={20} /> 환자 이름
              </label>
              <input id="patient-name" type="text" value={patientName}
                onChange={e => setPatientName(e.target.value)}
                placeholder="예: 김○○" autoComplete="off" maxLength={100}
                required={isFollowup} aria-describedby="patient-fields-help"
                className="w-full min-w-0 p-4 sm:p-5 bg-white border border-[#552c24]/20 rounded-2xl focus:ring-2 focus:ring-[#ffcd4a]/50 focus:border-[#ffcd4a] outline-none text-base sm:text-xl" />
            </div>
            <div className="space-y-2">
              <label htmlFor="patient-symptoms" className="text-base sm:text-xl font-bold text-[#552c24] flex items-center gap-2">
                <Stethoscope size={20} /> 질환·증상
              </label>
              <input id="patient-symptoms" type="text" value={symptoms}
                onChange={e => setSymptoms(e.target.value)}
                placeholder={symptomChoices.length ? "추가 증상이 있으면 입력해 주세요 (선택)" : "직접 입력하거나 아래 소화불량·피로 버튼 선택"} autoComplete="off" maxLength={300}
                required={isFollowup && symptomChoices.length === 0} aria-describedby="patient-fields-help selected-symptoms"
                className="w-full min-w-0 p-4 sm:p-5 bg-white border border-[#552c24]/20 rounded-2xl focus:ring-2 focus:ring-[#ffcd4a]/50 focus:border-[#ffcd4a] outline-none text-base sm:text-xl" />
            </div>
          </div>
          {symptomChoices.length > 0 && (
            <p id="selected-symptoms" className="text-sm font-bold text-[#552c24]" role="status">
              반영할 질환·증상: {effectiveSymptoms}
            </p>
          )}
          <p id="patient-fields-help" className="text-sm text-[#552c24]/70 leading-relaxed">
            모든 응대에 함께 반영합니다. 소화불량·피로는 아래 치료 종류에서 선택하면 따로 입력하지 않아도 됩니다.
          </p>

          <div className="space-y-4">
            <TagSelector icon={Stethoscope} title="치료 종류 (중복 선택 가능)" options={TREATMENTS} selectedOptions={selectedTreatments} onToggle={toggleTreatment} />
            <TagSelector icon={MessageSquare} title="응대 상황 (중복 선택 가능)" options={SITUATIONS} selectedOptions={selectedSituations} onToggle={toggleSituation} />
            <TagSelector icon={UserIcon} title="환자 특징 (중복 선택 가능)" options={TRAITS} selectedOptions={selectedTraits} onToggle={toggleTrait} />
          </div>

          {isFollowup && (
            <div className="rounded-2xl border border-[#ffcd4a] bg-[#ffcd4a]/10 p-4 text-sm leading-relaxed" role="status">
              환자 이름과 질환·증상 입력 또는 소화불량·피로 버튼 선택으로 문자를 만듭니다. 교통사고·다이어트는 제외합니다.
              {followupError && <p className="mt-1 font-bold">{followupError}</p>}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="patient-situation" className="text-base sm:text-xl font-bold sm:tracking-widest text-[#552c24] flex items-center gap-2">
                <MessageSquare size={20} className="shrink-0" /> 환자 메시지 또는 상황{isFollowup ? " (선택)" : ""}
              </label>
              <button
                type="button"
                onClick={() => setInput('')}
                className="text-sm px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full font-medium transition-colors"
              >
                지우기
              </button>
            </div>
            <textarea id="patient-situation"
              value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={isFollowup ? "추가 상황 메모 (선택) — 고정 안내 문자에는 이름과 질환·증상만 반영합니다." : "환자의 카톡 메시지를 붙여넣거나, 현재 상황을 설명해 주세요..."}
              className="w-full h-40 sm:h-48 p-4 sm:p-6 bg-white border border-[#552c24]/20 rounded-2xl sm:rounded-3xl focus:ring-2 focus:ring-[#ffcd4a]/50 focus:border-[#ffcd4a] outline-none transition-all resize-y text-base sm:text-2xl leading-relaxed shadow-sm font-medium"
              required={!isFollowup}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="response-direction" className="text-base sm:text-xl font-bold sm:tracking-widest text-[#552c24] flex items-center gap-2">
              <PlusCircle size={20} /> 특별히 원하는 방향 (선택)
            </label>
            <input
              id="response-direction" type="text" value={direction} onChange={(e) => setDirection(e.target.value)}
              placeholder="예: 방문 유도, 부드러운 거절, 비용 안내 등"
              className="w-full p-4 sm:p-5 bg-white border border-[#552c24]/20 rounded-2xl focus:ring-2 focus:ring-[#ffcd4a]/50 focus:border-[#ffcd4a] outline-none transition-all shadow-sm text-base sm:text-xl font-medium"
            />
          </div>

          <button type="submit" disabled={isLoading || !canSubmit}
            className={`w-full py-4 sm:py-6 rounded-2xl sm:rounded-full flex items-center justify-center gap-3 font-bold text-lg sm:text-2xl transition-all shadow-xl ${
              isLoading || !canSubmit ? 'bg-[#552c24]/10 text-[#552c24]/40 cursor-not-allowed' : 'bg-[#ffcd4a] text-[#552c24] hover:bg-[#ffcd4a]/90 active:scale-[0.98] shadow-[#ffcd4a]/20'
            }`}
          >
            {isLoading ? (<><RefreshCw className="animate-spin" size={20} />심리 분석 및 답변 생성 중...</>) : (<><Send size={20} />{isFollowup ? "안내 문자 만들기" : "분석 시작하기"}</>)}
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
            <ResultCard className="order-1 lg:order-2" icon={MessageSquare} title="✍️ 환자 답변 초안" content={result.responseDraft} isHighlighted={true} actionButton={
                <button onClick={handleCopy} aria-label={copied ? "복사 완료" : "문자 복사"} className="shrink-0 flex items-center gap-1.5 min-h-11 px-3 py-2 text-sm whitespace-nowrap bg-[#ffcd4a] text-[#552c24] rounded-full hover:bg-[#ffcd4a]/80 transition-all shadow-md active:scale-95">
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
