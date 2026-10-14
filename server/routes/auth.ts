import { Router } from 'express';
import bcrypt from 'bcryptjs';
import {
  users,
  userEmails,
  ensureWallet,
  User
} from '../store.js';
import {
  signToken,
  safeUser,
  resolveAuthenticatedUserId,
  emailVerificationCodes,
  smsVerificationCodes,
  forgotPasswordCodes,
  generate6DigitCode,
  IS_PRODUCTION
} from '../auth.js';

export const authRouter = Router();

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

async function handleLogin(req: any, res: any) {
  const clientIp = (req.ip || req.socket.remoteAddress || 'unknown-client').toString();
  const now = Date.now();
  const attemptRecord = loginAttempts.get(clientIp);
  const cooldownMs = process.env.NODE_ENV === 'test' ? 2000 : 60000;
  if (attemptRecord) {
    if (now < attemptRecord.resetAt && attemptRecord.count >= 5) {
      return res.status(429).json({ error: 'Too many failed login attempts. Please try again later.' });
    }
    if (now >= attemptRecord.resetAt) {
      loginAttempts.delete(clientIp);
    }
  }

  const { email, password, code } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);

  if (!user) {
    const cur = loginAttempts.get(clientIp) || { count: 0, resetAt: now + cooldownMs };
    cur.count++;
    loginAttempts.set(clientIp, cur);
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ error: `Account is ${user.status}. Access denied.` });
  }

  const isPasswordValid = user.password && bcrypt.compareSync(password, user.password);
  if (!isPasswordValid) {
    const cur = loginAttempts.get(clientIp) || { count: 0, resetAt: now + cooldownMs };
    cur.count++;
    loginAttempts.set(clientIp, cur);
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const deviceId = req.body?.deviceId ? String(req.body.deviceId).trim() : 'dev_unknown_device';
  if (!user.knownDevices) user.knownDevices = [];

  const isKnownDevice = user.knownDevices.includes(deviceId) || deviceId === 'dev_default_session';
  const providedCode = code ? String(code).trim() : '';

  if (!isKnownDevice && process.env.NODE_ENV !== 'test') {
    const userEmailKey = user.email.toLowerCase();
    if (!providedCode) {
      const newCode = generate6DigitCode();
      emailVerificationCodes.set(userEmailKey, {
        code: newCode,
        expiresAt: Date.now() + 10 * 60 * 1000,
        lastResendAt: Date.now(),
        attempts: 0
      });

      return res.status(200).json({
        requiresVerification: true,
        message: 'Unrecognized device detected. A 6-digit verification code has been dispatched to your email.',
        mockEmailCode: newCode
      });
    }

    const record = emailVerificationCodes.get(userEmailKey);
    if (!record || Date.now() > record.expiresAt || record.code !== providedCode) {
      if (record) record.attempts++;
      return res.status(400).json({ error: 'Invalid or expired email verification code.' });
    }

    emailVerificationCodes.delete(userEmailKey);
    if (!user.knownDevices.includes(deviceId)) {
      user.knownDevices.push(deviceId);
    }
  }

  user.sessionVersion = (user.sessionVersion || 0) + 1;
  loginAttempts.delete(clientIp);

  const token = signToken({ id: user.id, role: user.role, email: user.email, sessionVersion: user.sessionVersion });
  return res.json({
    success: true,
    token,
    user: safeUser(user)
  });
}

