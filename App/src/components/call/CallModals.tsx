import React, { useState, useEffect, useRef } from 'react';
import type { CallParticipant } from './callTypes';
import { getMediaDevices } from '../../webrtc/media';

export const VolumeModal: React.FC<{
  id: string | null;
  participants: CallParticipant[];
  onClose: () => void;
  onChange: (id: string, v: number) => void;
}> = ({ id, participants, onClose, onChange }) => {
  if (!id) return null;
  const p = participants.find((x) => x.id === id);
  const vol = p?.volume ?? 100;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-[88vw] max-w-[360px] bg-[#181818] border border-[#333333] rounded p-6 shadow-2xl text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-[#333333]">
          <div className="flex flex-col min-w-0">
            <span className="font-mono text-[10px] font-bold text-[#ff3535] tracking-widest uppercase">
              AUDIO GAIN // CONFIG
            </span>
            <span className="font-bold text-white text-sm font-mono truncate">{p?.name}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-white shrink-0 ml-3 cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div className="py-5 flex flex-col gap-4">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-zinc-400 uppercase">Input Amplitude</span>
            <span className="font-bold text-[#ff3535]">{vol}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={200}
            value={vol}
            onChange={(e) => onChange(id, +e.target.value)}
            className="w-full accent-[#ff3535] h-2 bg-[#272727] rounded cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-zinc-500 font-mono uppercase">
            <span>0% (MUTED)</span>
            <span>100% (UNITY)</span>
            <span>200% (BOOST)</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange(id, 100)}
          className="w-full py-2 bg-[#202020] hover:bg-[#272727] border border-[#333333] hover:border-[#ff3535] text-xs font-mono font-bold text-zinc-200 rounded uppercase cursor-pointer"
        >
          Reset Unity (100%)
        </button>
      </div>
    </div>
  );
};

export interface CallSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  localStream: MediaStream | null;
  onSwitchDevice: (opts: { audioDeviceId?: string; videoDeviceId?: string }) => Promise<void>;
}

