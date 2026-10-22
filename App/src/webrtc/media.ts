// Manage camera, microphone, screen capture, and audio activity analysis.

export interface MediaCaptureOptions {
  withVideo?: boolean;
  withAudio?: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

/**
 * Acquire camera & microphone stream with fallback to audio-only if video fails.
 */
export async function getMediaStream(
  withVideo: boolean | MediaCaptureOptions = true,
  withAudio = true
): Promise<{ stream: MediaStream; hasVideo: boolean }> {
  const options: MediaCaptureOptions =
    typeof withVideo === 'boolean'
      ? { withVideo, withAudio }
      : { withVideo: true, withAudio: true, ...withVideo };

  const wantVideo = options.withVideo ?? true;
  const wantAudio = options.withAudio ?? true;

  const audioConstraints: boolean | MediaTrackConstraints = wantAudio
    ? {
        echoCancellation: options.echoCancellation ?? true,
        noiseSuppression: options.noiseSuppression ?? true,
        autoGainControl: options.autoGainControl ?? true,
        ...(options.audioDeviceId ? { deviceId: { exact: options.audioDeviceId } } : {}),
      }
    : false;

  const videoConstraints: boolean | MediaTrackConstraints = wantVideo
    ? {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        ...(options.videoDeviceId ? { deviceId: { exact: options.videoDeviceId } } : {}),
      }
    : false;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: audioConstraints,
    });
    return { stream, hasVideo: wantVideo && stream.getVideoTracks().length > 0 };
  } catch (err) {
    if (wantVideo) {
      console.warn('[Media] Video capture failed, falling back to audio only:', err);
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: audioConstraints,
        });
        return { stream: audioStream, hasVideo: false };
      } catch (audioErr) {
        throw audioErr;
      }
    }
    throw err;
  }
}

/**
 * Enumerate available input/output media devices.
 */
export async function getMediaDevices(): Promise<{
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
}> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    return { audioInputs: [], videoInputs: [], audioOutputs: [] };
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      audioInputs: devices.filter((d) => d.kind === 'audioinput'),
      videoInputs: devices.filter((d) => d.kind === 'videoinput'),
      audioOutputs: devices.filter((d) => d.kind === 'audiooutput'),
    };
  } catch (e) {
    console.warn('[Media] Failed to enumerate devices:', e);
    return { audioInputs: [], videoInputs: [], audioOutputs: [] };
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
      this.ctx.close().catch(() => { });
    }
  }
}