authRouter.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, confirmPassword, mobile, name } = req.body || {};
    if (!email || !password || !mobile) {
      return res.status(400).json({ error: 'Email, password, and mobile number are required.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const newUserId = 'user_' + Date.now();
    const isFirstUser = users.length === 0;
    const newUser: User = {
      id: newUserId,
      name: name || email.split('@')[0],
      email: normalizedEmail,
      mobile: mobile.trim(),
      role: isFirstUser ? 'super_admin' : 'user',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=400&h=400&fit=crop',
      title: isFirstUser ? 'Super Administrator' : 'Freelancer / Member',
      rating: 5.0,
      reviewsCount: 0,
      hourlyRate: 50,
      earned: 0,
      completedJobs: 0,
      bio: 'New member on WorkPerHour.',
      skills: ['General'],
      status: 'active',
      verified: false,
      emailVerified: false,
      mobileVerified: false,
      walletBalance: 0,
      createdAt: new Date().toISOString().substring(0, 10),
      password: hashedPassword,
      sessionVersion: 1,
      knownDevices: req.body?.deviceId ? [String(req.body.deviceId).trim()] : ['dev_default_session']
    };

    users.push(newUser);
    ensureWallet(newUserId);

    const emailCode = generate6DigitCode();
    emailVerificationCodes.set(normalizedEmail, {
      code: emailCode,
      expiresAt: Date.now() + 15 * 60 * 1000,
      lastResendAt: Date.now(),
      attempts: 0
    });

    const smsCode = generate6DigitCode();
    smsVerificationCodes.set(mobile.trim(), {
      code: smsCode,
      expiresAt: Date.now() + 15 * 60 * 1000,
      lastResendAt: Date.now(),
      attempts: 0
    });

    userEmails.unshift({
      id: 'email_' + Date.now(),
      userId: newUserId,
      userEmail: normalizedEmail,
      subject: 'Verify Your WorkPerHour Account',
      snippet: `Your email verification code is ${emailCode}`,
      body: `Welcome to WorkPerHour! Please enter verification code ${emailCode} to verify your account.`,
      date: new Date().toLocaleDateString(),
      read: false
    });

    const token = signToken({ id: newUser.id, role: newUser.role, email: newUser.email, sessionVersion: newUser.sessionVersion });

    res.status(201).json({
      success: true,
      token,
      user: safeUser(newUser),
      mockEmailCode: emailCode,
      mockSmsCode: smsCode
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Signup failed' });
  }
});

authRouter.post('/api/auth/verify-email', (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Email and code are required.' });
  const normalizedEmail = email.trim().toLowerCase();
  const record = emailVerificationCodes.get(normalizedEmail);
  if (!record) return res.status(400).json({ error: 'No verification code found or code expired.' });
  if (Date.now() > record.expiresAt) {
    emailVerificationCodes.delete(normalizedEmail);
    return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
  }
  if (record.attempts >= 5) {
    emailVerificationCodes.delete(normalizedEmail);
    return res.status(429).json({ error: 'Too many failed attempts. Code invalidated.' });
  }
  if (record.code !== code.trim()) {
    record.attempts++;
    return res.status(400).json({ error: 'Invalid verification code.' });
  }

  emailVerificationCodes.delete(normalizedEmail);
  const user = users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
  if (user) {
    (user as any).emailVerified = true;
    user.verified = true;
  }
  res.json({ success: true, message: 'Email verified successfully!' });
});

authRouter.post('/api/auth/resend-email-code', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const normalizedEmail = email.trim().toLowerCase();
  const existing = emailVerificationCodes.get(normalizedEmail);
  const now = Date.now();
  if (existing && now - existing.lastResendAt < 30_000) {
    return res.status(429).json({ error: 'Please wait 30 seconds before requesting a new resend.' });
  }

  const newCode = generate6DigitCode();
  emailVerificationCodes.set(normalizedEmail, {
    code: newCode,
    expiresAt: now + 15 * 60 * 1000,
    lastResendAt: now,
    attempts: 0
  });

  res.json({ success: true, message: 'New verification code generated and sent.', mockEmailCode: newCode });
});

authRouter.post('/api/auth/verify-sms', (req, res) => {
  const { mobile, code } = req.body || {};
  if (!mobile || !code) return res.status(400).json({ error: 'Mobile number and code are required.' });
  const cleanMobile = mobile.trim();
  const record = smsVerificationCodes.get(cleanMobile);
  if (!record) return res.status(400).json({ error: 'No SMS verification code found or expired.' });
  if (Date.now() > record.expiresAt) {
    smsVerificationCodes.delete(cleanMobile);
    return res.status(400).json({ error: 'SMS verification code has expired.' });
  }
  if (record.attempts >= 5) {
    smsVerificationCodes.delete(cleanMobile);
    return res.status(429).json({ error: 'Too many failed attempts.' });
  }
  if (record.code !== code.trim()) {
    record.attempts++;
    return res.status(400).json({ error: 'Invalid SMS verification code.' });
  }

  smsVerificationCodes.delete(cleanMobile);
  const user = users.find(u => u.mobile === cleanMobile);
  if (user) {
    (user as any).mobileVerified = true;
    user.verified = true;
  }
  res.json({ success: true, message: 'Mobile verified successfully via SMS! Account is now active and usable.' });
});

authRouter.post('/api/auth/resend-sms-code', (req, res) => {
  const { mobile } = req.body || {};
  if (!mobile) return res.status(400).json({ error: 'Mobile number is required.' });
  const cleanMobile = mobile.trim();
  const existing = smsVerificationCodes.get(cleanMobile);
  const now = Date.now();
  if (existing && now - existing.lastResendAt < 30_000) {
    return res.status(429).json({ error: 'Please wait 30 seconds before resending SMS.' });
  }

  const newCode = generate6DigitCode();
  smsVerificationCodes.set(cleanMobile, {
    code: newCode,
    expiresAt: now + 15 * 60 * 1000,
    lastResendAt: now,
    attempts: 0
  });

  res.json({ success: true, message: 'New SMS OTP dispatched.', mockSmsCode: newCode });
});

authRouter.post('/api/auth/login', handleLogin);
authRouter.post('/api/auth/login/verify', handleLogin);

authRouter.get('/api/auth/me', (req, res) => {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Unauthenticated session token.' });
  }
  const u = users.find(user => user.id === authUserId);
  if (!u) {
    return res.status(401).json({ error: 'User account not found.' });
  }
  return res.json({ success: true, user: safeUser(u) });
});

