import { OrderFeeBreakdown } from './shared/fees';

export interface GigExtra {
  id: string;
  title: string;
  price: number;
}

export interface Review {
  id: string;
  reviewerId?: string;
  targetUserId?: string;
  orderId?: string;
  reviewerName?: string;
  reviewerAvatar?: string;
  buyerName?: string;
  userName?: string;
  avatar?: string;
  userAvatar?: string;
  rating: number;
  comment?: string;
  review?: string;
  timeAgo?: string;
  createdAt?: string;
  gigTitle?: string;
  orderTitle?: string;
  gigId?: string;
  projectId?: string;
}

export interface Gig {
  id: string;
  freelancerId: string;
  freelancerName: string;
  freelancerUsername?: string;
  freelancerAvatar: string;
  freelancerLevel?: string;
  title: string;
  slug?: string;
  category: string;
  subcategory?: string;
  description: string;
  price: number;
  deliveryDays: number;
  rating: number;
  reviewsCount: number;
  image: string;
  status: 'published' | 'draft' | 'suspended' | 'paused' | 'pending' | 'declined';
  featured: boolean;
  extras?: GigExtra[];
  moderationStatus?: 'approved' | 'flagged' | 'rejected' | 'pending';
  moderationNotes?: string;
}

export interface Project {
  id: string;
  buyerId: string;
  buyerName: string;
  buyerAvatar: string;
  title: string;
  slug?: string;
  category: string;
  subcategory?: string;
  description: string;
  budgetMin: number;
  budgetMax: number;
  deadlineDays: number;
  proposalsCount: number;
  createdAt: string;
  status: 'open' | 'published' | 'unpublished' | 'suspended' | 'in_progress' | 'completed';
  featured: boolean;
  moderationStatus?: 'approved' | 'flagged' | 'rejected' | 'pending';
  moderationNotes?: string;
  projectType?: 'fixed' | 'hourly';
  skills?: string[];
  experienceLevel?: 'entry' | 'intermediate' | 'expert';
  location?: string;
  countryFlag?: string;
  isUrgent?: boolean;
  verifiedBuyer?: boolean;
  buyerSpent?: string;
  buyerRating?: number;
  buyerReviewsCount?: number;
  buyerMemberSince?: string;
  buyerProjectsPosted?: number;
  attachments?: Array<{ name: string; size: string; url?: string }>;
  clarificationQuestions?: Array<{
    id: string;
    authorName: string;
    authorAvatar: string;
    question: string;
    createdAt: string;
    answer?: string;
    answeredAt?: string;
  }>;
}

