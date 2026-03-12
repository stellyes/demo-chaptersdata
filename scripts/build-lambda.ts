#!/usr/bin/env npx tsx
// ============================================
// BUILD SCRIPT FOR LEARNING PROCESSOR LAMBDA
// Bundles src/lambda/learning-handler.ts with esbuild,
// copies Prisma engine binaries, and creates a zip.
// ============================================

import { build } from 'esbuild';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync, writeFileSync, rmSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist', 'lambda');
const ENTRY = join(ROOT, 'src', 'lambda', 'learning-handler.ts');
const OUTPUT = join(DIST, 'index.js');
const ZIP_PATH = join(DIST, 'learning-handler.zip');

async function main() {
  console.log('=== Building Learning Processor Lambda ===\n');

  // Clean output directory
  if (existsSync(DIST)) {
    rmSync(DIST, { recursive: true });
  }
  mkdirSync(DIST, { recursive: true });

  // Step 1: Bundle with esbuild
  console.log('--- Step 1: esbuild bundle ---');

  await build({
    entryPoints: [ENTRY],
    outfile: OUTPUT,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    // Resolve @/ path alias to src/
    alias: {
      '@': join(ROOT, 'src'),
    },
    // Externalize Prisma (needs native binary) and AWS SDK (provided by Lambda runtime)
    external: [
      '@prisma/client',
      '@aws-sdk/*',
    ],
    treeShaking: true,
    minify: true,
    sourcemap: true,
    // Suppress warnings about dynamic requires in dependencies
    logLevel: 'warning',
  });

  console.log('  Bundle created successfully');

  // Step 2: Copy Prisma client + engine
  console.log('\n--- Step 2: Copy Prisma client ---');

  const prismaClientSrc = join(ROOT, 'node_modules', '.prisma', 'client');
  const prismaClientDest = join(DIST, 'node_modules', '.prisma', 'client');
  mkdirSync(prismaClientDest, { recursive: true });

  // Copy generated Prisma client files
  const prismaFiles = [
    'index.js',
    'index.d.ts',
    'schema.prisma',
    'default.js',
    'default.d.ts',
    'wasm.js',
    'wasm.d.ts',
  ];

  for (const file of prismaFiles) {
    const src = join(prismaClientSrc, file);
    if (existsSync(src)) {
      cpSync(src, join(prismaClientDest, file));
      console.log(`  Copied: .prisma/client/${file}`);
    }
  }

  // Copy the RHEL OpenSSL engine binary for Amazon Linux 2023
  const engineFile = 'libquery_engine-rhel-openssl-3.0.x.so.node';
  const engineSrc = join(prismaClientSrc, engineFile);
  if (existsSync(engineSrc)) {
    cpSync(engineSrc, join(prismaClientDest, engineFile));
    console.log(`  Copied: engine binary ${engineFile}`);
  } else {
    console.error(`  ERROR: Engine binary not found: ${engineSrc}`);
    console.error('  Run: npx prisma generate');
    process.exit(1);
  }

  // Also copy @prisma/client package for the require chain
  const prismaPackageSrc = join(ROOT, 'node_modules', '@prisma', 'client');
  const prismaPackageDest = join(DIST, 'node_modules', '@prisma', 'client');
  mkdirSync(prismaPackageDest, { recursive: true });

  for (const file of ['index.js', 'index.d.ts', 'package.json', 'default.js', 'default.d.ts']) {
    const src = join(prismaPackageSrc, file);
    if (existsSync(src)) {
      cpSync(src, join(prismaPackageDest, file));
    }
  }

  // Copy Prisma client runtime directory (required for library.js, etc.)
  const runtimeSrc = join(prismaPackageSrc, 'runtime');
  const runtimeDest = join(prismaPackageDest, 'runtime');
  if (existsSync(runtimeSrc)) {
    cpSync(runtimeSrc, runtimeDest, { recursive: true });
    console.log('  Copied: @prisma/client/runtime/');
  }

  // Copy the Prisma schema
  const schemaSrc = join(ROOT, 'prisma', 'schema.prisma');
  if (existsSync(schemaSrc)) {
    cpSync(schemaSrc, join(prismaClientDest, 'schema.prisma'));
    console.log('  Copied: schema.prisma');
  }

  // Step 3: Create package.json for Lambda
  console.log('\n--- Step 3: Create package.json ---');
  writeFileSync(join(DIST, 'package.json'), JSON.stringify({
    name: 'chapters-learning-processor',
    version: '1.0.0',
    main: 'index.js',
  }, null, 2));

  // Step 4: Create zip
  console.log('\n--- Step 4: Create zip ---');
  execSync(`cd "${DIST}" && zip -r "${ZIP_PATH}" . -x "*.zip"`, { stdio: 'inherit' });

  // Show output size
  const stats = statSync(ZIP_PATH);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
  console.log(`\n=== Build complete ===`);
  console.log(`Output: ${ZIP_PATH}`);
  console.log(`Size: ${sizeMB} MB`);

  if (stats.size > 50 * 1024 * 1024) {
    console.warn('\nWARNING: Zip exceeds 50MB Lambda limit!');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
