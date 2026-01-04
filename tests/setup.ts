import { beforeAll, afterEach, vi } from "vitest";

// Mock Obsidian globally before any imports.
vi.mock("obsidian", async () => {
  const mocks = await import("./mocks/obsidian/index");
  return mocks;
});

// Mock Claude Agent SDK.
vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
  const mocks = await import("./mocks/claude-sdk/index");
  return mocks;
});

// Mock Node.js fs write operations for Logger tests.
// Note: existsSync is NOT mocked - we rely on real file system checks
// for Claude CLI detection. Only write operations are mocked.
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

beforeAll(() => {
  // Setup global DOM environment if needed.
  // happy-dom provides document, window, etc.
});

afterEach(() => {
  // Clean up DOM after each test.
  document.body.innerHTML = "";

  // Clear all mocks.
  vi.clearAllMocks();
});
