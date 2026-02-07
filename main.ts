import { Plugin, PluginSettingTab, App, Setting, MarkdownPostProcessorContext, MarkdownView, TFile, Notice } from "obsidian";

// Type definition for the plugin's settings
interface AdvancedImageSettings {
	// Default percent value (applied automatically when an image is pasted)
	defaultPercent: number;
	// Whether to auto-display at 100% on mobile
	mobileAutoFull: boolean;
	// Screen-width threshold for detecting mobile (px)
	mobileThreshold: number;
}

// Default settings
const DEFAULT_SETTINGS: AdvancedImageSettings = {
	defaultPercent: 50,
	mobileAutoFull: true,
	mobileThreshold: 768,
};

// Pattern for a percent spec (e.g. "50%" or "image 50%")
const PERCENT_PATTERN = /(\d{1,3})%$/;

// List of image extensions
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "avif", "heic", "tif", "tiff"];

// Image link pattern: ![[filename.ext]] or ![[filename.ext|...]]
const IMAGE_LINK_PATTERN = /!\[\[([^\]|]+\.(png|jpg|jpeg|gif|bmp|svg|webp|avif|heic|tif|tiff))(\|[^\]]*)?\]\]/gi;

export default class AdvancedImagePlugin extends Plugin {
	settings: AdvancedImageSettings = DEFAULT_SETTINGS;
	private styleEl: HTMLStyleElement | null = null;
	private observer: MutationObserver | null = null;
	// Timer that prevents rescans from firing too often in a row
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	async onload() {
		// Load settings
		await this.loadSettings();

		// Dynamically add mobile CSS (media query)
		this.updateMobileStyle();

		// Handle the image's percent display in Reading View (view mode)
		this.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			this.processImages(el);
		});

		// Handle the image's percent display in Live Preview (edit mode)
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.setupLivePreviewObserver();
				this.debouncedScanAll();
			})
		);

		// Also rescan when switching notes
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.debouncedScanAll();
			})
		);

		// Also rescan when the editor content changes
		// (so edits like |50% → |30% in Live Preview get picked up)
		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				this.debouncedScanAll();
			})
		);

		// Initial setup
		this.app.workspace.onLayoutReady(() => {
			this.setupLivePreviewObserver();
			this.debouncedScanAll();
		});

		// When an image is pasted/dropped, automatically rename it and add the default % value
		this.registerEvent(
			this.app.workspace.on("editor-paste", (evt: ClipboardEvent, editor, view) => {
				this.handleImageInsert(editor);
			})
		);

		this.registerEvent(
			this.app.workspace.on("editor-drop", (evt: DragEvent, editor, view) => {
				this.handleImageInsert(editor);
			})
		);

		// When copying (Cmd+C), if the cursor line is an image link
		// Put both text and image data on the clipboard
		this.registerDomEvent(document, "copy", (evt: ClipboardEvent) => {
			this.handleImageCopy(evt);
		});

		// Add the settings tab
		this.addSettingTab(new AdvancedImageSettingTab(this.app, this));
	}

	onunload() {
		// Remove any added styles when the plugin is disabled
		if (this.styleEl) {
			this.styleEl.remove();
			this.styleEl = null;
		}
		// Stop the MutationObserver
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
		// Stop the timer
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update mobile styles when settings change
		this.updateMobileStyle();
	}

	// Dynamically generate and add mobile CSS
	updateMobileStyle() {
		// Remove the existing style element if present
		if (this.styleEl) {
			this.styleEl.remove();
		}

		this.styleEl = document.createElement("style");
		this.styleEl.id = "advanced-image-mobile-style";

		if (this.settings.mobileAutoFull) {
			// On mobile, always display at 100% width regardless of the percent spec
			this.styleEl.textContent = `
				@media (max-width: ${this.settings.mobileThreshold}px) {
					img.advanced-image-percent {
						width: 100% !important;
						max-width: 100% !important;
					}
				}
			`;
		} else {
			this.styleEl.textContent = "";
		}

		document.head.appendChild(this.styleEl);
	}

	// Find image elements and apply the percent display
	processImages(el: HTMLElement) {
		const images = el.querySelectorAll("img");
		images.forEach((img: HTMLImageElement) => {
			// Read the percent value out of the alt text
			const alt = img.alt;
			if (!alt) {
				// If there's no alt text, the percent spec may have been removed
				// Reset any previously applied style
				if (img.classList.contains("advanced-image-percent")) {
					img.classList.remove("advanced-image-percent");
					img.style.width = "";
					img.style.maxWidth = "";
					img.style.height = "";
				}
				return;
			}

			const match = alt.match(PERCENT_PATTERN);
			if (!match) {
				// Also reset when it doesn't match the percent pattern
				if (img.classList.contains("advanced-image-percent")) {
					img.classList.remove("advanced-image-percent");
					img.style.width = "";
					img.style.maxWidth = "";
					img.style.height = "";
				}
				return;
			}

			const percent = parseInt(match[1], 10);
			if (percent < 1 || percent > 100) return;

			// Set the width based on the percent value
			img.classList.add("advanced-image-percent");
			img.style.width = `${percent}%`;
			img.style.maxWidth = `${percent}%`;
			img.style.height = "auto";
		});

		// In Live Preview, the image sits inside the .internal-embed element
		// The percent value can also live in .internal-embed's alt attribute
		const embeds = el.querySelectorAll(".internal-embed");
		embeds.forEach((embed: Element) => {
			const alt = embed.getAttribute("alt");
			if (!alt) return;

			const match = alt.match(PERCENT_PATTERN);
			if (!match) return;

			const percent = parseInt(match[1], 10);
			if (percent < 1 || percent > 100) return;

			// Apply the style to images inside the embed
			const img = embed.querySelector("img");
			if (img) {
				img.classList.add("advanced-image-percent");
				img.style.width = `${percent}%`;
				img.style.maxWidth = `${percent}%`;
				img.style.height = "auto";
			}
		});
	}

	// Rescan images across the whole workspace (guarded against back-to-back runs)
	debouncedScanAll() {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			const workspace = document.querySelector(".workspace");
			if (workspace) {
				this.processImages(workspace as HTMLElement);
			}
		}, 100);
	}

	// Watch for images in Live Preview mode and process them
	setupLivePreviewObserver() {
		// Stop the existing observer
		if (this.observer) {
			this.observer.disconnect();
		}

		this.observer = new MutationObserver((mutations) => {
			let needsScan = false;
			for (const mutation of mutations) {
				// Look for images among newly added nodes
				if (mutation.addedNodes.length > 0) {
					mutation.addedNodes.forEach((node) => {
						if (node instanceof HTMLElement) {
							this.processImages(node);
						}
					});
				}
				// Also rescan when an attribute changes (e.g. alt text edits)
				if (mutation.type === "attributes") {
					needsScan = true;
				}
			}
			if (needsScan) {
				this.debouncedScanAll();
			}
		});

		// Watch the whole workspace
		const container = document.querySelector(".workspace");
		if (container) {
			this.observer.observe(container, {
				childList: true,
				subtree: true,
				// Also watch for attribute changes (to detect edits to alt, src, etc.)
				attributes: true,
				attributeFilter: ["alt", "src", "class"],
			});
		}

		// Also process images that are already showing
		this.debouncedScanAll();
	}

	// Return the current date/time as YYYY-MM-DD_HH-mm-ss
	getFormattedDate(): string {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
	}

	// If a file with the same name exists, return a path with a numeric suffix
	async getUniqueFilePath(folderPath: string, baseName: string, ext: string): Promise<string> {
		let candidate = `${folderPath}/${baseName}.${ext}`;
		if (!this.app.vault.getAbstractFileByPath(candidate)) {
			return candidate;
		}
		// If a file with the same name exists, try _1, _2, and so on
		let suffix = 1;
		while (true) {
			candidate = `${folderPath}/${baseName}_${suffix}.${ext}`;
			if (!this.app.vault.getAbstractFileByPath(candidate)) {
				return candidate;
			}
			suffix++;
		}
	}

	// When an image is pasted/dropped, automatically rename it and append the default % value
	handleImageInsert(editor: any) {
		const defaultPercent = this.settings.defaultPercent;

		// Wait a bit for Obsidian to finish writing the image link
		setTimeout(async () => {
			const cursor = editor.getCursor();
			const line = editor.getLine(cursor.line);

			// Look for the image-link pattern: ![[filename.ext]] (no pipe = not processed yet)
			const pastedPattern = /!\[\[([^\]|]+\.(png|jpg|jpeg|gif|bmp|svg|webp|avif|heic|tif|tiff))\]\]/gi;
			const match = pastedPattern.exec(line);
			if (!match) return;

			const originalFilename = match[1];
			// Do nothing if it already has a pipe
			if (originalFilename.includes("|")) return;

			// Find the original image file
			const originalFile = this.app.vault.getAbstractFileByPath(originalFilename)
				|| this.app.metadataCache.getFirstLinkpathDest(originalFilename, "");

			if (!originalFile || !(originalFile instanceof TFile)) {
				// If the file isn't found, just append the %
				const newLine = line.replace(match[0], `![[${originalFilename}|${defaultPercent}%]]`);
				editor.setLine(cursor.line, newLine);
				return;
			}

			// Get the current note's name
			const activeFile = this.app.workspace.getActiveFile();
			const noteName = activeFile ? activeFile.basename : "untitled";

			// Build the new file name: notename_timestamp.ext
			const dateStr = this.getFormattedDate();
			const ext = originalFile.extension;
			const newBaseName = `${noteName}_${dateStr}`;

			// Path to the folder containing the image file
			const folderPath = originalFile.parent ? originalFile.parent.path : "";

			// Check whether a file with the same name exists, and append a numeric suffix if so
			const newPath = await this.getUniqueFilePath(folderPath, newBaseName, ext);
			const newFileName = newPath.split("/").pop() || `${newBaseName}.${ext}`;

			// Rename the file
			try {
				await this.app.fileManager.renameFile(originalFile, newPath);

				// Update the editor's link to the new file name + %
				// renameFile auto-updates the link, so re-read the line
				const updatedLine = editor.getLine(cursor.line);
				const nameWithoutExt = newFileName.replace(`.${ext}`, "");
				// Append the percentage to the link after renaming
				const renamePattern = new RegExp(
					`!\\[\\[${nameWithoutExt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.${ext}\\]\\]`,
					"g"
				);
				if (renamePattern.test(updatedLine)) {
					const finalLine = updatedLine.replace(renamePattern, `![[${newFileName}|${defaultPercent}%]]`);
					editor.setLine(cursor.line, finalLine);
				}
			} catch (e) {
				// If the rename fails, just append % to the original file name
				const currentLine = editor.getLine(cursor.line);
				const fallbackPattern = new RegExp(
					`!\\[\\[${originalFilename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`,
					"g"
				);
				const newLine = currentLine.replace(fallbackPattern, `![[${originalFilename}|${defaultPercent}%]]`);
				editor.setLine(cursor.line, newLine);
			}
		}, 800);
	}

	// On copy, if the cursor line is an image link
	// Copy the text first, then overwrite the clipboard with image data shortly after
	async handleImageCopy(evt: ClipboardEvent) {
		// Get the active editor
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;

		// Check whether there's a selection
		const selection = editor.getSelection();
		// Get the text of the line the cursor is on
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		// Look for an image link in the selection, or the whole line
		const textToCheck = selection || line;
		IMAGE_LINK_PATTERN.lastIndex = 0;
		const match = IMAGE_LINK_PATTERN.exec(textToCheck);
		if (!match) return;

		// Found an image link
		const imageFilename = match[1];

		// Look for image files
		const imageFile = this.app.metadataCache.getFirstLinkpathDest(imageFilename, "");
		if (!imageFile || !(imageFile instanceof TFile)) return;

		// Stop the default copy and handle it ourselves
		evt.preventDefault();

		// The text to copy (the selection if there is one, otherwise the whole line)
		const textToCopy = selection || line;

		// (1) First, copy the text to the clipboard
		await navigator.clipboard.writeText(textToCopy);
		new Notice("テキストをコピーしました");

		// (2) Overwrite the clipboard with image data 1.5 seconds later
		setTimeout(async () => {
			try {
				// Read the image file's binary data
				const imageData = await this.app.vault.readBinary(imageFile);

				// Determine the image's MIME type (e.g. image/png, image/jpeg)
				const ext = imageFile.extension.toLowerCase();
				let mimeType = "image/png";
				if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
				else if (ext === "gif") mimeType = "image/gif";
				else if (ext === "webp") mimeType = "image/webp";
				else if (ext === "bmp") mimeType = "image/bmp";
				else if (ext === "svg") mimeType = "image/svg+xml";
				else if (ext === "avif") mimeType = "image/avif";

				// Overwrite the clipboard with image data
				const clipboardItem = new ClipboardItem({
					[mimeType]: new Blob([imageData], { type: mimeType }),
				});
				await navigator.clipboard.write([clipboardItem]);
				new Notice("画像をコピーしました");
			} catch (e) {
				new Notice("画像のコピーに失敗しました");
			}
		}, 1500);
	}
}

