import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { UserAccount } from '../../types';
import { setAuthToken } from '../../utils/authToken';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  loginRequiresCode: boolean;
  loginVerificationMessage: string;
  mockEmailCodeDisplay: string | null;
  loginEmail: string;
  setLoginEmail: (val: string) => void;
  loginPassword: string;
  setLoginPassword: (val: string) => void;
  loginCode: string;
  setLoginCode: (val: string) => void;
  handleLoginSubmit: any;
  setLoginRequiresCode: (val: boolean) => void;
  usersList: UserAccount[];
  updateCurrentUser: (u: UserAccount) => void;
  setImpersonatedUser: any;
  fetchAllAdminData: () => void;
  setIsForgotPasswordModalOpen: (val: boolean) => void;
  setMockEmailCodeDisplay: any;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  loginRequiresCode,
  loginVerificationMessage,
  mockEmailCodeDisplay,
  loginEmail,
  setLoginEmail,
  loginPassword,
  setLoginPassword,
  loginCode,
  setLoginCode,
  handleLoginSubmit,
  setLoginRequiresCode,
  usersList,
  updateCurrentUser,
  setImpersonatedUser,
  fetchAllAdminData,
  setIsForgotPasswordModalOpen,
  setMockEmailCodeDisplay
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 relative">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-fiverr-dark">Login to WorkPerHour</h2>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-fiverr-dark p-1.5 rounded-xl hover:bg-slate-100 transition cursor-pointer text-xs font-bold"
          >
            ✕ Close
          </button>
        </div>
        {loginRequiresCode ? (
          <form className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-amber-900">
                <ShieldCheck className="w-4 h-4 text-amber-600" />
                <span>Device Verification Code Required</span>
              </div>
              <p>{loginVerificationMessage || `Enter the 6-digit verification code sent to ${loginEmail}.`}</p>
            </div>

            {mockEmailCodeDisplay && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center justify-between">
                <span>Test / Demo OTP:</span>
                <span className="font-mono font-bold text-sm bg-white px-2 py-0.5 rounded border border-emerald-200">{mockEmailCodeDisplay}</span>
              </div>
            )}

            <div>
              <label className="text-xs font-bold text-fiverr-dark uppercase block mb-1">Enter 6-Digit Email Code</label>
              <input 
                type="text" 
                maxLength={6} 
                placeholder="123456" 
                value={loginCode} 
                onChange={(e) => setLoginCode(e.target.value)} 
                required 
                autoFocus
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-center text-lg font-mono font-bold tracking-widest bg-white focus:outline-emerald-500" 
              />
            </div>

            <button type="button" onClick={() => handleLoginSubmit()} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition cursor-pointer text-sm">
              Verify Code & Complete Login
            </button>

            <div className="flex items-center justify-between text-xs pt-1">
              <button 
                type="button" 
                onClick={async () => {
                  try {
                    const res = await fetch('/api/auth/resend-email-code', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: loginEmail })
                    });
                    const data = await res.json();
                    if (res.ok && data.mockEmailCode) {
                      setMockEmailCodeDisplay(data.mockEmailCode);
                      alert('New verification code sent to your email.');
                    }
                  } catch (e) {
                    console.warn(e);
                  }
                }} 
                className="text-emerald-700 font-semibold hover:underline cursor-pointer"
              >
                Resend Code
              </button>
              <button 
                type="button" 
                onClick={() => { setLoginRequiresCode(false); setLoginCode(''); }} 
                className="text-fiverr-muted hover:text-slate-800 cursor-pointer"
              >
                Back to Password
              </button>
            </div>
          </form>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); handleLoginSubmit(e); }}>
            <input type="email" placeholder="Email (e.g. user@example.com)" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required className="w-full px-4 py-2 border rounded-xl text-sm" />
            <input type="password" placeholder="Password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required className="w-full px-4 py-2 border rounded-xl text-sm" />
            <button type="submit" className="w-full py-2.5 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition cursor-pointer">Login</button>
            <button type="button" onClick={(e) => { e.preventDefault(); onClose(); setIsForgotPasswordModalOpen(true); }} className="w-full text-xs font-normal text-emerald-700 hover:text-emerald-900 cursor-pointer underline">Forgot Password?</button>
          </form>
        )}

        {usersList.length > 0 && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2 text-center">Instant Demo Account Login</span>
            <div className="grid grid-cols-2 gap-2 text-xs">
            {usersList.slice(0, 4).map(u => (
              <button
                key={u.id}
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/auth/demo-session', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ userId: u.id })
                    });
                    const data = await res.json();
                    if (data.token) {
                      setAuthToken(data.token);
                    }
                    updateCurrentUser(data.user || u);
                  } catch {
                    updateCurrentUser(u);
                  }
                  setImpersonatedUser(null);
                  onClose();
                  fetchAllAdminData();
                }}
                className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-left transition flex items-center gap-2 cursor-pointer"
              >
                <img src={u.avatar} className="w-6 h-6 rounded-full object-cover shrink-0" />
                <div className="truncate">
                  <div className="font-bold text-[11px] text-slate-800 truncate">{u.name.split(' ')[0]}</div>
                  <div className="text-[9px] text-fiverr-muted uppercase">{u.role}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        )}
      </div>
    </div>
  );
};
