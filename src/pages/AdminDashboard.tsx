import React, { useState, useEffect } from 'react';
import { ShieldCheck, PlusCircle, User as UserIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { handleFirestoreError, OperationType } from '../lib/firebaseUtils';

export function AdminDashboard() {
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
