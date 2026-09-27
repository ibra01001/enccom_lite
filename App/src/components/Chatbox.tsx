import { useState, useRef, useEffect, useCallback, type FC, type KeyboardEvent } from 'react';
import { useSocket } from '../context/SocketContext';
import Rooms from './Rooms';
import { useMls } from '../context/MlsContext';
import MlsDebugger from './MlsDebugger';
import { getCachedMessages } from '../utils/indexedDb';
import VideoCall from './call/call';
import CallRingOverlay from './call/CallRingOverlay';
import { startRingtone, stopRingtone } from '../webrtc/ringtone';
import {
  emitCallRing,
  emitCallRingCancel,
  emitCallRingAccept,
  emitCallRingDecline,
  type CallIncomingPayload,
  type CallRingEndPayload,
  type CallRingFailedPayload,
} from '../webrtc/signaling';
import '../styles/features.css';

import type {
  Message,
  HistoryPayload,
  JoinErrorPayload,
} from '../types/chat';

interface RoomMeta {
  owner?: string;
  isOwner?: boolean;
  activePeers?: string[];
  epoch?: number;
}

/** idle -> ringing-out -> in-call, with ringing-in reachable from idle. */
type CallPhase = 'idle' | 'ringing-out' | 'ringing-in' | 'in-call';

interface IncomingRing {
  from: string;
  name: string;
}

const RING_TIMEOUT_S = 35;

