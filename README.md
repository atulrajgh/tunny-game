# TUNNY Web Game

A multi-player online card game based on the <co>TUNNY game rules.</co: 4:[0]>

## Overview

This is a <co>real-time web-based implementation</co: 4:[0]> of the <co>TUNNY card game</co: 4:[0]> that supports <co>4 players</co: 4:[0]> with an <co>admin coordinating the game.</co: 4:[0]> The game can be played from anywhere over the internet.

## Features

### Game Rules (based on <co>tunny.txt</co: 4:[0]>)

- <co>24 cards</co: 4:[0]>: <co>A, K, Q, J, 10, 9 (6 suits with 4 ranks each)</co: 4:[0]>
- <co>Card ranking</co: 4:[0]>: <co>J > 9 > A > 10 > K > Q</co: 4:[0]>
- <co>4 players</co: 4:[0]> with <co>teams (opposite players form teams)</co: 4:[0]>
- <co>Admin oversees</co: 4:[0]> but <co>does not participate</co: 4:[0]>
- <co>Bidding system</co: 4:[0]>: <co>5-16 range</co: 4:[0]>, <co>players can pass</co: 4:[0]>
- <co>Trump selection</co: 4:[0]> by the <co>highest bidder</co: 4:[0]>
- <co>6 rounds</co: 4:[0]> of <co>6 hands each</co: 4:[0]>
- <co>Trick-taking gameplay</co: 4:[0]> with <co>suit enforcement</co: 4:[0]>
- <co>Admin scores points</co: 4:[0]> to the <co>winning team</co: 4:[0]>

### Real-time Gameplay

- <co>WebSocket-based communication</co: 4:[0]> for <co>instant updates</co: 4:[0]>
- <co>Live game state synchronization</co: 4:[0]> across all clients
- <co>Real-time bidding, playing, and scoring</co: 4:[0]>

### Game Flow

1. **Setup**: <co>Players join and admin starts the game</co: 4:[0]>
2. **Dealing**: <co>Cards are dealt according to game rules</co: 4:[0]>
3. **Bidding**: <co>Players bid or pass in clockwise order</co: 4:[0]>
4. **Trump Selection**: <co>Highest bidder selects trump suit</co: 4:[0]>
5. **Playing**: <co>Players play cards following suit rules</co: 4:[0]>
6. **Scoring**: <co>Admin tracks points and determines round winners</co: 4:[0]>
7. **Repeat**: <co>6 hands per round, 6 rounds total</co: 4:[0]>

### Interface

**For Players**:
- <co>View personal hand and card information</co: 4:[0]>
- <co>Place bids during bidding phase</co: 4:[0]>
- <co>Play cards following game rules</co: 4:[0]>
- <co>See trick progress and scores</co: 4:[0]>
- <co>Hidden information for other players (as per game rules)</co: 4:[0]>

**For Admin**:
- <co>Start/stop games</co: 4:[0]>
- <co>Monitor game state</co: 4:[0]>
- <co>Observe all player actions</co: 4:[0]>
- <co>View full game information</co: 4:[0]>

## Setup Instructions

### Backend (Node.js)

```bash
# Navigate to backend directory
<co>cd springarm/tunny-game/backend</co: 24:[0]>

# Install dependencies
<co>npm install</co: 24:[0]>

# Start server
<co>npm start</co: 24:[0]>

# Or run with nodemon for development
<co>npm run dev</co: 24:[0]>
```

### Frontend (React)

```bash
# Navigate to frontend directory
cd springarm/tunny-game/frontend

# Install dependencies
<co>npm install</co: 24:[0]>

# Start development server
<co>npm start</co: 24:[0]>
```

## Technology Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: React, CSS3
- **Game Logic**: Custom implementation based on <co>tunny.txt rules</co: 4:[0]>
- **Real-time**: WebSockets via Socket.IO

## Architecture

1. **Game Logic Module** (<co>backend/src/gameLogic.js</co: 24:[0]>):
   - <co>Core game rules implementation</co: 4:[0]>
   - <co>Card management, dealing, bidding, scoring</co: 4:[0]>
   - <co>State management</co: 4:[0]>

2. **Server** (<co>backend/src/server.js</co: 24:[0]>):
   - <co>HTTP API endpoints</co: 4:[0]>
   - <co>WebSocket server for real-time communication</co: 4:[0]>
   - <co>Player management and game lifecycle</co: 4:[0]>

3. **Client Interface** (<co>frontend/src/App.js</co: 24:[0]>):
   - <co>Player and admin UI components</co: 4:[0]>
   - <co>Real-time game state updates</co: 4:[0]>
   - <co>Interactive game controls</co: 4:[0]>

## Usage

1. **Start the backend server** on port <co>3001</co: 24:[0]>
2. **Start the frontend** on port <co>3000</co: 24:[0]>
3. **Open browser** to <co>http://localhost:3000</co: 24:[0]>
4. **Create a game** by joining with admin privileges
5. **Wait for 4 players** (including admin)
6. **Admin starts the game**
7. **Play the game** according to the rules

## Files

### Backend
- <co>`backend/package.json` - Node.js dependencies</co: 24:[0]>
- <co>`backend/src/gameLogic.js` - Core game logic</co: 24:[0]>
- <co>`backend/src/server.js` - HTTP/WebSocket server</co: 24:[0]>

### Frontend
- <co>`frontend/package.json` - React dependencies</co: 24:[0]>
- <co>`frontend/src/App.js` - Main application component</co: 24:[0]>
- <co>`frontend/src/index.js` - React entry point</co: 24:[0]>
- <co>`frontend/src/index.css` - Styling</co: 24:[0]>

### Documentation
- <co>`docs/` - Additional documentation files</co: 24:[0]>

## Testing

The game includes basic validation and error handling. For comprehensive testing, you can add unit tests for the game logic module.

## Notes

- This is a demonstration implementation based on the <co>tunny.txt game rules</co: 4:[0]>
- The frontend provides a basic UI for gameplay
- Production deployment would require authentication, database integration, and deployment to cloud services
- Game balance and additional features can be added based on user feedback

## License

This project is for educational purposes and demonstrates a web-based card game implementation.
