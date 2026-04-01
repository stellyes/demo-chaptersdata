#!/usr/bin/env npx tsx
// ============================================
// BUILD SCRIPT FOR COMPLIANCE AI LAMBDAS
// Bundles compliance Lambda handlers with esbuild,
// copies Prisma engine binaries, and creates zips.
//
// Usage:
//   npx tsx scripts/build-compliance-lambdas.ts           # build all
//   npx tsx scripts/build-compliance-lambdas.ts sync      # build corpus-sync only
//   npx tsx scripts/build-compliance-lambdas.ts compiler  # build rule-compiler only
// ============================================

import { build } from 'esbuild';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync, writeFileSync, rmSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '..');

interface LambdaConfig {
  name: string;
  entry: string;
  distDir: string;
  // corpus-sync needs better-sqlite3 as a native dependency, not bundled
  nativeModules?: string[];
  // Whether this Lambda needs Prisma (rule-compiler does, corpus-sync does not)
  needsPrisma: boolean;
  // Extra externals beyond the defaults
  extraExternals?: string[];
}

const LAMBDAS: Record<string, LambdaConfig> = {
  sync: {
    name: 'chapters-compliance-corpus-sync',
    entry: join(ROOT, 'src', 'lambda', 'compliance-corpus-sync.ts'),
    distDir: join(ROOT, 'dist', 'lambda-compliance-sync'),
    nativeModules: ['better-sqlite3'],
    needsPrisma: false,
    extraExternals: ['better-sqlite3'],
  },
  compiler: {
    name: 'chapters-compliance-rule-compiler',
    entry: join(ROOT, 'src', 'lambda', 'compliance-rule-compiler.ts'),
    distDir: join(ROOT, 'dist', 'lambda-compliance-compiler'),
    needsPrisma: true,
    extraExternals: ['@anthropic-ai/sdk'],
  },
  engine: {
    name: 'chapters-compliance-rules-engine',
    entry: join(ROOT, 'src', 'lambda', 'compliance-rules-engine.ts'),
    distDir: join(ROOT, 'dist', 'lambda-compliance-engine'),
    needsPrisma: true,
  },
  aggregator: {
    name: 'chapters-compliance-aggregator',
    entry: join(ROOT, 'src', 'lambda', 'compliance-aggregator.ts'),
    distDir: join(ROOT, 'dist', 'lambda-compliance-aggregator'),
    needsPrisma: true,
  },
  report: {
    name: 'chapters-compliance-report',
    entry: join(ROOT, 'src', 'lambda', 'compliance-report.ts'),
    distDir: join(ROOT, 'dist', 'lambda-compliance-report'),
    needsPrisma: true,
    extraExternals: ['@anthropic-ai/sdk'],
  },
  datagen: {
    name: 'chapters-compliance-training-data-gen',
    entry: join(ROOT, 'src', 'lambda', 'compliance-training-data-gen.ts'),
    distDir: join(ROOT, 'dist', 'lambda-compliance-datagen'),
    needsPrisma: true,
    extraExternals: ['@anthropic-ai/sdk'],
  },
  trigger: {
    name: 'chapters-compliance-train-trigger',
    entry: join(ROOT, 'src', 'lambda', 'compliance-train-trigger.ts'),
    distDir: join(ROOT, 'dist', 'lambda-compliance-trigger'),
    needsPrisma: false,
  },
  mlscanner: {
    name: 'chapters-compliance-ml-scanner',
    entry: join(ROOT, 'src', 'lambda', 'compliance-ml-scanner.ts'),
    distDir: join(ROOT, 'dist', 'lambda-compliance-mlscanner'),
    needsPrisma: true,
  },
};

