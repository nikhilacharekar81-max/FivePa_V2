// Authoritative Settings & Shared Fee Calculation Service for WorkPerHour

import { financeLedger, FinanceLedgerEngine } from './financeLedger.js';
import { DEFAULT_FEE_CONFIG, calculateOrderFees, type FeeConfig } from '../shared/fees.js';

export interface WebsiteSettings {
  siteName: string;
  siteTagline: string;
  supportEmail: string;
  contactPhone: string;
  helpdeskUrl: string;
  maintenanceMode: boolean;
  copyrightText: string;
}

export interface PlatformCommissionSettings {
  commissionPercent: number; // platform cut of the gig price; freelancer keeps the rest (default 20)
  buyerProcessingFeePercent: number; // client service fee on top of the gig price (default 5.5)
  smallOrderFeeAmount: number; // flat fee added when the gig price is under the threshold (default 3.50)
  smallOrderFeeThreshold: number; // gig price below this triggers the small-order fee (default 200)
  refundClientFeesOnFullRefund: boolean; // return service + small-order fee when an order is fully refunded
  minimumOrderAmount: number; // e.g. 5.00
  escrowProtectionDays: number; // default 14
  commissionDeductionTiming: 'on_escrow_release' | 'on_order_checkout';
}

export interface MembershipPlanTier {
  id: string;
  name: string;
  priceMonthly: number;
  bidsPerMonth: number;
  commissionDiscountPercent: number; // reduction from base commission
  featuredBadge: boolean;
  enabled: boolean;
}

export interface MembershipPlansSettings {
  membershipsEnabled: boolean;
  freelancerPlans: MembershipPlanTier[];
  buyerPlans: {
    id: string;
    name: string;
    priceMonthly: number;
    jobPostsPerMonth: number;
    zeroBuyerFee: boolean;
    enabled: boolean;
  }[];
}

export interface GigsProjectsOrdersSettings {
  gigModerationRequired: boolean; // Auto-publish vs Require Admin Approval
  projectModerationRequired: boolean;
  minimumGigPrice: number;
  maximumGigPrice: number;
  minimumProjectBudget: number;
  maxActiveOrdersPerFreelancer: number; // 0 for unlimited
  autoCompleteDeliveredDays: number; // default 3 days
  autoCompleteDeliveredEnabled: boolean; // default true (toggle auto-accept on/off with one setting)
  allowBuyerCancellationRequests: boolean;
}

export interface WalletsWithdrawalsSettings {
  minimumWithdrawalAmount: number;
  maximumWithdrawalPerTransaction: number;
  dailyWithdrawalLimit: number;
  payoutProcessingSchedule: 'instant_auto' | 'daily_batch' | 'manual_review_all' | 'manual_review_over_threshold';
  manualReviewThresholdAmount: number; // e.g. 500
  platformCoversGatewayFees: boolean;
  allowedPayoutMethods: {
    upi: boolean;
    bankTransfer: boolean;
    stripeConnect: boolean;
    razorpayX: boolean;
    paypal: boolean;
  };
  depositHoldDaysBeforeWithdraw: number;
}

export interface LanguageCurrencySettings {
  defaultCurrency: 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD';
  currencySymbolPlacement: 'before' | 'after';
  decimalPlaces: 0 | 2;
  primaryLanguage: 'en_US' | 'en_GB' | 'es' | 'fr' | 'de' | 'hi';
  dateFormat: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
  timezone: string;
}

export interface SecurityRegistrationSettings {
  allowNewRegistrations: boolean;
  requireEmailVerification: boolean;
  requireKycForPayouts: boolean;
  requireAdmin2FA: boolean;
  maxFailedLoginsLockout: number;
  sessionTimeoutMinutes: number;
  minPasswordLength: number;
}

export interface EmailsIntegrationsSettings {
  emailSenderName: string;
  emailSenderAddress: string;
  sendWelcomeEmail: boolean;
  sendOrderStatusEmails: boolean;
  sendPayoutStatusEmails: boolean;
  sendDisputeAdminAlerts: boolean;
  stripeEnabled: boolean;
  stripePublishableKeyMasked: string;
  razorpayEnabled: boolean;
}

export interface SettingsHistoryItem {
  id: string;
  timestamp: string;
  section: string;
  settingName: string;
  oldValue: string;
  newValue: string;
  actor: string;
  notes?: string;
}

export interface SiteSettingsState {
  website: WebsiteSettings;
  commission: PlatformCommissionSettings;
  memberships: MembershipPlansSettings;
  marketplace: GigsProjectsOrdersSettings;
  wallets: WalletsWithdrawalsSettings;
  localization: LanguageCurrencySettings;
  security: SecurityRegistrationSettings;
  integrations: EmailsIntegrationsSettings;
}

