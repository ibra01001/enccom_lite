import React, { useState } from 'react';
import type { CallParticipant } from './callTypes';

export type TileDensity = 'large' | 'medium' | 'small' | 'tiny';

interface Props {
  participant: CallParticipant;
  density?: TileDensity;
  isSpotlight?: boolean;
  isThumbnail?: boolean;
  onSpotlight: () => void;
  onVolumeClick: (id: string) => void;
  onKick: (id: string) => void;
  localVideoRef?: React.RefObject<HTMLVideoElement | null>;
}

const avatarSize: Record<TileDensity, string> = {
  large: 'w-14 h-14 text-lg',
  medium: 'w-12 h-12 text-base',
  small: 'w-10 h-10 text-xs',
  tiny: 'w-8 h-8 text-[10px]',
};

export const ParticipantTile = React.memo<Props>(({
  participant, density = 'medium', isSpotlight, isThumbnail,
  onSpotlight, onVolumeClick, onKick, localVideoRef,
}) => {
  const [hover, setHover] = useState(false);
  const [tapMenu, setTapMenu] = useState(false);

  const remoteVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = React.useRef<HTMLAudioElement | null>(null);

  // Bind remote stream to audio/video elements
  React.useEffect(() => {
    if (!participant.isLocal && participant.stream) {
      if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== participant.stream) {
        remoteVideoRef.current.srcObject = participant.stream;
      }
      if (remoteAudioRef.current && remoteAudioRef.current.srcObject !== participant.stream) {
        remoteAudioRef.current.srcObject = participant.stream;
      }
    }
  }, [participant.isLocal, participant.stream, participant.isVideoOn]);

  // Handle participant volume and deafen states
  React.useEffect(() => {
    if (!participant.isLocal) {
      const vol = Math.max(0, Math.min(2, (participant.volume ?? 100) / 100));
      const muted = Boolean(participant.isDeafened);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.volume = Math.min(1, vol);
        remoteVideoRef.current.muted = muted;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.volume = Math.min(1, vol);
        remoteAudioRef.current.muted = muted;
      }
    }
  }, [participant.isLocal, participant.volume, participant.isDeafened]);

  const speaking = participant.isSpeaking && !participant.isMuted;
  const effective: TileDensity = isSpotlight ? 'large' : isThumbnail ? 'tiny' : density;
  const compact = effective === 'small' || effective === 'tiny';
  const tiny = effective === 'tiny';
  const showActions = (hover && !isThumbnail) || (tapMenu && !isThumbnail);

  const border = speaking
    ? 'border-2 border-[#10b981] shadow-[0_0_18px_rgba(16,185,129,0.22)]'
    : 'border border-[#333333] hover:border-zinc-500';

  const handleClick = () => {
    if (isThumbnail) return;
    if (compact || 'ontouchstart' in window) setTapMenu(v => !v);
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={handleClick}
      style={{ containerType: 'inline-size' } as React.CSSProperties}
      className={`relative w-full h-full bg-[#181818] overflow-hidden flex items-center justify-center transition-all duration-200 ${border} ${!isThumbnail ? 'cursor-pointer' : ''}`}
    >
      {participant.isVideoOn ? (
        <div className="w-full h-full bg-[#121212] relative">
          {participant.isLocal ? (
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
          ) : (
            <div className="w-full h-full relative">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              {!participant.stream && (
                <div className="absolute inset-0 bg-gradient-to-br from-[#1c1c1c] to-[#242424] flex items-center justify-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className={`${avatarSize[effective]} border border-[#333333] bg-[#272727] flex items-center justify-center shadow-lg font-mono font-bold text-white`}>
                      {participant.name.slice(0, 2).toUpperCase()}
                    </div>
                    {!tiny && <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest hidden sm:inline">CONNECTING // STREAM</span>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#181818] p-2 sm:p-3">
          {/* Background audio playback for voice when video is off */}
          {!participant.isLocal && <audio ref={remoteAudioRef} autoPlay playsInline />}
          <div className={`border bg-[#202020] flex items-center justify-center font-mono font-bold text-white shadow-xl shrink-0 ${avatarSize[effective]} ${isSpotlight && !tiny && !compact ? 'sm:w-24 sm:h-24 sm:text-2xl w-20 h-20 text-xl' : ''} ${speaking ? 'border-[#10b981]' : 'border-[#333333]'}`}>
            {participant.name.slice(0, 2).toUpperCase()}
          </div>
          {!tiny && !isThumbnail && (
            <div className={`mt-2 flex flex-col items-center gap-0.5 ${compact ? 'hidden sm:flex' : ''}`}>
              <span className="font-mono text-[9px] text-[#ff3535] font-bold uppercase tracking-widest truncate max-w-[14ch]">{participant.role || 'PEER_NODE'}</span>
              {!compact && <span className="font-mono text-[10px] text-zinc-500 uppercase">{speaking ? 'TRANSMITTING VOICE' : 'CARRIER STANDBY'}</span>}
            </div>
          )}
        </div>
      )}

      {showActions && (
        <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1 bg-[#181818]/90 border border-[#333333] p-1 backdrop-blur-sm">
          <button type="button" onClick={e => { e.stopPropagation(); setTapMenu(false); onSpotlight(); }} className="p-1 hover:bg-[#272727] text-zinc-300 hover:text-white cursor-pointer" title="Focus">
            <span className="material-symbols-outlined text-[15px]">pin_invoke</span>
          </button>
          {!participant.isLocal && (
            <>
              <button type="button" onClick={e => { e.stopPropagation(); onVolumeClick(participant.id); setTapMenu(false); }} className="p-1 hover:bg-[#272727] text-zinc-300 hover:text-white cursor-pointer" title="Gain">
                <span className="material-symbols-outlined text-[15px]">volume_up</span>
              </button>
              <button type="button" onClick={e => { e.stopPropagation(); onKick(participant.id); }} className="p-1 hover:bg-[#2e1616] text-zinc-300 hover:text-[#ff3535] cursor-pointer" title="Remove">
                <span className="material-symbols-outlined text-[15px]">person_remove</span>
              </button>
            </>
          )}
          <button type="button" onClick={e => { e.stopPropagation(); setTapMenu(false); setHover(false); }} className="sm:hidden p-1 hover:bg-[#272727] text-zinc-400 cursor-pointer">
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      {compact && !isThumbnail && !showActions && (
        <button type="button" onClick={e => { e.stopPropagation(); setTapMenu(true); }} className="absolute top-1.5 right-1.5 z-10 w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/5 sm:hidden">
          <span className="material-symbols-outlined text-[14px]">more_vert</span>
        </button>
      )}

      <div className={`absolute left-1 right-1 sm:left-2 sm:right-2 z-10 flex items-center justify-between gap-1 pointer-events-none ${tiny ? 'bottom-1' : 'bottom-1.5 sm:bottom-2'}`}>
        <div className="flex items-center gap-1 min-w-0 flex-1 px-1.5 sm:px-2 py-1 pointer-events-auto overflow-hidden">
          <span className={`font-mono font-bold text-white truncate min-w-0 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)] ${tiny ? 'text-[10px]' : 'text-[11px] sm:text-xs'}`}>{participant.name.trim()}</span>
          {participant.role && !tiny && <span className={`font-mono text-[#ff3535] font-bold uppercase shrink-0 hidden sm:inline drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)] ${compact ? 'text-[8px]' : 'text-[9px]'}`}>{participant.role}</span>}
        </div>
        <div className={`flex items-center gap-1 px-1.5 py-1 pointer-events-auto shrink-0 ${tiny ? 'hidden' : 'flex'}`}>
          {participant.isMuted && <span className="material-symbols-outlined text-[#ff3535] text-[14px] drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">mic_off</span>}
          {participant.isDeafened && <span className="material-symbols-outlined text-[#ff3535] text-[14px] drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">headset_off</span>}
          <div className={`flex items-end gap-0.5 h-3 pl-0.5 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)] ${compact ? 'hidden sm:flex' : 'flex'}`} title={`Signal ${participant.signalStrength}`}>
            <span className="w-0.5 h-1.5 bg-[#10b981]" />
            <span className={`w-0.5 h-2.5 ${participant.signalStrength! >= 2 ? 'bg-[#10b981]' : 'bg-[#333333]'}`} />
            <span className={`w-0.5 h-3.5 hidden sm:inline-block ${participant.signalStrength === 3 ? 'bg-[#10b981]' : 'bg-[#333333]'}`} />
          </div>
          {speaking && <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse hidden sm:inline-block drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]" />}
        </div>
        {tiny && participant.isMuted && (
          <span className="w-5 h-5 flex items-center justify-center shrink-0 pointer-events-auto drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
            <span className="material-symbols-outlined text-[#ff3535] text-[12px]">mic_off</span>
          </span>
        )}
      </div>
    </div>
  );
});
