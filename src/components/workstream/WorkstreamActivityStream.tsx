import React, { useEffect, useRef } from 'react';
import { 
  FileText, Download, ShieldCheck, Activity, CheckCircle2, 
  Clock, AlertTriangle, MessageSquare, ArrowDown, Sparkles 
} from 'lucide-react';
import { WorkstreamMessage } from './types';
import { UserAccount } from '../../types';

interface WorkstreamActivityStreamProps {
  messages: WorkstreamMessage[];
  currentUserId?: string;
  usersList?: UserAccount[];
  partnerUser?: UserAccount;
  onDownloadFile?: (fileInfo: { name: string; url: string }) => void;
}

export const WorkstreamActivityStream: React.FC<WorkstreamActivityStreamProps> = ({
  messages,
  currentUserId,
  usersList = [],
  partnerUser,
  onDownloadFile
}) => {
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const renderSystemCard = (msg: WorkstreamMessage) => {
    let icon = <Activity className="w-4 h-4 text-slate-500" />;
    let bg = 'bg-slate-100/70 border-slate-200 text-slate-600';

    const action = msg.metadata?.action;
    if (action === 'escrow_released' || msg.text.toLowerCase().includes('released') || msg.text.toLowerCase().includes('completed')) {
      icon = <Sparkles className="w-4 h-4 text-emerald-600" />;
      bg = 'bg-emerald-100/60 border-emerald-300 text-emerald-900 font-semibold';
    } else if (action === 'escrow_funded' || msg.text.toLowerCase().includes('escrow') || msg.text.toLowerCase().includes('funded')) {
      icon = <ShieldCheck className="w-4 h-4 text-emerald-600" />;
      bg = 'bg-emerald-50/70 border-emerald-200 text-emerald-800';
    } else if (action === 'deliverable_submitted' || msg.text.toLowerCase().includes('deliver') || msg.text.toLowerCase().includes('submitted')) {
      icon = <CheckCircle2 className="w-4 h-4 text-blue-600" />;
      bg = 'bg-blue-50/70 border-blue-200 text-blue-800';
    } else if (action === 'revision_requested' || msg.text.toLowerCase().includes('revision') || msg.text.toLowerCase().includes('dispute')) {
      icon = <AlertTriangle className="w-4 h-4 text-amber-600" />;
      bg = 'bg-amber-50/70 border-amber-200 text-amber-800';
    } else if (action === 'requirement_logged' || msg.text.toLowerCase().includes('requirement')) {
      icon = <FileText className="w-4 h-4 text-indigo-600" />;
      bg = 'bg-indigo-50/70 border-indigo-200 text-indigo-800';
    } else if (action === 'missed_call' || msg.text.toLowerCase().includes('missed')) {
      icon = <Clock className="w-4 h-4 text-rose-500" />;
      bg = 'bg-rose-50/70 border-rose-200 text-rose-800';
    }

    return (
      <div 
        key={msg.id} 
        className={`w-full flex items-center gap-3 py-3 px-4.5 rounded-2xl border text-xs shadow-2xs ${bg}`}
      >
        <span className="shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <span>{msg.text}</span>
          {msg.metadata?.amount && (
            <span className="ml-2 font-bold font-mono">
              (${msg.metadata.amount.toLocaleString()})
            </span>
          )}
        </div>
        <span className="text-[10px] opacity-70 font-mono shrink-0 ml-2">
          {msg.timestamp}
        </span>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-slate-50/40">
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center py-24 text-slate-400 text-xs gap-3">
          <div className="p-4 bg-white border border-slate-200 rounded-full shadow-2xs">
            <MessageSquare className="w-8 h-8 opacity-30 text-slate-500" />
          </div>
          <div className="text-center max-w-xs">
            <p className="font-bold text-fiverr-dark text-sm">No activity yet</p>
            <p className="text-slate-400 mt-1">
              Send a message, discuss milestones, or attach work deliverables to begin collaboration.
            </p>
          </div>
        </div>
      ) : (
        messages.map((msg) => {
          if (msg.type === 'system') {
            return renderSystemCard(msg);
          }

          const isMe = msg.senderId === currentUserId;
          const senderObj = usersList.find(u => u.id === msg.senderId) || (isMe ? undefined : partnerUser);
          const avatarUrl = msg.senderAvatar || senderObj?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop';
          const senderName = msg.senderName || senderObj?.name || (isMe ? 'You' : 'Partner');

          return (
            <div 
              key={msg.id} 
              className={`flex gap-3 group ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
            >
              <img
                src={avatarUrl}
                alt={senderName}
                className="w-8 h-8 rounded-full object-cover ring-2 ring-white shrink-0 shadow-2xs self-end mb-1"
              />
              <div className={`max-w-[75%] sm:max-w-[70%] space-y-1 ${isMe ? 'items-end' : 'items-start'}`}>
                <div className={`flex items-center gap-2 text-[10px] text-slate-400 px-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <span className="font-bold text-fiverr-dark">{isMe ? 'You' : senderName}</span>
                  <span className="font-mono">{msg.timestamp}</span>
                </div>

                <div 
                  className={`p-4 rounded-3xl text-xs leading-relaxed shadow-xs transition-shadow ${
                    isMe 
                      ? 'bg-slate-900 text-white rounded-br-xs' 
                      : 'bg-white text-fiverr-dark border border-slate-200/90 rounded-bl-xs'
                  }`}
                >
                  {/* ATTACHMENT CARD */}
                  {msg.type === 'file' && msg.fileInfo ? (
                    <div className="space-y-2.5">
                      {msg.text && <p className="mb-2">{msg.text}</p>}
                      <div className={`flex items-center gap-3 p-3 rounded-2xl border transition ${
                        isMe 
                          ? 'bg-white/10 border-white/20 text-white hover:bg-white/15' 
                          : 'bg-slate-50 border-slate-200 text-fiverr-dark hover:bg-slate-100/80'
                      }`}>
                        <div className={`p-2.5 rounded-xl ${isMe ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-600'}`}>
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold truncate text-xs">{msg.fileInfo.name}</div>
                          <div className={`text-[10px] mt-0.5 font-mono ${isMe ? 'text-slate-300' : 'text-slate-400'}`}>
                            {msg.fileInfo.size}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            if (onDownloadFile && msg.fileInfo) {
                              onDownloadFile(msg.fileInfo);
                            } else if (msg.fileInfo?.url && msg.fileInfo.url !== '#') {
                              const downloadUrl = msg.fileInfo.url.includes('?') ? `${msg.fileInfo.url}&download=1` : `${msg.fileInfo.url}?download=1`;
                              const link = document.createElement('a');
                              link.href = downloadUrl;
                              link.download = msg.fileInfo.name || 'download';
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                            }
                          }}
                          className={`p-2 rounded-xl transition ${
                            isMe 
                              ? 'hover:bg-white/20 text-white' 
                              : 'hover:bg-slate-200 text-slate-600'
                          }`}
                          title="Download attachment"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.text}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
      <div ref={scrollEndRef} />
    </div>
  );
};
