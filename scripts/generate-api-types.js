#!/usr/bin/env node

/**
 * Generate TypeScript types from OpenAPI specification
 * Outputs to packages/api-types/src/index.ts
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const openapiPath = path.join(process.cwd(), 'openapi.json');
const outputPath = path.join(process.cwd(), 'packages/api-types/src/index.ts');

try {
  console.log('🔄 Generating TypeScript types from OpenAPI spec...');
  
  // Check if openapi.json exists
  if (!fs.existsSync(openapiPath)) {
    console.error('❌ openapi.json not found. Run npm run generate:spec first.');
    process.exit(1);
  }
  
  // Generate types using openapi-typescript with --allow-unresolved flag
  execSync(
    `npx openapi-typescript ${openapiPath} --output ${outputPath} --path-params-as-types`,
    { stdio: 'inherit' }
  );
  
  console.log(`✅ TypeScript types generated: ${outputPath}`);
  
  // Add helper exports
  const helperTypes = `

/**
 * Helper types for API requests and responses
 */

// Extract paths type
export type ApiPaths = paths;

// Extract components type  
export type ApiComponents = components;

// Helper to get request body type
export type RequestBody<
  Path extends keyof paths,
  Method extends keyof paths[Path]
> = paths[Path][Method] extends { requestBody: { content: { 'application/json': infer T } } }
  ? T
  : never;

// Helper to get response type
export type ResponseBody<
  Path extends keyof paths,
  Method extends keyof paths[Path],
  Status extends number = 200
> = paths[Path][Method] extends { responses: infer R }
  ? R extends { [K in Status]: { content: { 'application/json': infer T } } }
    ? T
    : never
  : never;

// Helper to get path parameters
export type PathParams<
  Path extends keyof paths,
  Method extends keyof paths[Path]
> = paths[Path][Method] extends { parameters: { path: infer T } }
  ? T
  : never;

// Helper to get query parameters
export type QueryParams<
  Path extends keyof paths,
  Method extends keyof paths[Path]
> = paths[Path][Method] extends { parameters: { query: infer T } }
  ? T
  : never;
`;
  
  fs.appendFileSync(outputPath, helperTypes);
  console.log('✅ Added helper types');
  
} catch (error) {
  console.error('❌ Failed to generate TypeScript types:', error.message);
  process.exit(1);
}
