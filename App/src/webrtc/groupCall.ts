// Multi-user Mesh Coordinator and useGroupCall / useWebRTC React Hook
import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { CallParticipant, FloatingReaction } from '../components/call/callTypes';

import { PeerConnection } from './peerConnection';
import { CandidateBuffer } from './ice';
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
  emitCallUserState,
  emitCallReaction,
  emitCallKick,
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
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const vadRef = useRef<VoiceActivityDetector>(new VoiceActivityDetector());
  const earlyCandidateBufferRef = useRef<CandidateBuffer>(new CandidateBuffer());
  const localStreamReadyRef = useRef<Promise<void>>(Promise.resolve());

  const wasMutedBeforeDeafenRef = useRef(false);
  const isDeafenedRef = useRef(false);
  const isMicMutedRef = useRef(false);
  const isVideoOnRef = useRef(false);

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
    earlyCandidateBufferRef.current.clear(peerId);

    setParticipants((prev) => prev.filter((p) => p.id !== peerId));
  }, []);

  // Helper to create or get a 1-to-1 PeerConnection wrapper
  const getOrCreatePeer = useCallback(
    (peerId: string): PeerConnection => {
      let peer = peersRef.current.get(peerId);
      if (peer) return peer;

      peer = new PeerConnection(
        peerId,
        localStreamRef.current,
        {
          onIceCandidate: (candidate) => {
            if (socket) emitCallIce(socket, peerId, candidate);
          },
          onTrack: (track, stream) => {
            let remoteStream = remoteStreamsRef.current.get(peerId);
            if (!remoteStream) {
              remoteStream = new MediaStream();
              remoteStreamsRef.current.set(peerId, remoteStream);
            }
            // Replace existing track of same kind instead of accumulating
            const existing = remoteStream.getTracks().find((t) => t.kind === track.kind);
            if (existing && existing.id !== track.id) {
              remoteStream.removeTrack(existing);
            }
            if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
              remoteStream.addTrack(track);
            }

            if (track.kind === 'audio') {
              vadRef.current.attachStream(peerId, stream);
            }

            // Create a new stream wrapper so React state detects the track addition
            const freshStream = new MediaStream(remoteStream.getTracks());
            remoteStreamsRef.current.set(peerId, freshStream);

            const hasVideo = freshStream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live');

            setParticipants((prev) => {
              const exists = prev.find((p) => p.id === peerId);
              if (exists) {
                return prev.map((p) =>
                  p.id === peerId
                    ? {
                        ...p,
                        stream: freshStream,
                        isVideoOn: p.isVideoOn || hasVideo,
                      }
                    : p
                );
              }
              return [
                ...prev,
                {
                  id: peerId,
                  name: `PEER_${peerId.slice(0, 4).toUpperCase()}`,
                  isLocal: false,
                  isMuted: false,
                  isVideoOn: hasVideo,
                  isSpeaking: false,
                  volume: 100,
                  signalStrength: 3,
                  role: 'PEER_NODE',
                  avatarColor: '#242424',
                  stream: freshStream,
                },
              ];
            });
          },
          onConnectionStateChange: (state) => {
            if (state === 'disconnected' || state === 'failed' || state === 'closed') {
              removePeer(peerId);
            }
          },
        },
        earlyCandidateBufferRef.current
      );

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
      onUserJoined: async ({ peerId, isMuted: peerMuted, isVideoOn: peerVideo }) => {
        if (peerId === myId) return;
        // Wait for our own media so the offer actually carries our tracks
        await localStreamReadyRef.current;
        const peer = getOrCreatePeer(peerId);

        // Set initial media state from join payload
        setParticipants((prev) => {
          const exists = prev.find((p) => p.id === peerId);
          if (exists) {
            return prev.map((p) =>
              p.id === peerId
                ? { ...p, isMuted: peerMuted ?? false, isVideoOn: peerVideo ?? false }
                : p
            );
          }
          return prev;
        });

        try {
          const offer = await peer.createOffer();
          emitCallOffer(socket, peerId, offer);
        } catch (err) {
          console.error('[Mesh] Error creating offer for', peerId, err);
        }
      },

      onOffer: async ({ sender, sdp }) => {
        // Same here: answering with no local tracks would leave us transmitless
        await localStreamReadyRef.current;
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
        } else {
          earlyCandidateBufferRef.current.addCandidate(sender, candidate);
        }
      },

      onUserLeft: ({ peerId }) => {
        removePeer(peerId);
      },

      onSessionSync: async ({ participants: currentPeers }) => {
        await localStreamReadyRef.current;
        for (const peerId of currentPeers) {
          if (peerId !== myId && !peersRef.current.has(peerId)) {
            getOrCreatePeer(peerId);
          }
        }
      },

      // Receive peer media state updates (mic, cam, deafen, screen share)
      onUserState: ({ peerId, isMuted: m, isVideoOn: v, isDeafened: d, isScreenSharing: s }) => {
        setParticipants((prev) =>
          prev.map((p) => {
            if (p.id !== peerId) return p;
            const updated = { ...p };
            if (m !== undefined) updated.isMuted = m;
            if (v !== undefined) updated.isVideoOn = v;
            if (d !== undefined) updated.isDeafened = d;
            if (s !== undefined) updated.isScreenSharing = s;
            return updated;
          })
        );
      },

      // Receive floating emoji reaction from peer
      onReaction: (payload: any) => {
        const sender = payload.sender || payload.peerId || 'PEER';
        const emoji = payload.emoji;
        if (!emoji) return;

        const reaction: FloatingReaction = {
          id: `${sender}-${Date.now()}`,
          emoji,
          senderName: String(sender).slice(0, 6).toUpperCase(),
          x: Math.random() * 80 + 10,
        };
        setReactions((prev) => [...prev, reaction]);
        // Auto-remove after animation duration
        setTimeout(() => {
          setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
        }, 3000);
      },

      // Kicked from call by room owner
      onKicked: (payload: any) => {
        const target = payload.target || payload.peerId;
        if (target === myId) {
          // We've been kicked — clean up
          peersRef.current.forEach((peer) => peer.close());
          peersRef.current.clear();
          remoteStreamsRef.current.clear();
          stopAllTracks(localStreamRef.current);
          localStreamRef.current = null;
          setLocalStream(null);
          stopAllTracks(screenStreamRef.current);
          screenStreamRef.current = null;
          vadRef.current.close();
          setParticipants([]);
        }
      },
    });

    let tornDown = false;

    // Capture media and announce call join
    const startCall = async () => {
      try {
        const { stream, hasVideo } = await getMediaStream(true, true);
        if (tornDown) {
          stopAllTracks(stream);
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        vadRef.current.attachStream('local', stream);

        setParticipants((prev) =>
          prev.map((p) => (p.isLocal ? { ...p, stream, isVideoOn: hasVideo, isMuted: false } : p))
        );
        setIsVideoOn(hasVideo);
        isVideoOnRef.current = hasVideo;
        setIsMicMuted(false);
        isMicMutedRef.current = false;
      } catch (err) {
        console.error('[Mesh] Media access failed:', err);
      }
    };

    localStreamReadyRef.current = startCall().then(() => {
      // Don't announce a join for a call we already hung up on
      if (tornDown) return;
      emitCallJoin(socket, roomId, isMicMutedRef.current, isVideoOnRef.current);
    });

    return () => {
      tornDown = true;
      unsubscribe();
      emitCallLeave(socket, roomId);

      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      remoteStreamsRef.current.clear();

      stopAllTracks(localStreamRef.current);
      localStreamRef.current = null;
      setLocalStream(null);
      stopAllTracks(screenStreamRef.current);
      screenStreamRef.current = null;

      vadRef.current.close();
    };
  }, [socket, roomId, myId, getOrCreatePeer, removePeer]);

  // Controls: Toggle Microphone
  const toggleMic = useCallback(() => {
    setIsMicMuted((prev) => {
      const next = !prev;
      isMicMutedRef.current = next;
      setTrackEnabled(localStreamRef.current, 'audio', !next);
      setParticipants((list) => list.map((p) => (p.isLocal ? { ...p, isMuted: next } : p)));
      // Broadcast state to all peers
      if (socket && roomId) {
        emitCallUserState(socket, roomId, { isMuted: next });
      }
      return next;
    });
  }, [socket, roomId]);

  // Controls: Toggle Camera
  const toggleCam = useCallback(async () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      // Toggle existing video track on/off
      const active = !videoTrack.enabled;
      videoTrack.enabled = active;
      setIsVideoOn(active);
      isVideoOnRef.current = active;
      setParticipants((prev) => prev.map((p) => (p.isLocal ? { ...p, isVideoOn: active } : p)));

      // Replace track across peers so hardware pauses/resumes
      peersRef.current.forEach((peer) => {
        peer.replaceVideoTrack(active ? videoTrack : null).catch(() => {});
      });

      // Broadcast state to peers
      if (socket && roomId) {
        emitCallUserState(socket, roomId, { isVideoOn: active });
      }
    } else {
      // No video track yet — acquire camera and slot it into transceivers
      try {
        const { stream: camStream } = await getMediaStream(true, false);
        const newTrack = camStream.getVideoTracks()[0];
        if (newTrack) {
          if (!localStreamRef.current) {
            localStreamRef.current = new MediaStream([newTrack]);
          } else {
            localStreamRef.current.addTrack(newTrack);
          }
          newTrack.enabled = true;

          const freshLocal = new MediaStream(localStreamRef.current.getTracks());
          localStreamRef.current = freshLocal;
          setLocalStream(freshLocal);

          // Replace video sender on every peer
          await Promise.all(
            Array.from(peersRef.current.values()).map((peer) =>
              peer.replaceVideoTrack(newTrack).catch((e) => {
                console.warn('[Mesh] replaceVideoTrack failed for peer:', e);
              })
            )
          );

          setIsVideoOn(true);
          isVideoOnRef.current = true;
          setParticipants((prev) =>
            prev.map((p) =>
              p.isLocal ? { ...p, isVideoOn: true, stream: freshLocal } : p
            )
          );

          if (socket && roomId) {
            emitCallUserState(socket, roomId, { isVideoOn: true });
          }
        }
      } catch (e) {
        console.error('[Mesh] Failed to enable camera:', e);
      }
    }
  }, [socket, roomId]);

  // Controls: Toggle Screen Share
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopAllTracks(screenStreamRef.current);
      screenStreamRef.current = null;
      setIsScreenSharing(false);

      const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null;
      peersRef.current.forEach((peer) => {
        peer.replaceVideoTrack(isVideoOnRef.current ? cameraTrack : null);
      });
      setParticipants((prev) => prev.map((p) => (p.isLocal ? { ...p, isScreenSharing: false } : p)));
      if (socket && roomId) {
        emitCallUserState(socket, roomId, { isScreenSharing: false });
      }
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
        if (socket && roomId) {
          emitCallUserState(socket, roomId, { isScreenSharing: true });
        }

        screenTrack.onended = () => {
          toggleScreenShare();
        };
      } catch (e) {
        console.warn('[Mesh] Screen share cancelled or failed:', e);
      }
    }
  }, [isScreenSharing, socket, roomId]);

  // Controls: Toggle Deafen
  // When deafened: mute ALL remote audio AND mute local mic.
  // When un-deafened: restore remote audio AND restore mic to its previous mute state.
  const toggleDeafen = useCallback(() => {
    setIsDeafened((prev) => {
      const next = !prev;
      isDeafenedRef.current = next;

      if (next) {
        // Record whether we were unmuted so we can accurately restore
        wasMutedBeforeDeafenRef.current = isMicMutedRef.current;
        // Mute local mic when deafened
        setTrackEnabled(localStreamRef.current, 'audio', false);
        setIsMicMuted(true);
        isMicMutedRef.current = true;
      } else {
        // Restore prior mic state
        const restoreMuted = wasMutedBeforeDeafenRef.current;
        setTrackEnabled(localStreamRef.current, 'audio', !restoreMuted);
        setIsMicMuted(restoreMuted);
        isMicMutedRef.current = restoreMuted;
      }

      setParticipants((list) =>
        list.map((p) =>
          p.isLocal ? { ...p, isDeafened: next, isMuted: next ? true : wasMutedBeforeDeafenRef.current } : p
        )
      );

      // Broadcast deafen + mute state
      if (socket && roomId) {
        emitCallUserState(socket, roomId, {
          isDeafened: next,
          isMuted: next ? true : wasMutedBeforeDeafenRef.current,
        });
      }
      return next;
    });
  }, [socket, roomId]);

  // Dynamically switch media input devices (camera or mic) without dropping call
  const switchMediaDevice = useCallback(
    async ({
      audioDeviceId,
      videoDeviceId,
    }: {
      audioDeviceId?: string;
      videoDeviceId?: string;
    }) => {
      try {
        if (audioDeviceId) {
          const { stream: newAudioStream } = await getMediaStream({
            withVideo: false,
            withAudio: true,
            audioDeviceId,
          });
          const newAudioTrack = newAudioStream.getAudioTracks()[0];
          if (newAudioTrack && localStreamRef.current) {
            const oldAudioTrack = localStreamRef.current.getAudioTracks()[0];
            if (oldAudioTrack) {
              oldAudioTrack.stop();
              localStreamRef.current.removeTrack(oldAudioTrack);
            }
            newAudioTrack.enabled = !isMicMutedRef.current;
            localStreamRef.current.addTrack(newAudioTrack);

            peersRef.current.forEach((peer) => {
              peer.replaceAudioTrack(newAudioTrack).catch(() => {});
            });

            vadRef.current.detachStream('local');
            vadRef.current.attachStream('local', localStreamRef.current);

            const fresh = new MediaStream(localStreamRef.current.getTracks());
            localStreamRef.current = fresh;
            setLocalStream(fresh);
          }
        }

        if (videoDeviceId && isVideoOnRef.current) {
          const { stream: newVideoStream } = await getMediaStream({
            withVideo: true,
            withAudio: false,
            videoDeviceId,
          });
          const newVideoTrack = newVideoStream.getVideoTracks()[0];
          if (newVideoTrack && localStreamRef.current) {
            const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
            if (oldVideoTrack) {
              oldVideoTrack.stop();
              localStreamRef.current.removeTrack(oldVideoTrack);
            }
            newVideoTrack.enabled = true;
            localStreamRef.current.addTrack(newVideoTrack);

            peersRef.current.forEach((peer) => {
              peer.replaceVideoTrack(newVideoTrack).catch(() => {});
            });

            const fresh = new MediaStream(localStreamRef.current.getTracks());
            localStreamRef.current = fresh;
            setLocalStream(fresh);
            setParticipants((prev) =>
              prev.map((p) => (p.isLocal ? { ...p, stream: fresh } : p))
            );
          }
        }
      } catch (err) {
        console.error('[Mesh] Error switching media device:', err);
      }
    },
    []
  );

  // Controls: Send floating reaction
  const triggerReaction = useCallback(
    (emoji: string) => {
      if (!socket || !roomId || !myId) return;
      emitCallReaction(socket, roomId, emoji);

      // Also show locally
      const reaction: FloatingReaction = {
        id: `${myId}-${Date.now()}`,
        emoji,
        senderName: 'YOU',
        x: Math.random() * 80 + 10,
      };
      setReactions((prev) => [...prev, reaction]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
      }, 3000);
    },
    [socket, roomId, myId]
  );

  // Controls: Kick a peer from the call (room owner only)
  const kickPeer = useCallback(
    (targetId: string) => {
      if (!socket || !roomId) return;
      emitCallKick(socket, roomId, targetId);
      // Immediately remove locally
      removePeer(targetId);
    },
    [socket, roomId, removePeer]
  );

  return {
    participants,
    setParticipants,
    localStream,
    screenStream: screenStreamRef.current,
    isMicMuted,
    isVideoOn,
    isScreenSharing,
    isDeafened,
    reactions,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    toggleDeafen,
    switchMediaDevice,
    triggerReaction,
    kickPeer,
    removePeer,
  };
}

// Export both names for maximum clarity and ergonomics
export { useGroupCall as useWebRTC };