export interface Proposal {
  id: string;
  projectId: string;
  freelancerId: string;
  freelancerName: string;
  freelancerAvatar: string;
  freelancerTitle: string;
  coverLetter: string;
  bidAmount: number;
  deliveryDays: number;
  createdAt: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface Order {
  id: string;
  title: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  status: 'funded_in_escrow' | 'in_progress' | 'delivered' | 'completed' | 'disputed' | 'revision' | 'cancelled';
  createdAt: string;
  dueDate: string;
  requirements?: string;
  deliverables?: string;
  deliverableFiles?: Array<{ id: string; name: string; url: string; size: string; uploadedAt: string }>;
  revisions?: Array<{ id: string; requestedAt: string; reason: string; status: string }>;
  adminNotes?: string;
  isMuted?: boolean;
  escrowProtectionStartDate?: string;
  escrowProtectionEndDate?: string;
  gigId?: string;
  projectId?: string;
  serviceUrl?: string;
  gigSlug?: string;
  sellerUsername?: string;
  buyerUsername?: string;
  serviceTitle?: string;
  serviceThumbnail?: string;
  isTimerPaused?: boolean;
  feeBreakdown?: OrderFeeBreakdown;
  deliveryHistory?: Array<{
    version: number;
    notes: string;
    files: Array<{ id: string; name: string; size: string; url: string; uploadedAt?: string }>;
    deliveredAt: string;
  }>;
  deliveryNotes?: string;
  acceptedVersion?: number;
  reviewWindowDays?: number;
  reviewWindowExpiresAt?: string;
  review?: Review;
}

export interface UserAccount {
  id: string;
  name: string;
  username?: string;
  email: string;
  mobile?: string;
  role: string;
  avatar: string;
  title: string;
  rating: number;
  reviewsCount: number;
  hourlyRate: number;
  earned: number;
  completedJobs: number;
  bio: string;
  skills: string[];
  status: 'active' | 'suspended' | 'restricted';
  verified: boolean;
  emailVerified?: boolean;
  mobileVerified?: boolean;
  sessionVersion?: number;
  isFlagged?: boolean;
  flagReason?: string;
  walletBalance: number;
  createdAt: string;
  isAvailableNow?: boolean;
  location?: string;
  countryFlag?: string;
  responseTime?: string;
  category?: string;
  subcategory?: string;
  languages?: string[];
  certifications?: string[];
  knownDevices?: string[];
}

export type User = UserAccount;

export interface Dispute {
  id: string;
  orderId: string;
  raisedBy: string;
  reason: string;
  evidence: string;
  status: 'open' | 'under_investigation' | 'resolved_refund' | 'resolved_release' | 'resolved_partial';
  createdAt: string;
  resolutionNotes?: string;
  assignedTo?: string;
}

export interface Refund {
  id: string;
  orderId: string;
  buyerId: string;
  amount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface Payout {
  id: string;
  freelancerId: string;
  amount: number;
  method: string;
  status: 'pending' | 'approved' | 'processed' | 'failed' | 'cancelled' | 'reversed';
  createdAt: string;
  accountDetails: string;
}

export interface PaymentMethodItem {
  id: string;
  userId: string;
  type: 'card' | 'bank' | 'paypal' | 'upi';
  name: string;
  details: {
    last4?: string;
    brand?: string;
    expiry?: string;
    bankName?: string;
    accountNumberMasked?: string;
    routingNumber?: string;
    email?: string;
    upiId?: string;
  };
  isDefault: boolean;
  createdAt: string;
}

export interface InvoiceItem {
  id: string;
  invoiceNumber: string;
  userId: string;
  type?: 'sent' | 'received';
  recipientName: string;
  recipientEmail: string;
  issuerName?: string;
  issuerEmail?: string;
  title: string;
  issueDate: string;
  dueDate: string;
  status: 'paid' | 'in_escrow' | 'unpaid' | 'refunded';
  items: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
  subtotal: number;
  serviceFee?: number;      // client service fee charged on top of the subtotal
  smallOrderFee?: number;   // flat fee for orders under the small-order threshold
  platformFee: number;      // platform commission taken from the freelancer
  tax: number;
  total: number;            // what the client paid (subtotal + client fees)
  notes?: string;
  relatedOrderId?: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  order: number;
  subcategories: { id: string; name: string; slug: string; enabled: boolean }[];
}

export interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  subject: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  createdAt: string;
  messages: { sender: string; text: string; timestamp: string }[];
}

export interface AuditLog {
  id: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  details: string;
  timestamp: string;
}

export interface Message {
  id: string;
  orderId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  type?: 'message' | 'system' | 'file' | 'deliverable';
  fileInfo?: { name: string; size: string; url: string; type?: string; category?: string };
  metadata?: {
    amount?: number;
    action?: string;
    milestoneTitle?: string;
    version?: number;
    notes?: string;
    reason?: string;
    rating?: number;
    comment?: string;
    revisionId?: string;
    deliveryVersion?: number;
    requirementText?: string;
    clientMessageId?: string;
  };
  status?: 'sending' | 'sent' | 'failed';
}

export interface UserEmail {
  id: string;
  userId: string;
  userEmail: string;
  subject: string;
  body: string;
  type: 'SUSPEND' | 'RESTRICT' | 'IMPERSONATE' | 'GENERAL';
  sentAt: string;
  read: boolean;
}

export interface AppNotification {
  id: string;
  userId: string;
  type: 'general' | 'missed_call';
  title: string;
  message: string;
  targetWorkstreamId?: string;
  senderUsername?: string;
  projectTitle?: string;
  read: boolean;
  createdAt: string;
}

