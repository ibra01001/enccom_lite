#room crud requests
from flask import request
from flask_socketio import emit, join_room as flask_join_room, leave_room as flask_leave_room
from extensions import socketio
from services.auth_service import get_current_user_id
import services.room_service as room_service
import services.chat_service as chat_service

@socketio.on('create_room')
def create_room(data=None):
    user_id = get_current_user_id()
    raw_name = data.get('name') if isinstance(data, dict) else None
    
    room_name, display_name = room_service.create_room(user_id, raw_name)
    flask_join_room(room_name)

    emit('room_created', {
        'room': room_name,
        'name': display_name,
        'owner': user_id
    })
    return room_name

@socketio.on('get_my_rooms')
def get_my_rooms():
    user_id = get_current_user_id()
    rooms_info = room_service.get_user_rooms(user_id)
    emit('rooms_list', {'rooms': rooms_info})

@socketio.on('update_room')
def update_room(data):
    if not isinstance(data, dict):
        return
    user_id = get_current_user_id()
    room = data.get('room')
    new_name = data.get('name')
    
    sanitized_name = room_service.update_room_name(user_id, room, new_name)
    if sanitized_name:
        emit('room_updated', {'room': room, 'name': sanitized_name}, to=room, include_self=True)

@socketio.on('delete_room')
def delete_room(data):
    room = data.get('room') if isinstance(data, dict) else data
    user_id = get_current_user_id()
    
    is_owner, success = room_service.delete_or_leave_room(user_id, room)
    if not success:
        return

    if is_owner:
        emit('room_deleted', {'room': room}, to=room, include_self=True)
        emit('mls_group_destroyed', {'room': room}, to=room, include_self=True)
    else:
        flask_leave_room(room)
        emit('peer_left', {'peerId': user_id, 'room': room}, to=room, include_self=False)
        emit('room_deleted', {'room': room})  # Signal only calling client to remove from sidebar
        emit('mls_group_destroyed', {'room': room})

@socketio.on('join_room')
def handle_join_room(data):
    room = data.get('room', 'public') if isinstance(data, dict) else 'public'
    user_id = get_current_user_id()

    room_meta = {}
    if room != 'public':
        room_meta = room_service.get_room_metadata(room)
        if not room_meta:
            emit('join_error', {'room': room, 'message': 'Room not found or has been deleted.'})
            return

        room_service.join_room_record(user_id, room)

    flask_join_room(room)
    print(f'Client {request.sid} (#{user_id}) joined room "{room}"')
    
    active_peers = room_service.get_active_peers(room)
    is_owner = (room_meta.get("owner") == user_id) if room != 'public' else False
    current_epoch = room_service.get_room_epoch(room)

    call_info = room_service.get_call_info(room) if room != 'public' else {'active': False, 'participants': []}

    emit('room_joined', {
        'room': room,
        'name': room_meta.get('name', room) if room != 'public' else 'Public Chat',
        'owner': room_meta.get('owner', 'system') if room != 'public' else 'system',
        'isOwner': is_owner,
        'activePeers': active_peers,
        'mls_enabled': room_meta.get('mls_enabled') == '1' if room != 'public' else False,
        'epoch': current_epoch,
        'call': {
            'active': call_info['active'],
            'participants': call_info['participants']
        }
    })

    # Notify existing room members so they can initiate MLS welcome exchange
    if room != 'public':
        room_owner = room_meta.get('owner')
        emit('peer_joined', {
            'peerId': user_id,
            'room': room,
            'owner': room_owner,
            'designated_inviter': room_owner
        }, to=room, include_self=False)

    history = chat_service.get_room_history(room)
    emit('initial history', {'room': room, 'history': history})
