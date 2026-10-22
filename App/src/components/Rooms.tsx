import { useState, useEffect, useRef, type FC, type FormEvent, type MouseEvent } from 'react';
import gsap from 'gsap';
import { useSocket } from '../context/SocketContext';
import type {
  Room,
  RoomsListPayload,
  RoomCreatedPayload,
  RoomUpdatedPayload,
  RoomDeletedPayload,
  JoinRequestPendingPayload,
  JoinRequestAcceptedPayload,
  JoinRequestRejectedPayload
} from '../types/chat';
import { useMls } from '../context/MlsContext';
import '../styles/features.css';

interface RoomsProps {
  currentRoom?: string;
  onSelectRoom?: (roomId: string) => void;
  isOpen?: boolean;
  onClose?: () => void;
}

interface PendingKnock {
  requestId: string;
  room: string;
  name: string;
}

const Rooms: FC<RoomsProps> = ({ currentRoom = 'public', onSelectRoom, isOpen = false, onClose }) => {
  const { socket } = useSocket();
  const { createGroup } = useMls();
  const [rooms, setRooms] = useState<Room[]>([{ id: 'public', name: 'Public Chat' }]);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [pendingKnock, setPendingKnock] = useState<PendingKnock | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [copiedRoomId, setCopiedRoomId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const sidebarRef = useRef<HTMLElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const menuPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');
    if (codeParam) {
      setJoinCodeInput(codeParam.toUpperCase());
      setIsJoining(true);
    }
  }, []);

  useEffect(() => {
    const el = sidebarRef.current;
    const bd = backdropRef.current;
    if (!el) return;
    const isMobile = window.innerWidth < 768;
    if (!isMobile) {
      gsap.set(el, { clearProps: 'transform,x' });
      return;
    }
    if (isOpen) {
      gsap.fromTo(el, { x: '-100%' }, { x: '0%', duration: 0.38, ease: 'power2.inOut' });
      if (bd) gsap.fromTo(bd, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' });
    } else {
      gsap.to(el, { x: '-100%', duration: 0.32, ease: 'power2.inOut' });
      if (bd) gsap.to(bd, { opacity: 0, duration: 0.22, ease: 'power2.in' });
    }
  }, [isOpen]);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const onResize = () => { if (window.innerWidth >= 768) gsap.set(el, { clearProps: 'transform,x' }); };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Close mobile 3-dot menu on outside click / Esc / scroll
  useEffect(() => {
    if (openMenuId === null) return;
    const onDocClick = (e: globalThis.MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-room-menu]') || t.closest('[data-room-kebab]')) return;
      setOpenMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenuId(null); };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenuId]);

  useEffect(() => {
    if (!socket) return;
    socket.emit('get_my_rooms');

    const onList = (d: RoomsListPayload) => { if (d?.rooms) setRooms(d.rooms); };
    const onCreated = (d: RoomCreatedPayload) => {
      if (!d?.room) return;
      createGroup(d.room);
      setRooms(p => p.some(r => r.id === d.room) ? p : [...p, { id: d.room, name: d.name || d.room, joinCode: d.joinCode, owner: d.owner }]);
      if (d.joinCode) {
        navigator.clipboard.writeText(d.joinCode).catch(() => { });
        setCopiedRoomId(d.room);
        setTimeout(() => setCopiedRoomId(null), 2500);
      }
      onSelectRoom?.(d.room);
    };
    const onUpdated = (d: RoomUpdatedPayload) => { if (d?.room && d?.name) setRooms(p => p.map(r => r.id === d.room ? { ...r, name: d.name } : r)); };
    const onDeleted = (d: RoomDeletedPayload) => {
      if (!d?.room) return;
      setRooms(p => p.filter(r => r.id !== d.room));
      if (currentRoom === d.room) onSelectRoom?.('public');
    };

    const onJoinPending = (d: JoinRequestPendingPayload) => {
      setPendingKnock({ requestId: d.requestId, room: d.room, name: d.name || d.room });
      setIsJoining(false);
      setJoinError(null);
    };

    const onJoinAccepted = (d: JoinRequestAcceptedPayload) => {
      setPendingKnock(null);
      setJoinError(null);
      socket.emit('get_my_rooms');
      if (d.room) onSelectRoom?.(d.room);
    };

    const onJoinRejected = (d: JoinRequestRejectedPayload) => {
      setPendingKnock(null);
      setJoinError(d.message || 'Join request was declined by the room owner.');
    };

    const onJoinCodeError = (d: { message: string }) => {
      setJoinError(d.message || 'Invalid join code.');
    };

    const onJoinCancelled = () => {
      setPendingKnock(null);
    };

    socket.on('rooms_list', onList);
    socket.on('room_created', onCreated);
    socket.on('room_updated', onUpdated);
    socket.on('room_deleted', onDeleted);
    socket.on('join_request_pending', onJoinPending);
    socket.on('join_request_accepted', onJoinAccepted);
    socket.on('join_request_rejected', onJoinRejected);
    socket.on('join_code_error', onJoinCodeError);
    socket.on('join_request_cancelled', onJoinCancelled);

    return () => {
      socket.off('rooms_list', onList);
      socket.off('room_created', onCreated);
      socket.off('room_updated', onUpdated);
      socket.off('room_deleted', onDeleted);
      socket.off('join_request_pending', onJoinPending);
      socket.off('join_request_accepted', onJoinAccepted);
      socket.off('join_request_rejected', onJoinRejected);
      socket.off('join_code_error', onJoinCodeError);
      socket.off('join_request_cancelled', onJoinCancelled);
    };
  }, [socket, currentRoom, onSelectRoom, createGroup]);

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!socket || !newRoomName.trim()) return;
    socket.emit('create_room', { name: newRoomName.trim() });
    setNewRoomName('');
    setIsCreating(false);
  };

  const handleRequestJoin = (e: FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    const cleanCode = joinCodeInput.replace(/[^A-Za-z0-9]/g, '').trim();
    if (!socket || cleanCode.length < 6) {
      setJoinError('Please enter a valid 12-character code');
      return;
    }
    socket.emit('request_join_room', { code: cleanCode });
  };

  const handleCancelKnock = () => {
    if (!socket || !pendingKnock) return;
    socket.emit('cancel_join_request', {
      requestId: pendingKnock.requestId,
      room: pendingKnock.room
    });
    setPendingKnock(null);
  };

  const handleUpdate = (e: FormEvent, id: string) => {
    e.preventDefault();
    if (!socket || !editingName.trim()) return;
    socket.emit('update_room', { room: id, name: editingName.trim() });
    setEditingRoomId(null);
    setEditingName('');
  };

  const handleDelete = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    if (socket) socket.emit('delete_room', { room: id });
  };

  const startEdit = (e: MouseEvent, room: Room) => {
    e.stopPropagation();
    setEditingRoomId(room.id);
    setEditingName(room.name);
  };

  const handleCopyCode = (e: MouseEvent, room: Room) => {
    e.stopPropagation();
    const code = room.joinCode;
    if (!code) return;
    navigator.clipboard.writeText(code).catch(() => { });
    setCopiedRoomId(room.id);
    setTimeout(() => setCopiedRoomId(null), 2000);
  };

  const toggleMenu = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const r = target.getBoundingClientRect();
    const menuW = 160;
    let x = r.right - menuW;
    if (x < 8) x = 8;
    if (x + menuW > window.innerWidth - 8) x = window.innerWidth - menuW - 8;
    let y = r.bottom + 6;
    if (y + 132 > window.innerHeight) y = r.top - 132 - 6;
    if (y < 8) y = 8;
    menuPosRef.current = { x, y };
    setOpenMenuId(prev => (prev === id ? null : id));
  };

  return (
    <>
      <div
        ref={backdropRef}
        onClick={onClose}
        className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-[1px] opacity-0 pointer-events-none"
        style={{ pointerEvents: isOpen ? 'auto' : 'none' }}
      />

      <aside
        ref={sidebarRef}
        className={[
          'fixed top-0 left-0 z-50 h-full translate-x-[-100%] md:relative md:translate-x-0 md:z-auto',
          'w-72 sm:w-80 shrink-0 bg-[#1a1a1a] border-r border-white/10',
          'flex flex-col select-none overflow-hidden',
        ].join(' ')}
      >
        {/* Header */}
        <div className="shrink-0 px-4 h-14 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <h4 className="font-mono text-[11px] font-bold tracking-widest uppercase text-zinc-300 truncate">Rooms</h4>
            <span className="font-mono text-[10px] text-zinc-500">{rooms.length}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Join Room Button */}
            <button
              type="button"
              onClick={() => {
                setIsJoining(v => !v);
                setIsCreating(false);
                setJoinError(null);
              }}
              className={`px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors border ${isJoining ? 'bg-white text-black border-white' : 'bg-transparent text-zinc-300 border-white/10 hover:border-white/20 hover:text-white'}`}
              title="Join room with 12-char code"
            >
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px] leading-none">{isJoining ? 'close' : 'key'}</span>
                <span>{isJoining ? 'Close' : 'Join'}</span>
              </span>
            </button>

            {/* Create Room Button */}
            <button
              type="button"
              onClick={() => {
                setIsCreating(v => !v);
                setIsJoining(false);
              }}
              className={`px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${isCreating ? 'bg-transparent text-zinc-400 hover:text-white' : 'bg-white text-black hover:bg-zinc-100'}`}
              title="Create new room"
            >
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px] leading-none">{isCreating ? 'close' : 'add'}</span>
                <span>{isCreating ? 'Cancel' : 'New'}</span>
              </span>
            </button>
          </div>
        </div>

        {/* Join form with 12-character alphanumeric code */}
        {isJoining && (
          <form onSubmit={handleRequestJoin} className="mx-3 mt-3 p-3 bg-[#272727] border border-white/10 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300">Enter 12-Char Code</span>
              <span className="font-mono text-[9px] text-[#10b981] font-bold">KNOCK & APPROVE</span>
            </div>
            <input
              type="text"
              placeholder="e.g. 7X9K-M2P4-Q8J1"
              value={joinCodeInput}
              onChange={e => {
                setJoinCodeInput(e.target.value.toUpperCase());
                setJoinError(null);
              }}
              maxLength={16}
              className="w-full bg-[#101010] text-white text-xs font-mono tracking-wider px-3 py-2 border border-white/10 focus:border-[#10b981] focus:outline-none placeholder-zinc-600"
              autoFocus
            />
            {joinError && (
              <span className="text-[11px] font-mono text-[#FF3535] leading-tight">{joinError}</span>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={joinCodeInput.replace(/[^A-Za-z0-9]/g, '').length < 6}
                className="flex-1 bg-[#10b981] hover:bg-[#059669] text-white text-xs font-mono font-bold uppercase tracking-widest py-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Request Join
              </button>
              <button
                type="button"
                onClick={() => { setIsJoining(false); setJoinError(null); }}
                className="px-3 py-2 bg-transparent border border-white/10 text-zinc-300 hover:text-white hover:border-white/20 text-xs font-mono uppercase tracking-widest transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Create form */}
        {isCreating && (
          <form onSubmit={handleCreate} className="mx-3 mt-3 p-3 bg-[#272727] border border-white/10 flex flex-col gap-2.5">
            <input
              type="text"
              placeholder="Room name"
              value={newRoomName}
              onChange={e => setNewRoomName(e.target.value)}
              className="w-full bg-[#101010] text-white text-sm px-3 py-2 border border-white/10 focus:border-white/20 focus:outline-none placeholder-zinc-500"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!newRoomName.trim()}
                className="flex-1 bg-white text-black text-xs font-mono font-bold uppercase tracking-widest py-2 hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-3 py-2 bg-transparent border border-white/10 text-zinc-300 hover:text-white hover:border-white/20 text-xs font-mono uppercase tracking-widest transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Pending Knock Notification Banner */}
        {pendingKnock && (
          <div className="mx-3 mt-3 p-3 bg-[#1e1e1e] border border-[#10b981]/30 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#10b981] animate-ping" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-200">
                Waiting for Approval
              </span>
            </div>
            <p className="text-zinc-400 text-xs truncate">
              Knocked on <span className="text-white font-medium">"{pendingKnock.name}"</span>
            </p>
            <button
              type="button"
              onClick={handleCancelKnock}
              className="w-full py-1.5 px-2 bg-transparent border border-white/10 hover:border-[#FF3535]/50 text-zinc-400 hover:text-[#FF3535] text-[10px] font-mono uppercase tracking-wider transition-colors"
            >
              Cancel Request
            </button>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-0.5">
          <div className="px-2 pb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold tracking-widest uppercase text-zinc-500">Channels</span>
          </div>

          {rooms.map(room => {
            const active = currentRoom === room.id;
            const editing = editingRoomId === room.id;
            const isPublic = room.id === 'public';
            const copied = copiedRoomId === room.id;

            if (editing) {
              return (
                <form key={room.id} onSubmit={e => handleUpdate(e, room.id)} className="mx-1 p-2 bg-[#272727] border border-white/10 flex items-center gap-2">
                  <input
                    type="text"
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    className="flex-1 bg-[#101010] text-white text-xs px-2 py-1.5 border border-white/10 focus:outline-none focus:border-white/20"
                    autoFocus
                  />
                  <button type="submit" className="px-2.5 py-1.5 bg-white text-black text-xs font-mono font-bold uppercase hover:bg-zinc-100 transition-colors">Save</button>
                  <button type="button" onClick={() => setEditingRoomId(null)} className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5">✕</button>
                </form>
              );
            }

            return (
              <div
                key={room.id}
                onClick={() => onSelectRoom?.(room.id)}
                className={`group flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer transition-colors border ${active ? 'bg-white/[0.04] border-white/10 border-l-2 border-l-[#FF3535] text-white' : 'bg-transparent border-transparent text-zinc-400 hover:text-white hover:bg-white/[0.03] hover:border-white/5'}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`material-symbols-outlined text-[16px] shrink-0 ${active ? 'text-[#FF3535]' : 'text-zinc-500 group-hover:text-zinc-300'}`}>
                    {isPublic ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M6 2h12v2H6zm0 18h12v2H6zM18 4h2v2h-2zM4 18h2v2H4zM4 4h2v2H4zm14 14h2v2h-2zM2 6h2v12H2zm18 0h2v12h-2zM8 4h2v4H8zm2 4h4v2h-4zm4 2h4v2h-4zm4-2h2v2h-2zM4 12h2v2H4zm6 4h2v4h-2zm-4-2h4v2H6zm8 2h2v4h-2zm2-2h4v2h-4z" /></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M5 8h14v2H5zm0 12h14v2H5zM3 10h2v10H3zm16 0h2v10h-2zM7 4h2v4H7zm2-2h6v2H9zm6 2h2v4h-2z" /></svg>
                    )}
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="truncate text-sm font-medium tracking-tight">{room.name}</span>
                    {!isPublic && room.joinCode && (
                      <span className="font-mono text-[9px] text-zinc-500 tracking-wider">
                        CODE: {room.joinCode}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {!isPublic && (
                    <>
                      {/* Desktop — hover */}
                      <div className="hidden md:group-hover:flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={e => handleCopyCode(e, room)}
                          title={copied ? 'Code copied!' : `Copy join code (${room.joinCode || ''})`}
                          className={`w-7 h-7 flex items-center justify-center hover:bg-white/5 hover:text-white transition-colors ${copied ? 'text-[#10B981]' : 'text-zinc-500'}`}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {copied ? 'check' : 'key'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={e => startEdit(e, room)}
                          title="Rename"
                          className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="1.2em" height="1.2em" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M4 16h2v2h2v2h2v2H2v-8h2zm8 4h-2v-2h2zm2-2h-2v-2h2zm-4-2H8v-2h2zm6 0h-2v-2h2zM6 14H4v-2h2zm6 0h-2v-2h2zm6 0h-2v-2h2zM8 12H6v-2h2zm6 0h-2v-2h2zm6 0h-2v-2h2zm-10-2H8V8h2zm8 0h-2V8h2zm4 0h-2V8h2zM12 8h-2V6h2zm4 0h-2V6h2zm4 0h-2V6h2zm-6-2h-2V4h2zm4 0h-2V4h2zm-2-2h-2V2h2z" /></svg>
                        </button>
                        <button
                          type="button"
                          onClick={e => handleDelete(e, room.id)}
                          title="Delete"
                          className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-[#FF3535] hover:bg-white/5 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="1.2em" height="1.2em" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M18 22H6v-2h12zM9 6h6V4h2v2h5v2h-2v12h-2V8H6v12H4V8H2V6h5V4h2zm6-2H9V2h6z" /></svg>
                        </button>
                      </div>

                      {/* Mobile — 3-dot kebab */}
                      <button
                        type="button"
                        data-room-kebab
                        onClick={e => toggleMenu(e, room.id)}
                        aria-label="More actions"
                        aria-expanded={openMenuId === room.id}
                        className="md:hidden w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 rounded transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M10 4h4v4h-4zM10 10h4v4h-4zM10 16h4v4h-4z" /></svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Mobile 3-dot menu */}
      {openMenuId && menuPosRef.current && (() => {
        const room = rooms.find(r => r.id === openMenuId);
        if (!room) return null;
        const copied = copiedRoomId === room.id;
        const pos = menuPosRef.current!;
        return (
          <div
            data-room-menu
            className="fixed z-[60] w-44 bg-[#272727] border border-white/10 rounded shadow-2xl overflow-hidden flex flex-col py-1 md:hidden"
            style={{ left: pos.x, top: pos.y }}
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={e => { handleCopyCode(e as any, room); setOpenMenuId(null); }}
              className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 text-sm hover:bg-white/[0.06] transition-colors ${copied ? 'text-[#10B981]' : 'text-zinc-200'}`}
            >
              <span className="material-symbols-outlined text-[16px] leading-none">
                {copied ? 'check' : 'key'}
              </span>
              <span className="font-mono text-xs font-medium">{copied ? 'Code copied!' : 'Copy join code'}</span>
            </button>
            <button
              type="button"
              onClick={e => { startEdit(e as any, room); setOpenMenuId(null); }}
              className="flex items-center gap-2.5 w-full text-left px-3 py-2.5 text-sm text-zinc-200 hover:bg-white/[0.06] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M4 16h2v2h2v2h2v2H2v-8h2zm8 4h-2v-2h2zm2-2h-2v-2h2zm-4-2H8v-2h2zm6 0h-2v-2h2zM6 14H4v-2h2zm6 0h-2v-2h2zm6 0h-2v-2h2zM8 12H6v-2h2zm6 0h-2v-2h2zm6 0h-2v-2h2zm-10-2H8V8h2zm8 0h-2V8h2zm4 0h-2V8h2zM12 8h-2V6h2zm4 0h-2V6h2zm4 0h-2V6h2zm-6-2h-2V4h2zm4 0h-2V4h2zm-2-2h-2V2h2z" /></svg>
              <span className="font-mono text-xs font-medium">Edit</span>
            </button>
            <div className="mx-2 my-1 h-px bg-white/10" />
            <button
              type="button"
              onClick={e => { handleDelete(e as any, room.id); setOpenMenuId(null); }}
              className="flex items-center gap-2.5 w-full text-left px-3 py-2.5 text-sm text-[#FF3535] hover:bg-[#FF3535]/10 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" /><path fill="currentColor" d="M18 22H6v-2h12zM9 6h6V4h2v2h5v2h-2v12h-2V8H6v12H4V8H2V6h5V4h2zm6-2H9V2h6z" /></svg>
              <span className="font-mono text-xs font-medium">Delete</span>
            </button>
          </div>
        );
      })()}
    </>
  );
};

export default Rooms;
