import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, type LanguageModelV1 } from "ai";
import {
  type App,
  Modal,
  Notice,
  normalizePath,
  Plugin,
  Setting,
  TFile,
} from "obsidian";
import { createOllama } from "ollama-ai-provider-v2";
import { z } from "zod";
import { SettingsTab } from "./settings-tab";

// Schema for caption generation
const CaptionSchema = z.object({
  captions: z.array(z.string().min(1).max(50)).min(1).max(5),
});

interface ImageRenamerSettings {
  apiKey: string;
  localApiKey: string; // Separate storage for local API key
  apiEndpoint: string;
  localApiEndpoint: string; // Separate storage for local endpoint
  model: string;
  localModel: string; // Separate storage for local model
  maxImageSize: number;
  datePrefix: boolean;
  caseStyle: "lower" | "upper" | "title" | "sentence" | "preserve";
  allowSpaces: boolean;
  maxRetries: number;
  timeoutMs: number;
  useLocalModel: boolean;
  localModelServer: "ollama" | "lm-studio" | "localai" | "custom";
}

const DEFAULT_SETTINGS: ImageRenamerSettings = {
  apiKey: "",
  localApiKey: "",
  apiEndpoint: "https://api.openai.com/v1/chat/completions",
  localApiEndpoint: "http://localhost:11434/api/chat",
  model: "gpt-4o-mini",
  localModel: "llama3.2-vision:11b",
  maxImageSize: 1024,
  datePrefix: false,
  caseStyle: "title",
  allowSpaces: true,
  maxRetries: 3,
  timeoutMs: 30000,
  useLocalModel: false,
  localModelServer: "ollama",
};

// Local model presets
const LOCAL_MODEL_PRESETS = {
  ollama: {
    endpoint: "http://localhost:11434/api/chat",
    model: "llama3.2-vision:11b", // Common models: llava, llama3.2-vision:11b, bakllava
    name: "Ollama",
  },
  "lm-studio": {
    endpoint: "http://localhost:1234/v1/chat/completions",
    model: "local-model",
    name: "LM Studio",
  },
  localai: {
    endpoint: "http://localhost:8080/v1/chat/completions",
    model: "llava-1.5-7b-hf",
    name: "LocalAI",
  },
  custom: {
    endpoint: "",
    model: "",
    name: "Custom",
  },
};

