import { Order, UserAccount, Gig, Project } from '../../types';

export type WorkstreamFilter = 
  | 'all' 
  | 'inbox' 
  | 'discussion' 
  | 'in_progress' 
  | 'delivered'
  | 'completed' 
  | 'starred' 
  | 'escrow' 
  | 'archived';

export type WorkstreamSubTab = 'activity' | 'files' | 'milestones' | 'invoices';

export interface WorkstreamMessage {
  id: string;
  orderId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  text: string;
  timestamp: string;
  type?: 'message' | 'system' | 'file' | 'proposal' | 'deliverable' | 'milestone';
  fileInfo?: {
    name: string;
    size: string;
    url: string;
    type?: string;
  };
  metadata?: {
    amount?: number;
    milestoneTitle?: string;
    action?: string;
  };
}

export interface WorkstreamItem extends Order {
  seller?: UserAccount;
  buyer?: UserAccount;
  gig?: Gig;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount?: number;
}

export interface SharedFileItem {
  id: string;
  name: string;
  size: string;
  url: string;
  uploadedAt: string;
  uploadedBy: string;
  uploaderAvatar?: string;
  type?: string;
}
