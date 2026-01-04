#!/bin/bash
# Initialize private Git submodules for Vercel builds
# Requires GITHUB_REPO_CLONE_TOKEN environment variable

set -e

if [ -z "$GITHUB_REPO_CLONE_TOKEN" ]; then
    echo "Warning: GITHUB_REPO_CLONE_TOKEN not set, skipping private submodule auth"
    git submodule update --init --recursive
    exit 0
fi

echo "Configuring Git for private submodule access..."

# Configure Git to use token for GitHub HTTPS URLs
git config --global url."https://${GITHUB_REPO_CLONE_TOKEN}@github.com/".insteadOf "https://github.com/"

# Initialize and update submodules
git submodule update --init --recursive

echo "Submodules initialized successfully"
