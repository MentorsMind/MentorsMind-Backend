# URGENT: pnpm Lockfile Configuration Fix

## 🚨 Immediate Fix Required

Your CI/CD is failing with:
```
ERR_PNPM_LOCKFILE_CONFIG_MISMATCH Cannot proceed with the frozen installation. 
The current "settings.autoInstallPeers" configuration doesn't match the value found in the lockfile
```

## ⚡ Quick Fix (Choose One):

### Option 1: Automated Fix Script
```bash
# On Unix/Linux/Mac:
chmod +x scripts/fix-pnpm-lockfile.sh
./scripts/fix-pnpm-lockfile.sh

# On Windows:
./scripts/fix-pnpm-lockfile.ps1
```

### Option 2: Manual Fix
```bash
# Set correct configuration
pnpm config set auto-install-peers true
pnpm config set strict-peer-dependencies false

# Remove old lockfile and reinstall
rm pnpm-lock.yaml
pnpm install

# Commit the new lockfile
git add pnpm-lock.yaml .npmrc
git commit -m "fix: update pnpm lockfile configuration"
git push
```

### Option 3: One-liner Fix
```bash
pnpm config set auto-install-peers true && rm pnpm-lock.yaml && pnpm install
```

## ✅ What This Fix Does:

1. **Updates `.npmrc`** - Sets `auto-install-peers=true` to match lockfile expectations
2. **Regenerates lockfile** - Creates new `pnpm-lock.yaml` with correct configuration  
3. **Updates CI/CD workflow** - Adds fallback logic for config mismatches
4. **Provides scripts** - Automated fix scripts for future issues

## 🔍 Root Cause:

The lockfile was created with `auto-install-peers=true` but your current configuration has `auto-install-peers=false`. pnpm requires these to match for frozen lockfile installs.

## 🚀 After Fix:

- ✅ CI/CD will pass without lockfile errors
- ✅ Dependencies will install correctly
- ✅ No more configuration mismatch errors
- ✅ Faster builds with proper caching

## 📋 Files Changed:

- `.npmrc` - Updated configuration
- `pnpm-lock.yaml` - Regenerated with correct settings
- `.github/workflows/deploy.yml` - Added fallback logic
- `scripts/` - Added fix utilities

Push these changes and your CI/CD should work immediately! 🎉