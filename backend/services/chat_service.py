#

import json
from extensions import r
from config import MAX_HISTORY, TTL_SECONDS, MAX_MSG_BYTES
from services.room_service import refresh_room_ttl

def validate_message_payload(msg, room_meta):
    """
    Validate message payload size and encryption requirement.
    Returns (is_valid, error_message)
    """
    raw_payload = json.dumps(msg)
    if len(raw_payload.encode('utf-8')) > MAX_MSG_BYTES:
        return False, 'Payload size exceeds limit'

    room = msg.get('room', 'public')
    if room != 'public':
        if room_meta and room_meta.get("mls_enabled") == "1" and not msg.get('ciphertext'):
            return False, 'Encrypted ciphertext required for this room'

    return True, None

def save_message(msg):
    """
    Persist chat message to Redis bounded history list.
    """
    room = msg.get('room', 'public')
    room_key = f"chat:messages:{room}"
    try:
        msg_to_store = {k: v for k, v in msg.items() if k != 'clientMsgId'}
        pipe = r.pipeline()
        pipe.lpush(room_key, json.dumps(msg_to_store))
        pipe.ltrim(room_key, 0, MAX_HISTORY - 1)
        pipe.expire(room_key, TTL_SECONDS)
        pipe.execute()
        # Slide TTL on all room keys so active sessions are never evicted
        sender_id = msg.get('senderId')
        refresh_room_ttl(room, user_id=sender_id)
    except Exception as e:
        print(f"Error saving message to Redis: {e}")

def get_room_history(room):
    """
    Retrieve chronological message history for a room.
    """
    room_key = f"chat:messages:{room}"
    try:
        raw_history = r.lrange(room_key, 0, MAX_HISTORY - 1)
        # Fallback for legacy key if public room key is empty
        if not raw_history and room == 'public':
            raw_history = r.lrange("chat:messages", 0, MAX_HISTORY - 1)
        return [json.loads(m) for m in reversed(raw_history)]
    except Exception as e:
        print(f"Error fetching history for room '{room}': {e}")
        return []
