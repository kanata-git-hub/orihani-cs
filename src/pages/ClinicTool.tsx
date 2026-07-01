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

const renderWithBoldLabels = (text: string) => {
  if (!text) return text;
  const parts = text.split(/(속마음:|가이드:|거절 시:|핵심:)/g);
  return parts.map((part, index) => {
    if (["속마음:", "가이드:", "거절 시:", "핵심:"].includes(part)) {
      return <strong key={index} className="font-extrabold text-2xl text-[#552c24]">{part}</strong>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
};

export function ClinicTool() {
  const { user } = useAuth();
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

  const toggleTreatment = (t: string) => setSelectedTreatments(prev => prev.includes(t) ? prev.filter(i => i !== t) : [...prev, t]);
  const toggleTrait = (t: string) => setSelectedTraits(prev => prev.includes(t) ? prev.filter(i => i !== t) : [...prev, t]);
  const toggleSituation = (s: string) => setSelectedSituations(prev => prev.includes(s) ? prev.filter(i => i !== s) : [...prev, s]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && selectedTreatments.length === 0 && selectedTraits.length === 0) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const text = await analyzePatientMessage({
        input,
        direction,
        selectedTreatments,
        selectedTraits,
        selectedSituations
      });

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
            className="max-w-5xl mx-auto bg-white border border-[#552c24]/10 rounded-[32px] p-8 shadow-sm mb-10"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden bg-white shadow-sm border border-[#552c24]/10 shrink-0">
                <img src="/icon.png" alt="AI 실장" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1">
                <div className="whitespace-pre-wrap text-[#552c24] leading-relaxed text-xl font-bold">
                  {INITIAL_GREETING}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="max-w-5xl mx-auto space-y-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <TagSelector icon={Stethoscope} title="치료 종류 (중복 선택 가능)" options={TREATMENTS} selectedOptions={selectedTreatments} onToggle={toggleTreatment} />
            <TagSelector icon={MessageSquare} title="응대 상황 (중복 선택 가능)" options={SITUATIONS} selectedOptions={selectedSituations} onToggle={toggleSituation} />
            <TagSelector icon={UserIcon} title="환자 특징 (중복 선택 가능)" options={TRAITS} selectedOptions={selectedTraits} onToggle={toggleTrait} />
          </div>

          <div className="space-y-2">
            <label className="text-xl font-bold uppercase tracking-widest text-[#552c24] flex items-center gap-2">
              <MessageSquare size={20} /> 환자 메시지 또는 상황
            </label>
            <textarea
              value={input} onChange={(e) => setInput(e.target.value)}
              placeholder="환자의 카톡 메시지를 붙여넣거나, 현재 상황을 설명해 주세요..."
              className="w-full h-48 p-6 bg-white border border-[#552c24]/20 rounded-3xl focus:ring-2 focus:ring-[#ffcd4a]/50 focus:border-[#ffcd4a] outline-none transition-all resize-none text-2xl leading-relaxed shadow-sm font-medium"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-xl font-bold uppercase tracking-widest text-[#552c24] flex items-center gap-2">
              <PlusCircle size={20} /> 특별히 원하는 방향 (선택)
            </label>
            <input
              type="text" value={direction} onChange={(e) => setDirection(e.target.value)}
              placeholder="예: 방문 유도, 부드러운 거절, 비용 안내 등"
              className="w-full p-5 bg-white border border-[#552c24]/20 rounded-2xl focus:ring-2 focus:ring-[#ffcd4a]/50 focus:border-[#ffcd4a] outline-none transition-all shadow-sm text-xl font-medium"
            />
          </div>

          <button type="submit" disabled={isLoading || !input.trim()}
            className={`w-full py-6 rounded-full flex items-center justify-center gap-3 font-bold text-2xl transition-all shadow-xl ${
              isLoading || !input.trim() ? 'bg-[#552c24]/10 text-[#552c24]/40 cursor-not-allowed' : 'bg-[#ffcd4a] text-[#552c24] hover:bg-[#ffcd4a]/90 active:scale-[0.98] shadow-[#ffcd4a]/20'
            }`}
          >
            {isLoading ? (<><RefreshCw className="animate-spin" size={20} />심리 분석 및 답변 생성 중...</>) : (<><Send size={20} />분석 시작하기</>)}
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
          <motion.div ref={resultRef} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-8 pb-20">
            <ResultCard icon={Brain} title="🧠 환자 심리 & 원장님 가이드" content={renderWithBoldLabels(result.strategy)} />
            <ResultCard icon={MessageSquare} title="✍️ 환자 답변 초안" content={result.responseDraft} isHighlighted={true} actionButton={
                <button onClick={handleCopy} className="p-3 bg-[#ffcd4a] text-[#552c24] rounded-full hover:bg-[#ffcd4a]/80 transition-all shadow-md active:scale-95">
                  {copied ? <Check size={20} /> : <Copy size={20} />}
                </button>
              } />
            <ResultCard icon={ShieldCheck} title="🛡️ 데스크 실전 대처 팁" content={renderWithBoldLabels(result.staffTip)} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
