#!/usr/bin/env node
/**
 * Pre-build script for Vercel deployments.
 * Removes local-only routes that shouldn't be deployed.
 */
const fs = require('fs');
const path = require('path');

const localRoutesDir = path.join(__dirname, '../app/(local)');
const instrumentationFile = path.join(__dirname, '../instrumentation.ts');

if (fs.existsSync(localRoutesDir)) {
    console.log('🗑️  Removing local-only routes from build:', localRoutesDir);
    fs.rmSync(localRoutesDir, { recursive: true, force: true });
    console.log('✅ Local routes removed');
} else {
    console.log('ℹ️  No local routes to remove');
}

if (fs.existsSync(instrumentationFile)) {
    console.log('🗑️  Removing instrumentation.ts from build');
    fs.rmSync(instrumentationFile);
    console.log('✅ instrumentation.ts removed');
}
