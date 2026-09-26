import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite is the local-development database (see src/lib/db.ts). Loading it
  // from node_modules at runtime keeps its WebAssembly files intact and out of
  // the production bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