export default class ImageRenamerPlugin extends Plugin {
  settings: ImageRenamerSettings;
  private abortController: AbortController | null = null;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "rename-image-file",
      name: "Rename with best suggestion",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isImageFile(file)) {
          if (!checking) {
            this.renameImageFile(file);
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "rename-image-file-interactive",
      name: "Rename from suggestions",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isImageFile(file)) {
          if (!checking) {
            this.renameImageFileInteractive(file);
          }
          return true;
        }
        return false;
      },
    });

    // Add context menu items for file explorer
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && this.isImageFile(file)) {
          menu.addItem((item) => {
            item
              .setTitle("Rename with best suggestion")
              .setIcon("image")
              .onClick(() => {
                this.renameImageFile(file);
              });
          });
          menu.addItem((item) => {
            item
              .setTitle("Rename from suggestions")
              .setIcon("image")
              .onClick(() => {
                this.renameImageFileInteractive(file);
              });
          });
        }
      }),
    );

    this.addSettingTab(new SettingsTab(this.app, this));
  }

  onunload() {
    // Clean up any pending requests
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  isImageFile(file: TFile): boolean {
    const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];
    return imageExtensions.includes(file.extension.toLowerCase());
  }

  validateApiEndpoint(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:";
    } catch {
      return false;
    }
  }

  async generateCaptionsWithRetry(
    file: TFile,
    retryCount: number = 0,
  ): Promise<string[]> {
    try {
      return await this.generateCaptions(file);
    } catch (error) {
      if (retryCount < this.settings.maxRetries - 1) {
        // Exponential backoff
        const delay = Math.min(1000 * 2 ** retryCount, 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.generateCaptionsWithRetry(file, retryCount + 1);
      }
      throw error;
    }
  }

  async generateCaptions(file: TFile): Promise<string[]> {
    // Check if we should use local model (not on mobile even if setting is enabled)
    const shouldUseLocal = this.settings.useLocalModel && !this.app.isMobile;

    // Only require API key for cloud services
    if (!shouldUseLocal && !this.settings.apiKey) {
      throw new Error("Please configure your API key in the plugin settings");
    }

    const arrayBuffer = await this.app.vault.readBinary(file);

    // Resize image if needed to avoid API limits
    const base64 = await this.resizeAndConvertToBase64(
      arrayBuffer,
      file.extension,
    );
    const imageUrl = `data:image/jpeg;base64,${base64}`;

    // Create abort controller for timeout
    this.abortController = new AbortController();
    const timeoutId = setTimeout(
      () => this.abortController?.abort(),
      this.settings.timeoutMs,
    );

    try {
      // Set up the appropriate model provider
      let model: LanguageModelV1;

      if (shouldUseLocal) {
        // Ollama setup
        const ollamaEndpoint =
          this.settings.localModelServer !== "custom"
            ? LOCAL_MODEL_PRESETS[this.settings.localModelServer].endpoint
            : this.settings.localApiEndpoint;

        const ollamaModel =
          this.settings.localModelServer !== "custom"
            ? LOCAL_MODEL_PRESETS[this.settings.localModelServer].model
            : this.settings.localModel;

        // Extract base URL from endpoint - ollama-ai-provider-v2 expects the /api path included
        let baseURL = ollamaEndpoint
          .replace(/\/chat$/, "")
          .replace(/\/v1\/.*$/, "");
        // Ensure we have /api in the path for ollama-ai-provider-v2
        if (!baseURL.endsWith("/api")) {
          baseURL = `${baseURL.replace(/\/$/, "")}/api`;
        }

        const ollama = createOllama({
          baseURL: baseURL || "http://localhost:11434/api",
        });

        // Call the provider directly with the model name
        model = ollama(ollamaModel);
      } else {
        // OpenAI setup
        const apiKey = this.settings.apiKey;
        const baseURL = this.settings.apiEndpoint
          .replace(/\/chat\/completions$/, "")
          .replace(/\/v1$/, "");

        // Create OpenAI provider instance with API key
        const openaiProvider = createOpenAI({
          apiKey: apiKey,
          baseURL: baseURL.includes("api.openai.com") ? undefined : baseURL,
        });

        // Create the model using the configured provider
        model = openaiProvider(this.settings.model);
      }

      // Generate captions using the AI SDK
      const result = await generateObject({
        model,
        schema: CaptionSchema,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Generate 3 different concise captions for this image. Each caption should be suitable as a filename (2-5 words). Provide them as an array of captions.",
              },
              {
                type: "image",
                image: imageUrl,
              },
            ],
          },
        ],
        abortSignal: this.abortController.signal,
        maxRetries: this.settings.maxRetries,
      });

      clearTimeout(timeoutId);

      // Process and sanitize the captions
      const captions = result.object.captions.map((c) =>
        this.sanitizeFilename(c),
      );

      // Ensure we have at least one caption
      if (captions.length === 0) {
        throw new Error("No captions generated");
      }

      return captions;
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      // Handle specific error types
      const errorObj = error as Error;
      if (errorObj.name === "AbortError") {
        throw new Error(
          "Request timeout. Please check your connection and try again.",
        );
      } else if (
        errorObj.message?.includes("401") ||
        errorObj.message?.includes("Unauthorized")
      ) {
        throw new Error("Invalid API key. Please check your settings.");
      } else if (errorObj.message?.includes("429")) {
        throw new Error(
          "Rate limit exceeded. Please wait before trying again.",
        );
      } else if (errorObj.message?.includes("model")) {
        throw new Error(
          "Model not found. Please check your model name in settings.",
        );
      }

      // Re-throw with cleaner message
      throw new Error(errorObj.message || "Failed to generate captions");
    } finally {
      this.abortController = null;
    }
  }

  async resizeAndConvertToBase64(
    arrayBuffer: ArrayBuffer,
    extension: string,
  ): Promise<string> {
    // Create a blob from the array buffer
    const blob = new Blob([arrayBuffer], { type: `image/${extension}` });
    const url = URL.createObjectURL(blob);

    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
          try {
            // Calculate new dimensions (max 512px on longest side)
            const maxSize = 512;
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > maxSize) {
                height = (height * maxSize) / width;
                width = maxSize;
              }
            } else {
              if (height > maxSize) {
                width = (width * maxSize) / height;
                height = maxSize;
              }
            }

            // Create canvas and resize
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");

            if (!ctx) {
              throw new Error("Failed to get canvas context");
            }

            ctx.drawImage(img, 0, 0, width, height);

            // Convert to base64 with JPEG compression
            canvas.toBlob(
              (blob) => {
                if (!blob) {
                  reject(new Error("Failed to create blob"));
                  return;
                }

                const reader = new FileReader();
                reader.onloadend = () => {
                  const base64String = reader.result as string;
                  // Remove the data URL prefix
                  const base64 = base64String.split(",")[1];
                  resolve(base64);
                };
                reader.onerror = () => reject(new Error("Failed to read blob"));
                reader.readAsDataURL(blob);
              },
              "image/jpeg",
              0.8,
            );
          } catch (error) {
            reject(error);
          } finally {
            // Always revoke the URL
            URL.revokeObjectURL(url);
          }
        };

        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(
            new Error(
              "Failed to load image. The file may be corrupted or in an unsupported format.",
            ),
          );
        };

        img.src = url;
      });
    } catch (error) {
      // Ensure URL is revoked even if promise setup fails
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  sanitizeFilename(text: string): string {
    let result = text.trim();

    // Remove invalid filename characters but keep spaces and underscores
    result = result.replace(/[<>:"/\\|?*]/g, "");

    // Handle spaces based on settings
    if (!this.settings.allowSpaces) {
      // Replace both spaces and underscores with hyphens
      result = result.replace(/[\s_]+/g, "-");
    } else {
      // Keep spaces, but normalize multiple spaces to single space
      result = result.replace(/\s+/g, " ");
      // Optionally convert underscores to spaces for consistency
      result = result.replace(/_/g, " ");
    }

    switch (this.settings.caseStyle) {
      case "lower":
        result = result.toLowerCase();
        break;
      case "upper":
        result = result.toUpperCase();
        break;
      case "title":
        result = result.replace(
          /\w\S*/g,
          (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(),
        );
        break;
      case "sentence":
        result = result.charAt(0).toUpperCase() + result.slice(1).toLowerCase();
        break;
    }

    // Clean up any multiple hyphens and trim hyphens from ends
    if (!this.settings.allowSpaces) {
      result = result.replace(/-+/g, "-").replace(/^-|-$/g, "");
    }

    // Trim any trailing/leading spaces
    result = result.trim();

    return result;
  }

  async getImageDate(file: TFile): Promise<string | null> {
    const stat = await this.app.vault.adapter.stat(file.path);
    if (stat?.ctime) {
      const date = new Date(stat.ctime);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
    return null;
  }

  async filterDuplicateNames(
    captions: string[],
    file: TFile,
  ): Promise<string[]> {
    const filtered: string[] = [];
    const parentPath = file.parent?.path || "";

    for (const caption of captions) {
      let finalName = caption;
      if (this.settings.datePrefix) {
        const date = await this.getImageDate(file);
        if (date) {
          finalName = `${date}-${caption}`;
        }
      }

      const testPath = normalizePath(
        `${parentPath}/${finalName}.${file.extension}`,
      );
      const existingFile = this.app.vault.getAbstractFileByPath(testPath);

      // Only include if no file exists at that path, or if it's the same file
      if (!existingFile || existingFile === file) {
        filtered.push(caption);
      }
    }

    return filtered;
  }

  async renameImageFile(file: TFile) {
    const modelSource = this.settings.useLocalModel ? "local model" : "OpenAI";
    const progressNotice = new Notice(
      `Generating caption with ${modelSource}...`,
      0,
    );

    try {
      const captions = await this.generateCaptionsWithRetry(file);

      if (captions.length === 0) {
        progressNotice.hide();
        new Notice("No captions generated");
        return;
      }

      // Filter out names that would create duplicates
      const availableCaptions = await this.filterDuplicateNames(captions, file);

      if (availableCaptions.length === 0) {
        progressNotice.hide();
        new Notice("All generated names already exist. Trying again...");
        // Generate new captions if all were duplicates
        const newCaptions = await this.generateCaptionsWithRetry(file);
        const newAvailable = await this.filterDuplicateNames(newCaptions, file);
        if (newAvailable.length === 0) {
          new Notice(
            "Could not generate unique names. Please try again or use interactive mode.",
          );
          return;
        }
        await this.performRename(file, newAvailable[0]);
      } else {
        progressNotice.hide();
        await this.performRename(file, availableCaptions[0]);
      }
    } catch (error) {
      progressNotice.hide();
      console.error("Error renaming file:", error);
      new Notice(`Error: ${error.message}`);
    }
  }

  async renameImageFileInteractive(file: TFile) {
    const modelSource = this.settings.useLocalModel ? "local model" : "OpenAI";
    const progressNotice = new Notice(
      `Generating captions with ${modelSource}...`,
      0,
    );

    try {
      const captions = await this.generateCaptionsWithRetry(file);

      if (captions.length === 0) {
        progressNotice.hide();
        new Notice("No captions generated");
        return;
      }

      // Filter out names that would create duplicates
      const availableCaptions = await this.filterDuplicateNames(captions, file);

      progressNotice.hide();

      if (availableCaptions.length === 0) {
        new Notice(
          "All generated names already exist. Generating new options...",
        );
        const newCaptions = await this.generateCaptionsWithRetry(file);
        const newAvailable = await this.filterDuplicateNames(newCaptions, file);

        if (newAvailable.length === 0) {
          new Notice(
            "Could not generate unique names. Please enter a custom name.",
          );
          // Still show modal with empty suggestions so user can enter custom name
          new CaptionSelectionModal(
            this.app,
            this,
            file,
            [],
            async (caption) => {
              await this.performRename(file, caption);
            },
          ).open();
        } else {
          new CaptionSelectionModal(
            this.app,
            this,
            file,
            newAvailable,
            async (caption) => {
              await this.performRename(file, caption);
            },
          ).open();
        }
      } else {
        new CaptionSelectionModal(
          this.app,
          this,
          file,
          availableCaptions,
          async (caption) => {
            await this.performRename(file, caption);
          },
        ).open();
      }
    } catch (error) {
      progressNotice.hide();
      console.error("Error renaming file:", error);
      new Notice(`Error: ${error.message}`);
    }
  }

  async performRename(file: TFile, newName: string) {
    let finalName = newName;

    if (this.settings.datePrefix) {
      const date = await this.getImageDate(file);
      if (date) {
        finalName = `${date}-${newName}`;
      }
    }

    const newPath = normalizePath(
      `${file.parent?.path || ""}/${finalName}.${file.extension}`,
    );

    // Check for duplicate
    const existingFile = this.app.vault.getAbstractFileByPath(newPath);
    if (existingFile && existingFile !== file) {
      new Notice(
        `A file named "${finalName}.${file.extension}" already exists`,
      );
      return;
    }

    try {
      await this.app.fileManager.renameFile(file, newPath);
      new Notice(`✅ Renamed to: ${finalName}.${file.extension}`);
    } catch (error) {
      console.error("Error performing rename:", error);
      new Notice(`Failed to rename: ${error.message}`);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class CaptionSelectionModal extends Modal {
  file: TFile;
  plugin: ImageRenamerPlugin;
  captions: string[];
  onSubmit: (caption: string) => void;
  selectedCaption: string;

  constructor(
    app: App,
    plugin: ImageRenamerPlugin,
    file: TFile,
    captions: string[],
    onSubmit: (caption: string) => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.captions = captions;
    this.onSubmit = onSubmit;
    this.selectedCaption = captions[0] || "";
  }

  async onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Select a caption" });

    contentEl.createEl("p", {
      text: `Current file: ${this.file.name}`,
      cls: "setting-item-description",
    });

    // Get and display inbound link count
    const backlinks = this.app.metadataCache.getBacklinksForFile(this.file);
    const linkCount = backlinks?.data.size || 0;

    if (linkCount > 0) {
      const linkInfo = contentEl.createEl("p", {
        cls: "setting-item-description",
        attr: { style: "color: var(--text-muted); margin-bottom: 15px;" },
      });
      linkInfo.createEl("span", {
        text: `🔗 This file has ${linkCount} inbound link${linkCount === 1 ? "" : "s"} that will be automatically updated.`,
        attr: { style: "font-size: 0.9em;" },
      });
    }

    if (this.captions.length > 0) {
      const captionContainer = contentEl.createEl("div", {
        cls: "caption-selection-container",
      });

      this.captions.forEach((caption, index) => {
        const setting = new Setting(captionContainer)
          .setName(`Option ${index + 1}`)
          .setDesc(caption);

        const radio = setting.controlEl.createEl("input", {
          type: "radio",
          cls: "caption-radio",
        });
        radio.name = "caption-selection";
        radio.value = caption;
        radio.checked = index === 0;
        radio.addEventListener("change", () => {
          this.selectedCaption = caption;
          textInput.value = caption;
        });
      });
    } else {
      contentEl.createEl("p", {
        text: "No unique suggestions available. Please enter a custom name:",
        cls: "setting-item-description",
      });
    }

    const customSetting = new Setting(contentEl)
      .setName("Custom caption")
      .setDesc("Edit the selected caption or enter your own");

    const textInput = customSetting.controlEl.createEl("input", {
      type: "text",
      cls: "caption-input",
    });
    textInput.value = this.selectedCaption;
    textInput.style.width = "100%";
    textInput.addEventListener("input", () => {
      this.selectedCaption = textInput.value;
    });

    // Check for duplicates as user types
    textInput.addEventListener("input", async () => {
      const value = textInput.value.trim();
      if (value) {
        let testName = value;
        if (this.plugin.settings.datePrefix) {
          const date = await this.plugin.getImageDate(this.file);
          if (date) {
            testName = `${date}-${value}`;
          }
        }

        const testPath = normalizePath(
          `${this.file.parent?.path || ""}/${testName}.${this.file.extension}`,
        );
        const existingFile = this.app.vault.getAbstractFileByPath(testPath);

        if (existingFile && existingFile !== this.file) {
          textInput.style.borderColor = "var(--text-error)";
          if (
            !textInput.nextElementSibling ||
            !textInput.nextElementSibling.classList.contains(
              "duplicate-warning",
            )
          ) {
            const warning = document.createElement("div");
            warning.className = "duplicate-warning";
            warning.style.color = "var(--text-error)";
            warning.style.fontSize = "0.8em";
            warning.style.marginTop = "5px";
            warning.textContent = "This name already exists";
            textInput.parentElement?.appendChild(warning);
          }
        } else {
          textInput.style.borderColor = "";
          const warning =
            textInput.parentElement?.querySelector(".duplicate-warning");
          warning?.remove();
        }
      }
    });

    const buttonContainer = contentEl.createEl("div", {
      cls: "modal-button-container",
      attr: {
        style:
          "display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;",
      },
    });

    const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => {
      this.close();
    });

    const confirmButton = buttonContainer.createEl("button", {
      text: "Rename",
      cls: "mod-cta",
    });
    confirmButton.addEventListener("click", () => {
      if (this.selectedCaption.trim()) {
        this.close();
        this.onSubmit(this.selectedCaption.trim());
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// Old settings tab - now replaced by settings-tab.ts
/*
class ImageRenamerSettingTab extends PluginSettingTab {
	plugin: ImageRenamerPlugin;

	constructor(app: App, plugin: ImageRenamerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Image Renamer Settings' });

		// Create tabs for Cloud vs Local
		const tabContainer = containerEl.createEl('div', {
			cls: 'setting-tab-container',
			attr: { style: 'margin-bottom: 20px;' }
		});

		const tabBar = tabContainer.createEl('div', {
			cls: 'setting-tab-bar',
			attr: {
				style: 'display: flex; gap: 10px; border-bottom: 2px solid var(--background-modifier-border); margin-bottom: 20px;'
			}
		});

		// Determine active tab based on settings (mobile always shows cloud)
		const activeTab = this.app.isMobile ? 'cloud' : (this.plugin.settings.useLocalModel ? 'local' : 'cloud');

		// Cloud tab button
		const cloudTabBtn = tabBar.createEl('button', {
			text: '☁️ Cloud API',
			cls: activeTab === 'cloud' ? 'mod-cta' : '',
			attr: {
				style: `padding: 10px 20px; background: ${activeTab === 'cloud' ? 'var(--interactive-accent)' : 'transparent'};
				        border: none; cursor: pointer; border-radius: 5px 5px 0 0;`
			}
		});

		// Local tab button (hidden on mobile)
		let localTabBtn: HTMLElement | null = null;
		if (!this.app.isMobile) {
			localTabBtn = tabBar.createEl('button', {
				text: '💻 Local Models',
				cls: activeTab === 'local' ? 'mod-cta' : '',
				attr: {
					style: `padding: 10px 20px; background: ${activeTab === 'local' ? 'var(--interactive-accent)' : 'transparent'};
					        border: none; cursor: pointer; border-radius: 5px 5px 0 0;`
				}
			});
		}

		// Tab content container
		const tabContent = containerEl.createEl('div');

		// Tab switching logic
		const showTab = async (tab: 'cloud' | 'local') => {
			if (this.app.isMobile && tab === 'local') return; // Prevent local tab on mobile

			// Update settings
			this.plugin.settings.useLocalModel = (tab === 'local');
			await this.plugin.saveSettings();

			// Update button styles
			if (tab === 'cloud') {
				cloudTabBtn.addClass('mod-cta');
				cloudTabBtn.style.background = 'var(--interactive-accent)';
				if (localTabBtn) {
					localTabBtn.removeClass('mod-cta');
					localTabBtn.style.background = 'transparent';
				}
			} else {
				cloudTabBtn.removeClass('mod-cta');
				cloudTabBtn.style.background = 'transparent';
				if (localTabBtn) {
					localTabBtn.addClass('mod-cta');
					localTabBtn.style.background = 'var(--interactive-accent)';
				}
			}

			// Clear and show appropriate content
			tabContent.empty();
			if (tab === 'cloud') {
				this.displayCloudSettings(tabContent);
			} else {
				this.displayLocalSettings(tabContent);
			}
		};

		// Add click handlers
		cloudTabBtn.addEventListener('click', () => showTab('cloud'));
		if (localTabBtn) {
			localTabBtn.addEventListener('click', () => showTab('local'));
		}

		// Show initial tab content
		if (activeTab === 'cloud') {
			this.displayCloudSettings(tabContent);
		} else {
			this.displayLocalSettings(tabContent);
		}

		// Common settings that appear for both tabs
		this.displayCommonSettings(containerEl);
	}

	async fetchOpenAIModels(): Promise<Array<{id: string, name: string}>> {
		try {
			if (!this.plugin.settings.apiKey) return [];

			const baseURL = this.plugin.settings.apiEndpoint.replace(/\/chat\/completions$/, '').replace(/\/v1$/, '');
			const modelsUrl = `${baseURL}/v1/models`;

			const response = await fetch(modelsUrl, {
				headers: { 'Authorization': `Bearer ${this.plugin.settings.apiKey}` }
			});

			if (response.ok) {
				const data = await response.json();
				if (data.data && Array.isArray(data.data)) {
					// Filter for vision-capable models
					return data.data
						.filter((m: any) => m.id.includes('vision') || m.id.includes('gpt-4') || m.id.includes('o1'))
						.map((m: any) => ({ id: m.id, name: m.id }))
						.sort((a: any, b: any) => a.id.localeCompare(b.id));
				}
			}
		} catch (error) {
			console.error('Failed to fetch OpenAI models:', error);
		}
		return [];
	}

	async fetchLocalModels(server: string, endpoint: string): Promise<Array<{id: string, name: string}>> {
		try {
			let modelsUrl = '';

			if (server === 'ollama') {
				modelsUrl = endpoint.replace(/\/api\/chat$/, '/api/tags');
			} else if (server === 'lm-studio' || server === 'localai') {
				modelsUrl = endpoint.replace(/\/chat\/completions$/, '/models').replace(/\/chat$/, '/models');
			} else {
				return [];
			}

			const response = await fetch(modelsUrl);

			if (response.ok) {
				const data = await response.json();

				if (server === 'ollama' && data.models) {
					// Filter for vision models
					return data.models
						.filter((m: any) => m.name.includes('vision') || m.name.includes('llava'))
						.map((m: any) => ({ id: m.name, name: m.name }));
				} else if (data.data && Array.isArray(data.data)) {
					// OpenAI-compatible format (LM Studio, LocalAI)
					return data.data.map((m: any) => ({ id: m.id, name: m.id }));
				}
			}
		} catch (error) {
			console.error('Failed to fetch local models:', error);
		}
		return [];
	}

	displayCloudSettings(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: 'Cloud API Settings' });

		// API Key
		const apiKeySetting = new Setting(containerEl)
			.setName('API Key')
			.setDesc('Your OpenAI API key (or compatible service)')
			.addText((text) => {
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
				text.inputEl.style.paddingRight = '80px';
				text.inputEl.style.fontFamily = 'var(--font-monospace)';

				// Add eye icon for show/hide password
				const eyeIcon = text.inputEl.parentElement?.createEl('span', {
					cls: 'clickable-icon',
					attr: {
						style: 'position: absolute; right: 60px; top: 50%; transform: translateY(-50%); cursor: pointer; z-index: 1;'
					}
				});

				if (eyeIcon) {
					eyeIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';

					eyeIcon.addEventListener('click', () => {
						if (text.inputEl.type === 'password') {
							text.inputEl.type = 'text';
							eyeIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
						} else {
							text.inputEl.type = 'password';
							eyeIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
						}
					});

					if (text.inputEl.parentElement) {
						text.inputEl.parentElement.style.position = 'relative';
						text.inputEl.parentElement.style.display = 'flex';
						text.inputEl.parentElement.style.alignItems = 'center';
					}
				}

				return text;
			});

		// Test button
		apiKeySetting.addButton((button) => {
			button.setButtonText('Test').onClick(async () => {
				if (!this.plugin.settings.apiKey) {
					new Notice('Please enter an API key first');
					return;
				}

				button.setDisabled(true);
				button.setButtonText('Testing...');

				try {
					const models = await this.fetchOpenAIModels();
					if (models.length > 0) {
						new Notice(`✅ API connected! Found ${models.length} vision models`);
						// Refresh to show models dropdown
						this.displayCloudSettings(containerEl);
					} else {
						new Notice('✅ API connection successful!');
					}
				} catch (error) {
					new Notice('❌ Failed to connect to API');
				} finally {
					button.setDisabled(false);
					button.setButtonText('Test');
				}
			});
		});

		// Help text
		const helpDiv = containerEl.createEl('div', {
			cls: 'setting-item-description',
			attr: { style: 'margin-top: -10px; margin-bottom: 10px; padding-left: 0;' }
		});
		helpDiv.createEl('span', { text: 'New to OpenAI? ' });
		helpDiv.createEl('a', {
			text: 'Get your API key here',
			href: 'https://platform.openai.com/api-keys'
		});
		helpDiv.createEl('span', { text: ". You'll need to add billing to use the vision API." });

		// Security warning
		const warningDiv = containerEl.createEl('div', {
			cls: 'setting-item-description',
			attr: { style: 'margin-bottom: 20px; padding-left: 0; color: var(--text-error); font-size: 0.9em;' }
		});
		warningDiv.createEl('span', { text: '🔒 ' });
		warningDiv.createEl('span', {
			text: 'API keys are stored in plain text in your vault configuration. Keep your vault secure.'
		});

		// API Endpoint
		new Setting(containerEl)
			.setName('API Endpoint')
			.setDesc('The API endpoint for the vision model')
			.addText((text) => {
				text
					.setPlaceholder('https://api.openai.com/v1/chat/completions')
					.setValue(this.plugin.settings.apiEndpoint)
					.onChange(async (value) => {
						if (value && !this.plugin.validateApiEndpoint(value)) {
							text.inputEl.style.borderColor = 'var(--text-error)';
							new Notice('Invalid URL format');
						} else {
							text.inputEl.style.borderColor = '';
							this.plugin.settings.apiEndpoint = value;
							await this.plugin.saveSettings();
						}
					});
				return text;
			});

		// Model selection with dropdown
		const modelSetting = new Setting(containerEl)
			.setName('Model')
			.setDesc('The model to use for caption generation');

		// Check if we have API key to fetch models
		if (this.plugin.settings.apiKey) {
			modelSetting.addDropdown(async (dropdown) => {
				// Add default/current model first
				dropdown.addOption(this.plugin.settings.model, this.plugin.settings.model);

				// Add common models
				const commonModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'];
				commonModels.forEach(model => {
					if (model !== this.plugin.settings.model) {
						dropdown.addOption(model, model);
					}
				});

				dropdown.setValue(this.plugin.settings.model);
				dropdown.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				});

				// Fetch and add available models asynchronously
				const models = await this.fetchOpenAIModels();
				if (models.length > 0) {
					// Clear and repopulate with fetched models
					dropdown.selectEl.empty();
					models.forEach(model => {
						dropdown.addOption(model.id, model.name);
					});
					dropdown.setValue(this.plugin.settings.model);
				}

				return dropdown;
			});
		} else {
			modelSetting.addText((text) => {
				text
					.setPlaceholder('gpt-4o-mini')
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value;
						await this.plugin.saveSettings();
					});
				return text;
			});
		}
	}

	displayLocalSettings(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: 'Local Model Settings' });

		const localServerSetting = new Setting(containerEl)
			.setName('Local Model Server')
					.setDesc('Select your local model server or choose Custom to enter your own')
					.addDropdown((dropdown) =>
						dropdown
							.addOption('ollama', 'Ollama (port 11434)')
							.addOption('lm-studio', 'LM Studio (port 1234)')
							.addOption('localai', 'LocalAI (port 8080)')
							.addOption('custom', 'Custom')
							.setValue(this.plugin.settings.localModelServer)
							.onChange(async (value: string) => {
								this.plugin.settings.localModelServer = value;

								// Auto-update local endpoint and model for presets (don't touch cloud settings)
								if (value !== 'custom') {
									const preset = LOCAL_MODEL_PRESETS[value];
									this.plugin.settings.localApiEndpoint = preset.endpoint;
									this.plugin.settings.localModel = preset.model;
								}

								await this.plugin.saveSettings();
								// Refresh display to update fields
								this.display();
							}),
					);

				// Add test button for local model
				localServerSetting.addButton((button) => {
					button.setButtonText('Test').onClick(async () => {
						button.setDisabled(true);
						button.setButtonText('Testing...');

						const endpoint =
							this.plugin.settings.localModelServer !== 'custom'
								? LOCAL_MODEL_PRESETS[this.plugin.settings.localModelServer].endpoint
								: this.plugin.settings.localApiEndpoint;

						try {
							// Try a simple health check or models endpoint
							const baseUrl = endpoint.replace(/\/chat\/completions$/, '').replace(/\/chat$/, '');
							const testUrl = baseUrl.includes('11434') ? `${baseUrl}/api/tags` : `${baseUrl}/models`;

							const response = await fetch(testUrl, {
								method: 'GET',
								headers: {
									Authorization: 'Bearer local',
								},
							});

							if (response.ok) {
								new Notice(`✅ Connected to ${LOCAL_MODEL_PRESETS[this.plugin.settings.localModelServer].name}!`);
							} else if (response.status === 404) {
								// Server is running but endpoint not found - still counts as success
								new Notice(`✅ ${LOCAL_MODEL_PRESETS[this.plugin.settings.localModelServer].name} server detected`);
							} else {
								new Notice(`⚠️ Server responded with status ${response.status}`);
							}
						} catch (_error) {
							new Notice(
								`❌ Cannot connect to local server. Is ${LOCAL_MODEL_PRESETS[this.plugin.settings.localModelServer].name} running?`,
							);
						} finally {
							button.setDisabled(false);
							button.setButtonText('Test');
						}
					});
				});

				// Show help text for local models
				const helpDiv = containerEl.createEl('div', {
					cls: 'setting-item-description',
					attr: {
						style: 'margin-top: -10px; margin-bottom: 20px; padding-left: 0;',
					},
				});
				helpDiv.createEl('span', { text: 'Need help setting up? ' });
				helpDiv.createEl('a', {
					text: 'See local model guide',
					href: 'https://github.com/osteele/obsidian-image-renamer/blob/main/docs/LOCAL_MODELS.md',
				});

				// API Key for custom local models
				if (this.plugin.settings.localModelServer === 'custom') {
					new Setting(containerEl)
						.setName('Local API Key')
						.setDesc('API key for your custom local server (if required)')
						.addText((text) => {
							text
								.setPlaceholder('Leave empty if not required')
								.setValue(this.plugin.settings.localApiKey)
								.onChange(async (value) => {
									this.plugin.settings.localApiKey = value;
									await this.plugin.saveSettings();
								});
							text.inputEl.type = 'password';
							return text;
						});
				}
			}
		}

		// API Key (show for cloud API or on mobile)
		if (!this.plugin.settings.useLocalModel || this.app.isMobile) {
			const apiKeySetting = new Setting(containerEl)
				.setName('API Key')
				.setDesc('Your OpenAI API key (or compatible service)')
				.addText((text) => {
					text
						.setPlaceholder('sk-...')
						.setValue(this.plugin.settings.apiKey)
						.onChange(async (value) => {
							this.plugin.settings.apiKey = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.type = 'password';
					text.inputEl.style.paddingRight = '80px'; // Increased padding to accommodate both eye icon and Test button
					text.inputEl.style.fontFamily = 'var(--font-monospace)'; // Make API key monospace

					// Add eye icon for show/hide password
					const eyeIcon = text.inputEl.parentElement?.createEl('span', {
						cls: 'clickable-icon',
						attr: {
							style:
								'position: absolute; right: 60px; top: 50%; transform: translateY(-50%); cursor: pointer; z-index: 1;', // Moved left to avoid border overlap
						},
					});

					if (eyeIcon) {
						// Set initial icon
						eyeIcon.innerHTML =
							'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';

						eyeIcon.addEventListener('click', () => {
							if (text.inputEl.type === 'password') {
								text.inputEl.type = 'text';
								// Eye with slash (hidden)
								eyeIcon.innerHTML =
									'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
							} else {
								text.inputEl.type = 'password';
								// Regular eye (visible)
								eyeIcon.innerHTML =
									'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
							}
						});

						// Make the parent position relative for absolute positioning
						if (text.inputEl.parentElement) {
							text.inputEl.parentElement.style.position = 'relative';
							text.inputEl.parentElement.style.display = 'flex';
							text.inputEl.parentElement.style.alignItems = 'center';
						}
					}

					return text;
				});

			// Add test button
			apiKeySetting.addButton((button) => {
				button.setButtonText('Test').onClick(async () => {
					if (!this.plugin.settings.apiKey) {
						new Notice('Please enter an API key first');
						return;
					}

					if (!this.plugin.validateApiEndpoint(this.plugin.settings.apiEndpoint)) {
						new Notice('❌ Invalid API endpoint URL');
						return;
					}

					button.setDisabled(true);
					button.setButtonText('Testing...');

					try {
						// Extract base URL from the endpoint (for OpenAI-style APIs)
						const endpointUrl = new URL(this.plugin.settings.apiEndpoint);
						const baseUrl = `${endpointUrl.protocol}//${endpointUrl.host}`;
						const modelsUrl = `${baseUrl}/v1/models`;

						// Try to fetch models list (doesn't consume tokens)
						const response = await fetch(modelsUrl, {
							method: 'GET',
							headers: {
								Authorization: `Bearer ${this.plugin.settings.apiKey}`,
							},
						});

						if (response.ok) {
							const data = await response.json();
							if (data.data && Array.isArray(data.data)) {
								const modelCount = data.data.length;
								const hasVisionModel = data.data.some(
									(m: { id: string }) => m.id.includes('vision') || m.id.includes('gpt-4') || m.id.includes('claude'),
								);
								new Notice(
									`✅ API connected! Found ${modelCount} models${hasVisionModel ? ' (including vision models)' : ''}`,
								);
							} else {
								new Notice('✅ API connection successful!');
							}
						} else {
							if (response.status === 401) {
								new Notice('❌ Invalid API key');
							} else if (response.status === 429) {
								new Notice('⚠️ Rate limit exceeded. Try again later.');
							} else if (response.status === 404) {
								// Models endpoint not found, try a simple completion instead
								new Notice('✅ API key validated (models endpoint not available)');
							} else {
								new Notice(`❌ API error: ${response.status}`);
							}
						}
					} catch (error) {
						console.error('API test error:', error);
						new Notice('❌ Failed to connect to API');
					} finally {
						button.setDisabled(false);
						button.setButtonText('Test');
					}
				});
			});
		}

		// Add help text with link (for cloud API or on mobile)
		if (!this.plugin.settings.useLocalModel || this.app.isMobile) {
			const helpDiv = containerEl.createEl('div', {
				cls: 'setting-item-description',
				attr: {
					style: 'margin-top: -10px; margin-bottom: 10px; padding-left: 0;',
				},
			});
			helpDiv.createEl('span', { text: 'New to OpenAI? ' });
			helpDiv.createEl('a', {
				text: 'Get your API key here',
				href: 'https://platform.openai.com/api-keys',
			});
			helpDiv.createEl('span', { text: ". You'll need to add billing to use the vision API." });

			// Security warning (more subtle styling)
			const warningDiv = containerEl.createEl('div', {
				cls: 'setting-item-description',
				attr: {
					style: 'margin-bottom: 20px; padding-left: 0; color: var(--text-error); font-size: 0.9em;',
				},
			});
			warningDiv.createEl('span', { text: '🔒 ' });
			warningDiv.createEl('span', {
				text: 'API keys are stored in plain text in your vault configuration. Keep your vault secure.',
			});
		}

		// API Endpoint - show for cloud, custom local, or on mobile
		if (
			!this.plugin.settings.useLocalModel ||
			this.plugin.settings.localModelServer === 'custom' ||
			this.app.isMobile
		) {
			const isLocal =
				this.plugin.settings.useLocalModel && this.plugin.settings.localModelServer === 'custom' && !this.app.isMobile;
			const _endpointSetting = new Setting(containerEl)
				.setName('API Endpoint')
				.setDesc(isLocal ? 'The API endpoint for your custom local model' : 'The API endpoint for the vision model')
				.addText((text) => {
					text
						.setPlaceholder(
							isLocal ? 'http://localhost:8080/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions',
						)
						.setValue(isLocal ? this.plugin.settings.localApiEndpoint : this.plugin.settings.apiEndpoint)
						.onChange(async (value) => {
							// Validate URL
							if (value && !this.plugin.validateApiEndpoint(value)) {
								text.inputEl.style.borderColor = 'var(--text-error)';
								new Notice('Invalid URL format');
							} else {
								text.inputEl.style.borderColor = '';
								if (isLocal) {
									this.plugin.settings.localApiEndpoint = value;
								} else {
									this.plugin.settings.apiEndpoint = value;
								}
								await this.plugin.saveSettings();
							}
						});
					return text;
				});
		}

		// Model - show for cloud, custom local, or on mobile
		if (
			!this.plugin.settings.useLocalModel ||
			this.plugin.settings.localModelServer === 'custom' ||
			this.app.isMobile
		) {
			const isLocal =
				this.plugin.settings.useLocalModel && this.plugin.settings.localModelServer === 'custom' && !this.app.isMobile;
			new Setting(containerEl)
				.setName('Model')
				.setDesc(isLocal ? 'The model name for your local server' : 'The model to use for caption generation')
				.addText((text) => {
					text
						.setPlaceholder(isLocal ? 'llava' : 'gpt-4o-mini')
						.setValue(isLocal ? this.plugin.settings.localModel : this.plugin.settings.model)
						.onChange(async (value) => {
							if (isLocal) {
								this.plugin.settings.localModel = value;
							} else {
								this.plugin.settings.model = value;
							}
							await this.plugin.saveSettings();
						});
					return text;
				});
		}

		// File Naming Settings section
		containerEl.createEl('h3', { text: 'File Naming Settings' });

		new Setting(containerEl)
			.setName('Date Prefix')
			.setDesc('Add date prefix to renamed files')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.datePrefix).onChange(async (value) => {
					this.plugin.settings.datePrefix = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Case Style')
			.setDesc('How to handle letter casing in filenames')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('preserve', 'Preserve original')
					.addOption('lower', 'lowercase')
					.addOption('upper', 'UPPERCASE')
					.addOption('title', 'Title Case')
					.addOption('sentence', 'Sentence case')
					.setValue(this.plugin.settings.caseStyle)
					.onChange(async (value: string) => {
						this.plugin.settings.caseStyle = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Allow Spaces')
			.setDesc('Allow spaces in filenames (otherwise uses hyphens)')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.allowSpaces).onChange(async (value) => {
					this.plugin.settings.allowSpaces = value;
					await this.plugin.saveSettings();
				}),
			);

		// Advanced settings
		containerEl.createEl('h3', { text: 'Advanced Settings' });

		new Setting(containerEl)
			.setName('Request Timeout')
			.setDesc('Timeout for API requests in seconds (default: 30)')
			.addText((text) =>
				text
					.setPlaceholder('30')
					.setValue(String(this.plugin.settings.timeoutMs / 1000))
					.onChange(async (value) => {
						const seconds = parseInt(value, 10) || 30;
						this.plugin.settings.timeoutMs = seconds * 1000;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Max Retries')
			.setDesc('Maximum number of retry attempts for failed requests (default: 3)')
			.addText((text) =>
				text
					.setPlaceholder('3')
					.setValue(String(this.plugin.settings.maxRetries))
					.onChange(async (value) => {
						this.plugin.settings.maxRetries = parseInt(value, 10) || 3;
						await this.plugin.saveSettings();
					}),
			);
	}
}
*/
