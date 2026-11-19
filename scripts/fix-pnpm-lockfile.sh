#!/bin/bash

# Fix pnpm lockfile configuration issues
# This script ensures consistent pnpm configuration across environments

set -e

echo "🔧 Fixing pnpm lockfile configuration..."

# Function to check if pnpm is installed
check_pnpm() {
    if ! command -v pnpm &> /dev/null; then
        echo "❌ pnpm is not installed. Please install pnpm first:"
        echo "npm install -g pnpm@9"
        exit 1
    fi
    echo "✅ pnpm found: $(pnpm --version)"
}

# Function to set consistent pnpm configuration
configure_pnpm() {
    echo "📝 Setting pnpm configuration..."
    pnpm config set auto-install-peers true
    pnpm config set strict-peer-dependencies false
    pnpm config set prefer-frozen-lockfile true
    pnpm config set enable-pre-post-scripts true
    echo "✅ pnpm configuration updated"
}

# Function to clean and reinstall
clean_install() {
    echo "🧹 Cleaning existing installation..."
    
    # Remove node_modules and lockfile
    if [ -d "node_modules" ]; then
        rm -rf node_modules
        echo "  ✅ Removed node_modules"
    fi
    
    if [ -f "pnpm-lock.yaml" ]; then
        rm -f pnpm-lock.yaml
        echo "  ✅ Removed old lockfile"
    fi
    
    # Clear pnpm store if needed
    echo "🗂️  Clearing pnpm store..."
    pnpm store prune
    
    echo "📦 Installing dependencies with correct configuration..."
    pnpm install
    
    echo "✅ Installation completed successfully"
}

# Function to try installing with existing lockfile
try_install() {
    echo "🔄 Attempting to install with existing lockfile..."
    
    if pnpm install --frozen-lockfile --prefer-offline 2>/dev/null; then
        echo "✅ Successfully installed with frozen lockfile"
        return 0
    else
        echo "⚠️  Lockfile configuration mismatch detected"
        return 1
    fi
}

# Main execution
main() {
    echo "Starting pnpm lockfile fix..."
    echo "Current directory: $(pwd)"
    echo "Node.js version: $(node --version)"
    
    check_pnpm
    configure_pnpm
    
    # Try to install with existing lockfile first
    if try_install; then
        echo "🎉 No lockfile issues detected!"
    else
        echo "🔄 Regenerating lockfile with correct configuration..."
        clean_install
    fi
    
    # Verify the installation
    echo "🔍 Verifying installation..."
    if pnpm list --depth=0 >/dev/null 2>&1; then
        echo "✅ All dependencies are properly installed"
    else
        echo "⚠️  Some dependency issues detected, but installation completed"
    fi
    
    echo ""
    echo "🎉 pnpm lockfile configuration has been fixed!"
    echo ""
    echo "Next steps:"
    echo "  1. Commit the updated pnpm-lock.yaml file"
    echo "  2. Push your changes to trigger CI/CD"
    echo "  3. The pipeline should now run without lockfile errors"
    echo ""
}

# Run the main function
main "$@"