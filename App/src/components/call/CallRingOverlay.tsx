import React from 'react';
import '../../styles/features.css';

type RingMode = 'incoming' | 'outgoing';

interface Props {
  mode: RingMode;
  /** Caller id when incoming, the ringing member's own id when outgoing. */
  peerId: string;
  roomName: string;
  /** Other members targeted by the ring (outgoing only). */
  memberCount?: number;
  /** Ids that already dismissed the ring (outgoing only). */
  declinedPeers?: string[];
  secondsLeft?: number;
  onAccept?: () => void;
  onDecline?: () => void;
}

const RingAvatar: React.FC<{ peerId: string; accent: string }> = ({ peerId, accent }) => {
  const initials = peerId.slice(0, 2).toUpperCase() || '??';
  return (
    <div className="relative flex items-center justify-center w-40 h-40 sm:w-48 sm:h-48 shrink-0">
      {/* Expanding signal waves */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className="absolute inset-0 rounded-full border-2 ob-ring-wave"
          style={{ borderColor: accent, animationDelay: `${i * 0.7}s` }}
        />
      ))}
      <div
        className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center border-2 ob-ring-sweep"
        style={{ backgroundColor: `${accent}1a`, borderColor: accent }}
      >
        <span
          className="ob-mono text-3xl sm:text-4xl font-bold tracking-widest"
          style={{ color: accent }}
        >
          {initials}
        </span>
      </div>
    </div>
  );
};

const RingStatus: React.FC<{ incoming: boolean }> = ({ incoming }) => (
  <div className="flex items-center gap-2">
    <span
      className="w-2 h-2 rounded-full ob-pulse"
      style={{ backgroundColor: incoming ? '#10b981' : '#ff3535' }}
    />
    <span className="ob-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-300">
      {incoming ? 'Incoming Call' : 'Ringing'}
    </span>
  </div>
);

const RingActions: React.FC<{
  incoming: boolean;
  secondsLeft?: number;
  onAccept?: () => void;
  onDecline?: () => void;
}> = ({ incoming, secondsLeft, onAccept, onDecline }) => (
  <div className="flex items-center gap-10 sm:gap-14">
    <button
      type="button"
      className="ob-ring-action ob-ring-action-decline"
      onClick={onDecline}
      title={incoming ? 'Decline' : 'Cancel call'}
    >
      <span>
        <span className="material-symbols-outlined text-[26px] leading-none">call_end</span>
      </span>
      <span>{incoming ? 'Decline' : 'Cancel'}</span>
    </button>

    {incoming && (
      <button
        type="button"
        className="ob-ring-action ob-ring-action-accept"
        onClick={onAccept}
        title={secondsLeft !== undefined ? `Accept (${secondsLeft}s)` : 'Accept'}
      >
        <span>
          <span className="material-symbols-outlined text-[26px] leading-none">call</span>
        </span>
        <span>Accept</span>
      </button>
    )}
  </div>
);

const RingFooter: React.FC<{ incoming: boolean; roomName: string; secondsLeft?: number }> = ({
  incoming,
  roomName,
  secondsLeft,
}) => (
  <p className="ob-mono text-[11px] text-zinc-500 uppercase tracking-wider text-center">
    {roomName}
    {!incoming && secondsLeft !== undefined && (
      <span className="text-zinc-600"> · no answer in {secondsLeft}s</span>
    )}
  </p>
);

export const CallRingOverlay: React.FC<Props> = ({
  mode,
  peerId,
  roomName,
  memberCount = 0,
  declinedPeers = [],
  secondsLeft,
  onAccept,
  onDecline,
}) => {
  const incoming = mode === 'incoming';
  const accent = incoming ? '#10b981' : '#ff3535';
  const others = Math.max(0, memberCount - declinedPeers.length);

  const headline = incoming ? `#${peerId} is calling you` : `Ringing #${peerId}`;
  const subline = incoming
    ? 'Encrypted group stream request'
    : others > 0
      ? `Notifying ${others} member${others === 1 ? '' : 's'} in this room`
      : 'Waiting for someone in this room to pick up';

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={incoming ? 'Incoming group call' : 'Outgoing group call'}
      className={
        incoming
          ? 'fixed inset-0 z-[60] bg-[#181818]'
          : 'absolute inset-0 z-10 bg-[#181818]'
      }
    >
      <div className="w-full h-full flex flex-col items-center justify-center gap-8 px-6 py-10 ob-grid-bg text-center select-none">
        <RingStatus incoming={incoming} />

        <RingAvatar peerId={peerId} accent={accent} />

        <div className="flex flex-col items-center gap-2">
          <h2 className="text-white font-bold text-2xl sm:text-3xl tracking-tight m-0 break-all">
            {headline}
          </h2>
          <p className="text-zinc-400 text-sm sm:text-base m-0">{subline}</p>
          {!incoming && declinedPeers.length > 0 && (
            <p className="ob-mono text-[11px] text-zinc-500 uppercase tracking-wider m-0">
              Declined: {declinedPeers.map((p) => `#${p}`).join(', ')}
            </p>
          )}
        </div>

        <RingActions
          incoming={incoming}
          secondsLeft={secondsLeft}
          onAccept={onAccept}
          onDecline={onDecline}
        />

        <RingFooter incoming={incoming} roomName={roomName} secondsLeft={secondsLeft} />
      </div>
    </div>
  );
};

export default CallRingOverlay;
