// Socket.IO signaling protocol bridge for WebRTC calls.
import type { Socket } from 'socket.io-client';

export interface CallUserJoinedPayload {
  peerId: string;
  room: string;
}

export interface CallOfferPayload {
  sender: string;
  sdp: RTCSessionDescriptionInit;
}

export interface CallAnswerPayload {
  sender: string;
  sdp: RTCSessionDescriptionInit;
}

export interface CallIcePayload {
  sender: string;
  candidate: RTCIceCandidateInit;
}

export interface CallUserLeftPayload {
  peerId: string;
  room?: string;
}

export interface SignalingHandlers {
  onUserJoined: (payload: CallUserJoinedPayload) => void;
  onOffer: (payload: CallOfferPayload) => void;
  onAnswer: (payload: CallAnswerPayload) => void;
  onIce: (payload: CallIcePayload) => void;
  onUserLeft: (payload: CallUserLeftPayload) => void;
}

/**
 * Emit call join request to backend room.
 */
export function emitCallJoin(socket: Socket, room: string) {
  socket.emit('call_join', { room });
}

/**
 * Emit call leave notification.
 */
export function emitCallLeave(socket: Socket, room: string) {
  socket.emit('call_leave', { room });
}

/**
 * Emit SDP Offer targeted to a specific peer.
 */
export function emitCallOffer(socket: Socket, target: string, sdp: RTCSessionDescriptionInit) {
  socket.emit('call_offer', { target, sdp });
}

/**
 * Emit SDP Answer targeted to a specific peer.
 */
export function emitCallAnswer(socket: Socket, target: string, sdp: RTCSessionDescriptionInit) {
  socket.emit('call_answer', { target, sdp });
}

/**
 * Emit ICE candidate targeted to a specific peer.
 */
export function emitCallIce(socket: Socket, target: string, candidate: RTCIceCandidateInit) {
  socket.emit('call_ice', { target, candidate });
}

/**
 * Subscribe to all call signaling events from the server.
 * Returns an unsubscribe cleanup callback.
 */
export function setupSignalingListeners(socket: Socket, handlers: SignalingHandlers): () => void {
  socket.on('call_user_joined', handlers.onUserJoined);
  socket.on('call_offer', handlers.onOffer);
  socket.on('call_answer', handlers.onAnswer);
  socket.on('call_ice', handlers.onIce);
  socket.on('call_user_left', handlers.onUserLeft);
  socket.on('peer_left', handlers.onUserLeft);

  return () => {
    socket.off('call_user_joined', handlers.onUserJoined);
    socket.off('call_offer', handlers.onOffer);
    socket.off('call_answer', handlers.onAnswer);
    socket.off('call_ice', handlers.onIce);
    socket.off('call_user_left', handlers.onUserLeft);
    socket.off('peer_left', handlers.onUserLeft);
  };
}
