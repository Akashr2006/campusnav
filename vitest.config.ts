import path from "path";

export default {
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "next/headers": path.resolve(__dirname, "./tests/mocks/next-headers.ts"),
    },
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
};