const Chatbox: FC = () => {
  const [currentRoom, setCurrentRoom] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || 'public';
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showDebugger, setShowDebugger] = useState<boolean>(true);
  const [roomMeta, setRoomMeta] = useState<RoomMeta>({});
  const [callPhase, setCallPhase] = useState<CallPhase>('idle');
  const [incomingRing, setIncomingRing] = useState<IncomingRing | null>(null);
  const [declinedPeers, setDeclinedPeers] = useState<string[]>([]);
  const [ringSecondsLeft, setRingSecondsLeft] = useState<number>(RING_TIMEOUT_S);
  const [callMinimized, setCallMinimized] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeContainerRef = useRef<HTMLDivElement>(null);
  const nextId = useRef<number>(1);
  const clientMsgId = useRef<number>(0);
  // Read inside socket listeners that must stay subscribed across phase changes
  const callPhaseRef = useRef<CallPhase>('idle');
  const ringDeadlineRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const { socket, myId } = useSocket();
  const {
    hasGroup,
    encryptMessage,
    decryptMessage,
    requestWelcome,
    restoreGroupAsOwner,
    recreateGroupAsOwner,
    isInitialized,
  } = useMls();

  const isPrivateRoom = currentRoom !== 'public';
  const isGroupActive = hasGroup(currentRoom);
  const isInCall = callPhase === 'in-call';
  const isRinging = callPhase === 'ringing-in' || callPhase === 'ringing-out';
  const otherMemberCount = (roomMeta.activePeers || []).filter((p) => p !== myId).length;

  const clearRingTimers = useCallback(() => {
    if (ringDeadlineRef.current !== null) {
      window.clearTimeout(ringDeadlineRef.current);
      ringDeadlineRef.current = null;
    }
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const abortRing = useCallback(() => {
    clearRingTimers();
    stopRingtone();
  }, [clearRingTimers]);

  // Keep the ref in sync so long-lived socket listeners can read the live phase
  useEffect(() => {
    callPhaseRef.current = callPhase;
  }, [callPhase]);

  // Pre-load locally cached plaintext messages from IndexedDB on room enter or refresh
  useEffect(() => {
    // End any active call and reset call state when switching rooms
    abortRing();
    setCallPhase('idle');
    setIncomingRing(null);
    setDeclinedPeers([]);
    setCallMinimized(false);

    let cancelled = false;
    getCachedMessages(currentRoom).then((cached) => {
      if (!cancelled && cached && cached.length > 0) {
        setMessages((prev) => {
          if (prev.length === 0) {
            return cached.map((c) => ({
              id: nextId.current++,
              senderId: c.senderId,
              text: c.text,
              ciphertext: c.ciphertext,
              room: c.roomId,
            }));
          }
          return prev;
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentRoom, abortRing]);

  // Stop the ringtone if the component unmounts mid-ring
  useEffect(() => abortRing, [abortRing]);

  // When joining or refreshing into a private room without an active group, request welcome from peers
  useEffect(() => {
    if (!isPrivateRoom || isGroupActive || !socket || !isInitialized) return;

    requestWelcome(currentRoom);

    const interval = setInterval(() => {
      if (!hasGroup(currentRoom)) {
        requestWelcome(currentRoom);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [isPrivateRoom, isGroupActive, socket, isInitialized, currentRoom, requestWelcome, hasGroup]);

  useEffect(() => {
    if (!socket) return;

    // Emit join_room for current active room
    const joinCurrentRoom = () => {
      socket.emit('join_room', { room: currentRoom });
    };

    // Join room immediately on mount / room change
    joinCurrentRoom();

    // Also re-join room if socket reconnects automatically
    socket.on('connect', joinCurrentRoom);

    const handleHistory = (data: HistoryPayload) => {
      // Handle both object payload { room, history } and legacy array
      const historyMsgs = Array.isArray(data) ? data : data?.history || [];
      const targetRoom = Array.isArray(data) ? 'public' : data?.room || 'public';

      if (targetRoom === currentRoom && historyMsgs.length >= 0) {
        const formatted: Message[] = historyMsgs.map((msg) => {
          let displayText = msg.text;
          if (msg.ciphertext) {
            const decrypted = decryptMessage(targetRoom, msg.ciphertext);
            displayText = decrypted || '[Encrypted Message]';
          }
          return {
            ...msg,
            text: displayText ?? '',
            id: msg.id || nextId.current++,
          };
        });
        setMessages(formatted);
      }
    };

    const handleMessage = (msg: Message) => {
      // Ignore messages meant for other rooms
      if (msg.room && msg.room !== currentRoom) return;

      const isOwn = Boolean(myId && msg.senderId === myId);

      // If this client sent the message, reconcile our pending optimistic message
      if (isOwn) {
        setMessages((prev) => {
          const hasPending = prev.some(
            (m) => m.pending && m.clientMsgId === msg.clientMsgId
          );
          if (hasPending) {
            return prev.map((m) =>
              m.pending && m.clientMsgId === msg.clientMsgId
                ? { ...m, ...msg, text: m.text || msg.text, pending: false }
                : m
            );
          }
          return [...prev, { ...msg, text: msg.text || '', id: nextId.current++ }];
        });
        return;
      }

      // Message from ANOTHER client — decrypt if it contains ciphertext
      let displayText = msg.text;
      if (msg.ciphertext) {
        const decrypted = decryptMessage(msg.room || currentRoom, msg.ciphertext);
        displayText = decrypted || '[Unable to decrypt]';
      }

      // System message or other client's message
      const newMsg: Message = {
        ...msg,
        text: displayText ?? '',
        id: nextId.current++,
      };
      setMessages((prev) => [...prev, newMsg]);
    };

    const handleJoinError = (data: JoinErrorPayload) => {
      // The invite link points to a deleted or non-existent room
      setJoinError(data?.message || 'Room not found.');
      setCurrentRoom('public');
      socket.emit('join_room', { room: 'public' });
    };

    const handleInitialHistory = (data: HistoryPayload) => {
      // After successfully joining a private room via link, refresh the sidebar
      const targetRoom = Array.isArray(data) ? 'public' : data?.room || 'public';
      if (targetRoom !== 'public') {
        socket.emit('get_my_rooms');
      }
      handleHistory(data);
    };

    interface RoomJoinedPayload {
      room: string;
      name: string;
      owner: string;
      isOwner: boolean;
      activePeers: string[];
      mls_enabled: boolean;
      epoch: number;
    }

    const handleRoomJoined = (data: RoomJoinedPayload) => {
      if (data?.room === currentRoom) {
        setRoomMeta({
          owner: data.owner,
          isOwner: data.isOwner,
          activePeers: data.activePeers,
          epoch: data.epoch,
        });

        // 3-stage owner recovery on refresh:
        // B → restore from IndexedDB (preserves epoch)
        // A → request a welcome from an active member (if peers online)
        // Last resort → recreate from scratch only when alone in the room
        if (data.mls_enabled && !hasGroup(data.room) && data.isOwner) {
          restoreGroupAsOwner(data.room).then((result) => {
            if (result === 'failed') {
              if (data.activePeers && data.activePeers.length > 1) {
                // Option A: at least one other peer is online — ask them to re-invite us
                console.log('[MLS Recovery] Option A — requesting welcome from active peer...');
                requestWelcome(data.room);
              } else {
                // Last resort: no peers online, no saved state — bootstrap a fresh group
                console.log('[MLS Recovery] Last resort — re-initializing empty group as owner...');
                recreateGroupAsOwner(data.room);
              }
            }
          });
        }
      }
    };

    const handlePeerJoinedRoom = (data: { peerId: string; room: string }) => {
      if (data?.room === currentRoom && data?.peerId) {
        setRoomMeta((prev) => {
          const peers = prev.activePeers || [];
          if (!peers.includes(data.peerId)) {
            return { ...prev, activePeers: [...peers, data.peerId] };
          }
          return prev;
        });
      }
    };

    const handlePeerLeftRoom = (data: { peerId: string; room: string }) => {
      if (data?.room === currentRoom && data?.peerId) {
        setRoomMeta((prev) => ({
          ...prev,
          activePeers: (prev.activePeers || []).filter((p) => p !== data.peerId),
        }));
      }
    };

    socket.on('initial history', handleInitialHistory);
    socket.on('chat message', handleMessage);
    socket.on('join_error', handleJoinError);
    socket.on('room_joined', handleRoomJoined);
    socket.on('peer_joined', handlePeerJoinedRoom);
    socket.on('peer_left', handlePeerLeftRoom);

    return () => {
      socket.off('connect', joinCurrentRoom);
      socket.off('initial history', handleInitialHistory);
      socket.off('chat message', handleMessage);
      socket.off('join_error', handleJoinError);
      socket.off('room_joined', handleRoomJoined);
      socket.off('peer_joined', handlePeerJoinedRoom);
      socket.off('peer_left', handlePeerLeftRoom);
    };
  }, [socket, currentRoom, decryptMessage, myId, hasGroup, restoreGroupAsOwner, requestWelcome, recreateGroupAsOwner]);

  // ============================================================
  // Group Ring — ring every member of the room before anyone joins
  // ============================================================
  const startRingCountdown = useCallback(
    (onExpire: () => void) => {
      clearRingTimers();
      setRingSecondsLeft(RING_TIMEOUT_S);
      ringDeadlineRef.current = window.setTimeout(() => {
        // Tear the tick down before handing off, or it runs forever
        clearRingTimers();
        setRingSecondsLeft(RING_TIMEOUT_S);
        onExpire();
      }, RING_TIMEOUT_S * 1000);
      tickRef.current = window.setInterval(() => {
        setRingSecondsLeft((s) => (s > 0 ? s - 1 : 0));
      }, 1000);
    },
    [clearRingTimers]
  );

  const handleStartRing = useCallback(() => {
    if (!socket || callPhaseRef.current !== 'idle') return;

    setDeclinedPeers([]);
    setCallPhase('ringing-out');
    emitCallRing(socket, currentRoom);
    startRingtone('outgoing');
    startRingCountdown(() => {
      if (callPhaseRef.current === 'ringing-out') {
        emitCallRingCancel(socket, currentRoom);
        setCallPhase('idle');
      }
    });
  }, [socket, currentRoom, startRingCountdown]);

  const handleAcceptRing = useCallback(() => {
    if (!socket) return;
    abortRing();
    setIncomingRing(null);
    setCallMinimized(false);
    setCallPhase('in-call');
    emitCallRingAccept(socket, currentRoom);
  }, [socket, currentRoom, abortRing]);

  const handleDeclineRing = useCallback(() => {
    if (!socket) return;
    abortRing();
    setIncomingRing(null);
    setCallPhase('idle');
    emitCallRingDecline(socket, currentRoom);
  }, [socket, currentRoom, abortRing]);

  const handleCancelRing = useCallback(() => {
    if (!socket) return;
    abortRing();
    setCallPhase('idle');
    setDeclinedPeers([]);
    setRingSecondsLeft(RING_TIMEOUT_S);
    emitCallRingCancel(socket, currentRoom);
  }, [socket, currentRoom, abortRing]);

  const handleLeaveCall = useCallback(() => {
    abortRing();
    setCallPhase('idle');
    setIncomingRing(null);
  }, [abortRing]);

  useEffect(() => {
    if (!socket) return;

    const endOutgoingRing = () => {
      clearRingTimers();
      stopRingtone();
      setCallPhase((p) => (p === 'ringing-out' || p === 'ringing-in' ? 'idle' : p));
      setIncomingRing(null);
      setRingSecondsLeft(RING_TIMEOUT_S);
    };

    const handleIncoming = (data: CallIncomingPayload) => {
      if (!data?.from || data.from === myId) return;
      // Only surface rings for the room currently open on this client
      if (data.room !== currentRoom) return;
      // Already busy in a call — let it go rather than stack overlays
      if (callPhaseRef.current === 'in-call' || callPhaseRef.current === 'ringing-in') return;

      setIncomingRing({ from: data.from, name: data.name || currentRoom });
      setCallPhase('ringing-in');
      startRingtone('incoming');
      startRingCountdown(() => {
        if (callPhaseRef.current === 'ringing-in') {
          emitCallRingDecline(socket, currentRoom);
          setCallPhase('idle');
          setIncomingRing(null);
        }
      });
    };

    const handleRingFailed = (data: CallRingFailedPayload) => {
      if (data?.room && data.room !== currentRoom) return;
      clearRingTimers();
      stopRingtone();
      setCallPhase('idle');
      setDeclinedPeers([]);
      setJoinError(data?.message || 'Could not start the group call.');
    };

    const handleRingDeclined = (data: CallRingEndPayload) => {
      if (data?.from === myId) return;
      if (data?.room !== currentRoom) return;
      if (callPhaseRef.current !== 'ringing-out') return;
      setDeclinedPeers((prev) => (prev.includes(data.from) ? prev : [...prev, data.from]));
    };

    const handleRingCancelled = (data: CallRingEndPayload) => {
      if (data?.from === myId) return;
      if (data?.room !== currentRoom) return;
      endOutgoingRing();
    };

    const handleRingAnswered = (data: CallRingEndPayload) => {
      if (data?.room !== currentRoom) return;
      // I accepted: the accept handler already moved me into the call
      if (data?.from === myId) return;
      const phase = callPhaseRef.current;
      if (phase !== 'ringing-out' && phase !== 'ringing-in') return;

      clearRingTimers();
      stopRingtone();
      setIncomingRing(null);

      if (phase === 'ringing-out') {
        // I started this ring and someone picked up — join them
        setCallMinimized(false);
        setCallPhase('in-call');
      } else {
        // Another member answered first — the ring is over for me, I stay out
        setCallPhase('idle');
      }
    };

    socket.on('call_incoming', handleIncoming);
    socket.on('call_ring_failed', handleRingFailed);
    socket.on('call_ring_declined', handleRingDeclined);
    socket.on('call_ring_cancelled', handleRingCancelled);
    socket.on('call_ring_answered', handleRingAnswered);

    return () => {
      socket.off('call_incoming', handleIncoming);
      socket.off('call_ring_failed', handleRingFailed);
      socket.off('call_ring_declined', handleRingDeclined);
      socket.off('call_ring_cancelled', handleRingCancelled);
      socket.off('call_ring_answered', handleRingAnswered);
    };
  }, [socket, myId, currentRoom, clearRingTimers, startRingCountdown]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const msgClientId = clientMsgId.current++;
    const localId = nextId.current++;

    if (isPrivateRoom) {
      if (!isGroupActive) {
        setJoinError("You are not a member of this MLS group or encryption is still initializing.");
        return;
      }

      const ciphertext = encryptMessage(currentRoom, trimmed);
      if (!ciphertext) {
        setJoinError("Failed to encrypt message with OpenMLS.");
        return;
      }

      // Optimistic message in UI
      setMessages((prev) => [
        ...prev,
        {
          id: localId,
          clientMsgId: msgClientId,
          senderId: myId,
          text: trimmed,
          ciphertext,
          room: currentRoom,
          pending: true,
        },
      ]);

      // Emit encrypted payload to server
      if (socket) {
        socket.emit('chat message', {
          ciphertext,
          clientMsgId: msgClientId,
          room: currentRoom,
        });
      }
    } else {
      // Public room: unencrypted message
      setMessages((prev) => [
        ...prev,
        {
          id: localId,
          clientMsgId: msgClientId,
          senderId: myId,
          text: trimmed,
          room: currentRoom,
          pending: true,
        },
      ]);

      if (socket) {
        socket.emit('chat message', {
          text: trimmed,
          clientMsgId: msgClientId,
          room: currentRoom,
        });
      }
    }

    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSend();
  };

  const isEmpty = !input.trim();

  // Swipe-to-open/close sidebar on mobile — keeps existing GSAP animation via isOpen prop
  const onTouchStart = (e: React.TouchEvent) => {
    if (window.innerWidth >= 768) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (window.innerWidth >= 768 || !touchStartRef.current) return;
    const start = touchStartRef.current;
    const end = e.changedTouches[0];
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    // only horizontal swipes
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.2) {
      touchStartRef.current = null;
      return;
    }
    if (!sidebarOpen && start.x < 36 && dx > 60) {
      setSidebarOpen(true);
    } else if (sidebarOpen && dx < -60) {
      setSidebarOpen(false);
    }
    touchStartRef.current = null;
  };

  return (
    <div
      ref={swipeContainerRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="ob-root w-full h-full flex flex-row overflow-hidden flex-1 bg-[#272727] touch-pan-y"
    >
      {/* Floating Join Error Alert */}
      {joinError && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded bg-[#1e0e0e] border border-[#ff3535] border-l-4 text-white shadow-2xl flex items-center gap-3 animate-in fade-in duration-150">
          <span className="material-symbols-outlined text-[#ff3535] text-[20px]">warning</span>
          <span className="text-xs font-semibold">{joinError}</span>
          <button
            type="button"
            onClick={() => setJoinError(null)}
            className="ml-3 text-zinc-400 hover:text-white p-1 cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {/* Rooms Sidebar */}
      <Rooms
        currentRoom={currentRoom}
        onSelectRoom={(id) => { setCurrentRoom(id); setSidebarOpen(false); }}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Chat Workspace */}
      <div className="flex-1 h-full flex flex-col min-w-0 bg-[#272727] relative">
        {/* Chat Header */}
        <header className="h-16 shrink-0 flex items-center justify-between px-6 bg-[#181818] border-b border-[#333333] select-none">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-white font-mono font-bold text-lg">#</span>
              <h6 className="text-white font-bold text-base font-['Hanken_Grotesk',sans-serif] m-0 truncate tracking-tight">
                {currentRoom === 'public' ? 'Public Chat' : currentRoom}
              </h6>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* User Identity Chip */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1  text-zinc-300 ob-mono text-xs">
              <span className="text-zinc-500">ID ::</span>
              <span className="font-bold text-white">#{myId ?? '...'}</span>
            </div>

            {/* MLS Inspector Toggle Button (Only in Private E2EE Rooms) */}
            {isPrivateRoom && (
              <button
                type="button"
                onClick={() => setShowDebugger((v) => !v)}
                className={`text-xs px-3 py-1.5  flex items-center gap-2 cursor-pointer transition-all ${showDebugger
                  ? 'text-white shadow-sm'
                  : 'text-zinc-300  hover:text-white '
                  }`}
                title="Toggle MLS Cryptographic Inspector Panel"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="em" height="1.5em" viewBox="0 0 24 24">
                  <path d="M0 0h24v24H0z" fill="none" />
                  <path fill="currentColor" d="M18 4h2v2h2v12h-2v2h-2v2H6v-2H4v-2H2V6h2V4h2V2h12zm-7 13h2v-6h-2zm0-8h2V7h-2z" />
                </svg>



              </button>
            )}

            {/* Enccom Telecom Carrier Call Toggle Button (Private Rooms Only) */}
            {isPrivateRoom && (
              !isRinging ? (
                <button
                  type="button"
                  onClick={handleStartRing}
                  disabled={isInCall}
                  className="group px-3 py-1.5   text-zinc-200 hover:text-white  flex items-center gap-1.5 font-['JetBrains_Mono',monospace] text-xs font-bold uppercase tracking-wider cursor-pointer transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Ring Every Member In This Room"
                >
                  <span className="material-symbols-outlined text-[16px] text-[#ff3535] group-hover:text-white transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
                      <path d="M0 0h24v24H0z" fill="none" />
                      <path fill="currentColor" d="M20 17V7h2v10zm-2-2V9h2v6zM2 7h2v10H2zm14 0h2v10h-2zM4 5h12v2H4zm0 12h12v2H4z" />
                    </svg>

                  </span>

                </button>
              ) : (
                <div className="flex items-center gap-1.5 font-['JetBrains_Mono',monospace]">
                  <span
                    className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#ff3535] border border-[#ff3535] bg-[#2e1616]"
                    title={
                      callPhase === 'ringing-in'
                        ? `Incoming call from #${incomingRing?.from ?? '...'}`
                        : `Ringing ${otherMemberCount} member${otherMemberCount === 1 ? '' : 's'}`
                    }
                  >
                    <span className="material-symbols-outlined text-[16px] ob-pulse">notifications_active</span>
                    {callPhase === 'ringing-in' ? 'Incoming' : 'Ringing'}
                  </span>
                </div>
              )
            )}
            {isPrivateRoom && isInCall && (
              <div className="flex items-center gap-1.5 font-['JetBrains_Mono',monospace]">
                <button
                  type="button"
                  onClick={() => setCallMinimized((v) => !v)}
                  className={`px-3 py-1.5 rounded flex items-center gap-1.5 text-xs font-bold cursor-pointer uppercase tracking-wider transition-all ${callMinimized
                    ? 'text-[#10b981]'
                    : 'text-zinc-300 hover:text-white'
                    }`}
                  title={callMinimized ? 'Expand Video Stage' : 'Minimize to Header'}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {callMinimized ? 'sensors' : 'keyboard_arrow_down'}
                  </span>

                </button>
              </div>
            )}
          </div>
        </header>

        {/* Incoming Ring — takes over the screen like a Discord group call */}
        {isPrivateRoom && callPhase === 'ringing-in' && incomingRing && (
          <CallRingOverlay
            mode="incoming"
            peerId={incomingRing.from}
            roomName={incomingRing.name}
            secondsLeft={ringSecondsLeft}
            onAccept={handleAcceptRing}
            onDecline={handleDeclineRing}
          />
        )}

        {/* Outgoing Ring — replaces the chat stream until someone picks up */}
        {isPrivateRoom && isInCall && !callMinimized ? (
          <div className="flex-1 min-h-0 overflow-hidden relative">
            <VideoCall
              roomId={currentRoom}
              isPrivateRoom={isPrivateRoom}
              myId={myId}
              onClose={handleLeaveCall}
            />
          </div>
        ) : isPrivateRoom && callPhase === 'ringing-out' ? (
          <div className="flex-1 min-h-0 overflow-hidden relative">
            <CallRingOverlay
              mode="outgoing"
              peerId={myId ?? '??'}
              roomName={currentRoom === 'public' ? 'Public Chat' : currentRoom}
              memberCount={otherMemberCount + (myId ? 1 : 0)}
              declinedPeers={declinedPeers}
              secondsLeft={ringSecondsLeft}
              onDecline={handleCancelRing}
            />
          </div>
        ) : (
          <>
            {/* Messages Stream Container */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-4 bg-[#202020] ob-grid-bg relative text-left"
            >


              {messages.map((msg) => {
                const isOwn = msg.senderId === myId;
                return (
                  <div
                    key={msg.id}
                    className="flex flex-col gap-1 w-full hover:bg-[#252525]/40 px-3 py-1.5 -mx-3 rounded transition-colors group"
                    style={{ opacity: msg.pending ? 0.6 : 1 }}
                  >
                    {/* Meta Header */}
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs ob-mono font-bold ${isOwn ? 'text-[#ff3535]' : 'text-zinc-300'
                          }`}
                      >
                        #{msg.senderId}
                      </span>
                      {isOwn && (
                        <span className="text-[10px] ob-mono text-zinc-500 font-medium">
                          (you)
                        </span>
                      )}

                      {msg.pending && (
                        <span className="text-[10px] text-zinc-500 ob-mono flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-ping" />
                          sending...
                        </span>
                      )}
                    </div>

                    {/* Message Body */}
                    <p className="text-white text-sm leading-relaxed break-words m-0 font-sans whitespace-pre-wrap">
                      {msg.text}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Input Bar Section */}
            <footer className="shrink-0 flex flex-col gap-2 px-6 py-4 bg-[#181818] border-t border-[#333333]">
              <div className="flex items-center gap-3 bg-[#222222] border border-[#333333] focus-within:border-[#ff3535] rounded p-1.5 transition-colors shadow-inner">
                <span className="material-symbols-outlined text-zinc-400 pl-2 text-[18px]">
                  {isPrivateRoom ? <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
                    <path d="M0 0h24v24H0z" fill="none" />
                    <path fill="currentColor" d="M11 18H3v-2h8zm12-3h-2v3h-4v-2h2v-3h2v-2H11V8h2v1h10zM3 16H1V8h2zm14 0h-2v-1h-2v1h-2v-3h6zm-8-2H5v-4h4zm2-6H3V6h8z" />
                  </svg>
                    : <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
                      <path d="M0 0h24v24H0z" fill="none" />
                      <path fill="currentColor" d="M5 2h6v2H5zm10 0h4v2h-4zM5 10h6v2H5zm10 0h4v2h-4zm4-6h2v6h-2zm-8 0h2v6h-2zM3 4h2v6H3zM0 18h2v4H0zm14 0h2v4h-2zm8 0h2v4h-2zM4 14h8v2H4zm12 0h4v2h-4zM2 16h2v2H2zm10 0h2v2h-2zm8 0h2v2h-2z" />
                    </svg>
                  }
                </span>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isPrivateRoom && !isGroupActive
                      ? "Connecting to MLS group session..."
                      : isPrivateRoom
                        ? "Type encrypted message (OpenMLS)..."
                        : "Type public message..."
                  }
                  aria-label="Message"
                  className="flex-1 text-sm text-white placeholder-zinc-500 outline-none bg-transparent min-w-0 font-sans"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={isEmpty || (isPrivateRoom && !isGroupActive)}
                  className="ob-btn-accent text-xs font-bold uppercase tracking-wider py-2 px-4 shrink-0 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >

                  <svg xmlns="http://www.w3.org/2000/svg" width="2em" height="2em" viewBox="0 0 24 24">
                    <path d="M0 0h24v24H0z" fill="none" />
                    <path fill="currentColor" d="M4 19h4v2H2v-8h2zm8 0H8v-2h4zm4-2h-4v-2h4zm4-2h-4v-2h4zm-10-2H4v-2h6zm12 0h-2v-2h2zM8 5H4v6H2V3h6zm12 6h-4V9h4zm-4-2h-4V7h4zm-4-2H8V5h4z" />
                  </svg>

                </button>
              </div>

              {/* Micro Telemetry Bar */}
              <div className="flex items-center justify-between px-1 text-[10px] ob-mono text-zinc-500">
                <div className="flex items-center gap-2 truncate">
                  <span>CIPHER: MLS_128_Ed25519_ChaCha20</span>
                  <span className="hidden sm:inline">•</span>
                  <span className="hidden sm:inline">RFC 9420 TREEKEM</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${!isPrivateRoom
                      ? 'bg-zinc-500'
                      : isGroupActive
                        ? 'bg-[#10b981]'
                        : 'bg-[#f59e0b]'
                      }`}
                  />
                  <span>
                    {!isPrivateRoom
                      ? 'PLAINTEXT'
                      : isGroupActive
                        ? 'RATCHET SYNCED'
                        : 'AWAITING KEYPACKAGE'}
                  </span>
                </div>
              </div>
            </footer>
          </>
        )}
      </div>

      {/* MLS Debugger Inspector Side Panel (Only in Private Rooms) */}
      {isPrivateRoom && showDebugger && (
        <MlsDebugger
          currentRoom={currentRoom}
          isOwner={roomMeta.isOwner}
          activePeers={roomMeta.activePeers}
          onClose={() => setShowDebugger(false)}
        />
      )}
    </div>
  );
};

export default Chatbox;
