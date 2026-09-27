# Connection events

# pyrefly: ignore [missing-import]

from flask import request
from flask_socketio import emit, join_room as flask_join_room

from extensions import socketio
from services.auth_service import get_current_user_id
from services.room_service import remove_user_from_active_rooms


@socketio.on("connect")
def handle_connect(auth=None):
    """
    Handle a new Socket.IO connection.

    auth contains the authentication object sent by the Socket.IO client.
    It is optional so the handler also works when no auth object is sent.
    """

    user_id = get_current_user_id()

    # Native Socket.IO user room:
    # enables clean targeted emissions.
    flask_join_room(f"user:{user_id}")

    print(f"connected: {request.sid} (#{user_id})")

    # Single source of truth:
    # server tells the client its assigned ID.
    emit(
        "session_info",
        {
            "myId": user_id
        }
    )


@socketio.on("disconnect")
def handle_disconnect():
    """
    Handle Socket.IO disconnection.
    """

    user_id = get_current_user_id()

    print(f"disconnected: {request.sid} (#{user_id})")

    user_rooms, user_calls = remove_user_from_active_rooms(user_id)

    for room in user_rooms:
        emit(
            "peer_left",
            {
                "peerId": user_id,
                "room": room
            },
            to=room,
            include_self=False
        )

    for room in user_calls:
        call_room = f"call:{room}"
        emit(
            "call_user_left",
            {
                "peerId": user_id,
                "room": room
            },
            to=call_room,
            include_self=False
        )