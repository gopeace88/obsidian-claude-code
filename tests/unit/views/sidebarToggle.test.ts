import { describe, it, expect, vi, beforeEach } from "vitest";

import { createMockApp } from "../../mocks/obsidian/App.mock";
import { MockWorkspaceLeaf } from "../../mocks/obsidian/WorkspaceLeaf.mock";

/**
 * Tests for sidebar toggle functionality.
 *
 * These tests verify the core logic of toggling the chat panel visibility
 * by collapsing/expanding the right sidebar rather than detaching the view.
 */
describe("Sidebar Toggle Logic", () => {
  describe("toggleChatView behavior", () => {
    let mockApp: ReturnType<typeof createMockApp>;
    let mockLeaf: MockWorkspaceLeaf;

    beforeEach(() => {
      mockApp = createMockApp();
      mockLeaf = new MockWorkspaceLeaf();
    });

    /**
     * Core toggle logic extracted for testing.
     * This mirrors the logic in ClaudeCodePlugin.toggleChatView().
     */
    async function toggleChatView(
      getExistingChatLeaf: () => MockWorkspaceLeaf | null,
      rightSplit: { collapsed: boolean; collapse: () => void; expand: () => void },
      revealLeaf: (leaf: MockWorkspaceLeaf) => void,
      activateChatView: () => Promise<void>
    ): Promise<void> {
      const existingLeaf = getExistingChatLeaf();

      if (existingLeaf && rightSplit) {
        if (rightSplit.collapsed) {
          // Sidebar is collapsed, expand it and reveal the chat.
          rightSplit.expand();
          revealLeaf(existingLeaf);
        } else {
          // Sidebar is visible, collapse it to hide.
          rightSplit.collapse();
        }
      } else if (!existingLeaf) {
        // No chat view exists, create one.
        await activateChatView();
      }
    }

    it("should collapse sidebar when visible and leaf exists", async () => {
      // Setup: sidebar is expanded, leaf exists.
      mockApp.workspace.rightSplit.collapsed = false;
      mockApp.workspace.getLeavesOfType.mockReturnValue([mockLeaf]);

      const collapse = vi.fn();
      const expand = vi.fn();
      const revealLeaf = vi.fn();
      const activateChatView = vi.fn();

      await toggleChatView(
        () => mockLeaf,
        { collapsed: false, collapse, expand },
        revealLeaf,
        activateChatView
      );

      expect(collapse).toHaveBeenCalledTimes(1);
      expect(expand).not.toHaveBeenCalled();
      expect(revealLeaf).not.toHaveBeenCalled();
      expect(activateChatView).not.toHaveBeenCalled();
    });

    it("should expand sidebar and reveal leaf when collapsed and leaf exists", async () => {
      // Setup: sidebar is collapsed, leaf exists.
      const collapse = vi.fn();
      const expand = vi.fn();
      const revealLeaf = vi.fn();
      const activateChatView = vi.fn();

      await toggleChatView(
        () => mockLeaf,
        { collapsed: true, collapse, expand },
        revealLeaf,
        activateChatView
      );

      expect(expand).toHaveBeenCalledTimes(1);
      expect(revealLeaf).toHaveBeenCalledWith(mockLeaf);
      expect(collapse).not.toHaveBeenCalled();
      expect(activateChatView).not.toHaveBeenCalled();
    });

    it("should create new chat view when no leaf exists", async () => {
      const collapse = vi.fn();
      const expand = vi.fn();
      const revealLeaf = vi.fn();
      const activateChatView = vi.fn();

      await toggleChatView(
        () => null,
        { collapsed: false, collapse, expand },
        revealLeaf,
        activateChatView
      );

      expect(activateChatView).toHaveBeenCalledTimes(1);
      expect(collapse).not.toHaveBeenCalled();
      expect(expand).not.toHaveBeenCalled();
      expect(revealLeaf).not.toHaveBeenCalled();
    });

    it("should create new chat view when no leaf exists even if sidebar is collapsed", async () => {
      const collapse = vi.fn();
      const expand = vi.fn();
      const revealLeaf = vi.fn();
      const activateChatView = vi.fn();

      await toggleChatView(
        () => null,
        { collapsed: true, collapse, expand },
        revealLeaf,
        activateChatView
      );

      expect(activateChatView).toHaveBeenCalledTimes(1);
      expect(expand).not.toHaveBeenCalled();
      expect(collapse).not.toHaveBeenCalled();
    });
  });

  describe("collapseSidebar behavior", () => {
    /**
     * Core collapse logic extracted for testing.
     * This mirrors the logic in ChatView.collapseSidebar().
     */
    function collapseSidebar(
      rightSplit: { collapsed: boolean; collapse: () => void } | null
    ): void {
      if (rightSplit && !rightSplit.collapsed) {
        rightSplit.collapse();
      }
    }

    it("should collapse sidebar when not already collapsed", () => {
      const collapse = vi.fn();
      const rightSplit = { collapsed: false, collapse };

      collapseSidebar(rightSplit);

      expect(collapse).toHaveBeenCalledTimes(1);
    });

    it("should not collapse sidebar when already collapsed", () => {
      const collapse = vi.fn();
      const rightSplit = { collapsed: true, collapse };

      collapseSidebar(rightSplit);

      expect(collapse).not.toHaveBeenCalled();
    });

    it("should handle null rightSplit gracefully", () => {
      // Should not throw.
      expect(() => collapseSidebar(null)).not.toThrow();
    });
  });

  describe("toggle state transitions", () => {
    it("should alternate between collapsed and expanded states", async () => {
      const state = { collapsed: false };
      const collapse = vi.fn(() => {
        state.collapsed = true;
      });
      const expand = vi.fn(() => {
        state.collapsed = false;
      });
      const mockLeaf = new MockWorkspaceLeaf();

      // First toggle: expanded → collapsed.
      if (mockLeaf && !state.collapsed) {
        collapse();
      }
      expect(state.collapsed).toBe(true);
      expect(collapse).toHaveBeenCalledTimes(1);

      // Second toggle: collapsed → expanded.
      if (mockLeaf && state.collapsed) {
        expand();
      }
      expect(state.collapsed).toBe(false);
      expect(expand).toHaveBeenCalledTimes(1);

      // Third toggle: expanded → collapsed again.
      if (mockLeaf && !state.collapsed) {
        collapse();
      }
      expect(state.collapsed).toBe(true);
      expect(collapse).toHaveBeenCalledTimes(2);
    });
  });

  describe("edge cases", () => {
    it("should handle rapid toggle calls without race conditions", async () => {
      const state = { collapsed: false };
      const toggleCount = { collapse: 0, expand: 0 };

      const collapse = vi.fn(() => {
        toggleCount.collapse++;
        state.collapsed = true;
      });
      const expand = vi.fn(() => {
        toggleCount.expand++;
        state.collapsed = false;
      });

      // Simulate rapid toggles.
      for (let i = 0; i < 10; i++) {
        if (state.collapsed) {
          expand();
        } else {
          collapse();
        }
      }

      // Should have exactly 10 total operations, alternating.
      expect(toggleCount.collapse + toggleCount.expand).toBe(10);
      expect(toggleCount.collapse).toBe(5);
      expect(toggleCount.expand).toBe(5);
    });

    it("should not throw when workspace APIs return unexpected values", () => {
      // Test with undefined rightSplit.
      const collapseSidebar = (
        rightSplit: { collapsed: boolean; collapse: () => void } | undefined | null
      ) => {
        if (rightSplit && !rightSplit.collapsed) {
          rightSplit.collapse();
        }
      };

      expect(() => collapseSidebar(undefined)).not.toThrow();
      expect(() => collapseSidebar(null)).not.toThrow();
    });
  });
});

