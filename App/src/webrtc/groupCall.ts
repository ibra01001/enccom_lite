// Multi-user Mesh Coordinator and useGroupCall / useWebRTC React Hook
import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { CallParticipant } from '../components/call/callTypes';

import { PeerConnection } from './peerConnection';
import {
  getMediaStream,
  getDisplayStream,
  stopAllTracks,
  setTrackEnabled,
  VoiceActivityDetector,
} from './media';
import {
  setupSignalingListeners,
  emitCallJoin,
  emitCallLeave,
  emitCallOffer,
  emitCallAnswer,
  emitCallIce,
} from './signaling';

export interface UseGroupCallOptions {
  roomId: string;
  myId: string | null;
  socket: Socket | null;
}

export function useGroupCall({ roomId, myId, socket }: UseGroupCallOptions) {
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const vadRef = useRef<VoiceActivityDetector>(new VoiceActivityDetector());

  // Initialize local participant entry
  useEffect(() => {
    if (!myId) return;

    setParticipants((prev) => {
      if (prev.some((p) => p.isLocal)) return prev;
      return [
        {
          id: myId,
          name: `YOU [${myId.slice(0, 6).toUpperCase()}]`,
          isLocal: true,
          isMuted: false,
          isVideoOn: false,
          isSpeaking: false,
          volume: 100,
          signalStrength: 3,
          role: 'HOST',
          avatarColor: '#ff3535',
          stream: null,
        },
        ...prev.filter((p) => !p.isLocal),
      ];
    });
  }, [myId]);

  // Remove a peer connection from the mesh
  const removePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (peer) {
      peer.close();
      peersRef.current.delete(peerId);
    }
    remoteStreamsRef.current.delete(peerId);
    vadRef.current.detachStream(peerId);

    setParticipants((prev) => prev.filter((p) => p.id !== peerId));
  }, []);

  // Helper to create or get a 1-to-1 PeerConnection wrapper
  const getOrCreatePeer = useCallback(
    (peerId: string): PeerConnection => {
      let peer = peersRef.current.get(peerId);
      if (peer) return peer;

      peer = new PeerConnection(peerId, localStreamRef.current, {
        onIceCandidate: (candidate) => {
          if (socket) emitCallIce(socket, peerId, candidate);
        },
        onTrack: (track, stream) => {
          let remoteStream = remoteStreamsRef.current.get(peerId);
          if (!remoteStream) {
            remoteStream = new MediaStream();
            remoteStreamsRef.current.set(peerId, remoteStream);
          }
          if (!remoteStream.getTracks().includes(track)) {
            remoteStream.addTrack(track);
          }

          if (track.kind === 'audio') {
            vadRef.current.attachStream(peerId, stream);
          }

          setParticipants((prev) => {
            const exists = prev.find((p) => p.id === peerId);
            if (exists) {
              return prev.map((p) => (p.id === peerId ? { ...p, stream: remoteStream } : p));
            }
            return [
              ...prev,
              {
                id: peerId,
                name: `PEER_${peerId.slice(0, 4).toUpperCase()}`,
                isLocal: false,
                isMuted: false,
                isVideoOn: true,
                isSpeaking: false,
                volume: 100,
                signalStrength: 3,
                role: 'PEER_NODE',
                avatarColor: '#242424',
                stream: remoteStream,
              },
            ];
          });
        },
        onConnectionStateChange: (state) => {
          if (state === 'disconnected' || state === 'failed' || state === 'closed') {
            removePeer(peerId);
          }
        },
      });

      peersRef.current.set(peerId, peer);
      return peer;
    },
    [socket, removePeer]
  );

  // Poll voice activity detector for speaking indicators
  useEffect(() => {
    const stopPolling = vadRef.current.startPolling((id, level, speaking) => {
      setParticipants((prev) =>
        prev.map((p) => {
          if ((id === 'local' && p.isLocal) || p.id === id) {
            if (p.isSpeaking !== speaking || Math.abs((p.audioLevel || 0) - level) > 5) {
              return { ...p, audioLevel: level, isSpeaking: speaking && !p.isMuted };
            }
          }
          return p;
        })
      );
    });

    return () => {
      stopPolling();
    };
  }, []);

  // Main Signaling Listeners & Mesh Lifecycle
  useEffect(() => {
    if (!socket || !roomId) return;

    const unsubscribe = setupSignalingListeners(socket, {
      onUserJoined: async ({ peerId }) => {
        if (peerId === myId) return;
        const peer = getOrCreatePeer(peerId);
        try {
          const offer = await peer.createOffer();
          emitCallOffer(socket, peerId, offer);
        } catch (err) {
          console.error('[Mesh] Error creating offer for', peerId, err);
        }
      },

      onOffer: async ({ sender, sdp }) => {
        const peer = getOrCreatePeer(sender);
        try {
          const answer = await peer.handleOffer(sdp);
          emitCallAnswer(socket, sender, answer);
        } catch (err) {
          console.error('[Mesh] Error answering offer from', sender, err);
        }
      },

      onAnswer: async ({ sender, sdp }) => {
        const peer = peersRef.current.get(sender);
        if (!peer) return;
        try {
          await peer.handleAnswer(sdp);
        } catch (err) {
          console.error('[Mesh] Error setting remote description from answer:', err);
        }
      },

      onIce: async ({ sender, candidate }) => {
        const peer = peersRef.current.get(sender);
        if (peer) {
          await peer.addIceCandidate(candidate);
        }
      },

      onUserLeft: ({ peerId }) => {
        removePeer(peerId);
      },
    });

    // Capture media and announce call join
    const startCall = async () => {
      try {
        const { stream, hasVideo } = await getMediaStream(true, true);
        localStreamRef.current = stream;
        vadRef.current.attachStream('local', stream);

        setParticipants((prev) =>
          prev.map((p) => (p.isLocal ? { ...p, stream, isVideoOn: hasVideo, isMuted: false } : p))
        );
        setIsVideoOn(hasVideo);
        setIsMicMuted(false);
      } catch (err) {
        console.error('[Mesh] Media access failed:', err);
      }

      emitCallJoin(socket, roomId);
    };

    startCall();

    return () => {
      unsubscribe();
      emitCallLeave(socket, roomId);

      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      remoteStreamsRef.current.clear();

      stopAllTracks(localStreamRef.current);
      localStreamRef.current = null;
      stopAllTracks(screenStreamRef.current);
      screenStreamRef.current = null;

      vadRef.current.close();
    };
  }, [socket, roomId, myId, getOrCreatePeer, removePeer]);

  // Controls: Toggle Microphone
  const toggleMic = useCallback(() => {
    setIsMicMuted((prev) => {
      const next = !prev;
      setTrackEnabled(localStreamRef.current, 'audio', !next);
      setParticipants((list) => list.map((p) => (p.isLocal ? { ...p, isMuted: next } : p)));
      return next;
    });
  }, []);

  // Controls: Toggle Camera
  const toggleCam = useCallback(async () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      const active = !videoTrack.enabled;
      videoTrack.enabled = active;
      setIsVideoOn(active);
      setParticipants((prev) => prev.map((p) => (p.isLocal ? { ...p, isVideoOn: active } : p)));
    } else if (!isVideoOn) {
      try {
        const { stream: camStream } = await getMediaStream(true, false);
        const newTrack = camStream.getVideoTracks()[0];
        if (newTrack && localStreamRef.current) {
          localStreamRef.current.addTrack(newTrack);
          peersRef.current.forEach((peer) => {
            peer.addTrack(newTrack, localStreamRef.current!);
          });
          setIsVideoOn(true);
          setParticipants((prev) => prev.map((p) => (p.isLocal ? { ...p, isVideoOn: true } : p)));
        }
      } catch (e) {
        console.error('[Mesh] Failed to enable camera:', e);
      }
    }
  }, [isVideoOn]);

  // Controls: Toggle Screen Share
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopAllTracks(screenStreamRef.current);
      screenStreamRef.current = null;
      setIsScreenSharing(false);

      const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null;
      peersRef.current.forEach((peer) => {
        peer.replaceVideoTrack(cameraTrack);
      });
      setParticipants((prev) => prev.map((p) => (p.isLocal ? { ...p, isScreenSharing: false } : p)));
    } else {
      try {
        const displayStream = await getDisplayStream();
        screenStreamRef.current = displayStream;
        const screenTrack = displayStream.getVideoTracks()[0];

        peersRef.current.forEach((peer) => {
          peer.replaceVideoTrack(screenTrack);
        });

        setIsScreenSharing(true);
        setParticipants((prev) => prev.map((p) => (p.isLocal ? { ...p, isScreenSharing: true } : p)));

        screenTrack.onended = () => {
          toggleScreenShare();
        };
      } catch (e) {
        console.warn('[Mesh] Screen share cancelled or failed:', e);
      }
    }
  }, [isScreenSharing]);

  // Controls: Toggle Deafen
  const toggleDeafen = useCallback(() => {
    setIsDeafened((prev) => {
      const next = !prev;
      setParticipants((list) => list.map((p) => (p.isLocal ? { ...p, isDeafened: next } : p)));
      return next;
    });
  }, []);

  return {
    participants,
    setParticipants,
    localStream: localStreamRef.current,
    screenStream: screenStreamRef.current,
    isMicMuted,
    isVideoOn,
    isScreenSharing,
    isDeafened,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    toggleDeafen,
    removePeer,
  };
}

// Export both names for maximum clarity and ergonomics
export { useGroupCall as useWebRTC };
