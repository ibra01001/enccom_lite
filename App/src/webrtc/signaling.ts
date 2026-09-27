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

export interface CallIncomingPayload {
  from: string;
  room: string;
  name?: string;
}

export interface CallRingEndPayload {
  room: string;
  from: string;
}

export interface CallRingFailedPayload {
  room?: string;
  message: string;
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
 * Ring every member of a room. Nobody joins the call mesh until someone accepts.
 */
export function emitCallRing(socket: Socket, room: string) {
  socket.emit('call_ring', { room });
}

/**
 * Caller stopped ringing before anyone picked up.
 */
export function emitCallRingCancel(socket: Socket, room: string) {
  socket.emit('call_ring_cancel', { room });
}

/**
 * Accept an incoming group ring and join the call mesh.
 */
export function emitCallRingAccept(socket: Socket, room: string) {
  socket.emit('call_ring_accept', { room });
}

/**
 * Dismiss an incoming group ring.
 */
export function emitCallRingDecline(socket: Socket, room: string) {
  socket.emit('call_ring_decline', { room });
}

/**
 * Subscribe to all call signaling events from the server.
 * Returns an unsubscribe cleanup callback.
 *
 * NOTE: ring events are deliberately NOT wired here — this listener only runs
 * while inside a call, and a ring must be receivable before joining one.
 * Subscribe to call_incoming / call_ring_* at the room level instead.
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