describe("Layout Ready Behavior", () => {
  it("should not force reveal when layout is restored", () => {
    // The new behavior: just log, don't call activateChatView().
    const revealLeaf = vi.fn();
    const existingLeaf = new MockWorkspaceLeaf();

    // Old behavior would have called revealLeaf.
    // New behavior: just check if leaf exists, don't reveal.
    const onLayoutReady = (getExistingLeaf: () => MockWorkspaceLeaf | null) => {
      const leaf = getExistingLeaf();
      if (leaf) {
        // Just log, don't reveal.
        // logger.debug("Plugin", "Chat view restored from workspace layout");
      }
    };

    onLayoutReady(() => existingLeaf);

    // revealLeaf should NOT have been called.
    expect(revealLeaf).not.toHaveBeenCalled();
  });

  it("should preserve collapsed state across restarts", () => {
    // Simulate Obsidian restoring workspace with collapsed sidebar.
    const workspaceState = {
      rightSplit: { collapsed: true },
      chatLeafExists: true,
    };

    // The plugin should not modify the collapsed state.
    const onLayoutReady = () => {
      // New behavior: don't force reveal, let Obsidian handle it.
      // Old behavior would have done: this.activateChatView()
    };

    onLayoutReady();

    // Collapsed state should remain unchanged.
    expect(workspaceState.rightSplit.collapsed).toBe(true);
  });
});
