import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@overcall/core"],
  poweredByHeader: false,
  devIndicators: false,
};
export default config;
