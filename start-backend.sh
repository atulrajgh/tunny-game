#!/bin/bash

# Simple server starter script

echo "Starting TUNNY Game Backend..."
echo "Port: 3001"
echo

echo "Starting the server. This may take a moment..."

cd "$(dirname "$0")/backend"

# Try to start the server
node src/server.js || (
    echo ""
    echo "ERROR: Server failed to start!"
    echo ""
    echo "Common issues:"
    echo "1. Port 3001 might already be in use"
    echo "2. Missing Node.js dependencies"
    echo "3. File permissions issues"
    echo ""
    echo "Try these solutions:"
    echo "1. Kill any existing node processes on port 3001"
    echo "2. Run 'npm install' in the backend directory"
    echo "3. Run this script again from the project root"
    echo ""
    exit 1
)
