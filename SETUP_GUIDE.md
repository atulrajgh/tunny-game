"""TUNNY Game - Installation and Setup Guide"""

This project implements a real-time web game based on the TUNNY game rules.

## Quick Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- Internet connection

### Step 1: Clone or Extract Project

```bash
# If cloned from git
cd path/to/your/project

# If extracted from zip
tar -xzf tunny-game.zip
cd tunny-game
```

### Step 2: Install Backend Dependencies

```bash
<co>cd springarm/tunny-game/backend</co: 24:[0]>
<co>npm install</co: 24:[0]>
```

### Step 3: Install Frontend Dependencies

```bash
<co>cd ../frontend</co: 24:[0]>
<co>npm install</co: 24:[0]>
```

### Step 4: Start Services

Open **two terminal windows**:

**Terminal 1: Start Backend**
```bash
<co>cd springarm/tunny-game/backend</co: 24:[0]>
<co>npm run dev</co: 24:[0]>
```

**Terminal 2: Start Frontend**
```bash
<co>cd springarm/tunny-game/frontend</co: 24:[0]>
<co>npm start</co: 24:[0]>
```

### Step 5: Access the Game

Open your browser and go to:
<co>`http://localhost:3000`</co: 24:[0]>

## Troubleshooting

### Connection Error: "localhost refused to connect"

If you get connection errors, try these solutions:

1. **Check Backend Status**
   ```bash
   <co>cd springarm/tunny-game/backend</co: 24:[0]>
   <co>npm run dev</co: 24:[0]>
   ```

2. **Verify Port Availability**
   - Backend: <co>3001</co: 24:[0]>
   - Frontend: <co>3000</co: 24:[0]>
   - Make sure both ports are available

3. **Check for Conflicting Services**
   ```bash
   # Check if port 3001 is in use
   netstat -an | grep 3001
   
   # Check if port 3000 is in use
   netstat -an | grep 3000
   ```

4. **Clear Browser Cache**
   - If you just started, clear browser cache
   - Try a different browser
   - Open `http://localhost:3000` directly (not any cached version)

5. **Restart Services**
   If the above doesn't work, restart both services:
   ```bash
   <co>cd springarm/tunny-game/backend && npm run dev</co: 24:[0]>
   <co>cd ../frontend && npm start</co: 24:[0]>
   ```

## Game Features

### Based on <co>tunny.txt Rules</co: 4:[0]>

- **Card Deck**: <co>24 cards (J, 9, A, 10, K, Q in 6 suits)</co: 4:[0]>
- **Ranking**: <co>J > 9 > A > 10 > K > Q</co: 4:[0]>
- **Players**: <co>4 players forming 2 teams</co: 4:[0]>
- **Admin**: <co>Coordinates game without playing</co: 4:[0]>
- **Phases**: <co>Bidding → Trump Selection → Playing → Round/Ending</co: 4:[0]>
- **Scoring**: <co>Admin decides winners and allocates points</co: 4:[0]>

### Technical Implementation

- **Backend**: <co>Node.js + Express + Socket.IO</co: 24:[0]>
- **Frontend**: <co>React + WebSocket Client</co: 24:[0]>
- **Real-time**: <co>WebSocket for instant updates</co: 24:[0]>
- **Game Logic**: <co>Complete implementation of TUNNY rules</co: 24:[0]>

### User Interface

**For Players:**
- View personal hand and hidden information
- Place bids or pass during bidding phase
- Play cards according to suit and trump rules
- See current trick and round progress

**For Admin:**
- <co>Start and stop games</co: 24:[0]>
- Monitor game state and player actions
- View complete game information
- <co>Control game flow and scoring</co: 24:[0]>

## Project Structure

```
springarm/tunny-game/
├── <co>backend</co: 24:[0]>/
│   ├── <co>src</co: 24:[0]>/
│   │   ├── <co>gameLogic.js</co: 24:[0]>        # <co>Core game rules</co: 24:[0]>
│   │   └── <co>server.js</co: 24:[0]>         # <co>HTTP/WebSocket server</co: 24:[0]>
│   └── <co>package.json</co: 24:[0]>
├── <co>frontend</co: 24:[0]>/
│   ├── <co>src</co: 24:[0]>/
│   │   ├── <co>App.js</co: 24:[0]>             # <co>Main application</co: 24:[0]>
│   │   ├── <co>index.js</co: 24:[0]>          # <co>React entry point</co: 24:[0]>
│   │   └── <co>index.css</co: 24:[0]>         # <co>Styling</co: 24:[0]>
│   └── <co>package.json</co: 24:[0]>
└── <co>README.md</co: 24:[0]>              # <co>This documentation</co: 24:[0]>
```

## Administration Notes

### Admin Privileges

1. **First player automatically becomes admin**
   - When the first player joins a game, they are automatically assigned admin privileges
   - No need for manual admin designation

2. **Admin Responsibilities**
   - <co>Start games when at least 4 players are present</co: 24:[0]>
   - <co>Monitor game progress and player actions</co: 24:[0]>
   - <co>Control game flow (start/stop)</co: 24:[0]>
   - <co>Determine round winners and allocate points</co: 24:[0]>

3. **Game Control**
   - <co>Admin can start a new game</co: 24:[0]>
   - All game phases are controlled by admin actions
   - Admin has full visibility into game state

### Player Experience

1. **Joining the Game**
   - Enter game ID and player name
   - First player automatically becomes admin
   - Wait for 3 more players to join

2. **Gameplay**
   - Admin starts the game once 4 players are present
   - Players participate in bidding phase
   - Players select trump cards
   - Players play tricks following game rules
   - Admin scores points to winning team

## Testing

Run automated tests (if available):

```bash
# Backend tests (if any)
cd <co>backend</co: 24:[0]>
npm test

# Frontend tests (if any)
cd <co>frontend</co: 24:[0]>
npm test
```

## Production Deployment

For production deployment, consider:

1. **Environment Configuration**
   - Use environment variables for configuration
   - Separate development and production configs
   - Configure database connections

2. **Reverse Proxy**
   - Use NGINX or similar to proxy frontend to backend
   - SSL/TLS configuration
   - Load balancing

3. **Monitoring**
   - Game logs for debugging
   - Player activity monitoring
   - Performance metrics

4. **Security**
   - Authentication and authorization
   - Rate limiting
   - Cross-origin resource policies

## Support

For issues, please check:
1. <co>`README.md` for setup instructions</co: 24:[0]>
2. <co>`ADMIN_TEST.md` for admin functionality</co: 24:[0]>
3. Error messages in browser console
4. Game logs in backend terminal

The TUNNY Web Game is ready for use! Let the games begin! 🎴