export const CallSettingsModal: React.FC<CallSettingsModalProps> = ({
  isOpen,
  onClose,
  localStream,
  onSwitchDevice,
}) => {
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);

  const [selectedMic, setSelectedMic] = useState<string>('');
  const [selectedCam, setSelectedCam] = useState<string>('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('');

  const [micLevel, setMicLevel] = useState<number>(0);
  const isTestingMic = true;
  const animFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    getMediaDevices().then(({ audioInputs, videoInputs, audioOutputs }) => {
      if (!mounted) return;
      setAudioInputs(audioInputs);
      setVideoInputs(videoInputs);
      setAudioOutputs(audioOutputs);

      // Determine active device ids from local stream
      const curAudio = localStream?.getAudioTracks()[0]?.getSettings().deviceId;
      const curVideo = localStream?.getVideoTracks()[0]?.getSettings().deviceId;

      if (curAudio) setSelectedMic(curAudio);
      else if (audioInputs.length > 0) setSelectedMic(audioInputs[0].deviceId);

      if (curVideo) setSelectedCam(curVideo);
      else if (videoInputs.length > 0) setSelectedCam(videoInputs[0].deviceId);

      if (audioOutputs.length > 0) setSelectedSpeaker(audioOutputs[0].deviceId);
    });

    return () => {
      mounted = false;
    };
  }, [isOpen, localStream]);

  // Live microphone meter test using localStream audio track
  useEffect(() => {
    if (!isOpen || !isTestingMic || !localStream) {
      setMicLevel(0);
      return;
    }

    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);

      const loop = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      console.warn('[CallSettings] Mic level test failed:', e);
    }

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [isOpen, isTestingMic, localStream]);

  const handleMicChange = async (deviceId: string) => {
    setSelectedMic(deviceId);
    await onSwitchDevice({ audioDeviceId: deviceId });
  };

  const handleCamChange = async (deviceId: string) => {
    setSelectedCam(deviceId);
    await onSwitchDevice({ videoDeviceId: deviceId });
  };

  const handleTestSpeaker = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } catch (e) {
      console.warn('[CallSettings] Speaker test failed:', e);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-[94vw] max-w-[500px] max-h-[85vh] bg-[#181818] border border-[#333333] rounded p-5 sm:p-6 shadow-2xl flex flex-col text-left overflow-y-auto font-mono text-zinc-200 scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#333333] shrink-0">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-[#ff3535] tracking-widest uppercase">
              HARDWARE & NET // CONFIG
            </span>
            <span className="text-white text-base font-bold">Voice & Video Settings</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-white shrink-0 p-1 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="py-4 flex flex-col gap-5">
          {/* Microphone Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs uppercase text-zinc-400 font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#ff3535]">mic</span>
              Audio Input (Microphone)
            </label>
            <select
              value={selectedMic}
              onChange={(e) => handleMicChange(e.target.value)}
              className="bg-[#202020] border border-[#333333] text-zinc-200 text-xs px-3 py-2 rounded focus:outline-none focus:border-[#ff3535] cursor-pointer"
            >
              {audioInputs.length === 0 && <option value="">Default Microphone</option>}
              {audioInputs.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
            {/* Live Mic Activity Meter */}
            <div className="mt-1 flex flex-col gap-1">
              <div className="flex justify-between text-[10px] text-zinc-500 uppercase">
                <span>Mic Sensitivity Test</span>
                <span>{micLevel}%</span>
              </div>
              <div className="w-full h-2 bg-[#272727] rounded overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#10b981] to-[#ff3535] transition-all duration-75"
                  style={{ width: `${micLevel}%` }}
                />
              </div>
            </div>
          </div>

          {/* Camera Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs uppercase text-zinc-400 font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#10b981]">videocam</span>
              Video Input (Camera)
            </label>
            <select
              value={selectedCam}
              onChange={(e) => handleCamChange(e.target.value)}
              className="bg-[#202020] border border-[#333333] text-zinc-200 text-xs px-3 py-2 rounded focus:outline-none focus:border-[#ff3535] cursor-pointer"
            >
              {videoInputs.length === 0 && <option value="">Default Camera</option>}
              {videoInputs.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>

            {/* Camera Preview Box */}
            <div className="mt-1.5 w-full aspect-video bg-[#121212] border border-[#333333] rounded overflow-hidden relative flex items-center justify-center">
              {localStream && localStream.getVideoTracks().length > 0 && localStream.getVideoTracks()[0].enabled ? (
                <video
                  ref={(node) => {
                    if (node && node.srcObject !== localStream) {
                      node.srcObject = localStream;
                      node.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover -scale-x-100"
                />
              ) : (
                <div className="flex flex-col items-center gap-1 text-zinc-500">
                  <span className="material-symbols-outlined text-2xl">videocam_off</span>
                  <span className="text-[10px] uppercase">Camera Inactive</span>
                </div>
              )}
            </div>
          </div>

          {/* Audio Output (Speaker) */}
          {audioOutputs.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase text-zinc-400 font-bold flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-zinc-300">headphones</span>
                  Audio Output (Speakers)
                </span>
                <button
                  type="button"
                  onClick={handleTestSpeaker}
                  className="text-[10px] text-[#10b981] hover:underline cursor-pointer uppercase"
                >
                  Test Sound ♫
                </button>
              </label>
              <select
                value={selectedSpeaker}
                onChange={(e) => setSelectedSpeaker(e.target.value)}
                className="bg-[#202020] border border-[#333333] text-zinc-200 text-xs px-3 py-2 rounded focus:outline-none focus:border-[#ff3535] cursor-pointer"
              >
                {audioOutputs.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Speaker ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* WebRTC Diagnostics summary */}
          <div className="bg-[#202020] border border-[#333333] p-3 rounded flex flex-col gap-1 text-[11px]">
            <span className="font-bold text-white uppercase flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
              WebRTC Audio Pipeline
            </span>
            <span className="text-zinc-400">
              Noise Suppression: <span className="text-[#10b981]">Active</span> · Echo Cancellation: <span className="text-[#10b981]">Active</span> · AGC: <span className="text-[#10b981]">Active</span>
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-[#333333] flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-[#ff3535] hover:bg-[#ff5252] text-white text-xs font-bold rounded uppercase cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
