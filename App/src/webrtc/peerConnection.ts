// 1-to-1 WebRTC Peer Connection Wrapper
import { RTC_CONFIG, CandidateBuffer } from './ice';

export { RTC_CONFIG };

export interface PeerConnectionCallbacks {
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  onTrack: (track: MediaStreamTrack, stream: MediaStream) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
}

/**
 * Manages an individual RTCPeerConnection with a single remote peer.
 */
export class PeerConnection {
  readonly peerId: string;
  private pc: RTCPeerConnection;
  private candidateBuffer: CandidateBuffer;
  private callbacks: PeerConnectionCallbacks;
  private videoSender: RTCRtpSender | null = null;
  private audioSender: RTCRtpSender | null = null;

  constructor(
    peerId: string,
    localStream: MediaStream | null,
    callbacks: PeerConnectionCallbacks,
    candidateBuffer?: CandidateBuffer
  ) {
    this.peerId = peerId;
    this.callbacks = callbacks;
    this.candidateBuffer = candidateBuffer || new CandidateBuffer();
    this.pc = new RTCPeerConnection(RTC_CONFIG);

    // Pre-allocate audio and video transceivers/senders so SDP negotiation includes both m-lines.
    // Retaining direct references to videoSender and audioSender ensures replaceTrack(null)
    // doesn't cause us to lose the sender reference when toggling camera or mic.
    const audioTrack = localStream?.getAudioTracks()[0] || null;
    if (audioTrack && localStream) {
      this.audioSender = this.pc.addTrack(audioTrack, localStream);
    } else {
      try {
        const tr = this.pc.addTransceiver('audio', { direction: 'sendrecv' });
        this.audioSender = tr.sender;
      } catch (err) {
        console.warn('[PeerConnection] Failed to add audio transceiver:', err);
      }
    }

    const videoTrack = localStream?.getVideoTracks()[0] || null;
    if (videoTrack && localStream) {
      this.videoSender = this.pc.addTrack(videoTrack, localStream);
    } else {
      try {
        const tr = this.pc.addTransceiver('video', { direction: 'sendrecv' });
        this.videoSender = tr.sender;
      } catch (err) {
        console.warn('[PeerConnection] Failed to add video transceiver:', err);
      }
    }

    // ICE Candidate event
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.callbacks.onIceCandidate(event.candidate.toJSON());
      }
    };

    // Incoming remote track event
    this.pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      this.callbacks.onTrack(event.track, stream);
    };

    // State change event
    this.pc.onconnectionstatechange = () => {
      this.callbacks.onConnectionStateChange(this.pc.connectionState);
    };
  }

  /**
   * Create and set local SDP Offer.
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  /**
   * Set remote SDP Offer, drain buffered ICE candidates, and create local SDP Answer.
   */
  async handleOffer(sdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.candidateBuffer.drainCandidates(this.peerId, this.pc);

    // If videoSender or audioSender wasn't explicitly initialized, locate from senders
    this.syncSenders();

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  /**
   * Set remote SDP Answer and drain buffered ICE candidates.
   */
  async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.candidateBuffer.drainCandidates(this.peerId, this.pc);
    this.syncSenders();
  }

  private syncSenders() {
    if (!this.videoSender) {
      const vSender = this.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (vSender) {
        this.videoSender = vSender;
      } else {
        const vTr = this.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'video');
        if (vTr?.sender) this.videoSender = vTr.sender;
      }
    }
    if (!this.audioSender) {
      const aSender = this.pc.getSenders().find((s) => s.track?.kind === 'audio');
      if (aSender) {
        this.audioSender = aSender;
      } else {
        const aTr = this.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio');
        if (aTr?.sender) this.audioSender = aTr.sender;
      }
    }
  }

  /**
   * Add incoming ICE candidate or buffer it if remote description isn't set yet.
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error(`[PeerConnection] Error adding ICE candidate for ${this.peerId}:`, err);
      }
    } else {
      this.candidateBuffer.addCandidate(this.peerId, candidate);
    }
  }

  /**
   * Replace outgoing video track (e.g. switching between webcam, screen share, or turning off).
   */
  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    this.syncSenders();

    if (this.videoSender) {
      await this.videoSender.replaceTrack(track);
      return;
    }

    // Fallback: transceiver lookup
    const transceivers = this.pc.getTransceivers ? this.pc.getTransceivers() : [];
    const videoTransceiver = transceivers.find(
      (t) => t.sender?.track?.kind === 'video' || t.receiver?.track?.kind === 'video'
    );
    if (videoTransceiver && videoTransceiver.sender) {
      this.videoSender = videoTransceiver.sender;
      await videoTransceiver.sender.replaceTrack(track);
      return;
    }

    const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (sender) {
      this.videoSender = sender;
      await sender.replaceTrack(track);
      return;
    }

    if (track) {
      this.videoSender = this.pc.addTrack(track);
    }
  }

  /**
   * Replace outgoing audio track.
   */
  async replaceAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    this.syncSenders();

    if (this.audioSender) {
      await this.audioSender.replaceTrack(track);
      return;
    }

    const transceivers = this.pc.getTransceivers ? this.pc.getTransceivers() : [];
    const audioTransceiver = transceivers.find(
      (t) => t.sender?.track?.kind === 'audio' || t.receiver?.track?.kind === 'audio'
    );
    if (audioTransceiver && audioTransceiver.sender) {
      this.audioSender = audioTransceiver.sender;
      await audioTransceiver.sender.replaceTrack(track);
      return;
    }

    const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
    if (sender) {
      this.audioSender = sender;
      await sender.replaceTrack(track);
    }
  }

  /**
   * Add a new track to an existing connection.
   */
  addTrack(track: MediaStreamTrack, stream: MediaStream): void {
    this.pc.addTrack(track, stream);
  }

  /**
   * Close connection and release resources.
   */
  close(): void {
    this.candidateBuffer.clear(this.peerId);
    this.pc.close();
  }
}

// Re-export useWebRTC and useGroupCall from groupCall.ts for backward compatibility
export { useGroupCall, useWebRTC } from './groupCall';
