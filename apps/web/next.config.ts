import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@footnote/core"],
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default config;
