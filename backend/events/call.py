# backend/events/call.py

from flask_socketio import emit, join_room, leave_room
from extensions import socketio, r
from services.auth_service import get_current_user_id
import services.room_service as room_service

# A ring is a transient reservation on a room: only one member may ring a
# room at a time, and the reservation self-expires if nobody ever answers.
RING_TTL_SECONDS = 60


def _ring_key(room):
    return f"room:{room}:ringing"


def _as_text(value):
    """Redis is configured with decode_responses=True, but normalize anyway."""
    if isinstance(value, bytes):
        return value.decode()
    return value


def _get_ringer(room):
    return _as_text(r.get(_ring_key(room)))


def _release_ring(room, user_id):
    """Drop the ring reservation only if it is still held by this user."""
    current = _get_ringer(room)
    if current is None or current == user_id:
        r.delete(_ring_key(room))


def _get_room(data):
    return data.get('room') if isinstance(data, dict) else None


# ============================================================
# Group Ring — ring every member currently in the room
# ============================================================

@socketio.on('call_ring')
def handle_call_ring(data):
    """
    Ring all members of a room. Nobody joins the call until someone accepts.
    data: { room: string }
    """
    room = _get_room(data)
    if not room or room == 'public':
        emit('call_ring_failed', {
            'room': room,
            'message': 'Group calling is restricted to private rooms.'
        })
        return

    caller_id = get_current_user_id()

    existing = _get_ringer(room)
    if existing and existing != caller_id:
        emit('call_ring_failed', {
            'room': room,
            'message': f"#{existing} is already ringing this room."
        })
        return

    r.set(_ring_key(room), caller_id, ex=RING_TTL_SECONDS)
    room_service.refresh_room_ttl(room, caller_id)

    # Target the chat room, not call:<room>, so every member is notified
    emit('call_incoming', {
        'from': caller_id,
        'room': room,
        'name': room_service.get_room_metadata(room).get('name', room)
    }, to=room, include_self=False)


@socketio.on('call_ring_cancel')
def handle_call_ring_cancel(data):
    """Caller gave up ringing. data: { room: string }"""
    room = _get_room(data)
    if not room:
        return

    user_id = get_current_user_id()
    _release_ring(room, user_id)
    emit('call_ring_cancelled', {'room': room, 'from': user_id}, to=room, include_self=True)


@socketio.on('call_ring_accept')
def handle_call_ring_accept(data):
    """A member accepted: the ring is over and the call mesh forms. data: { room: string }"""
    room = _get_room(data)
    if not room:
        return

    user_id = get_current_user_id()
    r.delete(_ring_key(room))
    emit('call_ring_answered', {'room': room, 'from': user_id}, to=room, include_self=True)


@socketio.on('call_ring_decline')
def handle_call_ring_decline(data):
    """A member declined. Other members keep ringing. data: { room: string }"""
    room = _get_room(data)
    if not room:
        return

    user_id = get_current_user_id()
    emit('call_ring_declined', {'room': room, 'from': user_id}, to=room, include_self=True)


@socketio.on('call_join')
def handle_call_join(data):
    """
    Client joins a call in a room.
    Notifies existing callers in that room so they can send WebRTC offers.
    """
    if not isinstance(data, dict):
        return

    room = data.get('room')
    if not room:
        return

    user_id = get_current_user_id()
    call_room = f"call:{room}"

    # Join the call room for group notifications
    join_room(call_room)

    # Broadcast to existing callers that a new peer arrived
    emit('call_user_joined', {'peerId': user_id, 'room': room}, to=call_room, include_self=False)


@socketio.on('call_leave')
def handle_call_leave(data):
    """
    Client hangs up or closes the call view.
    """
    room = data.get('room') if isinstance(data, dict) else None
    if not room:
        return

    user_id = get_current_user_id()
    call_room = f"call:{room}"

    leave_room(call_room)
    emit('call_user_left', {'peerId': user_id, 'room': room}, to=call_room, include_self=False)


# ============================================================
# 1-to-1 WebRTC Signaling Exchange
# ============================================================

@socketio.on('call_offer')
def handle_call_offer(data):
    """
    Relay SDP Offer from caller to target peer.
    data: { target: string, sdp: RTCSessionDescriptionInit }
    """
    if not isinstance(data, dict) or not data.get('target'):
        return

    sender_id = get_current_user_id()
    emit('call_offer', {
        'sender': sender_id,
        'sdp': data.get('sdp')
    }, to=f"user:{data['target']}")


@socketio.on('call_answer')
def handle_call_answer(data):
    """
    Relay SDP Answer back to the caller.
    data: { target: string, sdp: RTCSessionDescriptionInit }
    """
    if not isinstance(data, dict) or not data.get('target'):
        return

    sender_id = get_current_user_id()
    emit('call_answer', {
        'sender': sender_id,
        'sdp': data.get('sdp')
    }, to=f"user:{data['target']}")


@socketio.on('call_ice')
def handle_call_ice(data):
    """
    Relay ICE Candidate to target peer.
    data: { target: string, candidate: RTCIceCandidateInit }
    """
    if not isinstance(data, dict) or not data.get('target'):
        return

    sender_id = get_current_user_id()
    emit('call_ice', {
        'sender': sender_id,
        'candidate': data.get('candidate')
    }, to=f"user:{data['target']}")
