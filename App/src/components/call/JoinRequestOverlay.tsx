import React from 'react';
import type { RoomJoinRequestPayload } from '../../types/chat';

interface JoinRequestOverlayProps {
  request: RoomJoinRequestPayload;
  onAccept: (req: RoomJoinRequestPayload) => void;
  onDecline: (req: RoomJoinRequestPayload) => void;
}

export const JoinRequestOverlay: React.FC<JoinRequestOverlayProps> = ({
  request,
  onAccept,
  onDecline,
}) => {
  const initials = request.requesterId.slice(0, 2).toUpperCase() || '??';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Room join request"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200 select-none"
    >
      <div className="relative w-full max-w-md bg-[#1a1a1a] border border-white/10 shadow-2xl p-6 sm:p-8 flex flex-col items-center text-center">
        {/* Subtle corner tech accents */}
        <span className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-[#10b981]" />
        <span className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-[#10b981]" />
        <span className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-[#10b981]" />
        <span className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-[#10b981]" />

        {/* Status tag */}
        <div className="flex items-center gap-2 mb-6">
          <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-300">
            Knock Request
          </span>
        </div>

        {/* Avatar badge */}
        <div className="relative flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28 mb-5">
          <div className="absolute inset-0 rounded-full border border-[#10b981]/30 animate-ping opacity-30" />
          <div className="relative w-20 h-20 rounded-full flex items-center justify-center bg-[#10b981]/10 border border-[#10b981]/60">
            <span className="font-mono text-2xl font-bold tracking-widest text-[#10b981]">
              {initials}
            </span>
          </div>
        </div>

        {/* Information text */}
        <div className="space-y-1.5 mb-8">
          <h3 className="text-white font-bold text-lg sm:text-xl font-['Hanken_Grotesk',sans-serif] tracking-tight">
            User <span className="text-[#10b981] font-mono">#{request.requesterId}</span>
          </h3>
          <p className="text-zinc-400 text-xs sm:text-sm">
            Requests permission to join <span className="text-white font-semibold">"{request.roomName || request.room}"</span>
          </p>
          <div className="pt-2">
            <span className="inline-block px-2.5 py-1 bg-white/[0.04] border border-white/10 font-mono text-[10px] text-zinc-400 uppercase tracking-widest">
              Private E2EE Channel
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 w-full">
          <button
            type="button"
            onClick={() => onDecline(request)}
            className="flex-1 py-3 px-4 bg-transparent border border-white/10 text-zinc-300 hover:text-[#FF3535] hover:border-[#FF3535]/50 hover:bg-[#FF3535]/5 text-xs font-mono font-bold uppercase tracking-widest transition-all cursor-pointer"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => onAccept(request)}
            className="flex-1 py-3 px-4 bg-[#10b981] hover:bg-[#059669] text-white text-xs font-mono font-bold uppercase tracking-widest shadow-lg shadow-[#10b981]/20 transition-all cursor-pointer"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};

export default JoinRequestOverlay;