// Sensible Out-of-the-Box Defaults
export const DEFAULT_SITE_SETTINGS: SiteSettingsState = {
  website: {
    siteName: 'WorkPerHour',
    siteTagline: 'Hire Top Freelancers & Discover Quality Services',
    supportEmail: 'support@workperhour.com',
    contactPhone: '+1 (800) 555-WORK',
    helpdeskUrl: 'https://support.workperhour.com',
    maintenanceMode: false,
    copyrightText: '© 2026 WorkPerHour Inc. All rights reserved.'
  },
  commission: {
    commissionPercent: DEFAULT_FEE_CONFIG.commissionPercent, // 20% platform take rate
    buyerProcessingFeePercent: DEFAULT_FEE_CONFIG.buyerFeePercent, // 5.5% client service fee
    smallOrderFeeAmount: DEFAULT_FEE_CONFIG.smallOrderFee, // $3.50 flat fee...
    smallOrderFeeThreshold: DEFAULT_FEE_CONFIG.smallOrderThreshold, // ...on orders under $200
    refundClientFeesOnFullRefund: true,
    minimumOrderAmount: 10.0,
    escrowProtectionDays: 14, // 14-day mandatory vault
    commissionDeductionTiming: 'on_escrow_release'
  },
  memberships: {
    membershipsEnabled: true,
    freelancerPlans: [
      { id: 'plan_free', name: 'Standard Freelancer', priceMonthly: 0, bidsPerMonth: 15, commissionDiscountPercent: 0, featuredBadge: false, enabled: true },
      { id: 'plan_pro', name: 'WorkPerHour Pro Talent', priceMonthly: 29, bidsPerMonth: 80, commissionDiscountPercent: 2, featuredBadge: true, enabled: true }
    ],
    buyerPlans: [
      { id: 'buyer_free', name: 'Standard Client', priceMonthly: 0, jobPostsPerMonth: 10, zeroBuyerFee: false, enabled: true },
      { id: 'buyer_enterprise', name: 'Enterprise Client', priceMonthly: 99, jobPostsPerMonth: 999, zeroBuyerFee: true, enabled: true }
    ]
  },
  marketplace: {
    gigModerationRequired: false, // published directly by default
    projectModerationRequired: false,
    minimumGigPrice: 10,
    maximumGigPrice: 10000,
    minimumProjectBudget: 20,
    maxActiveOrdersPerFreelancer: 0, // 0 for unlimited (allows high-velocity sellers and buyers without artificial caps)
    autoCompleteDeliveredDays: 3,
    autoCompleteDeliveredEnabled: true,
    allowBuyerCancellationRequests: true
  },
  wallets: {
    minimumWithdrawalAmount: 50,
    maximumWithdrawalPerTransaction: 5000,
    dailyWithdrawalLimit: 10000,
    payoutProcessingSchedule: 'manual_review_over_threshold',
    manualReviewThresholdAmount: 500,
    platformCoversGatewayFees: true,
    allowedPayoutMethods: {
      upi: true,
      bankTransfer: true,
      stripeConnect: true,
      razorpayX: true,
      paypal: true
    },
    depositHoldDaysBeforeWithdraw: 0
  },
  localization: {
    defaultCurrency: 'USD',
    currencySymbolPlacement: 'before',
    decimalPlaces: 2,
    primaryLanguage: 'en_US',
    dateFormat: 'YYYY-MM-DD',
    timezone: 'UTC'
  },
  security: {
    allowNewRegistrations: true,
    requireEmailVerification: false,
    requireKycForPayouts: true,
    requireAdmin2FA: true,
    maxFailedLoginsLockout: 5,
    sessionTimeoutMinutes: 60,
    minPasswordLength: 8
  },
  integrations: {
    emailSenderName: 'WorkPerHour Notifications',
    emailSenderAddress: 'notifications@workperhour.com',
    sendWelcomeEmail: true,
    sendOrderStatusEmails: true,
    sendPayoutStatusEmails: true,
    sendDisputeAdminAlerts: true,
    stripeEnabled: true,
    stripePublishableKeyMasked: 'pk_test_51Mz...••••',
    razorpayEnabled: true
  }
};

export class SiteSettingsService {
  private settings: SiteSettingsState;
  private history: SettingsHistoryItem[] = [];

  constructor() {
    // Deep clone defaults
    this.settings = JSON.parse(JSON.stringify(DEFAULT_SITE_SETTINGS));
    this.seedInitialHistory();
    // Sync initial fee rules to finance engine
    this.syncFeesToLedger();
  }

  private seedInitialHistory() {
    this.history.push({
      id: 'SET-HIST-101',
      timestamp: '2026-10-01 10:00:00',
      section: 'Platform Commission',
      settingName: 'Platform Commission (%)',
      oldValue: 'Initial Configuration',
      newValue: `${DEFAULT_FEE_CONFIG.commissionPercent}%`,
      actor: 'System Setup',
      notes: `Standard ${DEFAULT_FEE_CONFIG.commissionPercent}% platform take rate initialized with 14-day escrow protection.`
    });
    this.history.push({
      id: 'SET-HIST-102',
      timestamp: '2026-10-05 09:30:00',
      section: 'Wallets & Withdrawals',
      settingName: 'Manual Review Threshold',
      oldValue: '$1,000.00',
      newValue: '$500.00',
      actor: 'Admin Chief',
      notes: 'Tightened payout compliance threshold to $500 for enhanced risk management.'
    });
  }

