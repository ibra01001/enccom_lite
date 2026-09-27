import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { CallParticipant } from '../components/call/callTypes';

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

interface UseWebRTCOptions {
  roomId: string;
  myId: string | null;
  socket: Socket | null;
}

export function useWebRTC({ roomId, myId, socket }: UseWebRTCOptions) {
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());

  // Audio analysis references
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalysersRef = useRef<Map<string, AnalyserNode>>(new Map());
  const animationFrameRef = useRef<number | null>(null);

  // Initialize local participant
  useEffect(() => {
    if (!myId) return;

    setParticipants((prev) => {
      const exists = prev.some((p) => p.isLocal);
      if (exists) return prev;
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

  // Clean up a specific peer connection
  const removePeer = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(peerId);
    }
    pendingCandidatesRef.current.delete(peerId);
    remoteStreamsRef.current.delete(peerId);
    audioAnalysersRef.current.delete(peerId);

    setParticipants((prev) => prev.filter((p) => p.id !== peerId));
  }, []);

  // Helper to create or retrieve an RTCPeerConnection
  const getOrCreatePeerConnection = useCallback(
    (peerId: string, _isInitiator: boolean = false) => {
      let pc = peerConnectionsRef.current.get(peerId);
      if (pc) return pc;

      pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnectionsRef.current.set(peerId, pc);

      // Add local media tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc?.addTrack(track, localStreamRef.current!);
        });
      }

      // Handle ICE Candidates generated locally
      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('call_ice', {
            target: peerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      // Handle incoming remote media tracks
      pc.ontrack = (event) => {
        let remoteStream = remoteStreamsRef.current.get(peerId);
        if (!remoteStream) {
          remoteStream = new MediaStream();
          remoteStreamsRef.current.set(peerId, remoteStream);
        }

        event.streams[0]?.getTracks().forEach((track) => {
          if (!remoteStream?.getTracks().includes(track)) {
            remoteStream?.addTrack(track);
          }
        });

        // Set up audio analyser for speaking indicator
        if (event.track.kind === 'audio' && audioContextRef.current) {
          try {
            const source = audioContextRef.current.createMediaStreamSource(new MediaStream([event.track]));
            const analyser = audioContextRef.current.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            audioAnalysersRef.current.set(peerId, analyser);
          } catch (e) {
            console.warn('[WebRTC] Failed to connect remote audio analyser:', e);
          }
        }

        setParticipants((prev) => {
          const existing = prev.find((p) => p.id === peerId);
          if (existing) {
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
      };

      // Monitor connection state
      pc.onconnectionstatechange = () => {
        if (pc?.connectionState === 'disconnected' || pc?.connectionState === 'failed' || pc?.connectionState === 'closed') {
          removePeer(peerId);
        }
      };

      return pc;
    },
    [socket, removePeer]
  );

  // Setup local audio analyser for voice activity
  const setupLocalAudioAnalyser = useCallback((stream: MediaStream) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack && audioContextRef.current) {
        const source = audioContextRef.current.createMediaStreamSource(new MediaStream([audioTrack]));
        const analyser = audioContextRef.current.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioAnalysersRef.current.set('local', analyser);
      }
    } catch (e) {
      console.warn('[WebRTC] AudioContext init failed:', e);
    }
  }, []);

  // Poll voice activity (equalizer wave)
  useEffect(() => {
    const dataArray = new Uint8Array(128);

    const checkAudioLevels = () => {
      audioAnalysersRef.current.forEach((analyser, id) => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const level = Math.min(100, Math.round((average / 128) * 100));
        const speaking = level > 12;

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

      animationFrameRef.current = requestAnimationFrame(checkAudioLevels);
    };

    animationFrameRef.current = requestAnimationFrame(checkAudioLevels);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  // Main Signaling Listener effect
  useEffect(() => {
    if (!socket || !roomId) return;

    // 1. New user joined the room call: initiate offer
    const handleUserJoined = async ({ peerId }: { peerId: string }) => {
      if (peerId === myId) return;

      const pc = getOrCreatePeerConnection(peerId, true);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('call_offer', {
          target: peerId,
          sdp: offer,
        });
      } catch (err) {
        console.error('[WebRTC] Error creating offer for', peerId, err);
      }
    };

    // 2. Incoming Offer: respond with answer
    const handleOffer = async ({ sender, sdp }: { sender: string; sdp: RTCSessionDescriptionInit }) => {
      const pc = getOrCreatePeerConnection(sender, false);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));

        // Drain any pending ICE candidates
        const pending = pendingCandidatesRef.current.get(sender) || [];
        for (const candidate of pending) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingCandidatesRef.current.delete(sender);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('call_answer', {
          target: sender,
          sdp: answer,
        });
      } catch (err) {
        console.error('[WebRTC] Error handling offer from', sender, err);
      }
    };

    // 3. Incoming Answer: apply remote description
    const handleAnswer = async ({ sender, sdp }: { sender: string; sdp: RTCSessionDescriptionInit }) => {
      const pc = peerConnectionsRef.current.get(sender);
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));

        // Drain any pending ICE candidates
        const pending = pendingCandidatesRef.current.get(sender) || [];
        for (const candidate of pending) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingCandidatesRef.current.delete(sender);
      } catch (err) {
        console.error('[WebRTC] Error setting remote description from answer:', err);
      }
    };

    // 4. Incoming ICE Candidate
    const handleIceCandidate = async ({ sender, candidate }: { sender: string; candidate: RTCIceCandidateInit }) => {
      const pc = peerConnectionsRef.current.get(sender);
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('[WebRTC] Error adding ICE candidate:', err);
        }
      } else {
        // Buffer until remote description is set
        const queue = pendingCandidatesRef.current.get(sender) || [];
        queue.push(candidate);
        pendingCandidatesRef.current.set(sender, queue);
      }
    };

    // 5. User left call
    const handleUserLeft = ({ peerId }: { peerId: string }) => {
      removePeer(peerId);
    };

    socket.on('call_user_joined', handleUserJoined);
    socket.on('call_offer', handleOffer);
    socket.on('call_answer', handleAnswer);
    socket.on('call_ice', handleIceCandidate);
    socket.on('call_user_left', handleUserLeft);
    socket.on('peer_left', handleUserLeft);

    // Initial media capture & call join announcement
    const startCall = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
        localStreamRef.current = stream;
        setupLocalAudioAnalyser(stream);

        // Update local participant stream
        setParticipants((prev) =>
          prev.map((p) => (p.isLocal ? { ...p, stream, isVideoOn: true, isMuted: false } : p))
        );
        setIsVideoOn(true);
        setIsMicMuted(false);
      } catch (err) {
        console.warn('[WebRTC] Camera access failed, attempting audio only:', err);
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          localStreamRef.current = audioStream;
          setupLocalAudioAnalyser(audioStream);
          setParticipants((prev) =>
            prev.map((p) => (p.isLocal ? { ...p, stream: audioStream, isVideoOn: false, isMuted: false } : p))
          );
          setIsVideoOn(false);
          setIsMicMuted(false);
        } catch (audioErr) {
          console.error('[WebRTC] Microphone access failed completely:', audioErr);
        }
      }

      // Tell backend room we have entered the call
      socket.emit('call_join', { room: roomId });
    };

    startCall();

    return () => {
      socket.off('call_user_joined', handleUserJoined);
      socket.off('call_offer', handleOffer);
      socket.off('call_answer', handleAnswer);
      socket.off('call_ice', handleIceCandidate);
      socket.off('call_user_left', handleUserLeft);
      socket.off('peer_left', handleUserLeft);

      // Leave call notification
      socket.emit('call_leave', { room: roomId });

      // Clean up peer connections
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
      pendingCandidatesRef.current.clear();
      remoteStreamsRef.current.clear();

      // Clean up media tracks
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;

      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [socket, roomId, myId, getOrCreatePeerConnection, removePeer, setupLocalAudioAnalyser]);

  // Controls: Toggle Microphone
  const toggleMic = useCallback(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const muted = !audioTrack.enabled;
      setIsMicMuted(muted);
      setParticipants((prev) => prev.map((p) => (p.isLocal ? { ...p, isMuted: muted } : p)));
    }
  }, []);

  // Controls: Toggle Camera
  const toggleCam = useCallback(async () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      const active = videoTrack.enabled;
      setIsVideoOn(active);
      setParticipants((prev) => prev.map((p) => (p.isLocal ? { ...p, isVideoOn: active } : p)));
    } else if (!isVideoOn) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newTrack = camStream.getVideoTracks()[0];
        if (newTrack && localStreamRef.current) {
          localStreamRef.current.addTrack(newTrack);
          peerConnectionsRef.current.forEach((pc) => {
            pc.addTrack(newTrack, localStreamRef.current!);
          });
          setIsVideoOn(true);
          setParticipants((prev) => prev.map((p) => (p.isLocal ? { ...p, isVideoOn: true } : p)));
        }
      } catch (e) {
        console.error('[WebRTC] Failed to enable camera:', e);
      }
    }
  }, [isVideoOn]);

  // Controls: Toggle Screen Share
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setIsScreenSharing(false);

      // Revert back to camera track on all peers if available
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null;
      peerConnectionsRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender && cameraTrack) {
          sender.replaceTrack(cameraTrack);
        }
      });
      setParticipants((prev) => prev.map((p) => (p.isLocal ? { ...p, isScreenSharing: false } : p)));
    } else {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        screenStreamRef.current = displayStream;
        const screenTrack = displayStream.getVideoTracks()[0];

        // Replace outgoing video track on all peer connections
        peerConnectionsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
          if (sender && screenTrack) {
            sender.replaceTrack(screenTrack);
          }
        });

        setIsScreenSharing(true);
        setParticipants((prev) => prev.map((p) => (p.isLocal ? { ...p, isScreenSharing: true } : p)));

        screenTrack.onended = () => {
          toggleScreenShare();
        };
      } catch (e) {
        console.warn('[WebRTC] Screen share cancelled or failed:', e);
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
