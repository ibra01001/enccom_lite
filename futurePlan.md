# chatbox

## Planned Features

1. Users can create private rooms ... done 
2. Users can change the room name after creation ... done
3. Users can delete the room and remove everyone in it ... done
4. encrypted messages ... done 
5. Voice call peer to peer

7. send images and videos they should be encrypted and not stored on the server and installed directly to the user's device.


## What I Need to Fix

1. Make it a globally persistent WebSocket connection with on-demand, room-based message history retrieval ... done
2. fix logic of creating rooms all created rooms must be privet ... done
3. Replace room link sharing with 12-character join codes (letters & digits) + owner accept/reject knock approval ... done

## Open Questions

0. What should I protect, and from whom?
1. How can I provide a server for the app? Should I host my own server or use a service like Railway?
2. How can I make the app more private and secure, so no one can track the user?
3. Can I make all conversations in rooms peer to peer?
4. Sending files should go directly to the receiver, not through the server. The receiver just needs to accept the file to start receiving it. I don't know if that is possible.
5. I must protect user privacy by all means and not monitor them. IP addresses must be anonymized or hidden, even from the app.