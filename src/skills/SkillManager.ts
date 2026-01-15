import { App, TFile, TFolder, requestUrl } from "obsidian";
import { logger } from "../utils/Logger";

export interface Skill {
  name: string;
  filename: string;
  description?: string;
  content: string;
}

export interface SkillPreset {
  name: string;
  description: string;
  url: string;
  files: { path: string; saveName: string }[];
}

// Official skill presets.
export const SKILL_PRESETS: SkillPreset[] = [
  {
    name: "Kepano's Obsidian Skills",
    description: "Official Obsidian skills by Kepano (Obsidian CEO)",
    url: "https://github.com/kepano/obsidian-skills",
    files: [
      { path: "skills/obsidian-markdown/SKILL.md", saveName: "obsidian-markdown.md" },
      { path: "skills/obsidian-bases/SKILL.md", saveName: "obsidian-bases.md" },
      { path: "skills/json-canvas/SKILL.md", saveName: "json-canvas.md" },
    ],
  },
];

export class SkillManager {
  private app: App;
  private skillsPath: string;

  constructor(app: App) {
    this.app = app;
    this.skillsPath = ".claude/skills";
  }

  // Ensure the skills directory exists.
  async ensureSkillsDir(): Promise<void> {
    const claudeDir = ".claude";
    const skillsDir = this.skillsPath;

    try {
      if (!(await this.app.vault.adapter.exists(claudeDir))) {
        await this.app.vault.adapter.mkdir(claudeDir);
      }
      if (!(await this.app.vault.adapter.exists(skillsDir))) {
        await this.app.vault.adapter.mkdir(skillsDir);
        logger.info("SkillManager", "Created skills directory");
      }
    } catch (error) {
      logger.error("SkillManager", "Failed to create skills directory", { error: String(error) });
    }
  }

  // List all installed skills.
  async listSkills(): Promise<Skill[]> {
    await this.ensureSkillsDir();
    const skills: Skill[] = [];

    try {
      const folder = this.app.vault.getAbstractFileByPath(this.skillsPath);
      if (folder instanceof TFolder) {
        for (const file of folder.children) {
          if (file instanceof TFile && file.extension === "md") {
            const content = await this.app.vault.read(file);
            const skill = this.parseSkill(file.name, content);
            skills.push(skill);
          }
        }
      }
    } catch (error) {
      logger.error("SkillManager", "Failed to list skills", { error: String(error) });
    }

    return skills;
  }

  // Parse skill metadata from content.
  private parseSkill(filename: string, content: string): Skill {
    let name = filename.replace(".md", "");
    let description: string | undefined;

    // Parse YAML frontmatter.
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const nameMatch = frontmatter.match(/name:\s*(.+)/);
      const descMatch = frontmatter.match(/description:\s*(.+)/);
      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) description = descMatch[1].trim();
    }

    return { name, filename, description, content };
  }

  // Delete a skill.
  async deleteSkill(filename: string): Promise<boolean> {
    const path = `${this.skillsPath}/${filename}`;
    try {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.app.vault.delete(file);
        logger.info("SkillManager", "Deleted skill", { filename });
        return true;
      }
    } catch (error) {
      logger.error("SkillManager", "Failed to delete skill", { filename, error: String(error) });
    }
    return false;
  }

  // Install a skill from a GitHub raw URL.
  async installFromUrl(url: string): Promise<{ success: boolean; filename?: string; error?: string }> {
    await this.ensureSkillsDir();

    try {
      // Convert GitHub URL to raw URL if needed.
      const rawUrl = this.toRawGitHubUrl(url);

      // Fetch the content.
      const response = await requestUrl({ url: rawUrl });
      if (response.status !== 200) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const content = response.text;

      // Extract filename from URL.
      const filename = this.extractFilename(url);
      if (!filename) {
        return { success: false, error: "Could not determine filename from URL" };
      }

      // Check if file already exists.
      const path = `${this.skillsPath}/${filename}`;
      if (await this.app.vault.adapter.exists(path)) {
        return { success: false, error: "Skill already exists" };
      }

      // Write the file.
      await this.app.vault.adapter.write(path, content);
      logger.info("SkillManager", "Installed skill from URL", { url, filename });

      return { success: true, filename };
    } catch (error) {
      logger.error("SkillManager", "Failed to install from URL", { url, error: String(error) });
      return { success: false, error: String(error) };
    }
  }

  // Convert GitHub blob URL to raw URL.
  private toRawGitHubUrl(url: string): string {
    // https://github.com/user/repo/blob/main/file.md -> https://raw.githubusercontent.com/user/repo/main/file.md
    if (url.includes("github.com") && url.includes("/blob/")) {
      return url
        .replace("github.com", "raw.githubusercontent.com")
        .replace("/blob/", "/");
    }
    return url;
  }

  // Extract filename from URL.
  private extractFilename(url: string): string | null {
    const parts = url.split("/");
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.endsWith(".md")) {
      return lastPart;
    }
    // Try to extract from query params or generate from URL.
    const match = url.match(/([^/]+\.md)(?:\?|$)/);
    return match ? match[1] : null;
  }

  // Install a preset (multiple skills).
  async installPreset(preset: SkillPreset): Promise<{ success: number; failed: number; errors: string[] }> {
    await this.ensureSkillsDir();
    const result = { success: 0, failed: 0, errors: [] as string[] };

    for (const file of preset.files) {
      try {
        const repoPath = preset.url.replace("https://github.com/", "");
        const url = `https://raw.githubusercontent.com/${repoPath}/main/${file.path}`;

        const response = await requestUrl({ url });
        if (response.status !== 200) {
          result.failed++;
          result.errors.push(`${file.saveName}: HTTP ${response.status}`);
          continue;
        }

        const savePath = `${this.skillsPath}/${file.saveName}`;
        if (await this.app.vault.adapter.exists(savePath)) {
          result.failed++;
          result.errors.push(`${file.saveName}: already exists`);
          continue;
        }

        await this.app.vault.adapter.write(savePath, response.text);
        result.success++;
        logger.info("SkillManager", "Installed preset skill", { saveName: file.saveName });
      } catch (error) {
        result.failed++;
        result.errors.push(`${file.saveName}: ${String(error)}`);
      }
    }

    logger.info("SkillManager", "Installed preset", { preset: preset.name, result });
    return result;
  }

  // Create a new skill.
  async createSkill(name: string, description: string, content: string): Promise<boolean> {
    await this.ensureSkillsDir();

    const filename = `${name.toLowerCase().replace(/\s+/g, "-")}.md`;
    const path = `${this.skillsPath}/${filename}`;

    try {
      if (await this.app.vault.adapter.exists(path)) {
        logger.warn("SkillManager", "Skill already exists", { filename });
        return false;
      }

      const fullContent = `---
name: ${name}
description: ${description}
---

${content}`;

      await this.app.vault.adapter.write(path, fullContent);
      logger.info("SkillManager", "Created skill", { filename });
      return true;
    } catch (error) {
      logger.error("SkillManager", "Failed to create skill", { filename, error: String(error) });
      return false;
    }
  }
}
