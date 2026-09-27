# rooms life cycle logic

import time
import uuid
import json
from extensions import r
from config import TTL_SECONDS

def create_room(user_id, raw_name=None):
    """Create a new room with MLS metadata and initialize its history."""
    room_id = uuid.uuid4().hex[:8]
    room_name = f"room_{room_id}"
    display_name = raw_name.strip()[:64] if raw_name and raw_name.strip() else f"Private Room #{room_id[:4]}"

    pipe = r.pipeline()
    # 1. Room metadata with MLS binding
    pipe.hset(f"chat:room:{room_name}", mapping={
        "name": display_name,
        "owner": user_id,
        "created_at": time.time(),
        "mls_enabled": "1"
    })
    pipe.expire(f"chat:room:{room_name}", TTL_SECONDS)
    # 2. Add room to creator's personal room set
    pipe.sadd(f"user:{user_id}:rooms", room_name)
    pipe.expire(f"user:{user_id}:rooms", TTL_SECONDS)
    # 3. Initialize room epoch counter
    pipe.set(f"room:{room_name}:epoch", "0", ex=TTL_SECONDS)
    # 4. Initialize room message history
    room_key = f"chat:messages:{room_name}"
    pipe.lpush(room_key, json.dumps({
        "room": room_name,
        "senderId": "system",
        "text": f"Room '{display_name}' created.",
        "timestamp": time.time()
    }))
    pipe.expire(room_key, TTL_SECONDS)
    pipe.execute()

    return room_name, display_name

def get_user_rooms(user_id):
    """Fetch all accessible rooms for user with batch metadata & auto-pruning."""
    user_rooms = r.smembers(f"user:{user_id}:rooms") or set()
    private_rooms = [rm for rm in user_rooms if rm != 'public']
    
    rooms_info = [{
        "id": "public",
        "name": "Public Chat",
        "owner": "system",
        "mls_enabled": False
    }]
    
    if private_rooms:
        pipe = r.pipeline()
        for room_id in private_rooms:
            pipe.hgetall(f"chat:room:{room_id}")
        metas = pipe.execute()

        stale_rooms = []
        parsed_rooms = []
        for room_id, meta in zip(private_rooms, metas):
            if not meta:
                stale_rooms.append(room_id)
                continue
            parsed_rooms.append({
                "id": room_id,
                "name": meta.get("name", room_id),
                "owner": meta.get("owner"),
                "mls_enabled": meta.get("mls_enabled") == "1",
                "created_at": float(meta.get("created_at", 0))
            })

        if stale_rooms:
            r.srem(f"user:{user_id}:rooms", *stale_rooms)

        parsed_rooms.sort(key=lambda x: x["created_at"], reverse=True)
        rooms_info.extend(parsed_rooms)
            
    return rooms_info

def update_room_name(user_id, room_id, new_name):
    """Update room display name if the requesting user is the owner."""
    if not room_id or room_id == 'public' or not new_name:
        return None

    room_meta = r.hgetall(f"chat:room:{room_id}")
    if room_meta and room_meta.get("owner") == user_id:
        sanitized_name = new_name.strip()[:64]
        r.hset(f"chat:room:{room_id}", "name", sanitized_name)
        return sanitized_name
    return None

def delete_or_leave_room(user_id, room_id):
    """
    Handle deletion by owner (purging room) or leave by guest.
    Returns: (is_owner, success_bool)
    """
    if not room_id or room_id == 'public':
        return None, False
        
    room_meta = r.hgetall(f"chat:room:{room_id}")
    if not room_meta:
        return None, False

    is_owner = (room_meta.get("owner") == user_id)

    if is_owner:
        pipe = r.pipeline()
        pipe.delete(f"chat:messages:{room_id}")
        pipe.delete(f"chat:room:{room_id}")
        pipe.delete(f"room:{room_id}:epoch")
        pipe.delete(f"room:{room_id}:commits")
        pipe.delete(f"room:{room_id}:active_users")
        pipe.srem(f"user:{user_id}:rooms", room_id)
        pipe.execute()
        return True, True
    else:
        r.srem(f"user:{user_id}:rooms", room_id)
        r.srem(f"room:{room_id}:active_users", user_id)
        return False, True

def get_room_metadata(room_id):
    """Retrieve metadata dictionary for room."""
    if not room_id or room_id == 'public':
        return {}
    return r.hgetall(f"chat:room:{room_id}")

def join_room_record(user_id, room_id):
    """Record user in room active users and user's rooms set."""
    if room_id != 'public':
        pipe = r.pipeline()
        pipe.sadd(f"user:{user_id}:rooms", room_id)
        pipe.expire(f"user:{user_id}:rooms", TTL_SECONDS)
        pipe.sadd(f"room:{room_id}:active_users", user_id)
        pipe.expire(f"room:{room_id}:active_users", TTL_SECONDS)
        pipe.execute()

def get_active_peers(room_id):
    """Get active peer user IDs in a room."""
    if room_id == 'public':
        return []
    return list(r.smembers(f"room:{room_id}:active_users") or set())

def get_room_epoch(room_id):
    """Get current epoch integer for a room."""
    if room_id == 'public':
        return 0
    current_epoch_str = r.get(f"room:{room_id}:epoch")
    return int(current_epoch_str) if current_epoch_str is not None else 0

def remove_user_from_active_rooms(user_id):
    """Remove user from active lists of all rooms on disconnect. Returns user_rooms."""
    user_rooms = r.smembers(f"user:{user_id}:rooms") or set()
    for rm in user_rooms:
        r.srem(f"room:{rm}:active_users", user_id)
    return user_rooms
