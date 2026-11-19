# Fix pnpm lockfile configuration issues
# PowerShell version for Windows environments

param(
    [switch]$Force = $false
)

Write-Host "🔧 Fixing pnpm lockfile configuration..." -ForegroundColor Cyan

# Function to check if pnpm is installed
function Test-PnpmInstalled {
    try {
        $version = pnpm --version
        Write-Host "✅ pnpm found: $version" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "❌ pnpm is not installed. Please install pnpm first:" -ForegroundColor Red
        Write-Host "npm install -g pnpm@9" -ForegroundColor Yellow
        return $false
    }
}

# Function to set consistent pnpm configuration
function Set-PnpmConfiguration {
    Write-Host "📝 Setting pnpm configuration..." -ForegroundColor Yellow
    
    try {
        pnpm config set auto-install-peers true
        pnpm config set strict-peer-dependencies false
        pnpm config set prefer-frozen-lockfile true
        pnpm config set enable-pre-post-scripts true
        Write-Host "✅ pnpm configuration updated" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "❌ Failed to set pnpm configuration: $_" -ForegroundColor Red
        return $false
    }
}

# Function to clean and reinstall
function Invoke-CleanInstall {
    Write-Host "🧹 Cleaning existing installation..." -ForegroundColor Yellow
    
    # Remove node_modules and lockfile
    if (Test-Path "node_modules") {
        Remove-Item -Recurse -Force "node_modules"
        Write-Host "  ✅ Removed node_modules" -ForegroundColor Green
    }
    
    if (Test-Path "pnpm-lock.yaml") {
        Remove-Item -Force "pnpm-lock.yaml"
        Write-Host "  ✅ Removed old lockfile" -ForegroundColor Green
    }
    
    # Clear pnpm store if needed
    Write-Host "🗂️  Clearing pnpm store..." -ForegroundColor Yellow
    try {
        pnpm store prune
    }
    catch {
        Write-Host "⚠️  Could not prune pnpm store, continuing..." -ForegroundColor Yellow
    }
    
    Write-Host "📦 Installing dependencies with correct configuration..." -ForegroundColor Yellow
    try {
        pnpm install
        Write-Host "✅ Installation completed successfully" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "❌ Installation failed: $_" -ForegroundColor Red
        return $false
    }
}

# Function to try installing with existing lockfile
function Test-ExistingLockfile {
    Write-Host "🔄 Attempting to install with existing lockfile..." -ForegroundColor Yellow
    
    try {
        $output = pnpm install --frozen-lockfile --prefer-offline 2>&1
        Write-Host "✅ Successfully installed with frozen lockfile" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "⚠️  Lockfile configuration mismatch detected" -ForegroundColor Yellow
        return $false
    }
}

# Main execution
function Main {
    Write-Host "Starting pnpm lockfile fix..." -ForegroundColor Cyan
    Write-Host "Current directory: $(Get-Location)" -ForegroundColor Gray
    Write-Host "Node.js version: $(node --version)" -ForegroundColor Gray
    Write-Host ""
    
    if (-not (Test-PnpmInstalled)) {
        exit 1
    }
    
    if (-not (Set-PnpmConfiguration)) {
        exit 1
    }
    
    # Try to install with existing lockfile first
    if ((Test-Path "pnpm-lock.yaml") -and -not $Force) {
        if (Test-ExistingLockfile) {
            Write-Host "🎉 No lockfile issues detected!" -ForegroundColor Green
        } else {
            Write-Host "🔄 Regenerating lockfile with correct configuration..." -ForegroundColor Yellow
            if (-not (Invoke-CleanInstall)) {
                exit 1
            }
        }
    } else {
        Write-Host "🔄 Performing clean installation..." -ForegroundColor Yellow
        if (-not (Invoke-CleanInstall)) {
            exit 1
        }
    }
    
    # Verify the installation
    Write-Host "🔍 Verifying installation..." -ForegroundColor Yellow
    try {
        pnpm list --depth=0 | Out-Null
        Write-Host "✅ All dependencies are properly installed" -ForegroundColor Green
    }
    catch {
        Write-Host "⚠️  Some dependency issues detected, but installation completed" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "🎉 pnpm lockfile configuration has been fixed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Commit the updated pnpm-lock.yaml file" -ForegroundColor White
    Write-Host "  2. Push your changes to trigger CI/CD" -ForegroundColor White
    Write-Host "  3. The pipeline should now run without lockfile errors" -ForegroundColor White
    Write-Host ""
}

# Run the main function
Main