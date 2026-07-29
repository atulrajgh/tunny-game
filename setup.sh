#!/bin/bash

# Simple TUNNY Game Setup Script

echo "=== TUNNY Web Game Setup ==="
echo

# Check if backend exists
if [ ! -f "springarm/tunny-game/backend/package.json" ]; then
    echo "ERROR: Backend directory not found!"
    echo "Please run this from the correct directory."
    exit 1
fi

# Check if frontend exists
if [ ! -f "springarm/tunny-game/frontend/package.json" ]; then
    echo "ERROR: Frontend directory not found!"
    echo "Please run this from the correct directory."
    exit 1
fi

echo "✓ Project structure found"
echo

# Install dependencies
echo "Installing backend dependencies..."
cd springarm/tunny-game/backend
npm install 2>/dev/null || (echo "Backend install failed"; exit 1)

echo "Installing frontend dependencies..."
cd ../frontend
npm install 2>/dev/null || (echo "Frontend install failed"; exit 1)

echo
enecho "=== Setup Complete ==="
echo

echo "To run the game:"
echo "1. Open two terminal windows"
echo "2. In Terminal 1 (Backend):"
echo "   cd springarm/tunny-game/backend"
echo "   npm start"
echo "3. In Terminal 2 (Frontend):"
echo "   cd springarm/tunny-game/frontend"
echo "   npm start"
echo

echo "Access the game at: http://localhost:3000"
echo
echo "For detailed instructions, see README.md"
