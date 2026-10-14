import React from 'react';

interface SignupModalProps {
  isOpen: boolean;
  onClose: () => void;
  handleSignupSubmit: (e: React.FormEvent) => void;
  signupName: string;
  setSignupName: (val: string) => void;
  signupEmail: string;
  setSignupEmail: (val: string) => void;
  signupMobile: string;
  setSignupMobile: (val: string) => void;
  signupPassword: string;
  setSignupPassword: (val: string) => void;
  signupConfirmPassword: string;
  setSignupConfirmPassword: (val: string) => void;
}

export const SignupModal: React.FC<SignupModalProps> = ({
  isOpen,
  onClose,
  handleSignupSubmit,
  signupName,
  setSignupName,
  signupEmail,
  setSignupEmail,
  signupMobile,
  setSignupMobile,
  signupPassword,
  setSignupPassword,
  signupConfirmPassword,
  setSignupConfirmPassword
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 relative">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-fiverr-dark">Register for WorkPerHour</h2>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-fiverr-dark p-1.5 rounded-xl hover:bg-slate-100 transition cursor-pointer text-xs font-bold"
          >
            ✕ Close
          </button>
        </div>
        <form onSubmit={handleSignupSubmit} className="space-y-3">
          <input type="text" placeholder="Full Name" value={signupName} onChange={(e) => setSignupName(e.target.value)} required className="w-full px-4 py-2 border rounded-xl text-sm" />
          <input type="email" placeholder="Email" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} required className="w-full px-4 py-2 border rounded-xl text-sm" />
          <input type="text" placeholder="Mobile Number" value={signupMobile} onChange={(e) => setSignupMobile(e.target.value)} required className="w-full px-4 py-2 border rounded-xl text-sm" />
          <input type="password" placeholder="Password (min 6 chars)" value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} required className="w-full px-4 py-2 border rounded-xl text-sm" />
          <input type="password" placeholder="Confirm Password" value={signupConfirmPassword} onChange={(e) => setSignupConfirmPassword(e.target.value)} required className="w-full px-4 py-2 border rounded-xl text-sm" />
          <button type="submit" className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl transition cursor-pointer">Sign Up</button>
        </form>
      </div>
    </div>
  );
};
