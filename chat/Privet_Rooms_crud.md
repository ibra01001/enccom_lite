# Private Rooms CRUD Architecture Guide

This document explains how to implement Create, Read, Update, and Delete (CRUD) operations for private rooms in a real-time WebSocket environment with Flask, React, and Redis.

---

## Core Security & Privacy Rule

* **Public Room (`public`)**: The only room listed globally and accessible by default to all users.
* **Private Rooms**: Every created room is private. Private rooms must never be listed globally to all connected users, as doing so leaks room IDs and violates privacy.

---

## Data Storage Strategy

To support private room CRUD operations cleanly:

1. **Redis Key Design**:
   * `chat:messages:<room_id>` (List): Holds the message history for a specific room.
   * `chat:room:<room_id>` (Hash): Stores metadata (e.g., `name`, `owner_id`, `created_at`).
   * `user:<user_id>:rooms` (Set): Stores the list of private room IDs a specific user belongs to.

2. **Client-Side Storage**:
   * React state / `localStorage`: Persists room IDs locally on the user's browser so they remember their joined private rooms across page reloads.

---

## CRUD Operations Breakdown

### 1. Create (C)
When a user clicks **+ Private Room**:

* **Client Action**: Emits a `create_room` socket event with an optional custom room title.
* **Backend Action**:
  1. Generates a random, unguessable `room_id` (e.g. using `uuid.uuid4().hex`).
  2. Stores metadata in Redis (`chat:room:<room_id>`).
  3. Adds the creator's ID to `user:<user_id>:rooms`.
  4. Executes `flask_join_room(room_id)` to subscribe the socket.
* **Response**: Emits `room_created` back **only to the creator** with the new room details.

#### Example Event Payload:
```json
// Event: create_room
{
  "name": "Project Alpha"
}

// Response Event: room_created (sent to creator)
{
  "room_id": "room_a1b2c3d4",
  "name": "Project Alpha",
  "role": "owner"
}
```

---

### 2. Read / List (R)
Retrieving message history and active room lists without exposing private rooms:

* **List User's Rooms**:
  * Instead of scanning all Redis keys globally (`chat:messages:*`), the client requests their personal joined rooms via `get_my_rooms`.
  * Backend returns `['public']` + any room IDs listed under `user:<user_id>:rooms`.

* **Fetch Room History**:
  * When switching rooms, the client emits `join_room` with `{"room": "room_a1b2c3d4"}`.
  * Backend returns `initial history` for that specific room ID.

---

### 3. Update (U)
Renaming an existing private room:

* **Client Action**: Room owner sends an `update_room` event with `room_id` and `new_name`.
* **Backend Validation**:
  1. Checks if `sender_id == owner_id` stored in `chat:room:<room_id>`.
  2. If valid, updates the `name` field in Redis hash `chat:room:<room_id>`.
* **Broadcast**: Emits `room_updated` to all connected sockets currently inside that room (`to=room_id`) so their UI updates live.

---

### 4. Delete (D)
Deleting a private room and removing members:

* **Client Action**: Owner clicks **Delete Room** and emits `delete_room` with `room_id`.
* **Backend Action**:
  1. Validates that `sender_id == owner_id`.
  2. Deletes message history key `chat:messages:<room_id>` and metadata `chat:room:<room_id>` from Redis.
  3. Emits `room_deleted` to all active sockets in `room_id`.
* **Client Behavior on Delete**:
  1. Active members receive `room_deleted`.
  2. Frontend removes `room_id` from local room list and automatically redirects members back to the `public` room.

---

### 5. Join via 12-Character Code & Owner Approval (Knock)
To prevent unauthorized room joins and link leakage:

* **12-Character Code**:
  * Upon room creation, an unguessable 12-character alphanumeric code is generated (e.g. `K9X2-M4P7-Q1J8`) and mapped in Redis (`chat:join_code:<CODE>`).
  * Instead of sharing plain URLs with room IDs, the owner shares this 12-character code.
* **Knock Flow**:
  * Guest pastes the code and emits `request_join_room`.
  * Guest enters pending state (`join_request_pending`).
  * Room owner receives `room_join_request` with the requester's ID and room name.
* **Owner Decision**:
  * Owner emits `respond_join_request` with decision `'accept'` or `'reject'`.
  * If accepted: guest is added to `room:<room_id>:authorized_members` and receives `join_request_accepted`, allowing them to safely join the room and enter the MLS group.
  * If rejected: guest receives `join_request_rejected`.

---

## Summary Matrix

| Operation | Socket Event | Scope | Redis Action |
|---|---|---|---|
| Create | `create_room` | Creator only | Set `chat:room:<room_id>` hash + `chat:join_code:<code>` |
| Read | `get_my_rooms` | User only | Query `user:<user_id>:rooms` |
| Request Join | `request_join_room` | Guest -> Owner | Set `room:<room_id>:pending_requests` |
| Approve/Reject | `respond_join_request` | Owner -> Guest | Add to `authorized_members` or delete request |
| Update | `update_room` | Room Members | HSET `chat:room:<room_id>` `name` |
| Delete | `delete_room` | Room Members | DEL keys & join code index |
