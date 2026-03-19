const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@seatly/tokens", "@seatly/types"],
  // Silence lockfile noise when ~/package-lock.json exists (see Next turbopack docs)
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

module.exports = nextConfig;
