import json
from extensions import r
from config import MAX_KEY_PACKAGES, MAX_COMMIT_HISTORY, TTL_SECONDS
from services.room_service import refresh_room_ttl

def save_key_packages(user_id, key_packages):
    """Register a fresh pool of key packages for a user."""
    if not key_packages:
        return 0
    packages_to_add = key_packages[:MAX_KEY_PACKAGES]
    key = f"user:{user_id}:keypackages"
    pipe = r.pipeline()
    pipe.delete(key)  # Purge stale keys from previous sessions on refresh
    pipe.rpush(key, *packages_to_add)
    pipe.ltrim(key, -MAX_KEY_PACKAGES, -1)  # Keep pool capped
    pipe.expire(key, TTL_SECONDS)
    pipe.execute()
    return len(packages_to_add)

def get_key_package_count(user_id):
    """Return available key packages count for user."""
    return r.llen(f"user:{user_id}:keypackages") or 0

def append_key_package(user_id, key_package_b64):
    """Append a single key package to user's pool."""
    if not key_package_b64:
        return
    key = f"user:{user_id}:keypackages"
    pipe = r.pipeline()
    pipe.rpush(key, key_package_b64)
    pipe.ltrim(key, -MAX_KEY_PACKAGES, -1)
    pipe.expire(key, TTL_SECONDS)
    pipe.execute()

def pop_key_package(target_user_id):
    """Pop one KeyPackage from the pool (MLS consume-once semantics)."""
    key_package_b64 = r.lpop(f"user:{target_user_id}:keypackages")
    if not key_package_b64:
        # Fallback to single keypackage key if legacy exists
        key_package_b64 = r.get(f"user:{target_user_id}:keypackage")
    return key_package_b64

def resolve_designated_inviter(user_id, room_owner, active_peers):
    """
    Resolve which peer should invite the newcomer.
    When the requester IS the owner, the designated_inviter must be a non-owner member.
    """
    if user_id == room_owner:
        non_owner_peers = [u for u in active_peers if u != user_id]
        return non_owner_peers[0] if non_owner_peers else room_owner
    return room_owner

def advance_epoch_and_store_commit(room, expected_epoch, commit_payload):
    """
    Check epoch conflict and advance epoch, saving commit to bounded backlog.
    Returns: (success, error_type, current_epoch, new_epoch)
    """
    current_epoch_str = r.get(f"room:{room}:epoch")
    current_epoch = int(current_epoch_str) if current_epoch_str is not None else 0

    if expected_epoch is not None:
        try:
            if int(expected_epoch) != current_epoch:
                return False, 'epoch_conflict', current_epoch, None
        except (ValueError, TypeError):
            pass

    new_epoch = r.incr(f"room:{room}:epoch")
    r.expire(f"room:{room}:epoch", TTL_SECONDS)

    commit_record = json.dumps({
        'epoch': new_epoch,
        'commit': commit_payload.get('commit'),
        'proposal': commit_payload.get('proposal')
    })
    pipe = r.pipeline()
    pipe.rpush(f"room:{room}:commits", commit_record)
    pipe.ltrim(f"room:{room}:commits", -MAX_COMMIT_HISTORY, -1)
    pipe.expire(f"room:{room}:commits", TTL_SECONDS)
    pipe.execute()

    # Slide TTL on all room keys so active MLS sessions are never evicted
    refresh_room_ttl(room)

    return True, None, current_epoch, new_epoch

def get_missed_commits(room, user_id, from_epoch):
    """
    Fetch missed commits for an authorized user from specified epoch.
    Returns: (commits_list, latest_epoch) or (None, None) if unauthorized
    """
    user_rooms = r.smembers(f"user:{user_id}:rooms") or set()
    if room not in user_rooms:
        return None, None

    current_epoch_str = r.get(f"room:{room}:epoch")
    current_epoch = int(current_epoch_str) if current_epoch_str is not None else 0

    raw_commits = r.lrange(f"room:{room}:commits", 0, -1)
    missed = []
    for item in raw_commits:
        try:
            record = json.loads(item)
            if record.get('epoch', 0) > from_epoch:
                missed.append(record)
        except Exception:
            continue

    return missed, current_epoch