// Settings tab
class AdvancedImageSettingTab extends PluginSettingTab {
	plugin: AdvancedImagePlugin;

	constructor(app: App, plugin: AdvancedImagePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Default percent value
		new Setting(containerEl)
			.setName("デフォルトのパーセント値")
			.setDesc("画像をペーストしたとき、自動で付くパーセント値（10〜100）")
			.addSlider((slider) =>
				slider
					.setLimits(10, 100, 5)
					.setValue(this.plugin.settings.defaultPercent)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.defaultPercent = value;
						await this.plugin.saveSettings();
					})
			);

		// Auto-display at 100% on mobile
		new Setting(containerEl)
			.setName("モバイルで自動100%表示")
			.setDesc("画面幅が小さいデバイスでは、パーセント指定に関係なく画像を100%幅で表示します")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.mobileAutoFull)
					.onChange(async (value) => {
						this.plugin.settings.mobileAutoFull = value;
						await this.plugin.saveSettings();
					})
			);

		// Threshold for detecting mobile
		new Setting(containerEl)
			.setName("モバイル判定の画面幅（px）")
			.setDesc("この幅以下のデバイスをモバイルとして扱います（初期値: 768）")
			.addText((text) =>
				text
					.setPlaceholder("768")
					.setValue(String(this.plugin.settings.mobileThreshold))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.mobileThreshold = num;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
