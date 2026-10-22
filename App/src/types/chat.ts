import type { Socket } from 'socket.io-client';

export interface Message {
  id: string | number;
  clientMsgId?: number;
  senderId?: string | null;
  text?: string;
  ciphertext?: string;
  room?: string;
  pending?: boolean;
}

export interface Room {
  id: string;
  name: string;
  owner?: string;
  joinCode?: string;
}

export interface SocketContextType {
  socket: Socket | null;
  myId: string | null;
}

export interface SessionInfoPayload {
  myId: string;
}

export interface RoomsListPayload {
  rooms: Room[];
}

export interface RoomCreatedPayload {
  room: string;
  name?: string;
  owner?: string;
  joinCode?: string;
}

export interface RoomUpdatedPayload {
  room: string;
  name: string;
}

export interface RoomDeletedPayload {
  room: string;
}

export interface JoinErrorPayload {
  message?: string;
  requiresApproval?: boolean;
  [key: string]: unknown;
}

export interface RoomJoinRequestPayload {
  requestId: string;
  room: string;
  roomName: string;
  requesterId: string;
  timestamp?: number;
}

export interface JoinRequestPendingPayload {
  requestId: string;
  room: string;
  name?: string;
}

export interface JoinRequestAcceptedPayload {
  room: string;
  name?: string;
  alreadyMember?: boolean;
}

export interface JoinRequestRejectedPayload {
  room: string;
  message: string;
}

export interface JoinRequestResolvedPayload {
  requestId: string;
  room?: string;
  decision: 'accept' | 'reject';
  requesterId?: string;
}

export interface HistoryObjectPayload {
  room?: string;
  history?: Message[];
}

export type HistoryPayload = Message[] | HistoryObjectPayload;
