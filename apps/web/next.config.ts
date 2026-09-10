import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Type checking runs in the root `typecheck` script; Next's duplicate
  // checker cannot parse its output under the Node 24 toolchain.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
