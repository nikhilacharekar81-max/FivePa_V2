import React, { useState, useRef } from 'react';
import { Send, Paperclip, Sparkles, FileCode, CheckCircle2 } from 'lucide-react';
import { uploadWorkstreamFile } from '../../utils/workstreamUpload';

interface WorkstreamMessageInputProps {
  onSendMessage: (text: string) => void;
  onAttachFile: (file: { name: string; size: string; url: string }) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const WorkstreamMessageInput: React.FC<WorkstreamMessageInputProps> = ({
  onSendMessage,
  onAttachFile,
  disabled = false,
  placeholder = "Type your message, send a proposal, or discuss project milestones..."
}) => {
  const [text, setText] = useState('');
  const [isAttaching, setIsAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSendMessage(text.trim());
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      handleSubmit(e);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await uploadWorkstreamFile(file);
      onAttachFile(result);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const insertQuickText = (quickText: string) => {
    setText(prev => prev ? `${prev} ${quickText}` : quickText);
  };

  return (
    <div className="p-4 sm:p-5 bg-white border-t border-slate-100">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-fiverr-dark placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition resize-none leading-relaxed"
        />

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 text-slate-500 hover:text-fiverr-dark hover:bg-slate-100 rounded-xl transition flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
              title="Attach File or Deliverable"
            >
              <Paperclip className="w-4 h-4" />
              <span className="hidden sm:inline text-[11px]">Attach File</span>
            </button>

            <button
              type="button"
              onClick={() => insertQuickText("Here is an update on current milestone progress:")}
              className="px-2.5 py-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition text-[11px] font-medium hidden md:inline-flex items-center gap-1"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span>Milestone Update</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 hidden sm:inline font-mono">
              ⌘ + Enter to send
            </span>
            <button
              type="submit"
              disabled={!text.trim() || disabled}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-xs transition cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send Message</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
