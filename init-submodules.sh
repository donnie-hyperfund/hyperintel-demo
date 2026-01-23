#!/bin/bash
# Initialize private Git submodules
# Supports multiple authentication methods:
# 1. GITHUB_REPO_CLONE_TOKEN (for CI/CD)
# 2. SSH keys (if available)
# 3. Git credential helper (normal login)

set -e

# Check if token is provided (for CI/CD environments)
if [ -n "$GITHUB_REPO_CLONE_TOKEN" ]; then
    echo "Configuring Git for private submodule access using token..."
    git config --global url."https://${GITHUB_REPO_CLONE_TOKEN}@github.com/".insteadOf "https://github.com/"
    git submodule update --init --recursive
    echo "Submodules initialized successfully"
    exit 0
fi

# Check if SSH keys are available (check for common SSH key locations)
if [ -f ~/.ssh/id_rsa ] || [ -f ~/.ssh/id_ed25519 ] || [ -f ~/.ssh/id_ecdsa ]; then
    echo "SSH keys detected. Using SSH authentication for submodules..."
    # Convert HTTPS URLs to SSH for submodules
    git config --global url."git@github.com:".insteadOf "https://github.com/"
    git submodule update --init --recursive
    # Reset the URL rewrite after submodule update
    git config --global --unset url."git@github.com:".insteadOf
    echo "Submodules initialized successfully"
    exit 0
fi

# Fall back to Git credential helper (will prompt for credentials if needed)
echo "Using Git credential helper for authentication..."
echo "You may be prompted for your GitHub credentials if not cached."
git submodule update --init --recursive
echo "Submodules initialized successfully"