  public getSettings(): SiteSettingsState {
    return JSON.parse(JSON.stringify(this.settings));
  }

  public getSettingsHistory(): SettingsHistoryItem[] {
    return [...this.history];
  }

  // Shared Fee Calculation Service: Used across entire application.
  // Delegates to src/shared/fees.ts so the ledger, the API and the UI all use identical math.
  public getFeeConfig(customCommissionPercent?: number): FeeConfig {
    const c = this.settings.commission;
    return {
      commissionPercent: customCommissionPercent !== undefined ? customCommissionPercent : c.commissionPercent,
      buyerFeePercent: c.buyerProcessingFeePercent,
      smallOrderFee: c.smallOrderFeeAmount,
      smallOrderThreshold: c.smallOrderFeeThreshold
    };
  }

  public calculateFeeSplit(orderAmount: number, customCommissionPercent?: number) {
    const f = calculateOrderFees(Math.max(0, orderAmount), this.getFeeConfig(customCommissionPercent));
    return {
      orderAmount: f.gigPrice,
      commissionPercent: this.getFeeConfig(customCommissionPercent).commissionPercent,
      platformFee: f.platformCommission,
      freelancerPercent: f.freelancerPercent,
      freelancerAmount: f.freelancerNet,
      buyerProcessingFeePercent: this.settings.commission.buyerProcessingFeePercent,
      buyerFee: f.serviceFee,
      smallOrderFee: f.smallOrderFee,
      totalBuyerCharged: f.clientTotal
    };
  }

  // Pushes every fee rule to the finance ledger, which is what actually enforces them on money movement.
  private syncFeesToLedger() {
    const c = this.settings.commission;
    financeLedger.configure({
      commissionPercent: c.commissionPercent,
      buyerFeePercent: c.buyerProcessingFeePercent,
      smallOrderFee: c.smallOrderFeeAmount,
      smallOrderThreshold: c.smallOrderFeeThreshold,
      refundClientFeesOnFullRefund: c.refundClientFeesOnFullRefund,
      minimumOrderAmount: c.minimumOrderAmount
    });
  }

  // Update a specific section of settings
  public updateSection<K extends keyof SiteSettingsState>(
    section: K,
    updates: Partial<SiteSettingsState[K]>,
    actor: string = 'Super Admin'
  ): SiteSettingsState[K] {
    const currentSection = this.settings[section];
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // Track changed keys in history
    for (const [key, val] of Object.entries(updates)) {
      const oldVal = (currentSection as any)[key];
      const oldStr = typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal);
      const newStr = typeof val === 'object' ? JSON.stringify(val) : String(val);

      if (oldStr !== newStr) {
        this.history.unshift({
          id: `SET-HIST-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
          timestamp,
          section: section.charAt(0).toUpperCase() + section.slice(1),
          settingName: key,
          oldValue: oldStr,
          newValue: newStr,
          actor,
          notes: `Updated ${key} in ${section} section`
        });
      }
    }

    // Apply updates
    this.settings[section] = {
      ...currentSection,
      ...updates
    };

    // If any fee rule changed, sync immediately to the double-entry finance ledger
    if (section === 'commission') {
      try {
        this.syncFeesToLedger();
      } catch (err) {
        // Invalid fee values must never reach money movement: roll the section back and re-throw.
        this.settings[section] = currentSection;
        this.syncFeesToLedger();
        throw err;
      }
    }

    return JSON.parse(JSON.stringify(this.settings[section]));
  }

  // Reset a section or all settings back to default
  public resetToDefaults(section?: keyof SiteSettingsState, actor: string = 'Super Admin'): SiteSettingsState {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (section) {
      this.settings[section] = JSON.parse(JSON.stringify(DEFAULT_SITE_SETTINGS[section]));
      this.history.unshift({
        id: `SET-HIST-${Date.now()}`,
        timestamp,
        section: section.charAt(0).toUpperCase() + section.slice(1),
        settingName: 'Reset Section',
        oldValue: 'Custom Values',
        newValue: 'Factory Defaults',
        actor,
        notes: `Reset ${section} section to default configuration`
      });

      if (section === 'commission') {
        this.syncFeesToLedger();
      }
    } else {
      this.settings = JSON.parse(JSON.stringify(DEFAULT_SITE_SETTINGS));
      this.history.unshift({
        id: `SET-HIST-${Date.now()}`,
        timestamp,
        section: 'All Settings',
        settingName: 'Factory Reset',
        oldValue: 'Custom Values',
        newValue: 'Factory Defaults',
        actor,
        notes: 'Reset all 9 settings sections back to platform factory defaults'
      });
      financeLedger.setPlatformCommissionRate(DEFAULT_SITE_SETTINGS.commission.commissionPercent);
    }

    return this.getSettings();
  }
}

// Global Singleton Instance
export const siteSettings = new SiteSettingsService();
