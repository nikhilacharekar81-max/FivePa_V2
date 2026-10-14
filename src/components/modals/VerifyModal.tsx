import React from 'react';

interface VerifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  verificationMode: 'email' | 'sms';
  setVerificationMode: (mode: 'email' | 'sms') => void;
  emailCodeInput: string;
  setEmailCodeInput: (val: string) => void;
  smsCodeInput: string;
  setSmsCodeInput: (val: string) => void;
  handleVerifyEmailSubmit: (e: React.FormEvent) => void;
  handleVerifySmsSubmit: (e: React.FormEvent) => void;
  handleResendEmailCode: () => void;
  handleResendSmsCode: () => void;
}

export const VerifyModal: React.FC<VerifyModalProps> = ({
  isOpen,
  onClose,
  verificationMode,
  setVerificationMode,
  emailCodeInput,
  setEmailCodeInput,
  smsCodeInput,
  setSmsCodeInput,
  handleVerifyEmailSubmit,
  handleVerifySmsSubmit,
  handleResendEmailCode,
  handleResendSmsCode
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 relative">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-fiverr-dark">Verify Your Account</h2>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-fiverr-dark p-1.5 rounded-xl hover:bg-slate-100 transition cursor-pointer text-xs font-bold"
          >
            ✕ Close
          </button>
        </div>
        <div className="mb-4">
          <button onClick={() => setVerificationMode('email')} className={`mr-2 px-3 py-1 rounded cursor-pointer text-xs font-bold ${verificationMode === 'email' ? 'bg-slate-900 text-white' : 'bg-slate-200'}`}>Email</button>
          <button onClick={() => setVerificationMode('sms')} className={`px-3 py-1 rounded cursor-pointer text-xs font-bold ${verificationMode === 'sms' ? 'bg-slate-900 text-white' : 'bg-slate-200'}`}>SMS</button>
        </div>
        {verificationMode === 'email' ? (
          <form onSubmit={handleVerifyEmailSubmit} className="space-y-4">
            <input type="text" placeholder="Enter Email Code" value={emailCodeInput} onChange={(e) => setEmailCodeInput(e.target.value)} required className="w-full px-4 py-2 border rounded-xl text-sm" />
            <button type="submit" className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl text-sm transition cursor-pointer">Verify Email</button>
            <button type="button" onClick={handleResendEmailCode} className="w-full text-xs text-emerald-700 hover:underline cursor-pointer">Resend Email Code</button>
          </form>
        ) : (
          <form onSubmit={handleVerifySmsSubmit} className="space-y-4">
            <input type="text" placeholder="Enter SMS Code" value={smsCodeInput} onChange={(e) => setSmsCodeInput(e.target.value)} required className="w-full px-4 py-2 border rounded-xl text-sm" />
            <button type="submit" className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl text-sm transition cursor-pointer">Verify SMS</button>
            <button type="button" onClick={handleResendSmsCode} className="w-full text-xs text-emerald-700 hover:underline cursor-pointer">Resend SMS Code</button>
          </form>
        )}
      </div>
    </div>
  );
};
