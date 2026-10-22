import React from 'react';
import type { CallParticipant, FloatingReaction } from './callTypes';
import { ParticipantTile, type TileDensity } from './ParticipantTile';

interface GridProps {
  participants: CallParticipant[];
  columns: number; gap: number; dockH: number; tileDensity: TileDensity;
  totalPages: number; currentPage: number; visibleCount: number; tileW: number;
  onSpotlight: (id: string) => void; onVolume: (id: string) => void; onKick: (id: string) => void;
  onPage: (n: number) => void;
}

export const CallGrid: React.FC<GridProps> = ({
  participants, columns, gap, dockH, tileDensity, totalPages, currentPage, visibleCount, tileW,
  onSpotlight, onVolume, onKick, onPage,
}) => (
  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 sm:p-3 md:p-4 flex flex-col items-center scrollbar-thin">
    <div className="w-full grid auto-rows-fr content-start" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px`, maxWidth: participants.length <= 2 ? '960px' : participants.length <= 4 ? '1100px' : '100%', paddingBottom: `${dockH}px` }}>
      {participants.map(p => (
        <div key={p.id} className="w-full aspect-video overflow-hidden rounded">
          <ParticipantTile participant={p} density={tileDensity} onSpotlight={() => onSpotlight(p.id)} onVolumeClick={onVolume} onKick={onKick} />
        </div>
      ))}
    </div>
    {totalPages > 1 && (
      <div className="shrink-0 mt-3 flex items-center gap-2 bg-[#181818] border border-[#333333] rounded-full px-2 py-1.5 shadow-xl">
        <button type="button" onClick={() => onPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0} className="w-8 h-8 rounded-full bg-[#202020] hover:bg-[#2a2a2a] disabled:opacity-30 border border-[#333333] flex items-center justify-center text-zinc-200 cursor-pointer">
          <span className="material-symbols-outlined text-[18px]">chevron_left</span>
        </button>
        <span className="font-mono text-xs font-bold text-white px-2 tabular-nums">{currentPage + 1} / {totalPages}<span className="hidden sm:inline text-zinc-400 font-normal"> · {participants.length} NODES</span></span>
        <span className="hidden sm:inline w-px h-4 bg-[#333333]" /><span className="hidden sm:inline font-mono text-[10px] text-zinc-500 uppercase">+{participants.length - visibleCount} MORE</span>
        <button type="button" onClick={() => onPage(Math.min(totalPages - 1, currentPage + 1))} disabled={currentPage === totalPages - 1} className="w-8 h-8 rounded-full bg-[#202020] hover:bg-[#2a2a2a] disabled:opacity-30 border border-[#333333] flex items-center justify-center text-zinc-200 cursor-pointer">
          <span className="material-symbols-outlined text-[18px]">chevron_right</span>
        </button>
      </div>
    )}
    {totalPages === 1 && participants.length > 6 && (
      <div className="shrink-0 mt-3 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">{participants.length} NODES · {columns}×{Math.ceil(participants.length / columns)} GRID · {tileW}×{Math.round(tileW / 1.777)} TILE</div>
    )}
  </div>
);

interface SpotlightProps {
  participants: CallParticipant[]; spotlight: CallParticipant;
  spotlightId: string | null; isScreenSharing: boolean;
  screenRef: React.RefObject<HTMLVideoElement | null>;
  screenStreamRef: React.RefObject<MediaStream | null>;
  onSpotlight: (id: string) => void; onVolume: (id: string) => void; onKick: (id: string) => void;
}

export const CallSpotlight: React.FC<SpotlightProps> = ({
  participants, spotlight, spotlightId, isScreenSharing, screenRef, screenStreamRef, onSpotlight, onVolume, onKick,
}) => {
  const others = participants.filter(p => spotlightId !== 'local-screenshare' && p.id !== spotlightId);
  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-2 sm:gap-3 p-2 sm:p-3 md:p-4 overflow-hidden">
      <div className="flex-1 min-h-0 min-w-0 flex items-center justify-center bg-[#181818] rounded border border-[#333333] overflow-hidden shadow-2xl">
        {spotlightId === 'local-screenshare' ? (
          <div className="w-full h-full flex items-center justify-center bg-[#121212] relative">
            <div className="absolute top-2 sm:top-4 left-2 sm:left-4 z-10 flex items-center gap-2 px-2 sm:px-3 py-1 rounded bg-[#ff3535] text-white font-mono font-bold text-[10px] sm:text-xs uppercase shadow-lg">
              <span className="w-2 h-2 rounded-full bg-white animate-ping hidden sm:inline-block" />BROADCASTING DISPLAY<span className="hidden sm:inline">// 1080P60</span>
            </div>
            <video ref={screenRef} autoPlay playsInline muted className="w-full h-full object-contain" />
            {!screenStreamRef.current && (
              <div className="flex flex-col items-center text-center p-6 sm:p-8 gap-3">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded bg-[#202020] border border-[#ff3535] flex items-center justify-center text-[#ff3535] shadow-xl">
                  <span className="material-symbols-outlined text-2xl sm:text-3xl">screen_share</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-xs font-bold text-[#ff3535] uppercase tracking-widest">01 // STREAM_ACTIVE</span>
                  <h4 className="text-base sm:text-xl font-bold text-white">Display Stream Transmitting</h4>
                  <p className="font-mono text-xs text-zinc-400 max-w-md">Encrypted WebRTC transport at 60 fps.</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <ParticipantTile participant={spotlight} density="large" isSpotlight onSpotlight={() => {}} onVolumeClick={onVolume} onKick={onKick} />
        )}
      </div>

      {/* Mobile horizontal */}
      <div className="md:hidden shrink-0 h-[112px] sm:h-[132px] flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1">
        {others.map(p => {
          const active = p.id === spotlightId;
          return (
            <button key={p.id} type="button" onClick={() => onSpotlight(p.id)} className={`h-full aspect-video w-[160px] sm:w-[190px] shrink-0 snap-start rounded overflow-hidden border-2 cursor-pointer ${active ? 'border-[#ff3535] shadow-lg' : 'border-transparent hover:border-zinc-500'}`}>
              <ParticipantTile participant={p} density="tiny" isThumbnail onSpotlight={() => onSpotlight(p.id)} onVolumeClick={onVolume} onKick={onKick} />
            </button>
          );
        })}
      </div>
      {/* Desktop vertical */}
      <div className="hidden md:flex w-[200px] lg:w-[240px] xl:w-[264px] shrink-0 flex-col gap-2.5 overflow-y-auto pr-1.5">
        {others.map(p => {
          const active = p.id === spotlightId;
          return (
            <button key={p.id} type="button" onClick={() => onSpotlight(p.id)} className={`w-full aspect-video shrink-0 rounded overflow-hidden border-2 text-left cursor-pointer ${active ? 'border-[#ff3535] shadow-lg' : 'border-transparent hover:border-zinc-600'}`}>
              <ParticipantTile participant={p} density="small" isThumbnail onSpotlight={() => onSpotlight(p.id)} onVolumeClick={onVolume} onKick={onKick} />
            </button>
          );
        })}
        {isScreenSharing && spotlightId !== 'local-screenshare' && (
          <button type="button" onClick={() => onSpotlight('local-screenshare')} className="w-full aspect-video shrink-0 rounded overflow-hidden border-2 border-transparent hover:border-zinc-600 text-left">
            <div className="w-full h-full bg-[#121212] flex items-center justify-center text-[#ff3535] font-mono text-xs">SCREEN</div>
          </button>
        )}
      </div>
    </div>
  );
};

export const ReactionsOverlay: React.FC<{ reactions: FloatingReaction[] }> = ({ reactions }) => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden z-30">
    {reactions.map(r => (
      <div key={r.id} className="absolute bottom-24 flex flex-col items-center animate-reaction-rise pointer-events-none" style={{ left: `${r.x}%` }}>
        <span className="text-3xl drop-shadow-md select-none">{r.emoji}</span>
        <span className="font-mono text-[9px] font-bold bg-[#181818] border border-[#333333] px-1.5 py-0.5 rounded text-zinc-200 mt-1 uppercase">{r.senderName}</span>
      </div>
    ))}
  </div>
);
