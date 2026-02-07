var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AdvancedImagePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  defaultPercent: 50,
  mobileAutoFull: true,
  mobileThreshold: 768
};
var PERCENT_PATTERN = /(\d{1,3})%$/;
var IMAGE_LINK_PATTERN = /!\[\[([^\]|]+\.(png|jpg|jpeg|gif|bmp|svg|webp|avif|heic|tif|tiff))(\|[^\]]*)?\]\]/gi;
var AdvancedImagePlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.styleEl = null;
    this.observer = null;
    // 再スキャンが連続で走りすぎないよう制御するタイマー
    this.debounceTimer = null;
  }
  async onload() {
    await this.loadSettings();
    this.updateMobileStyle();
    this.registerMarkdownPostProcessor((el, ctx) => {
      this.processImages(el);
    });
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.setupLivePreviewObserver();
        this.debouncedScanAll();
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.debouncedScanAll();
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        this.debouncedScanAll();
      })
    );
    this.app.workspace.onLayoutReady(() => {
      this.setupLivePreviewObserver();
      this.debouncedScanAll();
    });
    this.registerEvent(
      this.app.workspace.on("editor-paste", (evt, editor, view) => {
        this.handleImageInsert(editor);
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-drop", (evt, editor, view) => {
        this.handleImageInsert(editor);
      })
    );
    this.registerDomEvent(document, "copy", (evt) => {
      this.handleImageCopy(evt);
    });
    this.addSettingTab(new AdvancedImageSettingTab(this.app, this));
  }
  onunload() {
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
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
    this.updateMobileStyle();
  }
  // モバイル用のCSSを動的に生成して追加する
  updateMobileStyle() {
    if (this.styleEl) {
      this.styleEl.remove();
    }
    this.styleEl = document.createElement("style");
    this.styleEl.id = "advanced-image-mobile-style";
    if (this.settings.mobileAutoFull) {
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
  // 画像要素を探してパーセント表示を適用する
  processImages(el) {
    const images = el.querySelectorAll("img");
    images.forEach((img) => {
      const alt = img.alt;
      if (!alt) {
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
        if (img.classList.contains("advanced-image-percent")) {
          img.classList.remove("advanced-image-percent");
          img.style.width = "";
          img.style.maxWidth = "";
          img.style.height = "";
        }
        return;
      }
      const percent = parseInt(match[1], 10);
      if (percent < 1 || percent > 100)
        return;
      img.classList.add("advanced-image-percent");
      img.style.width = `${percent}%`;
      img.style.maxWidth = `${percent}%`;
      img.style.height = "auto";
    });
    const embeds = el.querySelectorAll(".internal-embed");
    embeds.forEach((embed) => {
      const alt = embed.getAttribute("alt");
      if (!alt)
        return;
      const match = alt.match(PERCENT_PATTERN);
      if (!match)
        return;
      const percent = parseInt(match[1], 10);
      if (percent < 1 || percent > 100)
        return;
      const img = embed.querySelector("img");
      if (img) {
        img.classList.add("advanced-image-percent");
        img.style.width = `${percent}%`;
        img.style.maxWidth = `${percent}%`;
        img.style.height = "auto";
      }
    });
  }
  // ワークスペース全体の画像を再スキャンする（連続実行を防ぐ制御付き）
  debouncedScanAll() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      const workspace = document.querySelector(".workspace");
      if (workspace) {
        this.processImages(workspace);
      }
    }, 100);
  }
  // Live Preview モードで画像を監視して処理する
  setupLivePreviewObserver() {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.observer = new MutationObserver((mutations) => {
      let needsScan = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement) {
              this.processImages(node);
            }
          });
        }
        if (mutation.type === "attributes") {
          needsScan = true;
        }
      }
      if (needsScan) {
        this.debouncedScanAll();
      }
    });
    const container = document.querySelector(".workspace");
    if (container) {
      this.observer.observe(container, {
        childList: true,
        subtree: true,
        // 属性の変更も監視する（alt, src などの変化を検知するため）
        attributes: true,
        attributeFilter: ["alt", "src", "class"]
      });
    }
    this.debouncedScanAll();
  }
  // 現在の日時を YYYY-MM-DD_HH-mm-ss 形式で返す
  getFormattedDate() {
    const now = /* @__PURE__ */ new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  }
  // 同名ファイルがある場合、数字サフィックスを付けたパスを返す
  async getUniqueFilePath(folderPath, baseName, ext) {
    let candidate = `${folderPath}/${baseName}.${ext}`;
    if (!this.app.vault.getAbstractFileByPath(candidate)) {
      return candidate;
    }
    let suffix = 1;
    while (true) {
      candidate = `${folderPath}/${baseName}_${suffix}.${ext}`;
      if (!this.app.vault.getAbstractFileByPath(candidate)) {
        return candidate;
      }
      suffix++;
    }
  }
  // 画像がペースト/ドロップされたとき、リネーム＋デフォルトの%値を自動で追加する
  handleImageInsert(editor) {
    const defaultPercent = this.settings.defaultPercent;
    setTimeout(async () => {
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line);
      const pastedPattern = /!\[\[([^\]|]+\.(png|jpg|jpeg|gif|bmp|svg|webp|avif|heic|tif|tiff))\]\]/gi;
      const match = pastedPattern.exec(line);
      if (!match)
        return;
      const originalFilename = match[1];
      if (originalFilename.includes("|"))
        return;
      const originalFile = this.app.vault.getAbstractFileByPath(originalFilename) || this.app.metadataCache.getFirstLinkpathDest(originalFilename, "");
      if (!originalFile || !(originalFile instanceof import_obsidian.TFile)) {
        const newLine = line.replace(match[0], `![[${originalFilename}|${defaultPercent}%]]`);
        editor.setLine(cursor.line, newLine);
        return;
      }
      const activeFile = this.app.workspace.getActiveFile();
      const noteName = activeFile ? activeFile.basename : "untitled";
      const dateStr = this.getFormattedDate();
      const ext = originalFile.extension;
      const newBaseName = `${noteName}_${dateStr}`;
      const folderPath = originalFile.parent ? originalFile.parent.path : "";
      const newPath = await this.getUniqueFilePath(folderPath, newBaseName, ext);
      const newFileName = newPath.split("/").pop() || `${newBaseName}.${ext}`;
      try {
        await this.app.fileManager.renameFile(originalFile, newPath);
        const updatedLine = editor.getLine(cursor.line);
        const nameWithoutExt = newFileName.replace(`.${ext}`, "");
        const renamePattern = new RegExp(
          `!\\[\\[${nameWithoutExt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.${ext}\\]\\]`,
          "g"
        );
        if (renamePattern.test(updatedLine)) {
          const finalLine = updatedLine.replace(renamePattern, `![[${newFileName}|${defaultPercent}%]]`);
          editor.setLine(cursor.line, finalLine);
        }
      } catch (e) {
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
  // コピー時に、カーソル行が画像リンクなら
  // 最初にテキストをコピー → 少し後に画像データでクリップボードを上書きする
  async handleImageCopy(evt) {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (!view)
      return;
    const editor = view.editor;
    const selection = editor.getSelection();
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const textToCheck = selection || line;
    IMAGE_LINK_PATTERN.lastIndex = 0;
    const match = IMAGE_LINK_PATTERN.exec(textToCheck);
    if (!match)
      return;
    const imageFilename = match[1];
    const imageFile = this.app.metadataCache.getFirstLinkpathDest(imageFilename, "");
    if (!imageFile || !(imageFile instanceof import_obsidian.TFile))
      return;
    evt.preventDefault();
    const textToCopy = selection || line;
    await navigator.clipboard.writeText(textToCopy);
    new import_obsidian.Notice("\u30C6\u30AD\u30B9\u30C8\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F");
    setTimeout(async () => {
      try {
        const imageData = await this.app.vault.readBinary(imageFile);
        const ext = imageFile.extension.toLowerCase();
        let mimeType = "image/png";
        if (ext === "jpg" || ext === "jpeg")
          mimeType = "image/jpeg";
        else if (ext === "gif")
          mimeType = "image/gif";
        else if (ext === "webp")
          mimeType = "image/webp";
        else if (ext === "bmp")
          mimeType = "image/bmp";
        else if (ext === "svg")
          mimeType = "image/svg+xml";
        else if (ext === "avif")
          mimeType = "image/avif";
        const clipboardItem = new ClipboardItem({
          [mimeType]: new Blob([imageData], { type: mimeType })
        });
        await navigator.clipboard.write([clipboardItem]);
        new import_obsidian.Notice("\u753B\u50CF\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F");
      } catch (e) {
        new import_obsidian.Notice("\u753B\u50CF\u306E\u30B3\u30D4\u30FC\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
      }
    }, 1500);
  }
};
var AdvancedImageSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("\u30C7\u30D5\u30A9\u30EB\u30C8\u306E\u30D1\u30FC\u30BB\u30F3\u30C8\u5024").setDesc("\u753B\u50CF\u3092\u30DA\u30FC\u30B9\u30C8\u3057\u305F\u3068\u304D\u3001\u81EA\u52D5\u3067\u4ED8\u304F\u30D1\u30FC\u30BB\u30F3\u30C8\u5024\uFF0810\u301C100\uFF09").addSlider(
      (slider) => slider.setLimits(10, 100, 5).setValue(this.plugin.settings.defaultPercent).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.defaultPercent = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u30E2\u30D0\u30A4\u30EB\u3067\u81EA\u52D5100%\u8868\u793A").setDesc("\u753B\u9762\u5E45\u304C\u5C0F\u3055\u3044\u30C7\u30D0\u30A4\u30B9\u3067\u306F\u3001\u30D1\u30FC\u30BB\u30F3\u30C8\u6307\u5B9A\u306B\u95A2\u4FC2\u306A\u304F\u753B\u50CF\u3092100%\u5E45\u3067\u8868\u793A\u3057\u307E\u3059").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.mobileAutoFull).onChange(async (value) => {
        this.plugin.settings.mobileAutoFull = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u30E2\u30D0\u30A4\u30EB\u5224\u5B9A\u306E\u753B\u9762\u5E45\uFF08px\uFF09").setDesc("\u3053\u306E\u5E45\u4EE5\u4E0B\u306E\u30C7\u30D0\u30A4\u30B9\u3092\u30E2\u30D0\u30A4\u30EB\u3068\u3057\u3066\u6271\u3044\u307E\u3059\uFF08\u521D\u671F\u5024: 768\uFF09").addText(
      (text) => text.setPlaceholder("768").setValue(String(this.plugin.settings.mobileThreshold)).onChange(async (value) => {
        const num = parseInt(value, 10);
        if (!isNaN(num) && num > 0) {
          this.plugin.settings.mobileThreshold = num;
          await this.plugin.saveSettings();
        }
      })
    );
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibWFpbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgUGx1Z2luLCBQbHVnaW5TZXR0aW5nVGFiLCBBcHAsIFNldHRpbmcsIE1hcmtkb3duUG9zdFByb2Nlc3NvckNvbnRleHQsIE1hcmtkb3duVmlldywgVEZpbGUsIE5vdGljZSB9IGZyb20gXCJvYnNpZGlhblwiO1xuXG4vLyBcdTMwRDdcdTMwRTlcdTMwQjBcdTMwQTRcdTMwRjNcdTMwNkVcdThBMkRcdTVCOUFcdTMwNkVcdTU3OEJcdTVCOUFcdTdGQTlcbmludGVyZmFjZSBBZHZhbmNlZEltYWdlU2V0dGluZ3Mge1xuXHQvLyBcdTMwQzdcdTMwRDVcdTMwQTlcdTMwRUJcdTMwQzhcdTMwNkVcdTMwRDFcdTMwRkNcdTMwQkJcdTMwRjNcdTMwQzhcdTUwMjRcdUZGMDhcdTc1M0JcdTUwQ0ZcdTMwREFcdTMwRkNcdTMwQjlcdTMwQzhcdTY2NDJcdTMwNkJcdTgxRUFcdTUyRDVcdTMwNjdcdTRFRDhcdTMwNEZcdTUwMjRcdUZGMDlcblx0ZGVmYXVsdFBlcmNlbnQ6IG51bWJlcjtcblx0Ly8gXHUzMEUyXHUzMEQwXHUzMEE0XHUzMEVCXHUzMDY3XHU4MUVBXHU1MkQ1MTAwJVx1ODg2OFx1NzkzQVx1MzA2Qlx1MzA1OVx1MzA4Qlx1MzA0Qlx1MzA2OVx1MzA0Nlx1MzA0QlxuXHRtb2JpbGVBdXRvRnVsbDogYm9vbGVhbjtcblx0Ly8gXHUzMEUyXHUzMEQwXHUzMEE0XHUzMEVCXHU1MjI0XHU1QjlBXHUzMDZFXHU3NTNCXHU5NzYyXHU1RTQ1XHUzMDU3XHUzMDREXHUzMDQ0XHU1MDI0XHVGRjA4cHhcdUZGMDlcblx0bW9iaWxlVGhyZXNob2xkOiBudW1iZXI7XG59XG5cbi8vIFx1OEEyRFx1NUI5QVx1MzA2RVx1NTIxRFx1NjcxRlx1NTAyNFxuY29uc3QgREVGQVVMVF9TRVRUSU5HUzogQWR2YW5jZWRJbWFnZVNldHRpbmdzID0ge1xuXHRkZWZhdWx0UGVyY2VudDogNTAsXG5cdG1vYmlsZUF1dG9GdWxsOiB0cnVlLFxuXHRtb2JpbGVUaHJlc2hvbGQ6IDc2OCxcbn07XG5cbi8vIFx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1NjMwN1x1NUI5QVx1MzA2RVx1MzBEMVx1MzBCRlx1MzBGQ1x1MzBGM1x1RkYwOFx1NEY4QjogXCI1MCVcIiBcdTMwODQgXCJpbWFnZSA1MCVcIlx1RkYwOVxuY29uc3QgUEVSQ0VOVF9QQVRURVJOID0gLyhcXGR7MSwzfSklJC87XG5cbi8vIFx1NzUzQlx1NTBDRlx1MzA2RVx1NjJFMVx1NUYzNVx1NUI1MFx1NEUwMFx1ODlBN1xuY29uc3QgSU1BR0VfRVhURU5TSU9OUyA9IFtcInBuZ1wiLCBcImpwZ1wiLCBcImpwZWdcIiwgXCJnaWZcIiwgXCJibXBcIiwgXCJzdmdcIiwgXCJ3ZWJwXCIsIFwiYXZpZlwiLCBcImhlaWNcIiwgXCJ0aWZcIiwgXCJ0aWZmXCJdO1xuXG4vLyBcdTc1M0JcdTUwQ0ZcdTMwRUFcdTMwRjNcdTMwQUZcdTMwNkVcdTMwRDFcdTMwQkZcdTMwRkNcdTMwRjM6ICFbW1x1MzBENVx1MzBBMVx1MzBBNFx1MzBFQlx1NTQwRC5cdTYyRTFcdTVGMzVcdTVCNTBdXSBcdTMwN0VcdTMwNUZcdTMwNkYgIVtbXHUzMEQ1XHUzMEExXHUzMEE0XHUzMEVCXHU1NDBELlx1NjJFMVx1NUYzNVx1NUI1MHwuLi5dXVxuY29uc3QgSU1BR0VfTElOS19QQVRURVJOID0gLyFcXFtcXFsoW15cXF18XStcXC4ocG5nfGpwZ3xqcGVnfGdpZnxibXB8c3ZnfHdlYnB8YXZpZnxoZWljfHRpZnx0aWZmKSkoXFx8W15cXF1dKik/XFxdXFxdL2dpO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBBZHZhbmNlZEltYWdlUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcblx0c2V0dGluZ3M6IEFkdmFuY2VkSW1hZ2VTZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG5cdHByaXZhdGUgc3R5bGVFbDogSFRNTFN0eWxlRWxlbWVudCB8IG51bGwgPSBudWxsO1xuXHRwcml2YXRlIG9ic2VydmVyOiBNdXRhdGlvbk9ic2VydmVyIHwgbnVsbCA9IG51bGw7XG5cdC8vIFx1NTE4RFx1MzBCOVx1MzBBRFx1MzBFM1x1MzBGM1x1MzA0Q1x1OTAyM1x1N0Q5QVx1MzA2N1x1OEQ3MFx1MzA4QVx1MzA1OVx1MzA0RVx1MzA2QVx1MzA0NFx1MzA4OFx1MzA0Nlx1NTIzNlx1NUZBMVx1MzA1OVx1MzA4Qlx1MzBCRlx1MzBBNFx1MzBERVx1MzBGQ1xuXHRwcml2YXRlIGRlYm91bmNlVGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbCA9IG51bGw7XG5cblx0YXN5bmMgb25sb2FkKCkge1xuXHRcdC8vIFx1OEEyRFx1NUI5QVx1MzA5Mlx1OEFBRFx1MzA3Rlx1OEZCQ1x1MzA4MFxuXHRcdGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG5cblx0XHQvLyBcdTMwRTJcdTMwRDBcdTMwQTRcdTMwRUJcdTc1MjhcdTMwNkVDU1NcdUZGMDhcdTMwRTFcdTMwQzdcdTMwQTNcdTMwQTJcdTMwQUZcdTMwQThcdTMwRUFcdUZGMDlcdTMwOTJcdTUyRDVcdTc2ODRcdTMwNkJcdThGRkRcdTUyQTBcblx0XHR0aGlzLnVwZGF0ZU1vYmlsZVN0eWxlKCk7XG5cblx0XHQvLyBSZWFkaW5nIFZpZXdcdUZGMDhcdTk1QjJcdTg5QTdcdTMwRTJcdTMwRkNcdTMwQzlcdUZGMDlcdTMwNjdcdTc1M0JcdTUwQ0ZcdTMwNkVcdTMwRDFcdTMwRkNcdTMwQkJcdTMwRjNcdTMwQzhcdTg4NjhcdTc5M0FcdTMwOTJcdTUxRTZcdTc0MDZcdTMwNTlcdTMwOEJcblx0XHR0aGlzLnJlZ2lzdGVyTWFya2Rvd25Qb3N0UHJvY2Vzc29yKChlbDogSFRNTEVsZW1lbnQsIGN0eDogTWFya2Rvd25Qb3N0UHJvY2Vzc29yQ29udGV4dCkgPT4ge1xuXHRcdFx0dGhpcy5wcm9jZXNzSW1hZ2VzKGVsKTtcblx0XHR9KTtcblxuXHRcdC8vIExpdmUgUHJldmlld1x1RkYwOFx1N0RFOFx1OTZDNlx1MzBFMlx1MzBGQ1x1MzBDOVx1RkYwOVx1MzA2N1x1NzUzQlx1NTBDRlx1MzA2RVx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1ODg2OFx1NzkzQVx1MzA5Mlx1NTFFNlx1NzQwNlx1MzA1OVx1MzA4QlxuXHRcdHRoaXMucmVnaXN0ZXJFdmVudChcblx0XHRcdHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuXHRcdFx0XHR0aGlzLnNldHVwTGl2ZVByZXZpZXdPYnNlcnZlcigpO1xuXHRcdFx0XHR0aGlzLmRlYm91bmNlZFNjYW5BbGwoKTtcblx0XHRcdH0pXG5cdFx0KTtcblxuXHRcdC8vIFx1MzBDRVx1MzBGQ1x1MzBDOFx1MzA5Mlx1NTIwN1x1MzA4QVx1NjZGRlx1MzA0OFx1MzA1Rlx1MzA2OFx1MzA0RFx1MzA2Qlx1MzA4Mlx1NTE4RFx1MzBCOVx1MzBBRFx1MzBFM1x1MzBGM1x1MzA1OVx1MzA4QlxuXHRcdHRoaXMucmVnaXN0ZXJFdmVudChcblx0XHRcdHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCAoKSA9PiB7XG5cdFx0XHRcdHRoaXMuZGVib3VuY2VkU2NhbkFsbCgpO1xuXHRcdFx0fSlcblx0XHQpO1xuXG5cdFx0Ly8gXHUzMEE4XHUzMEM3XHUzMEEzXHUzMEJGXHUzMDZFXHU1MTg1XHU1QkI5XHUzMDRDXHU1OTA5XHUzMDhGXHUzMDYzXHUzMDVGXHUzMDY4XHUzMDREXHUzMDZCXHUzMDgyXHU1MThEXHUzMEI5XHUzMEFEXHUzMEUzXHUzMEYzXHUzMDU5XHUzMDhCXG5cdFx0Ly8gXHVGRjA4TGl2ZSBQcmV2aWV3XHUzMDY3IHw1MCUgXHUyMTkyIHwzMCUgXHUzMDZFXHUzMDg4XHUzMDQ2XHUzMDZCXHU2NkY4XHUzMDREXHU2M0RCXHUzMDQ4XHUzMDVGXHUzMDY4XHUzMDREXHUzMDZCXHU1M0NEXHU2NjIwXHUzMDU5XHUzMDhCXHUzMDVGXHUzMDgxXHVGRjA5XG5cdFx0dGhpcy5yZWdpc3RlckV2ZW50KFxuXHRcdFx0dGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZWRpdG9yLWNoYW5nZVwiLCAoKSA9PiB7XG5cdFx0XHRcdHRoaXMuZGVib3VuY2VkU2NhbkFsbCgpO1xuXHRcdFx0fSlcblx0XHQpO1xuXG5cdFx0Ly8gXHU1MjFEXHU1NkRFXHUzMDZFXHU4QTJEXHU1QjlBXG5cdFx0dGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuXHRcdFx0dGhpcy5zZXR1cExpdmVQcmV2aWV3T2JzZXJ2ZXIoKTtcblx0XHRcdHRoaXMuZGVib3VuY2VkU2NhbkFsbCgpO1xuXHRcdH0pO1xuXG5cdFx0Ly8gXHU3NTNCXHU1MENGXHUzMDkyXHUzMERBXHUzMEZDXHUzMEI5XHUzMEM4L1x1MzBDOVx1MzBFRFx1MzBDM1x1MzBEN1x1MzA1N1x1MzA1Rlx1MzA2OFx1MzA0RFx1MzAwMVx1ODFFQVx1NTJENVx1MzA2N1x1MzBFQVx1MzBDRFx1MzBGQ1x1MzBFMFx1RkYwQlx1MzBDN1x1MzBENVx1MzBBOVx1MzBFQlx1MzBDOFx1MzA2RSVcdTUwMjRcdTMwOTJcdTRFRDhcdTMwNTFcdTMwOEJcblx0XHR0aGlzLnJlZ2lzdGVyRXZlbnQoXG5cdFx0XHR0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJlZGl0b3ItcGFzdGVcIiwgKGV2dDogQ2xpcGJvYXJkRXZlbnQsIGVkaXRvciwgdmlldykgPT4ge1xuXHRcdFx0XHR0aGlzLmhhbmRsZUltYWdlSW5zZXJ0KGVkaXRvcik7XG5cdFx0XHR9KVxuXHRcdCk7XG5cblx0XHR0aGlzLnJlZ2lzdGVyRXZlbnQoXG5cdFx0XHR0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJlZGl0b3ItZHJvcFwiLCAoZXZ0OiBEcmFnRXZlbnQsIGVkaXRvciwgdmlldykgPT4ge1xuXHRcdFx0XHR0aGlzLmhhbmRsZUltYWdlSW5zZXJ0KGVkaXRvcik7XG5cdFx0XHR9KVxuXHRcdCk7XG5cblx0XHQvLyBcdTMwQjNcdTMwRDRcdTMwRkNcdUZGMDhDbWQrQ1x1RkYwOVx1MzA1N1x1MzA1Rlx1MzA2OFx1MzA0RFx1MzAwMVx1MzBBQlx1MzBGQ1x1MzBCRFx1MzBFQlx1ODg0Q1x1MzA0Q1x1NzUzQlx1NTBDRlx1MzBFQVx1MzBGM1x1MzBBRlx1MzA2QVx1MzA4OVxuXHRcdC8vIFx1MzBDNlx1MzBBRFx1MzBCOVx1MzBDOFx1MzA2OFx1NzUzQlx1NTBDRlx1MzBDN1x1MzBGQ1x1MzBCRlx1MzA2RVx1NEUyMVx1NjVCOVx1MzA5Mlx1MzBBRlx1MzBFQVx1MzBDM1x1MzBEN1x1MzBEQ1x1MzBGQ1x1MzBDOVx1MzA2Qlx1NTE2NVx1MzA4Q1x1MzA4QlxuXHRcdHRoaXMucmVnaXN0ZXJEb21FdmVudChkb2N1bWVudCwgXCJjb3B5XCIsIChldnQ6IENsaXBib2FyZEV2ZW50KSA9PiB7XG5cdFx0XHR0aGlzLmhhbmRsZUltYWdlQ29weShldnQpO1xuXHRcdH0pO1xuXG5cdFx0Ly8gXHU4QTJEXHU1QjlBXHU3NTNCXHU5NzYyXHUzMDkyXHU4RkZEXHU1MkEwXG5cdFx0dGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBBZHZhbmNlZEltYWdlU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuXHR9XG5cblx0b251bmxvYWQoKSB7XG5cdFx0Ly8gXHUzMEQ3XHUzMEU5XHUzMEIwXHUzMEE0XHUzMEYzXHUzMDkyXHU3MTIxXHU1MkI5XHUzMDZCXHUzMDU3XHUzMDVGXHUzMDY4XHUzMDREXHUzMDAxXHU4RkZEXHU1MkEwXHUzMDU3XHUzMDVGXHUzMEI5XHUzMEJGXHUzMEE0XHUzMEVCXHUzMDkyXHU1MjRBXHU5NjY0XHUzMDU5XHUzMDhCXG5cdFx0aWYgKHRoaXMuc3R5bGVFbCkge1xuXHRcdFx0dGhpcy5zdHlsZUVsLnJlbW92ZSgpO1xuXHRcdFx0dGhpcy5zdHlsZUVsID0gbnVsbDtcblx0XHR9XG5cdFx0Ly8gTXV0YXRpb25PYnNlcnZlclx1MzA5Mlx1NTA1Q1x1NkI2Mlx1MzA1OVx1MzA4QlxuXHRcdGlmICh0aGlzLm9ic2VydmVyKSB7XG5cdFx0XHR0aGlzLm9ic2VydmVyLmRpc2Nvbm5lY3QoKTtcblx0XHRcdHRoaXMub2JzZXJ2ZXIgPSBudWxsO1xuXHRcdH1cblx0XHQvLyBcdTMwQkZcdTMwQTRcdTMwREVcdTMwRkNcdTMwOTJcdTUwNUNcdTZCNjJcdTMwNTlcdTMwOEJcblx0XHRpZiAodGhpcy5kZWJvdW5jZVRpbWVyKSB7XG5cdFx0XHRjbGVhclRpbWVvdXQodGhpcy5kZWJvdW5jZVRpbWVyKTtcblx0XHRcdHRoaXMuZGVib3VuY2VUaW1lciA9IG51bGw7XG5cdFx0fVxuXHR9XG5cblx0YXN5bmMgbG9hZFNldHRpbmdzKCkge1xuXHRcdHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuXHR9XG5cblx0YXN5bmMgc2F2ZVNldHRpbmdzKCkge1xuXHRcdGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XG5cdFx0Ly8gXHU4QTJEXHU1QjlBXHU1OTA5XHU2NkY0XHU2NjQyXHUzMDZCXHUzMEUyXHUzMEQwXHUzMEE0XHUzMEVCXHUzMEI5XHUzMEJGXHUzMEE0XHUzMEVCXHUzMDkyXHU2NkY0XHU2NUIwXHUzMDU5XHUzMDhCXG5cdFx0dGhpcy51cGRhdGVNb2JpbGVTdHlsZSgpO1xuXHR9XG5cblx0Ly8gXHUzMEUyXHUzMEQwXHUzMEE0XHUzMEVCXHU3NTI4XHUzMDZFQ1NTXHUzMDkyXHU1MkQ1XHU3Njg0XHUzMDZCXHU3NTFGXHU2MjEwXHUzMDU3XHUzMDY2XHU4RkZEXHU1MkEwXHUzMDU5XHUzMDhCXG5cdHVwZGF0ZU1vYmlsZVN0eWxlKCkge1xuXHRcdC8vIFx1NjVFMlx1NUI1OFx1MzA2RVx1MzBCOVx1MzBCRlx1MzBBNFx1MzBFQlx1ODk4MVx1N0QyMFx1MzA0Q1x1MzA0Mlx1MzA4Q1x1MzA3MFx1NTI0QVx1OTY2NFxuXHRcdGlmICh0aGlzLnN0eWxlRWwpIHtcblx0XHRcdHRoaXMuc3R5bGVFbC5yZW1vdmUoKTtcblx0XHR9XG5cblx0XHR0aGlzLnN0eWxlRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3R5bGVcIik7XG5cdFx0dGhpcy5zdHlsZUVsLmlkID0gXCJhZHZhbmNlZC1pbWFnZS1tb2JpbGUtc3R5bGVcIjtcblxuXHRcdGlmICh0aGlzLnNldHRpbmdzLm1vYmlsZUF1dG9GdWxsKSB7XG5cdFx0XHQvLyBcdTMwRTJcdTMwRDBcdTMwQTRcdTMwRUJcdTMwNjdcdTMwNkZcdTMwRDFcdTMwRkNcdTMwQkJcdTMwRjNcdTMwQzhcdTYzMDdcdTVCOUFcdTMwNkJcdTk1QTJcdTRGQzJcdTMwNkFcdTMwNEYxMDAlXHU1RTQ1XHUzMDY3XHU4ODY4XHU3OTNBXHUzMDU5XHUzMDhCXG5cdFx0XHR0aGlzLnN0eWxlRWwudGV4dENvbnRlbnQgPSBgXG5cdFx0XHRcdEBtZWRpYSAobWF4LXdpZHRoOiAke3RoaXMuc2V0dGluZ3MubW9iaWxlVGhyZXNob2xkfXB4KSB7XG5cdFx0XHRcdFx0aW1nLmFkdmFuY2VkLWltYWdlLXBlcmNlbnQge1xuXHRcdFx0XHRcdFx0d2lkdGg6IDEwMCUgIWltcG9ydGFudDtcblx0XHRcdFx0XHRcdG1heC13aWR0aDogMTAwJSAhaW1wb3J0YW50O1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0YDtcblx0XHR9IGVsc2Uge1xuXHRcdFx0dGhpcy5zdHlsZUVsLnRleHRDb250ZW50ID0gXCJcIjtcblx0XHR9XG5cblx0XHRkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHRoaXMuc3R5bGVFbCk7XG5cdH1cblxuXHQvLyBcdTc1M0JcdTUwQ0ZcdTg5ODFcdTdEMjBcdTMwOTJcdTYzQTJcdTMwNTdcdTMwNjZcdTMwRDFcdTMwRkNcdTMwQkJcdTMwRjNcdTMwQzhcdTg4NjhcdTc5M0FcdTMwOTJcdTkwNjlcdTc1MjhcdTMwNTlcdTMwOEJcblx0cHJvY2Vzc0ltYWdlcyhlbDogSFRNTEVsZW1lbnQpIHtcblx0XHRjb25zdCBpbWFnZXMgPSBlbC5xdWVyeVNlbGVjdG9yQWxsKFwiaW1nXCIpO1xuXHRcdGltYWdlcy5mb3JFYWNoKChpbWc6IEhUTUxJbWFnZUVsZW1lbnQpID0+IHtcblx0XHRcdC8vIGFsdFx1MzBDNlx1MzBBRFx1MzBCOVx1MzBDOFx1MzA0Qlx1MzA4OVx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1NTAyNFx1MzA5Mlx1NTNENlx1NUY5N1x1MzA1OVx1MzA4QlxuXHRcdFx0Y29uc3QgYWx0ID0gaW1nLmFsdDtcblx0XHRcdGlmICghYWx0KSB7XG5cdFx0XHRcdC8vIGFsdFx1MzA0Q1x1MzA2QVx1MzA0NFx1NTgzNFx1NTQwOFx1MzAwMVx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1NjMwN1x1NUI5QVx1MzA0Q1x1NTI0QVx1OTY2NFx1MzA1NVx1MzA4Q1x1MzA1Rlx1NTNFRlx1ODBGRFx1NjAyN1x1MzA0Q1x1MzA0Mlx1MzA4QlxuXHRcdFx0XHQvLyBcdTRFRTVcdTUyNERcdTkwNjlcdTc1MjhcdTMwNTdcdTMwNUZcdTMwQjlcdTMwQkZcdTMwQTRcdTMwRUJcdTMwOTJcdTMwRUFcdTMwQkJcdTMwQzNcdTMwQzhcdTMwNTlcdTMwOEJcblx0XHRcdFx0aWYgKGltZy5jbGFzc0xpc3QuY29udGFpbnMoXCJhZHZhbmNlZC1pbWFnZS1wZXJjZW50XCIpKSB7XG5cdFx0XHRcdFx0aW1nLmNsYXNzTGlzdC5yZW1vdmUoXCJhZHZhbmNlZC1pbWFnZS1wZXJjZW50XCIpO1xuXHRcdFx0XHRcdGltZy5zdHlsZS53aWR0aCA9IFwiXCI7XG5cdFx0XHRcdFx0aW1nLnN0eWxlLm1heFdpZHRoID0gXCJcIjtcblx0XHRcdFx0XHRpbWcuc3R5bGUuaGVpZ2h0ID0gXCJcIjtcblx0XHRcdFx0fVxuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGNvbnN0IG1hdGNoID0gYWx0Lm1hdGNoKFBFUkNFTlRfUEFUVEVSTik7XG5cdFx0XHRpZiAoIW1hdGNoKSB7XG5cdFx0XHRcdC8vIFx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1MzBEMVx1MzBCRlx1MzBGQ1x1MzBGM1x1MzA2Qlx1NEUwMFx1ODFGNFx1MzA1N1x1MzA2QVx1MzA0NFx1NTgzNFx1NTQwOFx1MzA4Mlx1MzBFQVx1MzBCQlx1MzBDM1x1MzBDOFx1MzA1OVx1MzA4QlxuXHRcdFx0XHRpZiAoaW1nLmNsYXNzTGlzdC5jb250YWlucyhcImFkdmFuY2VkLWltYWdlLXBlcmNlbnRcIikpIHtcblx0XHRcdFx0XHRpbWcuY2xhc3NMaXN0LnJlbW92ZShcImFkdmFuY2VkLWltYWdlLXBlcmNlbnRcIik7XG5cdFx0XHRcdFx0aW1nLnN0eWxlLndpZHRoID0gXCJcIjtcblx0XHRcdFx0XHRpbWcuc3R5bGUubWF4V2lkdGggPSBcIlwiO1xuXHRcdFx0XHRcdGltZy5zdHlsZS5oZWlnaHQgPSBcIlwiO1xuXHRcdFx0XHR9XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0Y29uc3QgcGVyY2VudCA9IHBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG5cdFx0XHRpZiAocGVyY2VudCA8IDEgfHwgcGVyY2VudCA+IDEwMCkgcmV0dXJuO1xuXG5cdFx0XHQvLyBcdTMwRDFcdTMwRkNcdTMwQkJcdTMwRjNcdTMwQzhcdTMwNkJcdTU3RkFcdTMwNjVcdTMwNDRcdTMwNjZcdTVFNDVcdTMwOTJcdThBMkRcdTVCOUFcdTMwNTlcdTMwOEJcblx0XHRcdGltZy5jbGFzc0xpc3QuYWRkKFwiYWR2YW5jZWQtaW1hZ2UtcGVyY2VudFwiKTtcblx0XHRcdGltZy5zdHlsZS53aWR0aCA9IGAke3BlcmNlbnR9JWA7XG5cdFx0XHRpbWcuc3R5bGUubWF4V2lkdGggPSBgJHtwZXJjZW50fSVgO1xuXHRcdFx0aW1nLnN0eWxlLmhlaWdodCA9IFwiYXV0b1wiO1xuXHRcdH0pO1xuXG5cdFx0Ly8gTGl2ZSBQcmV2aWV3IFx1MzA2N1x1MzA2RiAuaW50ZXJuYWwtZW1iZWQgXHU4OTgxXHU3RDIwXHUzMDZFXHU0RTJEXHUzMDZCXHU3NTNCXHU1MENGXHUzMDRDXHUzMDQyXHUzMDhCXG5cdFx0Ly8gLmludGVybmFsLWVtYmVkIFx1MzA2RSBhbHQgXHU1QzVFXHU2MDI3XHUzMDZCXHUzMEQxXHUzMEZDXHUzMEJCXHUzMEYzXHUzMEM4XHU1MDI0XHUzMDRDXHU1MTY1XHUzMDYzXHUzMDY2XHUzMDQ0XHUzMDhCXHU1ODM0XHU1NDA4XHUzMDgyXHUzMDQyXHUzMDhCXG5cdFx0Y29uc3QgZW1iZWRzID0gZWwucXVlcnlTZWxlY3RvckFsbChcIi5pbnRlcm5hbC1lbWJlZFwiKTtcblx0XHRlbWJlZHMuZm9yRWFjaCgoZW1iZWQ6IEVsZW1lbnQpID0+IHtcblx0XHRcdGNvbnN0IGFsdCA9IGVtYmVkLmdldEF0dHJpYnV0ZShcImFsdFwiKTtcblx0XHRcdGlmICghYWx0KSByZXR1cm47XG5cblx0XHRcdGNvbnN0IG1hdGNoID0gYWx0Lm1hdGNoKFBFUkNFTlRfUEFUVEVSTik7XG5cdFx0XHRpZiAoIW1hdGNoKSByZXR1cm47XG5cblx0XHRcdGNvbnN0IHBlcmNlbnQgPSBwYXJzZUludChtYXRjaFsxXSwgMTApO1xuXHRcdFx0aWYgKHBlcmNlbnQgPCAxIHx8IHBlcmNlbnQgPiAxMDApIHJldHVybjtcblxuXHRcdFx0Ly8gZW1iZWQgXHU1MTg1XHUzMDZFXHU3NTNCXHU1MENGXHUzMDZCXHUzMEI5XHUzMEJGXHUzMEE0XHUzMEVCXHUzMDkyXHU5MDY5XHU3NTI4XHUzMDU5XHUzMDhCXG5cdFx0XHRjb25zdCBpbWcgPSBlbWJlZC5xdWVyeVNlbGVjdG9yKFwiaW1nXCIpO1xuXHRcdFx0aWYgKGltZykge1xuXHRcdFx0XHRpbWcuY2xhc3NMaXN0LmFkZChcImFkdmFuY2VkLWltYWdlLXBlcmNlbnRcIik7XG5cdFx0XHRcdGltZy5zdHlsZS53aWR0aCA9IGAke3BlcmNlbnR9JWA7XG5cdFx0XHRcdGltZy5zdHlsZS5tYXhXaWR0aCA9IGAke3BlcmNlbnR9JWA7XG5cdFx0XHRcdGltZy5zdHlsZS5oZWlnaHQgPSBcImF1dG9cIjtcblx0XHRcdH1cblx0XHR9KTtcblx0fVxuXG5cdC8vIFx1MzBFRlx1MzBGQ1x1MzBBRlx1MzBCOVx1MzBEQVx1MzBGQ1x1MzBCOVx1NTE2OFx1NEY1M1x1MzA2RVx1NzUzQlx1NTBDRlx1MzA5Mlx1NTE4RFx1MzBCOVx1MzBBRFx1MzBFM1x1MzBGM1x1MzA1OVx1MzA4Qlx1RkYwOFx1OTAyM1x1N0Q5QVx1NUI5Rlx1ODg0Q1x1MzA5Mlx1OTYzMlx1MzA1MFx1NTIzNlx1NUZBMVx1NEVEOFx1MzA0RFx1RkYwOVxuXHRkZWJvdW5jZWRTY2FuQWxsKCkge1xuXHRcdGlmICh0aGlzLmRlYm91bmNlVGltZXIpIHtcblx0XHRcdGNsZWFyVGltZW91dCh0aGlzLmRlYm91bmNlVGltZXIpO1xuXHRcdH1cblx0XHR0aGlzLmRlYm91bmNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcblx0XHRcdGNvbnN0IHdvcmtzcGFjZSA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCIud29ya3NwYWNlXCIpO1xuXHRcdFx0aWYgKHdvcmtzcGFjZSkge1xuXHRcdFx0XHR0aGlzLnByb2Nlc3NJbWFnZXMod29ya3NwYWNlIGFzIEhUTUxFbGVtZW50KTtcblx0XHRcdH1cblx0XHR9LCAxMDApO1xuXHR9XG5cblx0Ly8gTGl2ZSBQcmV2aWV3IFx1MzBFMlx1MzBGQ1x1MzBDOVx1MzA2N1x1NzUzQlx1NTBDRlx1MzA5Mlx1NzZFM1x1ODk5Nlx1MzA1N1x1MzA2Nlx1NTFFNlx1NzQwNlx1MzA1OVx1MzA4QlxuXHRzZXR1cExpdmVQcmV2aWV3T2JzZXJ2ZXIoKSB7XG5cdFx0Ly8gXHU2NUUyXHU1QjU4XHUzMDZFT2JzZXJ2ZXJcdTMwOTJcdTUwNUNcdTZCNjJcblx0XHRpZiAodGhpcy5vYnNlcnZlcikge1xuXHRcdFx0dGhpcy5vYnNlcnZlci5kaXNjb25uZWN0KCk7XG5cdFx0fVxuXG5cdFx0dGhpcy5vYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKChtdXRhdGlvbnMpID0+IHtcblx0XHRcdGxldCBuZWVkc1NjYW4gPSBmYWxzZTtcblx0XHRcdGZvciAoY29uc3QgbXV0YXRpb24gb2YgbXV0YXRpb25zKSB7XG5cdFx0XHRcdC8vIFx1NjVCMFx1MzA1N1x1MzA0Rlx1OEZGRFx1NTJBMFx1MzA1NVx1MzA4Q1x1MzA1Rlx1MzBDRVx1MzBGQ1x1MzBDOVx1MzA2RVx1NEUyRFx1MzA0Qlx1MzA4OVx1NzUzQlx1NTBDRlx1MzA5Mlx1NjNBMlx1MzA1OVxuXHRcdFx0XHRpZiAobXV0YXRpb24uYWRkZWROb2Rlcy5sZW5ndGggPiAwKSB7XG5cdFx0XHRcdFx0bXV0YXRpb24uYWRkZWROb2Rlcy5mb3JFYWNoKChub2RlKSA9PiB7XG5cdFx0XHRcdFx0XHRpZiAobm9kZSBpbnN0YW5jZW9mIEhUTUxFbGVtZW50KSB7XG5cdFx0XHRcdFx0XHRcdHRoaXMucHJvY2Vzc0ltYWdlcyhub2RlKTtcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHR9KTtcblx0XHRcdFx0fVxuXHRcdFx0XHQvLyBcdTVDNUVcdTYwMjdcdTMwNENcdTU5MDlcdTMwOEZcdTMwNjNcdTMwNUZcdTU4MzRcdTU0MDhcdUZGMDhhbHRcdTMwQzZcdTMwQURcdTMwQjlcdTMwQzhcdTMwNkVcdTU5MDlcdTY2RjRcdTMwNkFcdTMwNjlcdUZGMDlcdTMwODJcdTUxOERcdTMwQjlcdTMwQURcdTMwRTNcdTMwRjNcdTMwNTlcdTMwOEJcblx0XHRcdFx0aWYgKG11dGF0aW9uLnR5cGUgPT09IFwiYXR0cmlidXRlc1wiKSB7XG5cdFx0XHRcdFx0bmVlZHNTY2FuID0gdHJ1ZTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0aWYgKG5lZWRzU2Nhbikge1xuXHRcdFx0XHR0aGlzLmRlYm91bmNlZFNjYW5BbGwoKTtcblx0XHRcdH1cblx0XHR9KTtcblxuXHRcdC8vIFx1MzBFRlx1MzBGQ1x1MzBBRlx1MzBCOVx1MzBEQVx1MzBGQ1x1MzBCOVx1NTE2OFx1NEY1M1x1MzA5Mlx1NzZFM1x1ODk5Nlx1MzA1OVx1MzA4QlxuXHRcdGNvbnN0IGNvbnRhaW5lciA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCIud29ya3NwYWNlXCIpO1xuXHRcdGlmIChjb250YWluZXIpIHtcblx0XHRcdHRoaXMub2JzZXJ2ZXIub2JzZXJ2ZShjb250YWluZXIsIHtcblx0XHRcdFx0Y2hpbGRMaXN0OiB0cnVlLFxuXHRcdFx0XHRzdWJ0cmVlOiB0cnVlLFxuXHRcdFx0XHQvLyBcdTVDNUVcdTYwMjdcdTMwNkVcdTU5MDlcdTY2RjRcdTMwODJcdTc2RTNcdTg5OTZcdTMwNTlcdTMwOEJcdUZGMDhhbHQsIHNyYyBcdTMwNkFcdTMwNjlcdTMwNkVcdTU5MDlcdTUzMTZcdTMwOTJcdTY5MUNcdTc3RTVcdTMwNTlcdTMwOEJcdTMwNUZcdTMwODFcdUZGMDlcblx0XHRcdFx0YXR0cmlidXRlczogdHJ1ZSxcblx0XHRcdFx0YXR0cmlidXRlRmlsdGVyOiBbXCJhbHRcIiwgXCJzcmNcIiwgXCJjbGFzc1wiXSxcblx0XHRcdH0pO1xuXHRcdH1cblxuXHRcdC8vIFx1NjVFMlx1MzA2Qlx1ODg2OFx1NzkzQVx1MzA1NVx1MzA4Q1x1MzA2Nlx1MzA0NFx1MzA4Qlx1NzUzQlx1NTBDRlx1MzA4Mlx1NTFFNlx1NzQwNlx1MzA1OVx1MzA4QlxuXHRcdHRoaXMuZGVib3VuY2VkU2NhbkFsbCgpO1xuXHR9XG5cblx0Ly8gXHU3M0ZFXHU1NzI4XHUzMDZFXHU2NUU1XHU2NjQyXHUzMDkyIFlZWVktTU0tRERfSEgtbW0tc3MgXHU1RjYyXHU1RjBGXHUzMDY3XHU4RkQ0XHUzMDU5XG5cdGdldEZvcm1hdHRlZERhdGUoKTogc3RyaW5nIHtcblx0XHRjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuXHRcdGNvbnN0IHBhZCA9IChuOiBudW1iZXIpID0+IFN0cmluZyhuKS5wYWRTdGFydCgyLCBcIjBcIik7XG5cdFx0cmV0dXJuIGAke25vdy5nZXRGdWxsWWVhcigpfS0ke3BhZChub3cuZ2V0TW9udGgoKSArIDEpfS0ke3BhZChub3cuZ2V0RGF0ZSgpKX1fJHtwYWQobm93LmdldEhvdXJzKCkpfS0ke3BhZChub3cuZ2V0TWludXRlcygpKX0tJHtwYWQobm93LmdldFNlY29uZHMoKSl9YDtcblx0fVxuXG5cdC8vIFx1NTQwQ1x1NTQwRFx1MzBENVx1MzBBMVx1MzBBNFx1MzBFQlx1MzA0Q1x1MzA0Mlx1MzA4Qlx1NTgzNFx1NTQwOFx1MzAwMVx1NjU3MFx1NUI1N1x1MzBCNVx1MzBENVx1MzBBM1x1MzBDM1x1MzBBRlx1MzBCOVx1MzA5Mlx1NEVEOFx1MzA1MVx1MzA1Rlx1MzBEMVx1MzBCOVx1MzA5Mlx1OEZENFx1MzA1OVxuXHRhc3luYyBnZXRVbmlxdWVGaWxlUGF0aChmb2xkZXJQYXRoOiBzdHJpbmcsIGJhc2VOYW1lOiBzdHJpbmcsIGV4dDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcblx0XHRsZXQgY2FuZGlkYXRlID0gYCR7Zm9sZGVyUGF0aH0vJHtiYXNlTmFtZX0uJHtleHR9YDtcblx0XHRpZiAoIXRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChjYW5kaWRhdGUpKSB7XG5cdFx0XHRyZXR1cm4gY2FuZGlkYXRlO1xuXHRcdH1cblx0XHQvLyBcdTU0MENcdTU0MERcdTMwRDVcdTMwQTFcdTMwQTRcdTMwRUJcdTMwNENcdTMwNDJcdTMwOENcdTMwNzAgXzEsIF8yLCAuLi4gXHUzMDY4XHU4QTY2XHUzMDU5XG5cdFx0bGV0IHN1ZmZpeCA9IDE7XG5cdFx0d2hpbGUgKHRydWUpIHtcblx0XHRcdGNhbmRpZGF0ZSA9IGAke2ZvbGRlclBhdGh9LyR7YmFzZU5hbWV9XyR7c3VmZml4fS4ke2V4dH1gO1xuXHRcdFx0aWYgKCF0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoY2FuZGlkYXRlKSkge1xuXHRcdFx0XHRyZXR1cm4gY2FuZGlkYXRlO1xuXHRcdFx0fVxuXHRcdFx0c3VmZml4Kys7XG5cdFx0fVxuXHR9XG5cblx0Ly8gXHU3NTNCXHU1MENGXHUzMDRDXHUzMERBXHUzMEZDXHUzMEI5XHUzMEM4L1x1MzBDOVx1MzBFRFx1MzBDM1x1MzBEN1x1MzA1NVx1MzA4Q1x1MzA1Rlx1MzA2OFx1MzA0RFx1MzAwMVx1MzBFQVx1MzBDRFx1MzBGQ1x1MzBFMFx1RkYwQlx1MzBDN1x1MzBENVx1MzBBOVx1MzBFQlx1MzBDOFx1MzA2RSVcdTUwMjRcdTMwOTJcdTgxRUFcdTUyRDVcdTMwNjdcdThGRkRcdTUyQTBcdTMwNTlcdTMwOEJcblx0aGFuZGxlSW1hZ2VJbnNlcnQoZWRpdG9yOiBhbnkpIHtcblx0XHRjb25zdCBkZWZhdWx0UGVyY2VudCA9IHRoaXMuc2V0dGluZ3MuZGVmYXVsdFBlcmNlbnQ7XG5cblx0XHQvLyBcdTVDMTFcdTMwNTdcdTVGODVcdTMwNjNcdTMwNjZcdTMwNEJcdTMwODlPYnNpZGlhblx1MzA0Q1x1NzUzQlx1NTBDRlx1MzBFQVx1MzBGM1x1MzBBRlx1MzA5Mlx1NjZGOFx1MzA0RFx1OEZCQ1x1MzA4MFx1MzA2RVx1MzA5Mlx1NUY4NVx1MzA2NFxuXHRcdHNldFRpbWVvdXQoYXN5bmMgKCkgPT4ge1xuXHRcdFx0Y29uc3QgY3Vyc29yID0gZWRpdG9yLmdldEN1cnNvcigpO1xuXHRcdFx0Y29uc3QgbGluZSA9IGVkaXRvci5nZXRMaW5lKGN1cnNvci5saW5lKTtcblxuXHRcdFx0Ly8gXHU3NTNCXHU1MENGXHUzMEVBXHUzMEYzXHUzMEFGXHUzMDZFXHUzMEQxXHUzMEJGXHUzMEZDXHUzMEYzXHUzMDkyXHU2M0EyXHUzMDU5OiAhW1tcdTMwRDVcdTMwQTFcdTMwQTRcdTMwRUJcdTU0MEQuXHU2MkUxXHU1RjM1XHU1QjUwXV1cdUZGMDhcdTMwRDFcdTMwQTRcdTMwRDdcdTcxMjFcdTMwNTdcdUZGMURcdTMwN0VcdTMwNjBcdTUyQTBcdTVERTVcdTMwNTVcdTMwOENcdTMwNjZcdTMwNDRcdTMwNkFcdTMwNDRcdTMwODJcdTMwNkVcdUZGMDlcblx0XHRcdGNvbnN0IHBhc3RlZFBhdHRlcm4gPSAvIVxcW1xcWyhbXlxcXXxdK1xcLihwbmd8anBnfGpwZWd8Z2lmfGJtcHxzdmd8d2VicHxhdmlmfGhlaWN8dGlmfHRpZmYpKVxcXVxcXS9naTtcblx0XHRcdGNvbnN0IG1hdGNoID0gcGFzdGVkUGF0dGVybi5leGVjKGxpbmUpO1xuXHRcdFx0aWYgKCFtYXRjaCkgcmV0dXJuO1xuXG5cdFx0XHRjb25zdCBvcmlnaW5hbEZpbGVuYW1lID0gbWF0Y2hbMV07XG5cdFx0XHQvLyBcdTY1RTJcdTMwNkJcdTMwRDFcdTMwQTRcdTMwRDdcdTRFRDhcdTMwNERcdTMwNkFcdTMwODlcdTRGNTVcdTMwODJcdTMwNTdcdTMwNkFcdTMwNDRcblx0XHRcdGlmIChvcmlnaW5hbEZpbGVuYW1lLmluY2x1ZGVzKFwifFwiKSkgcmV0dXJuO1xuXG5cdFx0XHQvLyBcdTUxNDNcdTMwNkVcdTc1M0JcdTUwQ0ZcdTMwRDVcdTMwQTFcdTMwQTRcdTMwRUJcdTMwOTJcdTg5OEJcdTMwNjRcdTMwNTFcdTMwOEJcblx0XHRcdGNvbnN0IG9yaWdpbmFsRmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChvcmlnaW5hbEZpbGVuYW1lKVxuXHRcdFx0XHR8fCB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KG9yaWdpbmFsRmlsZW5hbWUsIFwiXCIpO1xuXG5cdFx0XHRpZiAoIW9yaWdpbmFsRmlsZSB8fCAhKG9yaWdpbmFsRmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuXHRcdFx0XHQvLyBcdTMwRDVcdTMwQTFcdTMwQTRcdTMwRUJcdTMwNENcdTg5OEJcdTMwNjRcdTMwNEJcdTMwODlcdTMwNkFcdTMwNDRcdTU4MzRcdTU0MDhcdTMwNkYlXHUzMDYwXHUzMDUxXHU4RkZEXHU1MkEwXHUzMDU5XHUzMDhCXG5cdFx0XHRcdGNvbnN0IG5ld0xpbmUgPSBsaW5lLnJlcGxhY2UobWF0Y2hbMF0sIGAhW1ske29yaWdpbmFsRmlsZW5hbWV9fCR7ZGVmYXVsdFBlcmNlbnR9JV1dYCk7XG5cdFx0XHRcdGVkaXRvci5zZXRMaW5lKGN1cnNvci5saW5lLCBuZXdMaW5lKTtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHQvLyBcdTczRkVcdTU3MjhcdTMwNkVcdTMwQ0VcdTMwRkNcdTMwQzhcdTU0MERcdTMwOTJcdTUzRDZcdTVGOTdcblx0XHRcdGNvbnN0IGFjdGl2ZUZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuXHRcdFx0Y29uc3Qgbm90ZU5hbWUgPSBhY3RpdmVGaWxlID8gYWN0aXZlRmlsZS5iYXNlbmFtZSA6IFwidW50aXRsZWRcIjtcblxuXHRcdFx0Ly8gXHU2NUIwXHUzMDU3XHUzMDQ0XHUzMEQ1XHUzMEExXHUzMEE0XHUzMEVCXHU1NDBEXHUzMDkyXHU0RjVDXHUzMDhCOiBcdTMwQ0VcdTMwRkNcdTMwQzhcdTU0MERfXHU2NUU1XHU2NjQyLlx1NjJFMVx1NUYzNVx1NUI1MFxuXHRcdFx0Y29uc3QgZGF0ZVN0ciA9IHRoaXMuZ2V0Rm9ybWF0dGVkRGF0ZSgpO1xuXHRcdFx0Y29uc3QgZXh0ID0gb3JpZ2luYWxGaWxlLmV4dGVuc2lvbjtcblx0XHRcdGNvbnN0IG5ld0Jhc2VOYW1lID0gYCR7bm90ZU5hbWV9XyR7ZGF0ZVN0cn1gO1xuXG5cdFx0XHQvLyBcdTc1M0JcdTUwQ0ZcdTMwRDVcdTMwQTFcdTMwQTRcdTMwRUJcdTMwNENcdTMwNDJcdTMwOEJcdTMwRDVcdTMwQTlcdTMwRUJcdTMwQzBcdTMwNkVcdTMwRDFcdTMwQjlcblx0XHRcdGNvbnN0IGZvbGRlclBhdGggPSBvcmlnaW5hbEZpbGUucGFyZW50ID8gb3JpZ2luYWxGaWxlLnBhcmVudC5wYXRoIDogXCJcIjtcblxuXHRcdFx0Ly8gXHU1NDBDXHU1NDBEXHUzMEQ1XHUzMEExXHUzMEE0XHUzMEVCXHUzMDRDXHUzMDZBXHUzMDQ0XHUzMDRCXHU3OEJBXHU4QThEXHUzMDU3XHUzMDAxXHUzMDQyXHUzMDhDXHUzMDcwXHU2NTcwXHU1QjU3XHUzMEI1XHUzMEQ1XHUzMEEzXHUzMEMzXHUzMEFGXHUzMEI5XHUzMDkyXHU0RUQ4XHUzMDUxXHUzMDhCXG5cdFx0XHRjb25zdCBuZXdQYXRoID0gYXdhaXQgdGhpcy5nZXRVbmlxdWVGaWxlUGF0aChmb2xkZXJQYXRoLCBuZXdCYXNlTmFtZSwgZXh0KTtcblx0XHRcdGNvbnN0IG5ld0ZpbGVOYW1lID0gbmV3UGF0aC5zcGxpdChcIi9cIikucG9wKCkgfHwgYCR7bmV3QmFzZU5hbWV9LiR7ZXh0fWA7XG5cblx0XHRcdC8vIFx1MzBENVx1MzBBMVx1MzBBNFx1MzBFQlx1MzA5Mlx1MzBFQVx1MzBDRFx1MzBGQ1x1MzBFMFx1MzA1OVx1MzA4QlxuXHRcdFx0dHJ5IHtcblx0XHRcdFx0YXdhaXQgdGhpcy5hcHAuZmlsZU1hbmFnZXIucmVuYW1lRmlsZShvcmlnaW5hbEZpbGUsIG5ld1BhdGgpO1xuXG5cdFx0XHRcdC8vIFx1MzBBOFx1MzBDN1x1MzBBM1x1MzBCRlx1MzA2RVx1MzBFQVx1MzBGM1x1MzBBRlx1MzA5Mlx1NjVCMFx1MzA1N1x1MzA0NFx1MzBENVx1MzBBMVx1MzBBNFx1MzBFQlx1NTQwRFx1RkYwQiVcdTMwNkJcdTY2RjRcdTY1QjBcdTMwNTlcdTMwOEJcblx0XHRcdFx0Ly8gcmVuYW1lRmlsZSBcdTMwNENcdTMwRUFcdTMwRjNcdTMwQUZcdTMwOTJcdTgxRUFcdTUyRDVcdTY2RjRcdTY1QjBcdTMwNTlcdTMwOEJcdTMwNkVcdTMwNjdcdTMwMDFcdTUxOERcdTVFQTZcdTg4NENcdTMwOTJcdThBQURcdTMwN0ZcdTc2RjRcdTMwNTlcblx0XHRcdFx0Y29uc3QgdXBkYXRlZExpbmUgPSBlZGl0b3IuZ2V0TGluZShjdXJzb3IubGluZSk7XG5cdFx0XHRcdGNvbnN0IG5hbWVXaXRob3V0RXh0ID0gbmV3RmlsZU5hbWUucmVwbGFjZShgLiR7ZXh0fWAsIFwiXCIpO1xuXHRcdFx0XHQvLyBcdTMwRUFcdTMwQ0RcdTMwRkNcdTMwRTBcdTVGOENcdTMwNkVcdTMwRUFcdTMwRjNcdTMwQUZcdTMwNkJcdTMwRDFcdTMwRkNcdTMwQkJcdTMwRjNcdTMwQzhcdTMwOTJcdThGRkRcdTUyQTBcdTMwNTlcdTMwOEJcblx0XHRcdFx0Y29uc3QgcmVuYW1lUGF0dGVybiA9IG5ldyBSZWdFeHAoXG5cdFx0XHRcdFx0YCFcXFxcW1xcXFxbJHtuYW1lV2l0aG91dEV4dC5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgXCJcXFxcJCZcIil9XFxcXC4ke2V4dH1cXFxcXVxcXFxdYCxcblx0XHRcdFx0XHRcImdcIlxuXHRcdFx0XHQpO1xuXHRcdFx0XHRpZiAocmVuYW1lUGF0dGVybi50ZXN0KHVwZGF0ZWRMaW5lKSkge1xuXHRcdFx0XHRcdGNvbnN0IGZpbmFsTGluZSA9IHVwZGF0ZWRMaW5lLnJlcGxhY2UocmVuYW1lUGF0dGVybiwgYCFbWyR7bmV3RmlsZU5hbWV9fCR7ZGVmYXVsdFBlcmNlbnR9JV1dYCk7XG5cdFx0XHRcdFx0ZWRpdG9yLnNldExpbmUoY3Vyc29yLmxpbmUsIGZpbmFsTGluZSk7XG5cdFx0XHRcdH1cblx0XHRcdH0gY2F0Y2ggKGUpIHtcblx0XHRcdFx0Ly8gXHUzMEVBXHUzMENEXHUzMEZDXHUzMEUwXHU1OTMxXHU2NTU3XHU2NjQyXHUzMDZGXHU1MTQzXHUzMDZFXHUzMEQ1XHUzMEExXHUzMEE0XHUzMEVCXHU1NDBEXHUzMDZCJVx1MzA2MFx1MzA1MVx1OEZGRFx1NTJBMFx1MzA1OVx1MzA4QlxuXHRcdFx0XHRjb25zdCBjdXJyZW50TGluZSA9IGVkaXRvci5nZXRMaW5lKGN1cnNvci5saW5lKTtcblx0XHRcdFx0Y29uc3QgZmFsbGJhY2tQYXR0ZXJuID0gbmV3IFJlZ0V4cChcblx0XHRcdFx0XHRgIVxcXFxbXFxcXFske29yaWdpbmFsRmlsZW5hbWUucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csIFwiXFxcXCQmXCIpfVxcXFxdXFxcXF1gLFxuXHRcdFx0XHRcdFwiZ1wiXG5cdFx0XHRcdCk7XG5cdFx0XHRcdGNvbnN0IG5ld0xpbmUgPSBjdXJyZW50TGluZS5yZXBsYWNlKGZhbGxiYWNrUGF0dGVybiwgYCFbWyR7b3JpZ2luYWxGaWxlbmFtZX18JHtkZWZhdWx0UGVyY2VudH0lXV1gKTtcblx0XHRcdFx0ZWRpdG9yLnNldExpbmUoY3Vyc29yLmxpbmUsIG5ld0xpbmUpO1xuXHRcdFx0fVxuXHRcdH0sIDgwMCk7XG5cdH1cblxuXHQvLyBcdTMwQjNcdTMwRDRcdTMwRkNcdTY2NDJcdTMwNkJcdTMwMDFcdTMwQUJcdTMwRkNcdTMwQkRcdTMwRUJcdTg4NENcdTMwNENcdTc1M0JcdTUwQ0ZcdTMwRUFcdTMwRjNcdTMwQUZcdTMwNkFcdTMwODlcblx0Ly8gXHU2NzAwXHU1MjFEXHUzMDZCXHUzMEM2XHUzMEFEXHUzMEI5XHUzMEM4XHUzMDkyXHUzMEIzXHUzMEQ0XHUzMEZDIFx1MjE5MiBcdTVDMTFcdTMwNTdcdTVGOENcdTMwNkJcdTc1M0JcdTUwQ0ZcdTMwQzdcdTMwRkNcdTMwQkZcdTMwNjdcdTMwQUZcdTMwRUFcdTMwQzNcdTMwRDdcdTMwRENcdTMwRkNcdTMwQzlcdTMwOTJcdTRFMEFcdTY2RjhcdTMwNERcdTMwNTlcdTMwOEJcblx0YXN5bmMgaGFuZGxlSW1hZ2VDb3B5KGV2dDogQ2xpcGJvYXJkRXZlbnQpIHtcblx0XHQvLyBcdTMwQTJcdTMwQUZcdTMwQzZcdTMwQTNcdTMwRDZcdTMwNkFcdTMwQThcdTMwQzdcdTMwQTNcdTMwQkZcdTMwOTJcdTUzRDZcdTVGOTdcblx0XHRjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcblx0XHRpZiAoIXZpZXcpIHJldHVybjtcblx0XHRjb25zdCBlZGl0b3IgPSB2aWV3LmVkaXRvcjtcblxuXHRcdC8vIFx1OTA3OFx1NjI5RVx1N0JDNFx1NTZGMlx1MzA0Q1x1MzA0Mlx1MzA4Qlx1MzA0Qlx1MzBDMVx1MzBBN1x1MzBDM1x1MzBBRlxuXHRcdGNvbnN0IHNlbGVjdGlvbiA9IGVkaXRvci5nZXRTZWxlY3Rpb24oKTtcblx0XHQvLyBcdTMwQUJcdTMwRkNcdTMwQkRcdTMwRUJcdTMwNENcdTMwNDJcdTMwOEJcdTg4NENcdTMwNkVcdTMwQzZcdTMwQURcdTMwQjlcdTMwQzhcdTMwOTJcdTUzRDZcdTVGOTdcblx0XHRjb25zdCBjdXJzb3IgPSBlZGl0b3IuZ2V0Q3Vyc29yKCk7XG5cdFx0Y29uc3QgbGluZSA9IGVkaXRvci5nZXRMaW5lKGN1cnNvci5saW5lKTtcblxuXHRcdC8vIFx1OTA3OFx1NjI5RVx1N0JDNFx1NTZGMiBcdTMwN0VcdTMwNUZcdTMwNkYgXHU4ODRDXHU1MTY4XHU0RjUzXHUzMDRCXHUzMDg5XHU3NTNCXHU1MENGXHUzMEVBXHUzMEYzXHUzMEFGXHUzMDkyXHU2M0EyXHUzMDU5XG5cdFx0Y29uc3QgdGV4dFRvQ2hlY2sgPSBzZWxlY3Rpb24gfHwgbGluZTtcblx0XHRJTUFHRV9MSU5LX1BBVFRFUk4ubGFzdEluZGV4ID0gMDtcblx0XHRjb25zdCBtYXRjaCA9IElNQUdFX0xJTktfUEFUVEVSTi5leGVjKHRleHRUb0NoZWNrKTtcblx0XHRpZiAoIW1hdGNoKSByZXR1cm47XG5cblx0XHQvLyBcdTc1M0JcdTUwQ0ZcdTMwRUFcdTMwRjNcdTMwQUZcdTMwNENcdTg5OEJcdTMwNjRcdTMwNEJcdTMwNjNcdTMwNUZcblx0XHRjb25zdCBpbWFnZUZpbGVuYW1lID0gbWF0Y2hbMV07XG5cblx0XHQvLyBcdTc1M0JcdTUwQ0ZcdTMwRDVcdTMwQTFcdTMwQTRcdTMwRUJcdTMwOTJcdTYzQTJcdTMwNTlcblx0XHRjb25zdCBpbWFnZUZpbGUgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KGltYWdlRmlsZW5hbWUsIFwiXCIpO1xuXHRcdGlmICghaW1hZ2VGaWxlIHx8ICEoaW1hZ2VGaWxlIGluc3RhbmNlb2YgVEZpbGUpKSByZXR1cm47XG5cblx0XHQvLyBcdTMwQzdcdTMwRDVcdTMwQTlcdTMwRUJcdTMwQzhcdTMwNkVcdTMwQjNcdTMwRDRcdTMwRkNcdTMwOTJcdTZCNjJcdTMwODFcdTMwNjZcdTMwMDFcdTgxRUFcdTUyMDZcdTMwNjdcdTUxRTZcdTc0MDZcdTMwNTlcdTMwOEJcblx0XHRldnQucHJldmVudERlZmF1bHQoKTtcblxuXHRcdC8vIFx1MzBCM1x1MzBENFx1MzBGQ1x1MzA1OVx1MzA4Qlx1MzBDNlx1MzBBRFx1MzBCOVx1MzBDOFx1RkYwOFx1OTA3OFx1NjI5RVx1N0JDNFx1NTZGMlx1MzA0Q1x1MzA0Mlx1MzA4Q1x1MzA3MFx1MzA1RFx1MzA4Q1x1MzAwMVx1MzA2QVx1MzA1MVx1MzA4Q1x1MzA3MFx1ODg0Q1x1NTE2OFx1NEY1M1x1RkYwOVxuXHRcdGNvbnN0IHRleHRUb0NvcHkgPSBzZWxlY3Rpb24gfHwgbGluZTtcblxuXHRcdC8vIFx1MjQ2MCBcdTMwN0VcdTMwNUFcdTMwQzZcdTMwQURcdTMwQjlcdTMwQzhcdTMwOTJcdTMwQUZcdTMwRUFcdTMwQzNcdTMwRDdcdTMwRENcdTMwRkNcdTMwQzlcdTMwNkJcdTMwQjNcdTMwRDRcdTMwRkNcdTMwNTlcdTMwOEJcblx0XHRhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0ZXh0VG9Db3B5KTtcblx0XHRuZXcgTm90aWNlKFwiXHUzMEM2XHUzMEFEXHUzMEI5XHUzMEM4XHUzMDkyXHUzMEIzXHUzMEQ0XHUzMEZDXHUzMDU3XHUzMDdFXHUzMDU3XHUzMDVGXCIpO1xuXG5cdFx0Ly8gXHUyNDYxIDEuNVx1NzlEMlx1NUY4Q1x1MzA2Qlx1NzUzQlx1NTBDRlx1MzBDN1x1MzBGQ1x1MzBCRlx1MzA2N1x1MzBBRlx1MzBFQVx1MzBDM1x1MzBEN1x1MzBEQ1x1MzBGQ1x1MzBDOVx1MzA5Mlx1NEUwQVx1NjZGOFx1MzA0RFx1MzA1OVx1MzA4QlxuXHRcdHNldFRpbWVvdXQoYXN5bmMgKCkgPT4ge1xuXHRcdFx0dHJ5IHtcblx0XHRcdFx0Ly8gXHU3NTNCXHU1MENGXHUzMEQ1XHUzMEExXHUzMEE0XHUzMEVCXHUzMDZFXHUzMEQwXHUzMEE0XHUzMENBXHUzMEVBXHUzMEM3XHUzMEZDXHUzMEJGXHUzMDkyXHU4QUFEXHUzMDdGXHU4RkJDXHUzMDgwXG5cdFx0XHRcdGNvbnN0IGltYWdlRGF0YSA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWRCaW5hcnkoaW1hZ2VGaWxlKTtcblxuXHRcdFx0XHQvLyBcdTc1M0JcdTUwQ0ZcdTMwNkUgTUlNRSBcdTMwQkZcdTMwQTRcdTMwRDdcdTMwOTJcdTUyMjRcdTVCOUFcdTMwNTlcdTMwOEJcdUZGMDhcdTRGOEI6IGltYWdlL3BuZywgaW1hZ2UvanBlZ1x1RkYwOVxuXHRcdFx0XHRjb25zdCBleHQgPSBpbWFnZUZpbGUuZXh0ZW5zaW9uLnRvTG93ZXJDYXNlKCk7XG5cdFx0XHRcdGxldCBtaW1lVHlwZSA9IFwiaW1hZ2UvcG5nXCI7XG5cdFx0XHRcdGlmIChleHQgPT09IFwianBnXCIgfHwgZXh0ID09PSBcImpwZWdcIikgbWltZVR5cGUgPSBcImltYWdlL2pwZWdcIjtcblx0XHRcdFx0ZWxzZSBpZiAoZXh0ID09PSBcImdpZlwiKSBtaW1lVHlwZSA9IFwiaW1hZ2UvZ2lmXCI7XG5cdFx0XHRcdGVsc2UgaWYgKGV4dCA9PT0gXCJ3ZWJwXCIpIG1pbWVUeXBlID0gXCJpbWFnZS93ZWJwXCI7XG5cdFx0XHRcdGVsc2UgaWYgKGV4dCA9PT0gXCJibXBcIikgbWltZVR5cGUgPSBcImltYWdlL2JtcFwiO1xuXHRcdFx0XHRlbHNlIGlmIChleHQgPT09IFwic3ZnXCIpIG1pbWVUeXBlID0gXCJpbWFnZS9zdmcreG1sXCI7XG5cdFx0XHRcdGVsc2UgaWYgKGV4dCA9PT0gXCJhdmlmXCIpIG1pbWVUeXBlID0gXCJpbWFnZS9hdmlmXCI7XG5cblx0XHRcdFx0Ly8gXHUzMEFGXHUzMEVBXHUzMEMzXHUzMEQ3XHUzMERDXHUzMEZDXHUzMEM5XHUzMDkyXHU3NTNCXHU1MENGXHUzMEM3XHUzMEZDXHUzMEJGXHUzMDY3XHU0RTBBXHU2NkY4XHUzMDREXHUzMDU5XHUzMDhCXG5cdFx0XHRcdGNvbnN0IGNsaXBib2FyZEl0ZW0gPSBuZXcgQ2xpcGJvYXJkSXRlbSh7XG5cdFx0XHRcdFx0W21pbWVUeXBlXTogbmV3IEJsb2IoW2ltYWdlRGF0YV0sIHsgdHlwZTogbWltZVR5cGUgfSksXG5cdFx0XHRcdH0pO1xuXHRcdFx0XHRhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlKFtjbGlwYm9hcmRJdGVtXSk7XG5cdFx0XHRcdG5ldyBOb3RpY2UoXCJcdTc1M0JcdTUwQ0ZcdTMwOTJcdTMwQjNcdTMwRDRcdTMwRkNcdTMwNTdcdTMwN0VcdTMwNTdcdTMwNUZcIik7XG5cdFx0XHR9IGNhdGNoIChlKSB7XG5cdFx0XHRcdG5ldyBOb3RpY2UoXCJcdTc1M0JcdTUwQ0ZcdTMwNkVcdTMwQjNcdTMwRDRcdTMwRkNcdTMwNkJcdTU5MzFcdTY1NTdcdTMwNTdcdTMwN0VcdTMwNTdcdTMwNUZcIik7XG5cdFx0XHR9XG5cdFx0fSwgMTUwMCk7XG5cdH1cbn1cblxuLy8gXHU4QTJEXHU1QjlBXHU3NTNCXHU5NzYyXG5jbGFzcyBBZHZhbmNlZEltYWdlU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuXHRwbHVnaW46IEFkdmFuY2VkSW1hZ2VQbHVnaW47XG5cblx0Y29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogQWR2YW5jZWRJbWFnZVBsdWdpbikge1xuXHRcdHN1cGVyKGFwcCwgcGx1Z2luKTtcblx0XHR0aGlzLnBsdWdpbiA9IHBsdWdpbjtcblx0fVxuXG5cdGRpc3BsYXkoKTogdm9pZCB7XG5cdFx0Y29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcblx0XHRjb250YWluZXJFbC5lbXB0eSgpO1xuXG5cdFx0Ly8gXHUzMEM3XHUzMEQ1XHUzMEE5XHUzMEVCXHUzMEM4XHUzMDZFXHUzMEQxXHUzMEZDXHUzMEJCXHUzMEYzXHUzMEM4XHU1MDI0XG5cdFx0bmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG5cdFx0XHQuc2V0TmFtZShcIlx1MzBDN1x1MzBENVx1MzBBOVx1MzBFQlx1MzBDOFx1MzA2RVx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1NTAyNFwiKVxuXHRcdFx0LnNldERlc2MoXCJcdTc1M0JcdTUwQ0ZcdTMwOTJcdTMwREFcdTMwRkNcdTMwQjlcdTMwQzhcdTMwNTdcdTMwNUZcdTMwNjhcdTMwNERcdTMwMDFcdTgxRUFcdTUyRDVcdTMwNjdcdTRFRDhcdTMwNEZcdTMwRDFcdTMwRkNcdTMwQkJcdTMwRjNcdTMwQzhcdTUwMjRcdUZGMDgxMFx1MzAxQzEwMFx1RkYwOVwiKVxuXHRcdFx0LmFkZFNsaWRlcigoc2xpZGVyKSA9PlxuXHRcdFx0XHRzbGlkZXJcblx0XHRcdFx0XHQuc2V0TGltaXRzKDEwLCAxMDAsIDUpXG5cdFx0XHRcdFx0LnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmRlZmF1bHRQZXJjZW50KVxuXHRcdFx0XHRcdC5zZXREeW5hbWljVG9vbHRpcCgpXG5cdFx0XHRcdFx0Lm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuXHRcdFx0XHRcdFx0dGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFBlcmNlbnQgPSB2YWx1ZTtcblx0XHRcdFx0XHRcdGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuXHRcdFx0XHRcdH0pXG5cdFx0XHQpO1xuXG5cdFx0Ly8gXHUzMEUyXHUzMEQwXHUzMEE0XHUzMEVCXHUzMDY3XHU4MUVBXHU1MkQ1MTAwJVx1ODg2OFx1NzkzQVxuXHRcdG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuXHRcdFx0LnNldE5hbWUoXCJcdTMwRTJcdTMwRDBcdTMwQTRcdTMwRUJcdTMwNjdcdTgxRUFcdTUyRDUxMDAlXHU4ODY4XHU3OTNBXCIpXG5cdFx0XHQuc2V0RGVzYyhcIlx1NzUzQlx1OTc2Mlx1NUU0NVx1MzA0Q1x1NUMwRlx1MzA1NVx1MzA0NFx1MzBDN1x1MzBEMFx1MzBBNFx1MzBCOVx1MzA2N1x1MzA2Rlx1MzAwMVx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1NjMwN1x1NUI5QVx1MzA2Qlx1OTVBMlx1NEZDMlx1MzA2QVx1MzA0Rlx1NzUzQlx1NTBDRlx1MzA5MjEwMCVcdTVFNDVcdTMwNjdcdTg4NjhcdTc5M0FcdTMwNTdcdTMwN0VcdTMwNTlcIilcblx0XHRcdC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cblx0XHRcdFx0dG9nZ2xlXG5cdFx0XHRcdFx0LnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLm1vYmlsZUF1dG9GdWxsKVxuXHRcdFx0XHRcdC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcblx0XHRcdFx0XHRcdHRoaXMucGx1Z2luLnNldHRpbmdzLm1vYmlsZUF1dG9GdWxsID0gdmFsdWU7XG5cdFx0XHRcdFx0XHRhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcblx0XHRcdFx0XHR9KVxuXHRcdFx0KTtcblxuXHRcdC8vIFx1MzBFMlx1MzBEMFx1MzBBNFx1MzBFQlx1NTIyNFx1NUI5QVx1MzA2RVx1MzA1N1x1MzA0RFx1MzA0NFx1NTAyNFxuXHRcdG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuXHRcdFx0LnNldE5hbWUoXCJcdTMwRTJcdTMwRDBcdTMwQTRcdTMwRUJcdTUyMjRcdTVCOUFcdTMwNkVcdTc1M0JcdTk3NjJcdTVFNDVcdUZGMDhweFx1RkYwOVwiKVxuXHRcdFx0LnNldERlc2MoXCJcdTMwNTNcdTMwNkVcdTVFNDVcdTRFRTVcdTRFMEJcdTMwNkVcdTMwQzdcdTMwRDBcdTMwQTRcdTMwQjlcdTMwOTJcdTMwRTJcdTMwRDBcdTMwQTRcdTMwRUJcdTMwNjhcdTMwNTdcdTMwNjZcdTYyNzFcdTMwNDRcdTMwN0VcdTMwNTlcdUZGMDhcdTUyMURcdTY3MUZcdTUwMjQ6IDc2OFx1RkYwOVwiKVxuXHRcdFx0LmFkZFRleHQoKHRleHQpID0+XG5cdFx0XHRcdHRleHRcblx0XHRcdFx0XHQuc2V0UGxhY2Vob2xkZXIoXCI3NjhcIilcblx0XHRcdFx0XHQuc2V0VmFsdWUoU3RyaW5nKHRoaXMucGx1Z2luLnNldHRpbmdzLm1vYmlsZVRocmVzaG9sZCkpXG5cdFx0XHRcdFx0Lm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuXHRcdFx0XHRcdFx0Y29uc3QgbnVtID0gcGFyc2VJbnQodmFsdWUsIDEwKTtcblx0XHRcdFx0XHRcdGlmICghaXNOYU4obnVtKSAmJiBudW0gPiAwKSB7XG5cdFx0XHRcdFx0XHRcdHRoaXMucGx1Z2luLnNldHRpbmdzLm1vYmlsZVRocmVzaG9sZCA9IG51bTtcblx0XHRcdFx0XHRcdFx0YXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fSlcblx0XHRcdCk7XG5cdH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7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