async function buildLambda(config: LambdaConfig) {
  const { name, entry, distDir, needsPrisma, nativeModules, extraExternals } = config;
  const outputFile = join(distDir, 'index.js');
  const zipPath = join(distDir, `${name}.zip`);

  console.log(`\n=== Building ${name} ===\n`);

  // Clean
  if (existsSync(distDir)) rmSync(distDir, { recursive: true });
  mkdirSync(distDir, { recursive: true });

  // Step 1: esbuild bundle
  console.log('--- Step 1: esbuild bundle ---');
  const externals = ['@aws-sdk/*', ...(extraExternals || [])];
  if (needsPrisma) externals.push('@prisma/client');

  await build({
    entryPoints: [entry],
    outfile: outputFile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    alias: { '@': join(ROOT, 'src') },
    external: externals,
    treeShaking: true,
    minify: true,
    sourcemap: true,
    logLevel: 'warning',
  });
  console.log('  Bundle created successfully');

  // Step 2: Copy Prisma if needed
  if (needsPrisma) {
    console.log('\n--- Step 2: Copy Prisma client ---');
    copyPrismaClient(distDir);
  }

  // Step 3: Copy native modules if needed
  if (nativeModules?.length) {
    console.log(`\n--- Step ${needsPrisma ? 3 : 2}: Copy native modules ---`);
    for (const mod of nativeModules) {
      const modSrc = join(ROOT, 'node_modules', mod);
      const modDest = join(distDir, 'node_modules', mod);
      if (existsSync(modSrc)) {
        cpSync(modSrc, modDest, { recursive: true });
        console.log(`  Copied: ${mod}/`);
      } else {
        console.error(`  ERROR: Native module not found: ${modSrc}`);
        console.error(`  Run: npm install ${mod}`);
        process.exit(1);
      }
    }
  }

  // Step 4: Copy non-native externals (like @anthropic-ai/sdk)
  if (extraExternals?.length) {
    for (const ext of extraExternals) {
      if (nativeModules?.includes(ext)) continue; // already handled
      const extSrc = join(ROOT, 'node_modules', ext);
      const extDest = join(distDir, 'node_modules', ext);
      if (existsSync(extSrc) && !existsSync(extDest)) {
        cpSync(extSrc, extDest, { recursive: true });
        console.log(`  Copied: ${ext}/`);
      }
    }
  }

  // Step 5: package.json
  writeFileSync(join(distDir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    main: 'index.js',
  }, null, 2));

  // Step 6: zip
  console.log('\n--- Creating zip ---');
  execSync(`cd "${distDir}" && zip -r "${zipPath}" . -x "*.zip"`, { stdio: 'inherit' });

  const stats = statSync(zipPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
  console.log(`\n=== ${name} build complete ===`);
  console.log(`Output: ${zipPath}`);
  console.log(`Size: ${sizeMB} MB`);

  if (stats.size > 50 * 1024 * 1024) {
    console.warn('\nWARNING: Zip exceeds 50MB Lambda limit!');
    process.exit(1);
  }
}

function copyPrismaClient(distDir: string) {
  const prismaClientSrc = join(ROOT, 'node_modules', '.prisma', 'client');
  const prismaClientDest = join(distDir, 'node_modules', '.prisma', 'client');
  mkdirSync(prismaClientDest, { recursive: true });

  const prismaFiles = [
    'index.js', 'index.d.ts', 'schema.prisma',
    'default.js', 'default.d.ts', 'wasm.js', 'wasm.d.ts',
  ];
  for (const file of prismaFiles) {
    const src = join(prismaClientSrc, file);
    if (existsSync(src)) {
      cpSync(src, join(prismaClientDest, file));
      console.log(`  Copied: .prisma/client/${file}`);
    }
  }

  // RHEL engine binary for Amazon Linux 2023
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

  // @prisma/client package
  const prismaPackageSrc = join(ROOT, 'node_modules', '@prisma', 'client');
  const prismaPackageDest = join(distDir, 'node_modules', '@prisma', 'client');
  mkdirSync(prismaPackageDest, { recursive: true });

  for (const file of ['index.js', 'index.d.ts', 'package.json', 'default.js', 'default.d.ts']) {
    const src = join(prismaPackageSrc, file);
    if (existsSync(src)) cpSync(src, join(prismaPackageDest, file));
  }

  const runtimeSrc = join(prismaPackageSrc, 'runtime');
  const runtimeDest = join(prismaPackageDest, 'runtime');
  if (existsSync(runtimeSrc)) {
    cpSync(runtimeSrc, runtimeDest, { recursive: true });
    console.log('  Copied: @prisma/client/runtime/');
  }

  const schemaSrc = join(ROOT, 'prisma', 'schema.prisma');
  if (existsSync(schemaSrc)) {
    cpSync(schemaSrc, join(prismaClientDest, 'schema.prisma'));
    console.log('  Copied: schema.prisma');
  }
}

async function main() {
  const target = process.argv[2]; // 'sync', 'compiler', or undefined (all)

  if (target && LAMBDAS[target]) {
    await buildLambda(LAMBDAS[target]);
  } else if (!target) {
    for (const config of Object.values(LAMBDAS)) {
      await buildLambda(config);
    }
  } else {
    console.error(`Unknown target: ${target}`);
    console.error(`Available targets: ${Object.keys(LAMBDAS).join(', ')}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
