# rooms life cycle logic

import time
import uuid
import json
import secrets
from extensions import r
from config import TTL_SECONDS

JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 32 chars: uppercase & digits, omitting ambiguous 0/O and 1/I

def generate_join_code(length=12):
    """Generate unguessable 12-character alphanumeric code."""
    return "".join(secrets.choice(JOIN_CODE_ALPHABET) for _ in range(length))

def normalize_join_code(code):
    """Normalize user input: trim, remove dashes/spaces, uppercase."""
    if not code:
        return ""
    return str(code).replace("-", "").replace(" ", "").strip().upper()

def create_room(user_id, raw_name=None):
    """Create a new room with MLS metadata, 12-char join code, and initialize its history."""
    room_id = uuid.uuid4().hex[:8]
    room_name = f"room_{room_id}"
    display_name = raw_name.strip()[:64] if raw_name and raw_name.strip() else f"Private Room #{room_id[:4]}"

    join_code = generate_join_code(12)
    while r.exists(f"chat:join_code:{join_code}"):
        join_code = generate_join_code(12)

    pipe = r.pipeline()
    # 1. Room metadata with MLS binding & join code
    pipe.hset(f"chat:room:{room_name}", mapping={
        "name": display_name,
        "owner": user_id,
        "created_at": time.time(),
        "mls_enabled": "1",
        "join_code": join_code
    })
    pipe.expire(f"chat:room:{room_name}", TTL_SECONDS)
    # 2. Reverse index for join code
    pipe.set(f"chat:join_code:{join_code}", room_name, ex=TTL_SECONDS)
    # 3. Creator is authorized member
    pipe.sadd(f"room:{room_name}:authorized_members", user_id)
    pipe.expire(f"room:{room_name}:authorized_members", TTL_SECONDS)
    # 4. Add room to creator's personal room set
    pipe.sadd(f"user:{user_id}:rooms", room_name)
    pipe.expire(f"user:{user_id}:rooms", TTL_SECONDS)
    # 5. Initialize room epoch counter
    pipe.set(f"room:{room_name}:epoch", "0", ex=TTL_SECONDS)
    # 6. Initialize room message history
    room_key = f"chat:messages:{room_name}"
    pipe.lpush(room_key, json.dumps({
        "room": room_name,
        "senderId": "system",
        "text": f"Room '{display_name}' created.",
        "timestamp": time.time()
    }))
    pipe.expire(room_key, TTL_SECONDS)
    pipe.execute()

    return room_name, display_name, join_code

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
            
            # Lazily generate join_code for pre-existing legacy rooms
            join_code = meta.get("join_code")
            if not join_code:
                join_code = generate_join_code(12)
                r.hset(f"chat:room:{room_id}", "join_code", join_code)
                r.set(f"chat:join_code:{join_code}", room_id, ex=TTL_SECONDS)

            parsed_rooms.append({
                "id": room_id,
                "name": meta.get("name", room_id),
                "owner": meta.get("owner"),
                "mls_enabled": meta.get("mls_enabled") == "1",
                "created_at": float(meta.get("created_at", 0)),
                "join_code": join_code
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
        join_code = room_meta.get("join_code")
        pipe = r.pipeline()
        if join_code:
            pipe.delete(f"chat:join_code:{join_code}")
        pipe.delete(f"room:{room_id}:pending_requests")
        pipe.delete(f"room:{room_id}:authorized_members")
        pipe.delete(f"chat:messages:{room_id}")
        pipe.delete(f"chat:room:{room_id}")
        pipe.delete(f"room:{room_id}:epoch")
        pipe.delete(f"room:{room_id}:commits")
        pipe.delete(f"room:{room_id}:active_users")
        pipe.srem(f"user:{user_id}:rooms", room_id)
        pipe.execute()
        return True, True
    else:
        pipe = r.pipeline()
        pipe.srem(f"user:{user_id}:rooms", room_id)
        pipe.srem(f"room:{room_id}:active_users", user_id)
        pipe.srem(f"room:{room_id}:authorized_members", user_id)
        pipe.execute()
        return False, True

def get_room_metadata(room_id):
    """Retrieve metadata dictionary for room."""
    if not room_id or room_id == 'public':
        return {}
    return r.hgetall(f"chat:room:{room_id}")

def get_room_by_join_code(raw_code):
    """Lookup room by 12-char join code."""
    clean_code = normalize_join_code(raw_code)
    if not clean_code or len(clean_code) != 12:
        return None, None
    room_name = r.get(f"chat:join_code:{clean_code}")
    if isinstance(room_name, bytes):
        room_name = room_name.decode()
    if not room_name:
        return None, None
    meta = get_room_metadata(room_name)
    if not meta:
        return None, None
    return room_name, meta

def is_user_authorized_for_room(user_id, room_name):
    """Verify if user is the owner or an accepted member of the room."""
    if not room_name or room_name == 'public':
        return True
    meta = get_room_metadata(room_name)
    if not meta:
        return False
    if meta.get("owner") == user_id:
        return True
    return bool(r.sismember(f"room:{room_name}:authorized_members", user_id))

def create_join_request(requester_id, room_name):
    """Create a pending knock request for room owner approval."""
    request_id = uuid.uuid4().hex[:8]
    req_data = {
        "requestId": request_id,
        "requesterId": requester_id,
        "room": room_name,
        "timestamp": time.time()
    }
    r.hset(f"room:{room_name}:pending_requests", request_id, json.dumps(req_data))
    r.expire(f"room:{room_name}:pending_requests", TTL_SECONDS)
    return request_id

def resolve_join_request(owner_id, room_name, request_id, decision):
    """
    Handle owner acceptance or rejection of a join request.
    Returns: (success: bool, requester_id: str | None)
    """
    room_meta = get_room_metadata(room_name)
    if not room_meta or room_meta.get("owner") != owner_id:
        return False, None
    
    raw_req = r.hget(f"room:{room_name}:pending_requests", request_id)
    if not raw_req:
        return False, None
    if isinstance(raw_req, bytes):
        raw_req = raw_req.decode()
    try:
        req_obj = json.loads(raw_req)
        requester_id = req_obj.get("requesterId")
    except Exception:
        requester_id = None

    r.hdel(f"room:{room_name}:pending_requests", request_id)

    if not requester_id:
        return False, None

    if decision == 'accept':
        pipe = r.pipeline()
        pipe.sadd(f"room:{room_name}:authorized_members", requester_id)
        pipe.expire(f"room:{room_name}:authorized_members", TTL_SECONDS)
        pipe.sadd(f"user:{requester_id}:rooms", room_name)
        pipe.expire(f"user:{requester_id}:rooms", TTL_SECONDS)
        pipe.execute()
        return True, requester_id
    else:
        return False, requester_id

def cancel_join_request(requester_id, room_name, request_id):
    """Cancel a pending join request initiated by the requester."""
    raw_req = r.hget(f"room:{room_name}:pending_requests", request_id)
    if raw_req:
        if isinstance(raw_req, bytes):
            raw_req = raw_req.decode()
        try:
            req_obj = json.loads(raw_req)
            if req_obj.get("requesterId") == requester_id:
                r.hdel(f"room:{room_name}:pending_requests", request_id)
                return True
        except Exception:
            pass
    return False

def refresh_room_ttl(room_id, user_id=None):
    """
    Slide the TTL on all keys tied to a room whenever there is activity
    (message sent, MLS commit, etc.).  This prevents Redis from evicting
    an actively-used room mid-session.
    """
    if not room_id or room_id == 'public':
        return
    pipe = r.pipeline()
    # Core room keys
    pipe.expire(f"chat:room:{room_id}", TTL_SECONDS)
    pipe.expire(f"chat:messages:{room_id}", TTL_SECONDS)
    pipe.expire(f"room:{room_id}:epoch", TTL_SECONDS)
    pipe.expire(f"room:{room_id}:commits", TTL_SECONDS)
    pipe.expire(f"room:{room_id}:active_users", TTL_SECONDS)
    pipe.expire(f"room:{room_id}:authorized_members", TTL_SECONDS)
    pipe.expire(f"room:{room_id}:pending_requests", TTL_SECONDS)
    # Caller's membership set (if known)
    if user_id:
        pipe.expire(f"user:{user_id}:rooms", TTL_SECONDS)
    pipe.execute()

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
    """Remove user from active lists of all rooms on disconnect. Returns (user_rooms, user_calls)."""
    user_rooms = r.smembers(f"user:{user_id}:rooms") or set()
    for rm in user_rooms:
        r.srem(f"room:{rm}:active_users", user_id)

    # Also clean up from any active calls
    user_calls = r.smembers(f"user:{user_id}:active_calls") or set()
    for rm in user_calls:
        r.srem(f"room:{rm}:call_participants", user_id)
    r.delete(f"user:{user_id}:active_calls")

    return user_rooms, user_calls

# ============================================================
# Active Call State Management
# ============================================================

def add_call_participant(room_id, user_id):
    """Add a user to the active call session in a room."""
    if not room_id or room_id == 'public':
        return []
    pipe = r.pipeline()
    pipe.sadd(f"room:{room_id}:call_participants", user_id)
    pipe.expire(f"room:{room_id}:call_participants", TTL_SECONDS)
    pipe.sadd(f"user:{user_id}:active_calls", room_id)
    pipe.expire(f"user:{user_id}:active_calls", TTL_SECONDS)
    pipe.execute()
    return get_call_participants(room_id)

def remove_call_participant(room_id, user_id):
    """Remove a user from the active call session in a room."""
    if not room_id or room_id == 'public':
        return []
    pipe = r.pipeline()
    pipe.srem(f"room:{room_id}:call_participants", user_id)
    pipe.srem(f"user:{user_id}:active_calls", room_id)
    pipe.execute()
    return get_call_participants(room_id)

def get_call_participants(room_id):
    """Get active call participant user IDs in a room."""
    if not room_id or room_id == 'public':
        return []
    return list(r.smembers(f"room:{room_id}:call_participants") or set())

def get_call_info(room_id):
    """Get status dictionary for active call in a room."""
    if not room_id or room_id == 'public':
        return {'active': False, 'participants': [], 'ringing': False, 'ringer': None}
    participants = get_call_participants(room_id)
    ringer = r.get(f"room:{room_id}:ringing")
    if isinstance(ringer, bytes):
        ringer = ringer.decode()
    return {
        'active': len(participants) > 0,
        'participants': participants,
        'ringing': bool(ringer),
        'ringer': ringer
    }

def clear_call(room_id):
    """Clear all call participants and ringing state for a room."""
    if not room_id or room_id == 'public':
        return
    pipe = r.pipeline()
    pipe.delete(f"room:{room_id}:call_participants")
    pipe.delete(f"room:{room_id}:ringing")
    pipe.execute()

