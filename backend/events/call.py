# backend/events/call.py

from flask_socketio import emit, join_room, leave_room
from extensions import socketio, r
from services.auth_service import get_current_user_id
import services.room_service as room_service

# A ring is a transient reservation on a room: allows members to receive
# incoming call alerts. Self-expires if nobody answers.
RING_TTL_SECONDS = 45


def _ring_key(room):
    return f"room:{room}:ringing"


def _as_text(value):
    """Normalize redis value to string."""
    if isinstance(value, bytes):
        return value.decode()
    return value


def _get_ringer(room):
    return _as_text(r.get(_ring_key(room)))


def _release_ring(room, user_id=None):
    """Drop the ring reservation."""
    current = _get_ringer(room)
    if user_id is None or current is None or current == user_id:
        r.delete(_ring_key(room))


def _get_room(data):
    return data.get('room') if isinstance(data, dict) else None


# ============================================================
# Group Ring & Call Status Handlers
# ============================================================

@socketio.on('get_call_status')
def handle_get_call_status(data):
    """Query current active call status for a room."""
    room = _get_room(data)
    if not room or room == 'public':
        return
    call_info = room_service.get_call_info(room)
    emit('call_status', {
        'room': room,
        'active': call_info['active'],
        'participants': call_info['participants'],
        'ringing': call_info['ringing'],
        'ringer': call_info['ringer']
    })


@socketio.on('call_ring')
def handle_call_ring(data):
    """
    Ring all members of a room. If a call is already active or ringing,
    handle seamlessly without throwing collision errors.
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

    # 1. If a call is ALREADY active with participants, inform caller so they can join directly
    active_participants = room_service.get_call_participants(room)
    if active_participants:
        emit('call_status', {
            'room': room,
            'active': True,
            'participants': active_participants,
            'action': 'join_existing'
        })
        return

    # 2. Check if another member is already ringing (simultaneous call)
    existing_ringer = _get_ringer(room)
    if existing_ringer and existing_ringer != caller_id:
        # Both members initiated a call at roughly the same time:
        # Instead of erroring out, treat as mutual call interest!
        emit('call_ring_answered', {
            'room': room,
            'from': existing_ringer,
            'mutual': True
        })
        return

    # Set ring reservation
    r.set(_ring_key(room), caller_id, ex=RING_TTL_SECONDS)
    room_service.refresh_room_ttl(room, caller_id)

    payload = {
        'from': caller_id,
        'room': room,
        'name': room_service.get_room_metadata(room).get('name', room)
    }

    # Broadcast to the chat room socket group
    emit('call_incoming', payload, to=room, include_self=False)

    # ALSO broadcast directly to each room member's individual user room
    # (guarantees delivery even if their active tab or socket hasn't focused the room)
    active_peers = room_service.get_active_peers(room)
    for peer_id in active_peers:
        if peer_id != caller_id:
            emit('call_incoming', payload, to=f"user:{peer_id}")


@socketio.on('call_ring_cancel')
def handle_call_ring_cancel(data):
    """Caller gave up ringing. data: { room: string }"""
    room = _get_room(data)
    if not room:
        return

    user_id = get_current_user_id()
    _release_ring(room, user_id)
    emit('call_ring_cancelled', {'room': room, 'from': user_id}, to=room, include_self=True)

    # Also notify active peers directly
    for peer_id in room_service.get_active_peers(room):
        if peer_id != user_id:
            emit('call_ring_cancelled', {'room': room, 'from': user_id}, to=f"user:{peer_id}")


@socketio.on('call_ring_accept')
def handle_call_ring_accept(data):
    """A member accepted: ring phase ends and call mesh forms."""
    room = _get_room(data)
    if not room:
        return

    user_id = get_current_user_id()
    r.delete(_ring_key(room))

    # Notify room that ring was answered
    emit('call_ring_answered', {
        'room': room,
        'from': user_id
    }, to=room, include_self=True)

    for peer_id in room_service.get_active_peers(room):
        if peer_id != user_id:
            emit('call_ring_answered', {'room': room, 'from': user_id}, to=f"user:{peer_id}")


@socketio.on('call_ring_decline')
def handle_call_ring_decline(data):
    """A member declined. Other members keep ringing."""
    room = _get_room(data)
    if not room:
        return

    user_id = get_current_user_id()
    emit('call_ring_declined', {'room': room, 'from': user_id}, to=room, include_self=True)


@socketio.on('call_join')
def handle_call_join(data):
    """
    Client joins an active call in a room.
    Notifies existing callers so they can send WebRTC offers.
    Syncs current participant list back to the client.
    """
    if not isinstance(data, dict):
        return

    room = data.get('room')
    if not room:
        return

    user_id = get_current_user_id()
    call_room = f"call:{room}"

    # Join the call room for group WebRTC notifications
    join_room(call_room)

    # Add user to active call participants in Redis
    participants = room_service.add_call_participant(room, user_id)
    r.delete(_ring_key(room))

    # Notify existing peers in the call mesh
    emit('call_user_joined', {'peerId': user_id, 'room': room}, to=call_room, include_self=False)

    # Sync current participants to joining user
    emit('call_session_sync', {
        'room': room,
        'participants': participants
    })

    # Broadcast updated call status to the whole chat room (Active Call Banner)
    emit('call_status', {
        'room': room,
        'active': True,
        'participants': participants
    }, to=room, include_self=True)


@socketio.on('call_leave')
def handle_call_leave(data):
    """
    Client hangs up or leaves the call view.
    """
    room = data.get('room') if isinstance(data, dict) else None
    if not room:
        return

    user_id = get_current_user_id()
    call_room = f"call:{room}"

    leave_room(call_room)
    participants = room_service.remove_call_participant(room, user_id)

    # Notify remaining peers in the call
    emit('call_user_left', {'peerId': user_id, 'room': room}, to=call_room, include_self=False)

    # If no participants remain, call has ended
    if not participants:
        room_service.clear_call(room)
        emit('call_ended', {'room': room}, to=room, include_self=True)
    else:
        # Update call status with remaining participants
        emit('call_status', {
            'room': room,
            'active': True,
            'participants': participants
        }, to=room, include_self=True)


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

