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

    // Attach local media tracks if available
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        this.pc.addTrack(track, localStream);
      });
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
   * Replace outgoing video track (e.g. switching between webcam and screen share).
   */
  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (sender) {
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
