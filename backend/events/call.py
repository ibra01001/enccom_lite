# backend/events/call.py

from flask_socketio import emit, join_room, leave_room
from extensions import socketio
from services.auth_service import get_current_user_id


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
