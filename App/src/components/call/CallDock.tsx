import React from 'react';
import type { CallLayoutMode } from './callTypes';

interface Props {
  isMicMuted: boolean; isVideoOn: boolean; isScreenSharing: boolean; isDeafened: boolean;
  layoutMode: CallLayoutMode; showReactions: boolean;
  onToggleMic: () => void; onToggleCam: () => void; onToggleShare: () => void; onToggleDeafen: () => void;
  onToggleLayout: () => void;
  onToggleReactions: () => void; onReaction: (e: string) => void;
  onToggleSettings: () => void;
  onClose?: () => void;
}

// unified square buttons - same size everywhere (sharp like HowItWorksSteps)
const base = 'h-9 w-9 min-[375px]:h-10 min-[375px]:w-10 sm:h-10 sm:w-10 rounded-none border transition-all cursor-pointer flex items-center justify-center font-mono shrink-0';
const idle = 'bg-[#202020] text-zinc-200 border-white/10 hover:border-zinc-400';
const activeRed = 'bg-[#2e1616] text-[#ff3535] border-[#ff3535]';
const activeGreen = 'bg-[#10b981]/15 text-[#10b981] border-[#10b981]';

export const CallDock = React.forwardRef<HTMLElement, Props>(({
  isMicMuted, isVideoOn, isScreenSharing, isDeafened, layoutMode, showReactions,
  onToggleMic, onToggleCam, onToggleShare, onToggleDeafen, onToggleLayout, onToggleReactions, onReaction, onToggleSettings, onClose,
}, ref) => (
  <footer
    ref={ref}
    className="
      absolute z-30 flex items-center bg-[#1a1a1a] border-white/10 shadow-2xl
      /* FULL WIDTH on all screens - sharp like HowItWorksSteps */
      bottom-0 left-0 right-0 rounded-none border-t
      px-2 sm:px-6
      pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]
      gap-1.5 sm:gap-2 justify-center
      flex-nowrap overflow-hidden
      sm:py-3
    "
  >
    <button type="button" onClick={onToggleMic} className={`${base} ${isMicMuted ? activeRed : idle}`} title={isMicMuted ? 'Unmute' : 'Mute'}>
      <span className="material-symbols-outlined text-[20px] leading-none">{isMicMuted ? 'mic_off' : 'mic'}</span>
    </button>
    <button type="button" onClick={onToggleCam} className={`${base} ${isVideoOn ? activeGreen : idle}`} title={isVideoOn ? 'Turn Off Camera' : 'Turn On Camera'}>
      <span className="material-symbols-outlined text-[20px] leading-none">{isVideoOn ? 'videocam' : 'videocam_off'}</span>
    </button>
    <button type="button" onClick={onToggleShare} className={`${base} ${isScreenSharing ? 'bg-[#ff3535] text-white border-[#ff3535]' : idle}`} title={isScreenSharing ? 'Stop Share' : 'Share Screen'}>
      <span className="material-symbols-outlined text-[20px] leading-none">{isScreenSharing ? 'stop_screen_share' : 'screen_share'}</span>
    </button>
    <button type="button" onClick={onToggleDeafen} className={`${base} ${isDeafened ? activeRed : idle}`} title={isDeafened ? 'Undeafen' : 'Deafen'}>
      <span className="material-symbols-outlined text-[20px] leading-none">{isDeafened ? 'headset_off' : 'headphones'}</span>
    </button>

    <button type="button" onClick={onToggleLayout} className={`${base} ${idle}`} title={layoutMode === 'grid' ? 'Focus view' : 'Grid view'}>
      <span className="material-symbols-outlined text-[20px] leading-none">{layoutMode === 'grid' ? 'view_carousel' : 'grid_view'}</span>
    </button>

    <button type="button" onClick={onToggleSettings} className={`${base} ${idle}`} title="Hardware & Voice Settings">
      <span className="material-symbols-outlined text-[20px] leading-none">settings</span>
    </button>

    <div className="relative shrink-0">
      <button type="button" onClick={onToggleReactions} className={`${base} ${idle}`} title="Reaction">
        <span className="material-symbols-outlined text-[20px] leading-none">add_reaction</span>
      </button>
      {showReactions && (
        <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-[#1a1a1a] border border-white/10 p-1.5 flex gap-1 shadow-2xl">
          {['🔥', '⚡', '🔒', '🛡️', '❤️', '👏', '🚀'].map(e => <button key={e} type="button" onClick={() => onReaction(e)} className="w-9 h-9 hover:bg-[#272727] text-lg hover:scale-110 transition-transform cursor-pointer border border-transparent hover:border-white/10">{e}</button>)}
        </div>
      )}
    </div>

    <div className="hidden sm:block w-px h-6 bg-white/10 mx-2 shrink-0" />

    <button type="button" onClick={onClose} className="h-9 w-9 min-[375px]:h-10 min-[375px]:w-10 sm:h-10 sm:w-10 rounded-none bg-[#ff3535] hover:bg-[#ff5252] text-white flex items-center justify-center border border-[#ff3535] shrink-0 cursor-pointer" title="Disconnect">
      <span className="material-symbols-outlined text-[20px] leading-none">call_end</span>
    </button>
  </footer>
));
