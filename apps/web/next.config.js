const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@seatly/tokens", "@seatly/types"],
};

module.exports = nextConfig;
