import React from 'react';
import { LogIn } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { loginWithGoogle } from '../firebase';

export function HomePage() {
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