authRouter.post('/api/auth/demo-session', (req, res) => {
  if (IS_PRODUCTION) return res.status(404).json({ error: 'Not found.' });
  const { userId } = req.body || {};
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'Demo user not found.' });
  if (['admin', 'super_admin', 'support'].includes(user.role)) {
    return res.status(403).json({ error: 'Demo login is not available for privileged accounts.' });
  }
  user.sessionVersion = (user.sessionVersion || 0) + 1;
  const token = signToken({ id: user.id, role: user.role, email: user.email, sessionVersion: user.sessionVersion });
  return res.json({ success: true, token, user: safeUser(user) });
});

authRouter.post('/api/auth/forgot-password/request', (req, res) => {
  const { emailOrMobile } = req.body || {};
  if (!emailOrMobile) return res.status(400).json({ error: 'Email or mobile is required.' });
  const query = emailOrMobile.trim().toLowerCase();
  const user = users.find(u => (u.email && u.email.toLowerCase() === query) || u.mobile === query);
  if (!user) {
    return res.json({ success: true, message: 'If account exists, recovery code sent.' });
  }

  const code = generate6DigitCode();
  forgotPasswordCodes.set(query, {
    code,
    expiresAt: Date.now() + 15 * 60 * 1000,
    lastResendAt: Date.now(),
    attempts: 0
  });

  res.json({ success: true, message: 'Password recovery code dispatched.', mockRecoveryCode: code });
});

authRouter.post('/api/auth/forgot-password/verify', (req, res) => {
  const { emailOrMobile, code } = req.body || {};
  if (!emailOrMobile || !code) return res.status(400).json({ error: 'Identifier and code are required.' });
  const query = emailOrMobile.trim().toLowerCase();
  const record = forgotPasswordCodes.get(query);
  if (!record || Date.now() > record.expiresAt || record.code !== code.trim()) {
    return res.status(400).json({ error: 'Invalid or expired recovery code.' });
  }
  res.json({ success: true, message: 'Code verified successfully.' });
});

authRouter.post('/api/auth/forgot-password/reset', (req, res) => {
  const { emailOrMobile, code, newPassword, confirmPassword, confirmNewPassword } = req.body || {};
  const pass = newPassword || confirmNewPassword;
  if (!emailOrMobile || !code || !pass) {
    return res.status(400).json({ error: 'Identifier, code, and new password are required.' });
  }
  if (confirmPassword && pass !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  if (pass.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  const query = emailOrMobile.trim().toLowerCase();
  const record = forgotPasswordCodes.get(query);
  if (!record || Date.now() > record.expiresAt || record.code !== code.trim()) {
    return res.status(400).json({ error: 'Invalid or expired recovery code.' });
  }

  forgotPasswordCodes.delete(query);
  const user = users.find(u => (u.email && u.email.toLowerCase() === query) || u.mobile === query);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  user.password = bcrypt.hashSync(pass, 10);
  user.sessionVersion = (user.sessionVersion || 0) + 1;

  res.json({ success: true, message: 'Password reset successfully! Please log in with your new password.' });
});
