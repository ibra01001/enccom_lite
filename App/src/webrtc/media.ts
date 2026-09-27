// Manage camera, microphone, screen capture, and audio activity analysis.

/**
 * Acquire camera & microphone stream with fallback to audio-only if video fails.
 */
export async function getMediaStream(withVideo = true, withAudio = true): Promise<{ stream: MediaStream; hasVideo: boolean }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: withVideo,
      audio: withAudio,
    });
    return { stream, hasVideo: withVideo };
  } catch (err) {
    if (withVideo) {
      console.warn('[Media] Video capture failed, falling back to audio only:', err);
      const audioStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: withAudio,
      });
      return { stream: audioStream, hasVideo: false };
    }
    throw err;
  }
}

/**
 * Acquire screen capture stream.
 */
export async function getDisplayStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
}

/**
 * Stop all tracks on a MediaStream to immediately release hardware devices.
 */
export function stopAllTracks(stream: MediaStream | null) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

/**
 * Toggle audio or video track enabled status on a stream.
 */
export function setTrackEnabled(stream: MediaStream | null, kind: 'audio' | 'video', enabled: boolean): boolean {
  if (!stream) return false;
  const track = kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
  if (track) {
    track.enabled = enabled;
    return track.enabled;
  }
  return false;
}

/**
 * Seamlessly replace the video sender track across all active RTCPeerConnections (for screen sharing).
 */
export function replaceVideoSenderTrack(
  peerConnections: Map<string, RTCPeerConnection>,
  newTrack: MediaStreamTrack | null
) {
  peerConnections.forEach((pc) => {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (sender) {
      sender.replaceTrack(newTrack).catch((err) => {
        console.error('[Media] replaceTrack error:', err);
      });
    }
  });
}

/**
 * Web Audio API Analyser for measuring decibel volume levels and voice activity.
 */
export class VoiceActivityDetector {
  private ctx: AudioContext | null = null;
  private analysers = new Map<string, AnalyserNode>();
  private animId: number | null = null;

  private getAudioContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    return this.ctx;
  }

  attachStream(id: string, stream: MediaStream) {
    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      const ctx = this.getAudioContext();
      const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      this.analysers.set(id, analyser);
    } catch (e) {
      console.warn(`[Media] Failed to attach audio analyser for ${id}:`, e);
    }
  }

  detachStream(id: string) {
    this.analysers.delete(id);
  }

  startPolling(onLevel: (id: string, level: number, speaking: boolean) => void): () => void {
    const dataArray = new Uint8Array(128);

    const check = () => {
      this.analysers.forEach((analyser, id) => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const level = Math.min(100, Math.round((average / 128) * 100));
        const speaking = level > 12;
        onLevel(id, level, speaking);
      });

      this.animId = requestAnimationFrame(check);
    };

    this.animId = requestAnimationFrame(check);

    return () => {
      if (this.animId) cancelAnimationFrame(this.animId);
    };
  }

  close() {
    if (this.animId) cancelAnimationFrame(this.animId);
    this.analysers.clear();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
    }
  }
}