export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

/**
 * Manages buffering and draining of ICE candidates that arrive
 * before remote description is set on the RTCPeerConnection.
 */
export class CandidateBuffer {
  private queue = new Map<string, RTCIceCandidateInit[]>();

  addCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const list = this.queue.get(peerId) || [];
    list.push(candidate);
    this.queue.set(peerId, list);
  }

  async drainCandidates(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const list = this.queue.get(peerId);
    if (!list || list.length === 0) return;

    for (const candidate of list) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error(`[ICE] Failed to add buffered candidate for ${peerId}:`, err);
      }
    }
    this.queue.delete(peerId);
  }

  clear(peerId?: string) {
    if (peerId) {
      this.queue.delete(peerId);
    } else {
      this.queue.clear();
    }
  }
}
