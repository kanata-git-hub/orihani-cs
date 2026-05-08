import React, { useState, useRef, useEffect } from 'react';
import { 
  MessageSquare, User as UserIcon, Brain, Send, Copy, Check, ShieldCheck, 
  Sparkles, RefreshCw, PlusCircle, Stethoscope, LogOut, LogIn
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import { TREATMENTS, TRAITS, SITUATIONS, INITIAL_GREETING } from './constants';
import { AnalysisResult } from './types';
import { analyzePatientMessage } from './services/geminiService';
import { TagSelector } from './components/TagSelector';
import { ResultCard } from './components/ResultCard';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuth } from './contexts/AuthContext';
import { loginWithGoogle, logout, db, auth } from './firebase';
import { collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import personaImg from './image/persona.png';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

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

function ClinicTool() {
  const { user, isAdmin } = useAuth();
  const [input, setInput] = useState(() => localStorage.getItem('app_input') || "");
  const [direction, setDirection] = useState(() => localStorage.getItem('app_direction') || "");
  const [selectedTreatments, setSelectedTreatments] = useState<string[]>(() => JSON.parse(localStorage.getItem('app_treatments') || "[]"));
  const [selectedTraits, setSelectedTraits] = useState<string[]>(() => JSON.parse(localStorage.getItem('app_traits') || "[]"));
  const [selectedSituations, setSelectedSituations] = useState<string[]>(() => JSON.parse(localStorage.getItem('app_situations') || "[]"));
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(() => JSON.parse(localStorage.getItem('app_result') || "null"));
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('app_input', input);
    localStorage.setItem('app_direction', direction);
    localStorage.setItem('app_treatments', JSON.stringify(selectedTreatments));
    localStorage.setItem('app_traits', JSON.stringify(selectedTraits));
    localStorage.setItem('app_situations', JSON.stringify(selectedSituations));
    localStorage.setItem('app_result', JSON.stringify(result));
  }, [input, direction, selectedTreatments, selectedTraits, selectedSituations, result]);

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
    localStorage.removeItem('app_input');
    localStorage.removeItem('app_direction');
    localStorage.removeItem('app_treatments');
    localStorage.removeItem('app_traits');
    localStorage.removeItem('app_situations');
    localStorage.removeItem('app_result');
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
                <img src={personaImg} alt="AI 실장" className="w-full h-full object-cover" />
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

