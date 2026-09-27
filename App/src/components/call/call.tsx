import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { CallParticipant, CallLayoutMode, FloatingReaction } from './callTypes';
import { useAdaptiveCallLayout, useIsMobile } from './useAdaptiveCallLayout';
import { CallGrid, CallSpotlight, ReactionsOverlay } from './CallStage';
import { CallDock } from './CallDock';
import { VolumeModal } from './CallModals';
import type { TileDensity } from './ParticipantTile';
import { useSocket } from '../../context/SocketContext';
import { useWebRTC } from '../../webrtc/peerConnection';

interface Props {
  roomId: string;
  isPrivateRoom?: boolean;
  myId?: string | null;
  onClose?: () => void;
}

export const VideoCall: React.FC<Props> = ({ roomId, isPrivateRoom = false, myId = 'local-user', onClose }) => {
  const { socket } = useSocket();
  const [layout, setLayout] = useState<CallLayoutMode>('grid');
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [showReactions, setShowReactions] = useState(false);
  const [volumeFor, setVolumeFor] = useState<string | null>(null);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [page, setPage] = useState(0);

  const localRef = useRef<HTMLVideoElement | null>(null);
  const screenRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);
  const [dockH, setDockH] = useState(88);
  const isMobile = useIsMobile(768);

  const {
    participants,
    setParticipants,
    localStream,
    screenStream,
    isMicMuted,
    isVideoOn,
    isScreenSharing,
    isDeafened,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    toggleDeafen,
    removePeer,
  } = useWebRTC({
    roomId,
    myId,
    socket,
  });

  const screenStreamRef = useRef<MediaStream | null>(null);
  screenStreamRef.current = screenStream;

  // Bind local webcam stream to video element
  useEffect(() => {
    if (localRef.current && localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream, isVideoOn]);

  // Bind screen stream to video element
  useEffect(() => {
    if (screenRef.current && screenStream) {
      screenRef.current.srcObject = screenStream;
    }
  }, [screenStream, isScreenSharing]);

  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setDockH(Math.ceil(e[0].contentRect.height) + 20));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setPage(0), [participants.length, layout]);

  const handleToggleShare = async () => {
    await toggleScreenShare();
    if (!isScreenSharing) {
      setLayout('spotlight');
      setSpotlightId('local-screenshare');
    } else if (spotlightId === 'local-screenshare') {
      setSpotlightId(null);
    }
  };

  const triggerReaction = useCallback((emoji: string) => {
    const r: FloatingReaction = {
      id: Math.random().toString(),
      emoji,
      senderName: 'YOU',
      x: Math.floor(20 + Math.random() * 60),
    };
    setReactions((p) => [...p, r]);
    setShowReactions(false);
    setTimeout(() => setReactions((p) => p.filter((x) => x.id !== r.id)), 2800);
  }, []);

  const changeVolume = useCallback(
    (id: string, v: number) => setParticipants((p) => p.map((x) => (x.id === id ? { ...x, volume: v } : x))),
    [setParticipants]
  );

  const gap = isMobile ? 8 : 12;
  const { columns, totalPages, visibleCount, tileW } = useAdaptiveCallLayout(stageRef, participants.length, {
    gap,
    minTileW: isMobile ? 132 : 156,
    minTileH: isMobile ? 84 : 96,
    maxTileH: isMobile ? 260 : 360,
    controlDockReserve: dockH,
    currentPage: page,
  });

  const paginated = useMemo(
    () =>
      totalPages <= 1
        ? participants
        : participants.slice(page * visibleCount, page * visibleCount + visibleCount),
    [participants, page, visibleCount, totalPages]
  );

  const density: TileDensity = useMemo(
    () => (tileW >= 300 ? 'large' : tileW >= 220 ? 'medium' : tileW >= 160 ? 'small' : 'tiny'),
    [tileW]
  );

  const spotlight = useMemo(
    () =>
      spotlightId === 'local-screenshare'
        ? {
            id: 'local-screenshare',
            name: 'LOCAL SCREEN TRANSMISSION',
            isLocal: true,
            isMuted: false,
            isVideoOn: true,
            isScreenSharing: true,
            isSpeaking: false,
            volume: 100,
            signalStrength: 3 as const,
          }
        : participants.find((p) => p.id === spotlightId) || participants[0],
    [spotlightId, participants]
  );

  if (!isPrivateRoom) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#181818] p-8 text-center font-mono">
        <div className="w-16 h-16 rounded bg-[#202020] border border-[#ff3535] flex items-center justify-center text-[#ff3535] mb-4 shadow-xl">
          <span className="material-symbols-outlined text-3xl">videocam_off</span>
        </div>
        <h3 className="text-base font-bold text-white uppercase tracking-wider mb-2">RESTRICTED TRANSMISSION</h3>
        <p className="text-xs text-zinc-400 max-w-md mb-6">Encrypted streams restricted to private MLS RFC 9420 rooms.</p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-[#ff3535] text-white rounded text-xs font-bold uppercase cursor-pointer"
          >
            DISCONNECT & RETURN
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col bg-[#272727] text-[#e5e2e1] select-none overflow-hidden font-['Hanken_Grotesk',sans-serif] ob-grid-bg">
      <main ref={stageRef} className="flex-1 min-h-0 relative flex flex-col overflow-hidden bg-[#272727]">
        <ReactionsOverlay reactions={reactions} />
        {layout === 'spotlight' ? (
          <CallSpotlight
            participants={participants}
            spotlight={spotlight as CallParticipant}
            spotlightId={spotlightId}
            isScreenSharing={isScreenSharing}
            screenRef={screenRef}
            localRef={localRef}
            screenStreamRef={screenStreamRef}
            onSpotlight={setSpotlightId}
            onVolume={setVolumeFor}
            onKick={removePeer}
          />
        ) : (
          <CallGrid
            participants={paginated}
            columns={columns}
            gap={gap}
            dockH={dockH}
            tileDensity={density}
            totalPages={totalPages}
            currentPage={page}
            visibleCount={visibleCount}
            tileW={tileW}
            onSpotlight={(id) => {
              setSpotlightId(id);
              setLayout('spotlight');
            }}
            onVolume={setVolumeFor}
            onKick={removePeer}
            localRef={localRef}
            onPage={setPage}
          />
        )}
      </main>

      <VolumeModal
        id={volumeFor}
        participants={participants}
        onClose={() => setVolumeFor(null)}
        onChange={changeVolume}
      />

      <CallDock
        ref={dockRef}
        isMicMuted={isMicMuted}
        isVideoOn={isVideoOn}
        isScreenSharing={isScreenSharing}
        isDeafened={isDeafened}
        layoutMode={layout}
        showReactions={showReactions}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onToggleShare={handleToggleShare}
        onToggleDeafen={toggleDeafen}
        onToggleLayout={() => setLayout((m) => (m === 'grid' ? 'spotlight' : 'grid'))}
        onToggleReactions={() => setShowReactions((v) => !v)}
        onReaction={triggerReaction}
        onClose={onClose}
      />
    </div>
  );
};

export default VideoCall;

