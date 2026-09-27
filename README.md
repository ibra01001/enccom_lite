<div align="center">

# Enccom
## Privet , Real time Application .
<img width="509" height="151" alt="image" src="https://github.com/user-attachments/assets/b8293a55-6796-4489-a03c-62e90dbbf567" />

</div>

## THE PROBLEM WITH MODERN APPS:
**Identity :** modern apps require too much personal informations , name ,email , phone number , location , device you use  ect ..................................  
**Account Takeover (hacking) :** Having a prement account identity make you valubale target, 429 million social media accounts were hacked in 2025,Instagram leads with 31% of all social media hacks, followed by Facebook (27%) and LinkedIn (18%) source: station X ,https://app.stationx.net/articles/social-media-hacking-statistics
## ENCCOM Solution :
**No account needed :** means no identity means no personal informations.

**Temporary Database:** all your converstaions will be deleted so no data to collect.

**encrypted messages :** they scramble your text into unreadable code on your device, ensuring that only the intended recipient can unlock and read it.

**video call :** peer to peer video call.

## Enccom target audience:
Users who need temporary, private conversations, sensitive discussions.

Developers, students, and tech communities interested in secure communication technologies.

Anyone concerned about account theft, tracking, and persistent digital identities.

People who do not want to create permanent accounts or share personal information such as phone numbers or emails.

## CHAT SYSETEM:
For a good performance we cant just use Http protocol alone 
Chat need to be in real time so we used websocket  protocol connection
 (socket.io)

<img width="200" height="200" padding=10px alt="Cybersecurity Evolution" src="https://github.com/user-attachments/assets/0be16da9-4ad1-43ef-bee9-118e82aa1645" />

## ENCRYPTION PROTOCOL WE USED IN ENCCOM ?:
To encrypte messages one of the best ways is to use a cryptographic library never build your
own in ENCCOM we used OpenMls protocol (Messaging Layer Security protocol)

**Openmls link :**<a href=https://docs.rs/openmls/latest/openmls/> click here<a>

### Extract the module for react :
run the command : `wasm-pack build --target bundler`

## Video Calls using WebRtc (under development)

WebRTC (Web Real-Time Communication) is an open-source framework that allows browsers and mobile apps to establish direct, peer-to-peer (P2P) connections to share video, audio, and arbitrary data without needing an intermediate media server


<img width="300" height="300" padding="10px" alt="Cybersecurity Evolution(1)" src="https://github.com/user-attachments/assets/3222b27e-3ad1-4e0a-b365-8220b47c2044" />



## How the app is safe ?

1- you have no data to lose so hackers dont cares to hack you.

2 - even if somehow the hacker managed to enter the convo he cant read the messages 

3 - no identity and temporary database for messages.

4 - peer to peer video call ( still working on it ....)


### Lunching the App :
`docker-compose up --build`

<div align="center">

# Tech used 
[![React](https://img.shields.io/badge/React-frontend-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Flask](https://img.shields.io/badge/Flask-backend-000000?style=for-the-badge&logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![Python](https://img.shields.io/badge/Python-3.x-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-realtime-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
[![Redis](https://img.shields.io/badge/Redis-in--memory-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-containerized-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![WebRTC](https://img.shields.io/badge/WebRTC-video-333333?style=for-the-badge&logo=webrtc&logoColor=white)](https://webrtc.org/)

</div>

<img width="1920" height="1014" alt="image" src="https://github.com/user-attachments/assets/73d86826-203f-4ea2-b205-e05cdfeec5c4" />

