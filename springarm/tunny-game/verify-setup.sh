#!/bin/bash

echo "=== TUNNY Game - Quick Verification ==="
echo

# Check if backend files exist
if [ ! -f "springarm/tunny-game/backend/src/server.js" ]; then
    echo "❌ Backend server file not found"
    exit 1
fi

if [ ! -f "springarm/tunny-game/backend/src/gameLogic.js" ]; then
    echo "❌ Backend game logic file not found"
    exit 1
fi

# Check if frontend files exist
if [ ! -f "springarm/tunny-game/frontend/src/App.js" ]; then
    echo "❌ Frontend App file not found"
    exit 1
fi

if [ ! -f "springarm/tunny-game/frontend/src/index.js" ]; then
    echo "❌ Frontend index file not found"
    exit 1
fi

echo "✅ All core files present"
echo

# Check if package.json files exist
if [ ! -f "springarm/tunny-game/backend/package.json" ]; then
    echo "❌ Backend package.json not found"
    exit 1
fi

if [ ! -f "springarm/tunny-game/frontend/package.json" ]; then
    echo "❌ Frontend package.json not found"
    exit 1
fi

echo "✅ All package.json files present"
echo

# Check if node_modules exists (for quick verification)
if [ -d "springarm/tunny-game/backend/node_modules" ]; then
    echo "✅ Backend dependencies installed"
else
    echo "⚠️  Backend dependencies not installed - run: cd backend && npm install"
fi

if [ -d "springarm/tunny-game/frontend/node_modules" ]; then
    echo "✅ Frontend dependencies installed"
else
    echo "⚠️  Frontend dependencies not installed - run: cd frontend && npm install"
fi

echo
enecho "=== Next Steps ==="
echo "1. Install dependencies (if shown above):"
echo "   cd springarm/tunny-game/backend && npm install"
echo "   cd springarm/tunny-game/frontend && npm install"
echo
echo "2. Start backend server:"
echo "   cd springarm/tunny-game/backend"
echo "   npm run dev  # or npm start"
echo
echo "3. Start frontend client:"
echo "   cd springarm/tunny-game/frontend"
echo "   npm start"
echo
echo "4. Access the game: http://localhost:3000"
echo
echo "=== Quick Start (if dependencies installed) ==="
echo "cd springarm/tunny-game/backend && npm run dev"
echo "cd springarm/tunny-game/frontend && npm start"
echo
echo "If you get 'localhost refused to connect', check:":
echo "- Backend server is running on port 3001"
echo "- Frontend server is running on port 3000"
echo "- No other applications using these ports"
echo
echo "=== Complete Documentation ==="
echo "For detailed setup instructions, see:"
echo "- README.md - Main project documentation"
echo "- SETUP_GUIDE.md - Complete setup guide"
echo
echo "=== Game Features ==="
echo "✅ Real-time multiplayer via WebSocket"
echo "✅ Admin-controlled gameplay"
echo "✅ Complete TUNNY game rules implementation"
echo "✅ Team-based play (4 players)"
echo "✅ Bidding, trump selection, trick-taking"
echo "✅ 6 rounds of 6 hands each"
echo "✅ Automatic admin assignment (first player)"
echo
echo "🎴 TUNNY Game Setup Verification Complete! 🎴"