function AdminDashboard() {
  const [users, setUsers] = useState<any[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'approved_users'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'approved_users');
    });

    return () => unsubscribe();
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;

    setError(null);
    const pathForWrite = 'approved_users';
    try {
      await addDoc(collection(db, pathForWrite), {
        email: newEmail.trim(),
        role: newRole,
        createdAt: serverTimestamp()
      });
      setNewEmail('');
      setNewRole('user');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, pathForWrite);
      setError('새 회원 등록 중 오류가 발생했습니다.');
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    const pathForDelete = `approved_users/${id}`;
    try {
      await deleteDoc(doc(db, 'approved_users', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, pathForDelete);
      setError('회원 삭제 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between mt-10">
        <h2 className="text-3xl font-bold text-[#552c24] flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-[#ffcd4a]" />
          관리자 대시보드
        </h2>
        <Link to="/tool" className="px-6 py-3 bg-white border border-[#552c24]/20 text-[#552c24] font-bold rounded-full hover:bg-gray-50 transition-colors shadow-sm">
          메인으로 돌아가기
        </Link>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-bold text-center">
          {error}
        </div>
      )}

      <div className="bg-white border border-[#552c24]/10 rounded-[32px] p-8 shadow-sm">
        <h3 className="text-xl font-bold mb-6 text-[#552c24] flex items-center gap-2">
          <PlusCircle className="w-6 h-6 text-[#ffcd4a]" />
          새 회원 승인
        </h3>
        <form onSubmit={handleAddUser} className="flex flex-col sm:flex-row gap-4">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="이메일 주소 입력"
            className="flex-1 p-4 bg-white border border-[#552c24]/20 rounded-2xl focus:ring-2 focus:ring-[#ffcd4a]/50 focus:border-[#ffcd4a] outline-none transition-all shadow-sm font-medium"
            required
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="p-4 bg-white border border-[#552c24]/20 rounded-2xl focus:ring-2 focus:ring-[#ffcd4a]/50 focus:border-[#ffcd4a] outline-none transition-all shadow-sm font-medium text-[#552c24] font-bold"
          >
            <option value="user">사용자 (User)</option>
            <option value="admin">관리자 (Admin)</option>
          </select>
          <button
            type="submit"
            className="px-8 py-4 bg-[#ffcd4a] text-[#552c24] font-bold rounded-2xl hover:bg-[#ffcd4a]/90 transition-all shadow-md active:scale-[0.98]"
          >
            등록하기
          </button>
        </form>
      </div>

      <div className="bg-white border border-[#552c24]/10 rounded-[32px] p-8 shadow-sm">
        <h3 className="text-xl font-bold mb-6 text-[#552c24] flex items-center gap-2">
          <UserIcon className="w-6 h-6 text-[#ffcd4a]" />
          승인된 회원 목록
        </h3>
        <div className="overflow-x-auto text-left">
          <table className="w-full text-[#552c24]">
            <thead>
              <tr className="border-b border-[#552c24]/10">
                <th className="pb-4 font-bold text-lg uppercase tracking-wider text-gray-500">이메일</th>
                <th className="pb-4 font-bold text-lg uppercase tracking-wider text-gray-500">권한</th>
                <th className="pb-4 font-bold text-lg uppercase tracking-wider text-gray-500 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#552c24]/5">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="py-4 font-medium text-lg">{u.email}</td>
                  <td className="py-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold ${
                      u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-4 text-right">
                    <button
                      onClick={() => handleDeleteUser(u.id)}
                      className="px-4 py-2 bg-red-50 text-red-600 rounded-full text-sm font-bold hover:bg-red-100 transition-colors"
                    >
                      권한 삭제
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-gray-500 font-medium">
                    등록된 회원이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HomePage() {
  const { user } = useAuth();
  if (user) return <Navigate to="/tool" replace />;

  return (
    <div className="max-w-3xl mx-auto mt-20 text-center">
      <h2 className="text-5xl font-extrabold text-[#552c24] mb-6 leading-tight">오리한의원 실장 업무를 AI와 함께</h2>
      <p className="text-2xl text-[#552c24]/80 mb-12 font-medium">서비스를 이용하시려면 로그인이 필요합니다.</p>
      <button 
        onClick={loginWithGoogle}
        className="px-10 py-5 bg-[#ffcd4a] text-[#552c24] rounded-full font-bold text-2xl hover:bg-[#ffcd4a]/90 transition-all shadow-lg inline-flex items-center gap-3 active:scale-95"
      >
        <LogIn size={24} />
        Google로 계속하기
      </button>
    </div>
  );
}

export default function App() {
  const { user, isAdmin } = useAuth();

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#fffdfa] text-[#552c24] selection:bg-[#ffcd4a]/40 selection:text-[#552c24]">
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-[#552c24]/10 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden bg-white shadow-sm border border-[#552c24]/10">
                <img src={personaImg} alt="오리한의원" className="w-full h-full object-cover" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-[#552c24]">오리한의원 수석 실장 AI</h1>
                <p className="text-sm uppercase tracking-widest text-[#552c24]/70 font-bold">Ori Clinic Manager</p>
              </div>
            </Link>
            
            <div className="flex items-center gap-4">
              {user && isAdmin && (
                <Link to="/admin" className="px-4 py-2 hover:bg-[#ffcd4a]/20 rounded-full transition-colors font-bold flex items-center gap-2">
                  <ShieldCheck size={18} /> Admin
                </Link>
              )}
              {user ? (
                <>
                  <span className="font-bold text-sm bg-gray-100 px-3 py-1 rounded-full text-[#552c24]">{user.displayName || user.email}</span>
                  <button 
                    onClick={logout}
                    className="flex items-center gap-2 px-4 py-2 hover:bg-red-50 text-red-600 rounded-full transition-colors font-bold text-sm"
                  >
                    <LogOut size={16} /> Logout
                  </button>
                </>
              ) : (
                <button 
                  onClick={loginWithGoogle}
                  className="flex items-center gap-2 px-4 py-2 bg-[#ffcd4a] hover:bg-[#ffcd4a]/90 text-[#552c24] rounded-full transition-colors font-bold shadow-sm"
                >
                  <LogIn size={18} /> Login
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-6 py-10">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/tool" element={<ProtectedRoute><ClinicTool /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute requireAdmin={true}><AdminDashboard /></ProtectedRoute>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
