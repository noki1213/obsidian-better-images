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
      this.app.workspace.on("editor-paste", (evt, editor) => {
        if (!evt.clipboardData)
          return;
        const imageFile = this.getImageFileFromDataTransfer(evt.clipboardData);
        if (!imageFile)
          return;
        evt.preventDefault();
        this.saveImageAndInsertLink(imageFile, editor);
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-drop", (evt, editor) => {
        if (!evt.dataTransfer)
          return;
        const imageFile = this.getImageFileFromDataTransfer(evt.dataTransfer);
        if (!imageFile)
          return;
        evt.preventDefault();
        this.saveImageAndInsertLink(imageFile, editor);
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
  // DataTransfer（クリップボードやドラッグデータ）から画像ファイルを取り出す
  getImageFileFromDataTransfer(dataTransfer) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        return item.getAsFile();
      }
    }
    return null;
  }
  // 同名ファイルがある場合、数字サフィックスを付けたパスを返す
  async getUniqueFilePath(folderPath, baseName, ext) {
    const prefix = folderPath ? `${folderPath}/` : "";
    let candidate = `${prefix}${baseName}.${ext}`;
    if (!this.app.vault.getAbstractFileByPath(candidate)) {
      return candidate;
    }
    let suffix = 1;
    while (true) {
      candidate = `${prefix}${baseName}_${suffix}.${ext}`;
      if (!this.app.vault.getAbstractFileByPath(candidate)) {
        return candidate;
      }
      suffix++;
    }
  }
  // 画像ファイルをVaultに保存して、リンクをエディタに挿入する
  async saveImageAndInsertLink(imageFile, editor) {
    const defaultPercent = this.settings.defaultPercent;
    try {
      const activeFile = this.app.workspace.getActiveFile();
      const noteName = activeFile ? activeFile.basename : "untitled";
      const dateStr = this.getFormattedDate();
      const ext = imageFile.name.split(".").pop() || "png";
      const newBaseName = `${noteName}_${dateStr}`;
      const savePath = await this.app.vault.getAvailablePathForAttachments(newBaseName, ext, activeFile);
      const arrayBuffer = await imageFile.arrayBuffer();
      const savedFile = await this.app.vault.createBinary(savePath, arrayBuffer);
      const savedFileName = savedFile.name;
      const linkText = `![[${savedFileName}|${defaultPercent}%]]`;
      editor.replaceSelection(linkText);
    } catch (e) {
      new import_obsidian.Notice("\u753B\u50CF\u306E\u4FDD\u5B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
    }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibWFpbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgUGx1Z2luLCBQbHVnaW5TZXR0aW5nVGFiLCBBcHAsIFNldHRpbmcsIE1hcmtkb3duUG9zdFByb2Nlc3NvckNvbnRleHQsIE1hcmtkb3duVmlldywgVEZpbGUsIE5vdGljZSB9IGZyb20gXCJvYnNpZGlhblwiO1xuXG4vLyBcdTMwRDdcdTMwRTlcdTMwQjBcdTMwQTRcdTMwRjNcdTMwNkVcdThBMkRcdTVCOUFcdTMwNkVcdTU3OEJcdTVCOUFcdTdGQTlcbmludGVyZmFjZSBBZHZhbmNlZEltYWdlU2V0dGluZ3Mge1xuXHQvLyBcdTMwQzdcdTMwRDVcdTMwQTlcdTMwRUJcdTMwQzhcdTMwNkVcdTMwRDFcdTMwRkNcdTMwQkJcdTMwRjNcdTMwQzhcdTUwMjRcdUZGMDhcdTc1M0JcdTUwQ0ZcdTMwREFcdTMwRkNcdTMwQjlcdTMwQzhcdTY2NDJcdTMwNkJcdTgxRUFcdTUyRDVcdTMwNjdcdTRFRDhcdTMwNEZcdTUwMjRcdUZGMDlcblx0ZGVmYXVsdFBlcmNlbnQ6IG51bWJlcjtcblx0Ly8gXHUzMEUyXHUzMEQwXHUzMEE0XHUzMEVCXHUzMDY3XHU4MUVBXHU1MkQ1MTAwJVx1ODg2OFx1NzkzQVx1MzA2Qlx1MzA1OVx1MzA4Qlx1MzA0Qlx1MzA2OVx1MzA0Nlx1MzA0QlxuXHRtb2JpbGVBdXRvRnVsbDogYm9vbGVhbjtcblx0Ly8gXHUzMEUyXHUzMEQwXHUzMEE0XHUzMEVCXHU1MjI0XHU1QjlBXHUzMDZFXHU3NTNCXHU5NzYyXHU1RTQ1XHUzMDU3XHUzMDREXHUzMDQ0XHU1MDI0XHVGRjA4cHhcdUZGMDlcblx0bW9iaWxlVGhyZXNob2xkOiBudW1iZXI7XG59XG5cbi8vIFx1OEEyRFx1NUI5QVx1MzA2RVx1NTIxRFx1NjcxRlx1NTAyNFxuY29uc3QgREVGQVVMVF9TRVRUSU5HUzogQWR2YW5jZWRJbWFnZVNldHRpbmdzID0ge1xuXHRkZWZhdWx0UGVyY2VudDogNTAsXG5cdG1vYmlsZUF1dG9GdWxsOiB0cnVlLFxuXHRtb2JpbGVUaHJlc2hvbGQ6IDc2OCxcbn07XG5cbi8vIFx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1NjMwN1x1NUI5QVx1MzA2RVx1MzBEMVx1MzBCRlx1MzBGQ1x1MzBGM1x1RkYwOFx1NEY4QjogXCI1MCVcIiBcdTMwODQgXCJpbWFnZSA1MCVcIlx1RkYwOVxuY29uc3QgUEVSQ0VOVF9QQVRURVJOID0gLyhcXGR7MSwzfSklJC87XG5cbi8vIFx1NzUzQlx1NTBDRlx1MzA2RVx1NjJFMVx1NUYzNVx1NUI1MFx1NEUwMFx1ODlBN1xuY29uc3QgSU1BR0VfRVhURU5TSU9OUyA9IFtcInBuZ1wiLCBcImpwZ1wiLCBcImpwZWdcIiwgXCJnaWZcIiwgXCJibXBcIiwgXCJzdmdcIiwgXCJ3ZWJwXCIsIFwiYXZpZlwiLCBcImhlaWNcIiwgXCJ0aWZcIiwgXCJ0aWZmXCJdO1xuXG4vLyBcdTc1M0JcdTUwQ0ZcdTMwRUFcdTMwRjNcdTMwQUZcdTMwNkVcdTMwRDFcdTMwQkZcdTMwRkNcdTMwRjM6ICFbW1x1MzBENVx1MzBBMVx1MzBBNFx1MzBFQlx1NTQwRC5cdTYyRTFcdTVGMzVcdTVCNTBdXSBcdTMwN0VcdTMwNUZcdTMwNkYgIVtbXHUzMEQ1XHUzMEExXHUzMEE0XHUzMEVCXHU1NDBELlx1NjJFMVx1NUYzNVx1NUI1MHwuLi5dXVxuY29uc3QgSU1BR0VfTElOS19QQVRURVJOID0gLyFcXFtcXFsoW15cXF18XStcXC4ocG5nfGpwZ3xqcGVnfGdpZnxibXB8c3ZnfHdlYnB8YXZpZnxoZWljfHRpZnx0aWZmKSkoXFx8W15cXF1dKik/XFxdXFxdL2dpO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBBZHZhbmNlZEltYWdlUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcblx0c2V0dGluZ3M6IEFkdmFuY2VkSW1hZ2VTZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG5cdHByaXZhdGUgc3R5bGVFbDogSFRNTFN0eWxlRWxlbWVudCB8IG51bGwgPSBudWxsO1xuXHRwcml2YXRlIG9ic2VydmVyOiBNdXRhdGlvbk9ic2VydmVyIHwgbnVsbCA9IG51bGw7XG5cdC8vIFx1NTE4RFx1MzBCOVx1MzBBRFx1MzBFM1x1MzBGM1x1MzA0Q1x1OTAyM1x1N0Q5QVx1MzA2N1x1OEQ3MFx1MzA4QVx1MzA1OVx1MzA0RVx1MzA2QVx1MzA0NFx1MzA4OFx1MzA0Nlx1NTIzNlx1NUZBMVx1MzA1OVx1MzA4Qlx1MzBCRlx1MzBBNFx1MzBERVx1MzBGQ1xuXHRwcml2YXRlIGRlYm91bmNlVGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbCA9IG51bGw7XG5cblx0YXN5bmMgb25sb2FkKCkge1xuXHRcdC8vIFx1OEEyRFx1NUI5QVx1MzA5Mlx1OEFBRFx1MzA3Rlx1OEZCQ1x1MzA4MFxuXHRcdGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG5cblx0XHQvLyBcdTMwRTJcdTMwRDBcdTMwQTRcdTMwRUJcdTc1MjhcdTMwNkVDU1NcdUZGMDhcdTMwRTFcdTMwQzdcdTMwQTNcdTMwQTJcdTMwQUZcdTMwQThcdTMwRUFcdUZGMDlcdTMwOTJcdTUyRDVcdTc2ODRcdTMwNkJcdThGRkRcdTUyQTBcblx0XHR0aGlzLnVwZGF0ZU1vYmlsZVN0eWxlKCk7XG5cblx0XHQvLyBSZWFkaW5nIFZpZXdcdUZGMDhcdTk1QjJcdTg5QTdcdTMwRTJcdTMwRkNcdTMwQzlcdUZGMDlcdTMwNjdcdTc1M0JcdTUwQ0ZcdTMwNkVcdTMwRDFcdTMwRkNcdTMwQkJcdTMwRjNcdTMwQzhcdTg4NjhcdTc5M0FcdTMwOTJcdTUxRTZcdTc0MDZcdTMwNTlcdTMwOEJcblx0XHR0aGlzLnJlZ2lzdGVyTWFya2Rvd25Qb3N0UHJvY2Vzc29yKChlbDogSFRNTEVsZW1lbnQsIGN0eDogTWFya2Rvd25Qb3N0UHJvY2Vzc29yQ29udGV4dCkgPT4ge1xuXHRcdFx0dGhpcy5wcm9jZXNzSW1hZ2VzKGVsKTtcblx0XHR9KTtcblxuXHRcdC8vIExpdmUgUHJldmlld1x1RkYwOFx1N0RFOFx1OTZDNlx1MzBFMlx1MzBGQ1x1MzBDOVx1RkYwOVx1MzA2N1x1NzUzQlx1NTBDRlx1MzA2RVx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1ODg2OFx1NzkzQVx1MzA5Mlx1NTFFNlx1NzQwNlx1MzA1OVx1MzA4QlxuXHRcdHRoaXMucmVnaXN0ZXJFdmVudChcblx0XHRcdHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuXHRcdFx0XHR0aGlzLnNldHVwTGl2ZVByZXZpZXdPYnNlcnZlcigpO1xuXHRcdFx0XHR0aGlzLmRlYm91bmNlZFNjYW5BbGwoKTtcblx0XHRcdH0pXG5cdFx0KTtcblxuXHRcdC8vIFx1MzBDRVx1MzBGQ1x1MzBDOFx1MzA5Mlx1NTIwN1x1MzA4QVx1NjZGRlx1MzA0OFx1MzA1Rlx1MzA2OFx1MzA0RFx1MzA2Qlx1MzA4Mlx1NTE4RFx1MzBCOVx1MzBBRFx1MzBFM1x1MzBGM1x1MzA1OVx1MzA4QlxuXHRcdHRoaXMucmVnaXN0ZXJFdmVudChcblx0XHRcdHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCAoKSA9PiB7XG5cdFx0XHRcdHRoaXMuZGVib3VuY2VkU2NhbkFsbCgpO1xuXHRcdFx0fSlcblx0XHQpO1xuXG5cdFx0Ly8gXHUzMEE4XHUzMEM3XHUzMEEzXHUzMEJGXHUzMDZFXHU1MTg1XHU1QkI5XHUzMDRDXHU1OTA5XHUzMDhGXHUzMDYzXHUzMDVGXHUzMDY4XHUzMDREXHUzMDZCXHUzMDgyXHU1MThEXHUzMEI5XHUzMEFEXHUzMEUzXHUzMEYzXHUzMDU5XHUzMDhCXG5cdFx0Ly8gXHVGRjA4TGl2ZSBQcmV2aWV3XHUzMDY3IHw1MCUgXHUyMTkyIHwzMCUgXHUzMDZFXHUzMDg4XHUzMDQ2XHUzMDZCXHU2NkY4XHUzMDREXHU2M0RCXHUzMDQ4XHUzMDVGXHUzMDY4XHUzMDREXHUzMDZCXHU1M0NEXHU2NjIwXHUzMDU5XHUzMDhCXHUzMDVGXHUzMDgxXHVGRjA5XG5cdFx0dGhpcy5yZWdpc3RlckV2ZW50KFxuXHRcdFx0dGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZWRpdG9yLWNoYW5nZVwiLCAoKSA9PiB7XG5cdFx0XHRcdHRoaXMuZGVib3VuY2VkU2NhbkFsbCgpO1xuXHRcdFx0fSlcblx0XHQpO1xuXG5cdFx0Ly8gXHU1MjFEXHU1NkRFXHUzMDZFXHU4QTJEXHU1QjlBXG5cdFx0dGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuXHRcdFx0dGhpcy5zZXR1cExpdmVQcmV2aWV3T2JzZXJ2ZXIoKTtcblx0XHRcdHRoaXMuZGVib3VuY2VkU2NhbkFsbCgpO1xuXHRcdH0pO1xuXG5cdFx0Ly8gXHU3NTNCXHU1MENGXHUzMDkyXHUzMERBXHUzMEZDXHUzMEI5XHUzMEM4XHUzMDU3XHUzMDVGXHUzMDY4XHUzMDREXHUzMDAxT2JzaWRpYW5cdTMwNkVcdTMwQzdcdTMwRDVcdTMwQTlcdTMwRUJcdTMwQzhcdTUxRTZcdTc0MDZcdTMwOTJcdTZCNjJcdTMwODFcdTMwNjZcblx0XHQvLyBcdTgxRUFcdTUyMDZcdTMwNjdcdTZCNjNcdTMwNTdcdTMwNDRcdTMwRDVcdTMwQTFcdTMwQTRcdTMwRUJcdTU0MERcdTMwNjdcdTRGRERcdTVCNThcdTMwNTlcdTMwOEJcdUZGMDhpbWFnZS1jb252ZXJ0ZXIgXHUzMDY4XHU1NDBDXHUzMDU4XHU2NUI5XHU1RjBGXHVGRjA5XG5cdFx0dGhpcy5yZWdpc3RlckV2ZW50KFxuXHRcdFx0dGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZWRpdG9yLXBhc3RlXCIsIChldnQ6IENsaXBib2FyZEV2ZW50LCBlZGl0b3IpID0+IHtcblx0XHRcdFx0aWYgKCFldnQuY2xpcGJvYXJkRGF0YSkgcmV0dXJuO1xuXHRcdFx0XHQvLyBcdTMwQUZcdTMwRUFcdTMwQzNcdTMwRDdcdTMwRENcdTMwRkNcdTMwQzlcdTMwNkJcdTc1M0JcdTUwQ0ZcdTMwRDVcdTMwQTFcdTMwQTRcdTMwRUJcdTMwNENcdTMwNDJcdTMwOEJcdTMwNEJcdTc4QkFcdThBOERcdTMwNTlcdTMwOEJcblx0XHRcdFx0Y29uc3QgaW1hZ2VGaWxlID0gdGhpcy5nZXRJbWFnZUZpbGVGcm9tRGF0YVRyYW5zZmVyKGV2dC5jbGlwYm9hcmREYXRhKTtcblx0XHRcdFx0aWYgKCFpbWFnZUZpbGUpIHJldHVybjtcblx0XHRcdFx0Ly8gT2JzaWRpYW5cdTMwNkVcdTMwQzdcdTMwRDVcdTMwQTlcdTMwRUJcdTMwQzhcdTMwNkVcdTMwREFcdTMwRkNcdTMwQjlcdTMwQzhcdTUxRTZcdTc0MDZcdTMwOTJcdTZCNjJcdTMwODFcdTMwOEJcblx0XHRcdFx0ZXZ0LnByZXZlbnREZWZhdWx0KCk7XG5cdFx0XHRcdHRoaXMuc2F2ZUltYWdlQW5kSW5zZXJ0TGluayhpbWFnZUZpbGUsIGVkaXRvcik7XG5cdFx0XHR9KVxuXHRcdCk7XG5cblx0XHQvLyBcdTc1M0JcdTUwQ0ZcdTMwOTJcdTMwQzlcdTMwRURcdTMwQzNcdTMwRDdcdTMwNTdcdTMwNUZcdTMwNjhcdTMwNERcblx0XHR0aGlzLnJlZ2lzdGVyRXZlbnQoXG5cdFx0XHR0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJlZGl0b3ItZHJvcFwiLCAoZXZ0OiBEcmFnRXZlbnQsIGVkaXRvcikgPT4ge1xuXHRcdFx0XHRpZiAoIWV2dC5kYXRhVHJhbnNmZXIpIHJldHVybjtcblx0XHRcdFx0Y29uc3QgaW1hZ2VGaWxlID0gdGhpcy5nZXRJbWFnZUZpbGVGcm9tRGF0YVRyYW5zZmVyKGV2dC5kYXRhVHJhbnNmZXIpO1xuXHRcdFx0XHRpZiAoIWltYWdlRmlsZSkgcmV0dXJuO1xuXHRcdFx0XHRldnQucHJldmVudERlZmF1bHQoKTtcblx0XHRcdFx0dGhpcy5zYXZlSW1hZ2VBbmRJbnNlcnRMaW5rKGltYWdlRmlsZSwgZWRpdG9yKTtcblx0XHRcdH0pXG5cdFx0KTtcblxuXHRcdC8vIFx1MzBCM1x1MzBENFx1MzBGQ1x1RkYwOENtZCtDXHVGRjA5XHUzMDU3XHUzMDVGXHUzMDY4XHUzMDREXHUzMDAxXHUzMEFCXHUzMEZDXHUzMEJEXHUzMEVCXHU4ODRDXHUzMDRDXHU3NTNCXHU1MENGXHUzMEVBXHUzMEYzXHUzMEFGXHUzMDZBXHUzMDg5XG5cdFx0Ly8gXHUzMEM2XHUzMEFEXHUzMEI5XHUzMEM4XHUzMDY4XHU3NTNCXHU1MENGXHUzMEM3XHUzMEZDXHUzMEJGXHUzMDZFXHU0RTIxXHU2NUI5XHUzMDkyXHUzMEFGXHUzMEVBXHUzMEMzXHUzMEQ3XHUzMERDXHUzMEZDXHUzMEM5XHUzMDZCXHU1MTY1XHUzMDhDXHUzMDhCXG5cdFx0dGhpcy5yZWdpc3RlckRvbUV2ZW50KGRvY3VtZW50LCBcImNvcHlcIiwgKGV2dDogQ2xpcGJvYXJkRXZlbnQpID0+IHtcblx0XHRcdHRoaXMuaGFuZGxlSW1hZ2VDb3B5KGV2dCk7XG5cdFx0fSk7XG5cblx0XHQvLyBcdThBMkRcdTVCOUFcdTc1M0JcdTk3NjJcdTMwOTJcdThGRkRcdTUyQTBcblx0XHR0aGlzLmFkZFNldHRpbmdUYWIobmV3IEFkdmFuY2VkSW1hZ2VTZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG5cdH1cblxuXHRvbnVubG9hZCgpIHtcblx0XHQvLyBcdTMwRDdcdTMwRTlcdTMwQjBcdTMwQTRcdTMwRjNcdTMwOTJcdTcxMjFcdTUyQjlcdTMwNkJcdTMwNTdcdTMwNUZcdTMwNjhcdTMwNERcdTMwMDFcdThGRkRcdTUyQTBcdTMwNTdcdTMwNUZcdTMwQjlcdTMwQkZcdTMwQTRcdTMwRUJcdTMwOTJcdTUyNEFcdTk2NjRcdTMwNTlcdTMwOEJcblx0XHRpZiAodGhpcy5zdHlsZUVsKSB7XG5cdFx0XHR0aGlzLnN0eWxlRWwucmVtb3ZlKCk7XG5cdFx0XHR0aGlzLnN0eWxlRWwgPSBudWxsO1xuXHRcdH1cblx0XHQvLyBNdXRhdGlvbk9ic2VydmVyXHUzMDkyXHU1MDVDXHU2QjYyXHUzMDU5XHUzMDhCXG5cdFx0aWYgKHRoaXMub2JzZXJ2ZXIpIHtcblx0XHRcdHRoaXMub2JzZXJ2ZXIuZGlzY29ubmVjdCgpO1xuXHRcdFx0dGhpcy5vYnNlcnZlciA9IG51bGw7XG5cdFx0fVxuXHRcdC8vIFx1MzBCRlx1MzBBNFx1MzBERVx1MzBGQ1x1MzA5Mlx1NTA1Q1x1NkI2Mlx1MzA1OVx1MzA4QlxuXHRcdGlmICh0aGlzLmRlYm91bmNlVGltZXIpIHtcblx0XHRcdGNsZWFyVGltZW91dCh0aGlzLmRlYm91bmNlVGltZXIpO1xuXHRcdFx0dGhpcy5kZWJvdW5jZVRpbWVyID0gbnVsbDtcblx0XHR9XG5cdH1cblxuXHRhc3luYyBsb2FkU2V0dGluZ3MoKSB7XG5cdFx0dGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XG5cdH1cblxuXHRhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG5cdFx0YXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcblx0XHQvLyBcdThBMkRcdTVCOUFcdTU5MDlcdTY2RjRcdTY2NDJcdTMwNkJcdTMwRTJcdTMwRDBcdTMwQTRcdTMwRUJcdTMwQjlcdTMwQkZcdTMwQTRcdTMwRUJcdTMwOTJcdTY2RjRcdTY1QjBcdTMwNTlcdTMwOEJcblx0XHR0aGlzLnVwZGF0ZU1vYmlsZVN0eWxlKCk7XG5cdH1cblxuXHQvLyBcdTMwRTJcdTMwRDBcdTMwQTRcdTMwRUJcdTc1MjhcdTMwNkVDU1NcdTMwOTJcdTUyRDVcdTc2ODRcdTMwNkJcdTc1MUZcdTYyMTBcdTMwNTdcdTMwNjZcdThGRkRcdTUyQTBcdTMwNTlcdTMwOEJcblx0dXBkYXRlTW9iaWxlU3R5bGUoKSB7XG5cdFx0Ly8gXHU2NUUyXHU1QjU4XHUzMDZFXHUzMEI5XHUzMEJGXHUzMEE0XHUzMEVCXHU4OTgxXHU3RDIwXHUzMDRDXHUzMDQyXHUzMDhDXHUzMDcwXHU1MjRBXHU5NjY0XG5cdFx0aWYgKHRoaXMuc3R5bGVFbCkge1xuXHRcdFx0dGhpcy5zdHlsZUVsLnJlbW92ZSgpO1xuXHRcdH1cblxuXHRcdHRoaXMuc3R5bGVFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzdHlsZVwiKTtcblx0XHR0aGlzLnN0eWxlRWwuaWQgPSBcImFkdmFuY2VkLWltYWdlLW1vYmlsZS1zdHlsZVwiO1xuXG5cdFx0aWYgKHRoaXMuc2V0dGluZ3MubW9iaWxlQXV0b0Z1bGwpIHtcblx0XHRcdC8vIFx1MzBFMlx1MzBEMFx1MzBBNFx1MzBFQlx1MzA2N1x1MzA2Rlx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1NjMwN1x1NUI5QVx1MzA2Qlx1OTVBMlx1NEZDMlx1MzA2QVx1MzA0RjEwMCVcdTVFNDVcdTMwNjdcdTg4NjhcdTc5M0FcdTMwNTlcdTMwOEJcblx0XHRcdHRoaXMuc3R5bGVFbC50ZXh0Q29udGVudCA9IGBcblx0XHRcdFx0QG1lZGlhIChtYXgtd2lkdGg6ICR7dGhpcy5zZXR0aW5ncy5tb2JpbGVUaHJlc2hvbGR9cHgpIHtcblx0XHRcdFx0XHRpbWcuYWR2YW5jZWQtaW1hZ2UtcGVyY2VudCB7XG5cdFx0XHRcdFx0XHR3aWR0aDogMTAwJSAhaW1wb3J0YW50O1xuXHRcdFx0XHRcdFx0bWF4LXdpZHRoOiAxMDAlICFpbXBvcnRhbnQ7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHRgO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHR0aGlzLnN0eWxlRWwudGV4dENvbnRlbnQgPSBcIlwiO1xuXHRcdH1cblxuXHRcdGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQodGhpcy5zdHlsZUVsKTtcblx0fVxuXG5cdC8vIFx1NzUzQlx1NTBDRlx1ODk4MVx1N0QyMFx1MzA5Mlx1NjNBMlx1MzA1N1x1MzA2Nlx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1ODg2OFx1NzkzQVx1MzA5Mlx1OTA2OVx1NzUyOFx1MzA1OVx1MzA4QlxuXHRwcm9jZXNzSW1hZ2VzKGVsOiBIVE1MRWxlbWVudCkge1xuXHRcdGNvbnN0IGltYWdlcyA9IGVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCJpbWdcIik7XG5cdFx0aW1hZ2VzLmZvckVhY2goKGltZzogSFRNTEltYWdlRWxlbWVudCkgPT4ge1xuXHRcdFx0Ly8gYWx0XHUzMEM2XHUzMEFEXHUzMEI5XHUzMEM4XHUzMDRCXHUzMDg5XHUzMEQxXHUzMEZDXHUzMEJCXHUzMEYzXHUzMEM4XHU1MDI0XHUzMDkyXHU1M0Q2XHU1Rjk3XHUzMDU5XHUzMDhCXG5cdFx0XHRjb25zdCBhbHQgPSBpbWcuYWx0O1xuXHRcdFx0aWYgKCFhbHQpIHtcblx0XHRcdFx0Ly8gYWx0XHUzMDRDXHUzMDZBXHUzMDQ0XHU1ODM0XHU1NDA4XHUzMDAxXHUzMEQxXHUzMEZDXHUzMEJCXHUzMEYzXHUzMEM4XHU2MzA3XHU1QjlBXHUzMDRDXHU1MjRBXHU5NjY0XHUzMDU1XHUzMDhDXHUzMDVGXHU1M0VGXHU4MEZEXHU2MDI3XHUzMDRDXHUzMDQyXHUzMDhCXG5cdFx0XHRcdC8vIFx1NEVFNVx1NTI0RFx1OTA2OVx1NzUyOFx1MzA1N1x1MzA1Rlx1MzBCOVx1MzBCRlx1MzBBNFx1MzBFQlx1MzA5Mlx1MzBFQVx1MzBCQlx1MzBDM1x1MzBDOFx1MzA1OVx1MzA4QlxuXHRcdFx0XHRpZiAoaW1nLmNsYXNzTGlzdC5jb250YWlucyhcImFkdmFuY2VkLWltYWdlLXBlcmNlbnRcIikpIHtcblx0XHRcdFx0XHRpbWcuY2xhc3NMaXN0LnJlbW92ZShcImFkdmFuY2VkLWltYWdlLXBlcmNlbnRcIik7XG5cdFx0XHRcdFx0aW1nLnN0eWxlLndpZHRoID0gXCJcIjtcblx0XHRcdFx0XHRpbWcuc3R5bGUubWF4V2lkdGggPSBcIlwiO1xuXHRcdFx0XHRcdGltZy5zdHlsZS5oZWlnaHQgPSBcIlwiO1xuXHRcdFx0XHR9XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0Y29uc3QgbWF0Y2ggPSBhbHQubWF0Y2goUEVSQ0VOVF9QQVRURVJOKTtcblx0XHRcdGlmICghbWF0Y2gpIHtcblx0XHRcdFx0Ly8gXHUzMEQxXHUzMEZDXHUzMEJCXHUzMEYzXHUzMEM4XHUzMEQxXHUzMEJGXHUzMEZDXHUzMEYzXHUzMDZCXHU0RTAwXHU4MUY0XHUzMDU3XHUzMDZBXHUzMDQ0XHU1ODM0XHU1NDA4XHUzMDgyXHUzMEVBXHUzMEJCXHUzMEMzXHUzMEM4XHUzMDU5XHUzMDhCXG5cdFx0XHRcdGlmIChpbWcuY2xhc3NMaXN0LmNvbnRhaW5zKFwiYWR2YW5jZWQtaW1hZ2UtcGVyY2VudFwiKSkge1xuXHRcdFx0XHRcdGltZy5jbGFzc0xpc3QucmVtb3ZlKFwiYWR2YW5jZWQtaW1hZ2UtcGVyY2VudFwiKTtcblx0XHRcdFx0XHRpbWcuc3R5bGUud2lkdGggPSBcIlwiO1xuXHRcdFx0XHRcdGltZy5zdHlsZS5tYXhXaWR0aCA9IFwiXCI7XG5cdFx0XHRcdFx0aW1nLnN0eWxlLmhlaWdodCA9IFwiXCI7XG5cdFx0XHRcdH1cblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHRjb25zdCBwZXJjZW50ID0gcGFyc2VJbnQobWF0Y2hbMV0sIDEwKTtcblx0XHRcdGlmIChwZXJjZW50IDwgMSB8fCBwZXJjZW50ID4gMTAwKSByZXR1cm47XG5cblx0XHRcdC8vIFx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1MzA2Qlx1NTdGQVx1MzA2NVx1MzA0NFx1MzA2Nlx1NUU0NVx1MzA5Mlx1OEEyRFx1NUI5QVx1MzA1OVx1MzA4QlxuXHRcdFx0aW1nLmNsYXNzTGlzdC5hZGQoXCJhZHZhbmNlZC1pbWFnZS1wZXJjZW50XCIpO1xuXHRcdFx0aW1nLnN0eWxlLndpZHRoID0gYCR7cGVyY2VudH0lYDtcblx0XHRcdGltZy5zdHlsZS5tYXhXaWR0aCA9IGAke3BlcmNlbnR9JWA7XG5cdFx0XHRpbWcuc3R5bGUuaGVpZ2h0ID0gXCJhdXRvXCI7XG5cdFx0fSk7XG5cblx0XHQvLyBMaXZlIFByZXZpZXcgXHUzMDY3XHUzMDZGIC5pbnRlcm5hbC1lbWJlZCBcdTg5ODFcdTdEMjBcdTMwNkVcdTRFMkRcdTMwNkJcdTc1M0JcdTUwQ0ZcdTMwNENcdTMwNDJcdTMwOEJcblx0XHQvLyAuaW50ZXJuYWwtZW1iZWQgXHUzMDZFIGFsdCBcdTVDNUVcdTYwMjdcdTMwNkJcdTMwRDFcdTMwRkNcdTMwQkJcdTMwRjNcdTMwQzhcdTUwMjRcdTMwNENcdTUxNjVcdTMwNjNcdTMwNjZcdTMwNDRcdTMwOEJcdTU4MzRcdTU0MDhcdTMwODJcdTMwNDJcdTMwOEJcblx0XHRjb25zdCBlbWJlZHMgPSBlbC5xdWVyeVNlbGVjdG9yQWxsKFwiLmludGVybmFsLWVtYmVkXCIpO1xuXHRcdGVtYmVkcy5mb3JFYWNoKChlbWJlZDogRWxlbWVudCkgPT4ge1xuXHRcdFx0Y29uc3QgYWx0ID0gZW1iZWQuZ2V0QXR0cmlidXRlKFwiYWx0XCIpO1xuXHRcdFx0aWYgKCFhbHQpIHJldHVybjtcblxuXHRcdFx0Y29uc3QgbWF0Y2ggPSBhbHQubWF0Y2goUEVSQ0VOVF9QQVRURVJOKTtcblx0XHRcdGlmICghbWF0Y2gpIHJldHVybjtcblxuXHRcdFx0Y29uc3QgcGVyY2VudCA9IHBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG5cdFx0XHRpZiAocGVyY2VudCA8IDEgfHwgcGVyY2VudCA+IDEwMCkgcmV0dXJuO1xuXG5cdFx0XHQvLyBlbWJlZCBcdTUxODVcdTMwNkVcdTc1M0JcdTUwQ0ZcdTMwNkJcdTMwQjlcdTMwQkZcdTMwQTRcdTMwRUJcdTMwOTJcdTkwNjlcdTc1MjhcdTMwNTlcdTMwOEJcblx0XHRcdGNvbnN0IGltZyA9IGVtYmVkLnF1ZXJ5U2VsZWN0b3IoXCJpbWdcIik7XG5cdFx0XHRpZiAoaW1nKSB7XG5cdFx0XHRcdGltZy5jbGFzc0xpc3QuYWRkKFwiYWR2YW5jZWQtaW1hZ2UtcGVyY2VudFwiKTtcblx0XHRcdFx0aW1nLnN0eWxlLndpZHRoID0gYCR7cGVyY2VudH0lYDtcblx0XHRcdFx0aW1nLnN0eWxlLm1heFdpZHRoID0gYCR7cGVyY2VudH0lYDtcblx0XHRcdFx0aW1nLnN0eWxlLmhlaWdodCA9IFwiYXV0b1wiO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9XG5cblx0Ly8gXHUzMEVGXHUzMEZDXHUzMEFGXHUzMEI5XHUzMERBXHUzMEZDXHUzMEI5XHU1MTY4XHU0RjUzXHUzMDZFXHU3NTNCXHU1MENGXHUzMDkyXHU1MThEXHUzMEI5XHUzMEFEXHUzMEUzXHUzMEYzXHUzMDU5XHUzMDhCXHVGRjA4XHU5MDIzXHU3RDlBXHU1QjlGXHU4ODRDXHUzMDkyXHU5NjMyXHUzMDUwXHU1MjM2XHU1RkExXHU0RUQ4XHUzMDREXHVGRjA5XG5cdGRlYm91bmNlZFNjYW5BbGwoKSB7XG5cdFx0aWYgKHRoaXMuZGVib3VuY2VUaW1lcikge1xuXHRcdFx0Y2xlYXJUaW1lb3V0KHRoaXMuZGVib3VuY2VUaW1lcik7XG5cdFx0fVxuXHRcdHRoaXMuZGVib3VuY2VUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuXHRcdFx0Y29uc3Qgd29ya3NwYWNlID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihcIi53b3Jrc3BhY2VcIik7XG5cdFx0XHRpZiAod29ya3NwYWNlKSB7XG5cdFx0XHRcdHRoaXMucHJvY2Vzc0ltYWdlcyh3b3Jrc3BhY2UgYXMgSFRNTEVsZW1lbnQpO1xuXHRcdFx0fVxuXHRcdH0sIDEwMCk7XG5cdH1cblxuXHQvLyBMaXZlIFByZXZpZXcgXHUzMEUyXHUzMEZDXHUzMEM5XHUzMDY3XHU3NTNCXHU1MENGXHUzMDkyXHU3NkUzXHU4OTk2XHUzMDU3XHUzMDY2XHU1MUU2XHU3NDA2XHUzMDU5XHUzMDhCXG5cdHNldHVwTGl2ZVByZXZpZXdPYnNlcnZlcigpIHtcblx0XHQvLyBcdTY1RTJcdTVCNThcdTMwNkVPYnNlcnZlclx1MzA5Mlx1NTA1Q1x1NkI2MlxuXHRcdGlmICh0aGlzLm9ic2VydmVyKSB7XG5cdFx0XHR0aGlzLm9ic2VydmVyLmRpc2Nvbm5lY3QoKTtcblx0XHR9XG5cblx0XHR0aGlzLm9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIoKG11dGF0aW9ucykgPT4ge1xuXHRcdFx0bGV0IG5lZWRzU2NhbiA9IGZhbHNlO1xuXHRcdFx0Zm9yIChjb25zdCBtdXRhdGlvbiBvZiBtdXRhdGlvbnMpIHtcblx0XHRcdFx0Ly8gXHU2NUIwXHUzMDU3XHUzMDRGXHU4RkZEXHU1MkEwXHUzMDU1XHUzMDhDXHUzMDVGXHUzMENFXHUzMEZDXHUzMEM5XHUzMDZFXHU0RTJEXHUzMDRCXHUzMDg5XHU3NTNCXHU1MENGXHUzMDkyXHU2M0EyXHUzMDU5XG5cdFx0XHRcdGlmIChtdXRhdGlvbi5hZGRlZE5vZGVzLmxlbmd0aCA+IDApIHtcblx0XHRcdFx0XHRtdXRhdGlvbi5hZGRlZE5vZGVzLmZvckVhY2goKG5vZGUpID0+IHtcblx0XHRcdFx0XHRcdGlmIChub2RlIGluc3RhbmNlb2YgSFRNTEVsZW1lbnQpIHtcblx0XHRcdFx0XHRcdFx0dGhpcy5wcm9jZXNzSW1hZ2VzKG5vZGUpO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH0pO1xuXHRcdFx0XHR9XG5cdFx0XHRcdC8vIFx1NUM1RVx1NjAyN1x1MzA0Q1x1NTkwOVx1MzA4Rlx1MzA2M1x1MzA1Rlx1NTgzNFx1NTQwOFx1RkYwOGFsdFx1MzBDNlx1MzBBRFx1MzBCOVx1MzBDOFx1MzA2RVx1NTkwOVx1NjZGNFx1MzA2QVx1MzA2OVx1RkYwOVx1MzA4Mlx1NTE4RFx1MzBCOVx1MzBBRFx1MzBFM1x1MzBGM1x1MzA1OVx1MzA4QlxuXHRcdFx0XHRpZiAobXV0YXRpb24udHlwZSA9PT0gXCJhdHRyaWJ1dGVzXCIpIHtcblx0XHRcdFx0XHRuZWVkc1NjYW4gPSB0cnVlO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRpZiAobmVlZHNTY2FuKSB7XG5cdFx0XHRcdHRoaXMuZGVib3VuY2VkU2NhbkFsbCgpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXG5cdFx0Ly8gXHUzMEVGXHUzMEZDXHUzMEFGXHUzMEI5XHUzMERBXHUzMEZDXHUzMEI5XHU1MTY4XHU0RjUzXHUzMDkyXHU3NkUzXHU4OTk2XHUzMDU5XHUzMDhCXG5cdFx0Y29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihcIi53b3Jrc3BhY2VcIik7XG5cdFx0aWYgKGNvbnRhaW5lcikge1xuXHRcdFx0dGhpcy5vYnNlcnZlci5vYnNlcnZlKGNvbnRhaW5lciwge1xuXHRcdFx0XHRjaGlsZExpc3Q6IHRydWUsXG5cdFx0XHRcdHN1YnRyZWU6IHRydWUsXG5cdFx0XHRcdC8vIFx1NUM1RVx1NjAyN1x1MzA2RVx1NTkwOVx1NjZGNFx1MzA4Mlx1NzZFM1x1ODk5Nlx1MzA1OVx1MzA4Qlx1RkYwOGFsdCwgc3JjIFx1MzA2QVx1MzA2OVx1MzA2RVx1NTkwOVx1NTMxNlx1MzA5Mlx1NjkxQ1x1NzdFNVx1MzA1OVx1MzA4Qlx1MzA1Rlx1MzA4MVx1RkYwOVxuXHRcdFx0XHRhdHRyaWJ1dGVzOiB0cnVlLFxuXHRcdFx0XHRhdHRyaWJ1dGVGaWx0ZXI6IFtcImFsdFwiLCBcInNyY1wiLCBcImNsYXNzXCJdLFxuXHRcdFx0fSk7XG5cdFx0fVxuXG5cdFx0Ly8gXHU2NUUyXHUzMDZCXHU4ODY4XHU3OTNBXHUzMDU1XHUzMDhDXHUzMDY2XHUzMDQ0XHUzMDhCXHU3NTNCXHU1MENGXHUzMDgyXHU1MUU2XHU3NDA2XHUzMDU5XHUzMDhCXG5cdFx0dGhpcy5kZWJvdW5jZWRTY2FuQWxsKCk7XG5cdH1cblxuXHQvLyBcdTczRkVcdTU3MjhcdTMwNkVcdTY1RTVcdTY2NDJcdTMwOTIgWVlZWS1NTS1ERF9ISC1tbS1zcyBcdTVGNjJcdTVGMEZcdTMwNjdcdThGRDRcdTMwNTlcblx0Z2V0Rm9ybWF0dGVkRGF0ZSgpOiBzdHJpbmcge1xuXHRcdGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG5cdFx0Y29uc3QgcGFkID0gKG46IG51bWJlcikgPT4gU3RyaW5nKG4pLnBhZFN0YXJ0KDIsIFwiMFwiKTtcblx0XHRyZXR1cm4gYCR7bm93LmdldEZ1bGxZZWFyKCl9LSR7cGFkKG5vdy5nZXRNb250aCgpICsgMSl9LSR7cGFkKG5vdy5nZXREYXRlKCkpfV8ke3BhZChub3cuZ2V0SG91cnMoKSl9LSR7cGFkKG5vdy5nZXRNaW51dGVzKCkpfS0ke3BhZChub3cuZ2V0U2Vjb25kcygpKX1gO1xuXHR9XG5cblx0Ly8gRGF0YVRyYW5zZmVyXHVGRjA4XHUzMEFGXHUzMEVBXHUzMEMzXHUzMEQ3XHUzMERDXHUzMEZDXHUzMEM5XHUzMDg0XHUzMEM5XHUzMEU5XHUzMEMzXHUzMEIwXHUzMEM3XHUzMEZDXHUzMEJGXHVGRjA5XHUzMDRCXHUzMDg5XHU3NTNCXHU1MENGXHUzMEQ1XHUzMEExXHUzMEE0XHUzMEVCXHUzMDkyXHU1M0Q2XHUzMDhBXHU1MUZBXHUzMDU5XG5cdGdldEltYWdlRmlsZUZyb21EYXRhVHJhbnNmZXIoZGF0YVRyYW5zZmVyOiBEYXRhVHJhbnNmZXIpOiBGaWxlIHwgbnVsbCB7XG5cdFx0Zm9yIChsZXQgaSA9IDA7IGkgPCBkYXRhVHJhbnNmZXIuaXRlbXMubGVuZ3RoOyBpKyspIHtcblx0XHRcdGNvbnN0IGl0ZW0gPSBkYXRhVHJhbnNmZXIuaXRlbXNbaV07XG5cdFx0XHRpZiAoaXRlbS5raW5kID09PSBcImZpbGVcIiAmJiBpdGVtLnR5cGUuc3RhcnRzV2l0aChcImltYWdlL1wiKSkge1xuXHRcdFx0XHRyZXR1cm4gaXRlbS5nZXRBc0ZpbGUoKTtcblx0XHRcdH1cblx0XHR9XG5cdFx0cmV0dXJuIG51bGw7XG5cdH1cblxuXHQvLyBcdTU0MENcdTU0MERcdTMwRDVcdTMwQTFcdTMwQTRcdTMwRUJcdTMwNENcdTMwNDJcdTMwOEJcdTU4MzRcdTU0MDhcdTMwMDFcdTY1NzBcdTVCNTdcdTMwQjVcdTMwRDVcdTMwQTNcdTMwQzNcdTMwQUZcdTMwQjlcdTMwOTJcdTRFRDhcdTMwNTFcdTMwNUZcdTMwRDFcdTMwQjlcdTMwOTJcdThGRDRcdTMwNTlcblx0YXN5bmMgZ2V0VW5pcXVlRmlsZVBhdGgoZm9sZGVyUGF0aDogc3RyaW5nLCBiYXNlTmFtZTogc3RyaW5nLCBleHQ6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG5cdFx0Y29uc3QgcHJlZml4ID0gZm9sZGVyUGF0aCA/IGAke2ZvbGRlclBhdGh9L2AgOiBcIlwiO1xuXHRcdGxldCBjYW5kaWRhdGUgPSBgJHtwcmVmaXh9JHtiYXNlTmFtZX0uJHtleHR9YDtcblx0XHRpZiAoIXRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChjYW5kaWRhdGUpKSB7XG5cdFx0XHRyZXR1cm4gY2FuZGlkYXRlO1xuXHRcdH1cblx0XHRsZXQgc3VmZml4ID0gMTtcblx0XHR3aGlsZSAodHJ1ZSkge1xuXHRcdFx0Y2FuZGlkYXRlID0gYCR7cHJlZml4fSR7YmFzZU5hbWV9XyR7c3VmZml4fS4ke2V4dH1gO1xuXHRcdFx0aWYgKCF0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoY2FuZGlkYXRlKSkge1xuXHRcdFx0XHRyZXR1cm4gY2FuZGlkYXRlO1xuXHRcdFx0fVxuXHRcdFx0c3VmZml4Kys7XG5cdFx0fVxuXHR9XG5cblx0Ly8gXHU3NTNCXHU1MENGXHUzMEQ1XHUzMEExXHUzMEE0XHUzMEVCXHUzMDkyVmF1bHRcdTMwNkJcdTRGRERcdTVCNThcdTMwNTdcdTMwNjZcdTMwMDFcdTMwRUFcdTMwRjNcdTMwQUZcdTMwOTJcdTMwQThcdTMwQzdcdTMwQTNcdTMwQkZcdTMwNkJcdTYzM0ZcdTUxNjVcdTMwNTlcdTMwOEJcblx0YXN5bmMgc2F2ZUltYWdlQW5kSW5zZXJ0TGluayhpbWFnZUZpbGU6IEZpbGUsIGVkaXRvcjogYW55KSB7XG5cdFx0Y29uc3QgZGVmYXVsdFBlcmNlbnQgPSB0aGlzLnNldHRpbmdzLmRlZmF1bHRQZXJjZW50O1xuXG5cdFx0dHJ5IHtcblx0XHRcdC8vIFx1NzNGRVx1NTcyOFx1MzA2RVx1MzBDRVx1MzBGQ1x1MzBDOFx1NjBDNVx1NTgzMVx1MzA5Mlx1NTNENlx1NUY5N1xuXHRcdFx0Y29uc3QgYWN0aXZlRmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG5cdFx0XHRjb25zdCBub3RlTmFtZSA9IGFjdGl2ZUZpbGUgPyBhY3RpdmVGaWxlLmJhc2VuYW1lIDogXCJ1bnRpdGxlZFwiO1xuXG5cdFx0XHQvLyBcdTMwRDVcdTMwQTFcdTMwQTRcdTMwRUJcdTU0MERcdTMwOTJcdTRGNUNcdTMwOEI6IFx1MzBDRVx1MzBGQ1x1MzBDOFx1NTQwRF9cdTY1RTVcdTY2NDIuXHU2MkUxXHU1RjM1XHU1QjUwXG5cdFx0XHRjb25zdCBkYXRlU3RyID0gdGhpcy5nZXRGb3JtYXR0ZWREYXRlKCk7XG5cdFx0XHQvLyBcdTUxNDNcdTMwNkVcdTYyRTFcdTVGMzVcdTVCNTBcdTMwOTJcdTUzRDZcdTVGOTdcdUZGMDhpbWFnZS9wbmcgXHUyMTkyIHBuZ1x1RkYwOVxuXHRcdFx0Y29uc3QgZXh0ID0gaW1hZ2VGaWxlLm5hbWUuc3BsaXQoXCIuXCIpLnBvcCgpIHx8IFwicG5nXCI7XG5cdFx0XHRjb25zdCBuZXdCYXNlTmFtZSA9IGAke25vdGVOYW1lfV8ke2RhdGVTdHJ9YDtcblxuXHRcdFx0Ly8gXHU0RkREXHU1QjU4XHU1MTQ4XHUzMEQ1XHUzMEE5XHUzMEVCXHUzMEMwXHUzMDkyXHU1M0Q2XHU1Rjk3XHVGRjA4T2JzaWRpYW5cdTMwNkVcdTZERkJcdTRFRDhcdTMwRDVcdTMwQTFcdTMwQTRcdTMwRUJcdThBMkRcdTVCOUFcdTMwOTJcdTRGN0ZcdTMwNDZcdUZGMDlcblx0XHRcdC8vIEB0cy1pZ25vcmUgLSBnZXRBdmFpbGFibGVQYXRoRm9yQXR0YWNobWVudHMgXHUzMDZGXHU1MTg1XHU5MEU4QVBJXHUzMDYwXHUzMDRDXHU1Qjg5XHU1QjlBXHUzMDU3XHUzMDY2XHU0RjdGXHUzMDQ4XHUzMDhCXG5cdFx0XHRjb25zdCBzYXZlUGF0aCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmdldEF2YWlsYWJsZVBhdGhGb3JBdHRhY2htZW50cyhuZXdCYXNlTmFtZSwgZXh0LCBhY3RpdmVGaWxlKTtcblxuXHRcdFx0Ly8gXHU3NTNCXHU1MENGXHUzMEM3XHUzMEZDXHUzMEJGXHUzMDkyXHU4QUFEXHUzMDdGXHU4RkJDXHUzMDgwXG5cdFx0XHRjb25zdCBhcnJheUJ1ZmZlciA9IGF3YWl0IGltYWdlRmlsZS5hcnJheUJ1ZmZlcigpO1xuXG5cdFx0XHQvLyBWYXVsdFx1MzA2Qlx1MzBENVx1MzBBMVx1MzBBNFx1MzBFQlx1MzA5Mlx1NEZERFx1NUI1OFx1MzA1OVx1MzA4QlxuXHRcdFx0Y29uc3Qgc2F2ZWRGaWxlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlQmluYXJ5KHNhdmVQYXRoLCBhcnJheUJ1ZmZlcik7XG5cblx0XHRcdC8vIFx1MzBENVx1MzBBMVx1MzBBNFx1MzBFQlx1NTQwRFx1MzA2MFx1MzA1MVx1NTNENlx1MzA4QVx1NTFGQVx1MzA1OVx1RkYwOFx1MzBENVx1MzBBOVx1MzBFQlx1MzBDMFx1MzBEMVx1MzBCOVx1MzA2Rlx1NEUwRFx1ODk4MVx1RkYwOVxuXHRcdFx0Y29uc3Qgc2F2ZWRGaWxlTmFtZSA9IHNhdmVkRmlsZS5uYW1lO1xuXG5cdFx0XHQvLyBcdTMwQThcdTMwQzdcdTMwQTNcdTMwQkZcdTMwNkJcdTMwRUFcdTMwRjNcdTMwQUZcdTMwOTJcdTYzM0ZcdTUxNjVcdTMwNTlcdTMwOEJcblx0XHRcdGNvbnN0IGxpbmtUZXh0ID0gYCFbWyR7c2F2ZWRGaWxlTmFtZX18JHtkZWZhdWx0UGVyY2VudH0lXV1gO1xuXHRcdFx0ZWRpdG9yLnJlcGxhY2VTZWxlY3Rpb24obGlua1RleHQpO1xuXG5cdFx0fSBjYXRjaCAoZSkge1xuXHRcdFx0bmV3IE5vdGljZShcIlx1NzUzQlx1NTBDRlx1MzA2RVx1NEZERFx1NUI1OFx1MzA2Qlx1NTkzMVx1NjU1N1x1MzA1N1x1MzA3RVx1MzA1N1x1MzA1RlwiKTtcblx0XHR9XG5cdH1cblxuXHQvLyBcdTMwQjNcdTMwRDRcdTMwRkNcdTY2NDJcdTMwNkJcdTMwMDFcdTMwQUJcdTMwRkNcdTMwQkRcdTMwRUJcdTg4NENcdTMwNENcdTc1M0JcdTUwQ0ZcdTMwRUFcdTMwRjNcdTMwQUZcdTMwNkFcdTMwODlcblx0Ly8gXHU2NzAwXHU1MjFEXHUzMDZCXHUzMEM2XHUzMEFEXHUzMEI5XHUzMEM4XHUzMDkyXHUzMEIzXHUzMEQ0XHUzMEZDIFx1MjE5MiBcdTVDMTFcdTMwNTdcdTVGOENcdTMwNkJcdTc1M0JcdTUwQ0ZcdTMwQzdcdTMwRkNcdTMwQkZcdTMwNjdcdTMwQUZcdTMwRUFcdTMwQzNcdTMwRDdcdTMwRENcdTMwRkNcdTMwQzlcdTMwOTJcdTRFMEFcdTY2RjhcdTMwNERcdTMwNTlcdTMwOEJcblx0YXN5bmMgaGFuZGxlSW1hZ2VDb3B5KGV2dDogQ2xpcGJvYXJkRXZlbnQpIHtcblx0XHQvLyBcdTMwQTJcdTMwQUZcdTMwQzZcdTMwQTNcdTMwRDZcdTMwNkFcdTMwQThcdTMwQzdcdTMwQTNcdTMwQkZcdTMwOTJcdTUzRDZcdTVGOTdcblx0XHRjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcblx0XHRpZiAoIXZpZXcpIHJldHVybjtcblx0XHRjb25zdCBlZGl0b3IgPSB2aWV3LmVkaXRvcjtcblxuXHRcdC8vIFx1OTA3OFx1NjI5RVx1N0JDNFx1NTZGMlx1MzA0Q1x1MzA0Mlx1MzA4Qlx1MzA0Qlx1MzBDMVx1MzBBN1x1MzBDM1x1MzBBRlxuXHRcdGNvbnN0IHNlbGVjdGlvbiA9IGVkaXRvci5nZXRTZWxlY3Rpb24oKTtcblx0XHQvLyBcdTMwQUJcdTMwRkNcdTMwQkRcdTMwRUJcdTMwNENcdTMwNDJcdTMwOEJcdTg4NENcdTMwNkVcdTMwQzZcdTMwQURcdTMwQjlcdTMwQzhcdTMwOTJcdTUzRDZcdTVGOTdcblx0XHRjb25zdCBjdXJzb3IgPSBlZGl0b3IuZ2V0Q3Vyc29yKCk7XG5cdFx0Y29uc3QgbGluZSA9IGVkaXRvci5nZXRMaW5lKGN1cnNvci5saW5lKTtcblxuXHRcdC8vIFx1OTA3OFx1NjI5RVx1N0JDNFx1NTZGMiBcdTMwN0VcdTMwNUZcdTMwNkYgXHU4ODRDXHU1MTY4XHU0RjUzXHUzMDRCXHUzMDg5XHU3NTNCXHU1MENGXHUzMEVBXHUzMEYzXHUzMEFGXHUzMDkyXHU2M0EyXHUzMDU5XG5cdFx0Y29uc3QgdGV4dFRvQ2hlY2sgPSBzZWxlY3Rpb24gfHwgbGluZTtcblx0XHRJTUFHRV9MSU5LX1BBVFRFUk4ubGFzdEluZGV4ID0gMDtcblx0XHRjb25zdCBtYXRjaCA9IElNQUdFX0xJTktfUEFUVEVSTi5leGVjKHRleHRUb0NoZWNrKTtcblx0XHRpZiAoIW1hdGNoKSByZXR1cm47XG5cblx0XHQvLyBcdTc1M0JcdTUwQ0ZcdTMwRUFcdTMwRjNcdTMwQUZcdTMwNENcdTg5OEJcdTMwNjRcdTMwNEJcdTMwNjNcdTMwNUZcblx0XHRjb25zdCBpbWFnZUZpbGVuYW1lID0gbWF0Y2hbMV07XG5cblx0XHQvLyBcdTc1M0JcdTUwQ0ZcdTMwRDVcdTMwQTFcdTMwQTRcdTMwRUJcdTMwOTJcdTYzQTJcdTMwNTlcblx0XHRjb25zdCBpbWFnZUZpbGUgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KGltYWdlRmlsZW5hbWUsIFwiXCIpO1xuXHRcdGlmICghaW1hZ2VGaWxlIHx8ICEoaW1hZ2VGaWxlIGluc3RhbmNlb2YgVEZpbGUpKSByZXR1cm47XG5cblx0XHQvLyBcdTMwQzdcdTMwRDVcdTMwQTlcdTMwRUJcdTMwQzhcdTMwNkVcdTMwQjNcdTMwRDRcdTMwRkNcdTMwOTJcdTZCNjJcdTMwODFcdTMwNjZcdTMwMDFcdTgxRUFcdTUyMDZcdTMwNjdcdTUxRTZcdTc0MDZcdTMwNTlcdTMwOEJcblx0XHRldnQucHJldmVudERlZmF1bHQoKTtcblxuXHRcdC8vIFx1MzBCM1x1MzBENFx1MzBGQ1x1MzA1OVx1MzA4Qlx1MzBDNlx1MzBBRFx1MzBCOVx1MzBDOFx1RkYwOFx1OTA3OFx1NjI5RVx1N0JDNFx1NTZGMlx1MzA0Q1x1MzA0Mlx1MzA4Q1x1MzA3MFx1MzA1RFx1MzA4Q1x1MzAwMVx1MzA2QVx1MzA1MVx1MzA4Q1x1MzA3MFx1ODg0Q1x1NTE2OFx1NEY1M1x1RkYwOVxuXHRcdGNvbnN0IHRleHRUb0NvcHkgPSBzZWxlY3Rpb24gfHwgbGluZTtcblxuXHRcdC8vIFx1MjQ2MCBcdTMwN0VcdTMwNUFcdTMwQzZcdTMwQURcdTMwQjlcdTMwQzhcdTMwOTJcdTMwQUZcdTMwRUFcdTMwQzNcdTMwRDdcdTMwRENcdTMwRkNcdTMwQzlcdTMwNkJcdTMwQjNcdTMwRDRcdTMwRkNcdTMwNTlcdTMwOEJcblx0XHRhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0ZXh0VG9Db3B5KTtcblx0XHRuZXcgTm90aWNlKFwiXHUzMEM2XHUzMEFEXHUzMEI5XHUzMEM4XHUzMDkyXHUzMEIzXHUzMEQ0XHUzMEZDXHUzMDU3XHUzMDdFXHUzMDU3XHUzMDVGXCIpO1xuXG5cdFx0Ly8gXHUyNDYxIDEuNVx1NzlEMlx1NUY4Q1x1MzA2Qlx1NzUzQlx1NTBDRlx1MzBDN1x1MzBGQ1x1MzBCRlx1MzA2N1x1MzBBRlx1MzBFQVx1MzBDM1x1MzBEN1x1MzBEQ1x1MzBGQ1x1MzBDOVx1MzA5Mlx1NEUwQVx1NjZGOFx1MzA0RFx1MzA1OVx1MzA4QlxuXHRcdHNldFRpbWVvdXQoYXN5bmMgKCkgPT4ge1xuXHRcdFx0dHJ5IHtcblx0XHRcdFx0Ly8gXHU3NTNCXHU1MENGXHUzMEQ1XHUzMEExXHUzMEE0XHUzMEVCXHUzMDZFXHUzMEQwXHUzMEE0XHUzMENBXHUzMEVBXHUzMEM3XHUzMEZDXHUzMEJGXHUzMDkyXHU4QUFEXHUzMDdGXHU4RkJDXHUzMDgwXG5cdFx0XHRcdGNvbnN0IGltYWdlRGF0YSA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWRCaW5hcnkoaW1hZ2VGaWxlKTtcblxuXHRcdFx0XHQvLyBcdTc1M0JcdTUwQ0ZcdTMwNkUgTUlNRSBcdTMwQkZcdTMwQTRcdTMwRDdcdTMwOTJcdTUyMjRcdTVCOUFcdTMwNTlcdTMwOEJcdUZGMDhcdTRGOEI6IGltYWdlL3BuZywgaW1hZ2UvanBlZ1x1RkYwOVxuXHRcdFx0XHRjb25zdCBleHQgPSBpbWFnZUZpbGUuZXh0ZW5zaW9uLnRvTG93ZXJDYXNlKCk7XG5cdFx0XHRcdGxldCBtaW1lVHlwZSA9IFwiaW1hZ2UvcG5nXCI7XG5cdFx0XHRcdGlmIChleHQgPT09IFwianBnXCIgfHwgZXh0ID09PSBcImpwZWdcIikgbWltZVR5cGUgPSBcImltYWdlL2pwZWdcIjtcblx0XHRcdFx0ZWxzZSBpZiAoZXh0ID09PSBcImdpZlwiKSBtaW1lVHlwZSA9IFwiaW1hZ2UvZ2lmXCI7XG5cdFx0XHRcdGVsc2UgaWYgKGV4dCA9PT0gXCJ3ZWJwXCIpIG1pbWVUeXBlID0gXCJpbWFnZS93ZWJwXCI7XG5cdFx0XHRcdGVsc2UgaWYgKGV4dCA9PT0gXCJibXBcIikgbWltZVR5cGUgPSBcImltYWdlL2JtcFwiO1xuXHRcdFx0XHRlbHNlIGlmIChleHQgPT09IFwic3ZnXCIpIG1pbWVUeXBlID0gXCJpbWFnZS9zdmcreG1sXCI7XG5cdFx0XHRcdGVsc2UgaWYgKGV4dCA9PT0gXCJhdmlmXCIpIG1pbWVUeXBlID0gXCJpbWFnZS9hdmlmXCI7XG5cblx0XHRcdFx0Ly8gXHUzMEFGXHUzMEVBXHUzMEMzXHUzMEQ3XHUzMERDXHUzMEZDXHUzMEM5XHUzMDkyXHU3NTNCXHU1MENGXHUzMEM3XHUzMEZDXHUzMEJGXHUzMDY3XHU0RTBBXHU2NkY4XHUzMDREXHUzMDU5XHUzMDhCXG5cdFx0XHRcdGNvbnN0IGNsaXBib2FyZEl0ZW0gPSBuZXcgQ2xpcGJvYXJkSXRlbSh7XG5cdFx0XHRcdFx0W21pbWVUeXBlXTogbmV3IEJsb2IoW2ltYWdlRGF0YV0sIHsgdHlwZTogbWltZVR5cGUgfSksXG5cdFx0XHRcdH0pO1xuXHRcdFx0XHRhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlKFtjbGlwYm9hcmRJdGVtXSk7XG5cdFx0XHRcdG5ldyBOb3RpY2UoXCJcdTc1M0JcdTUwQ0ZcdTMwOTJcdTMwQjNcdTMwRDRcdTMwRkNcdTMwNTdcdTMwN0VcdTMwNTdcdTMwNUZcIik7XG5cdFx0XHR9IGNhdGNoIChlKSB7XG5cdFx0XHRcdG5ldyBOb3RpY2UoXCJcdTc1M0JcdTUwQ0ZcdTMwNkVcdTMwQjNcdTMwRDRcdTMwRkNcdTMwNkJcdTU5MzFcdTY1NTdcdTMwNTdcdTMwN0VcdTMwNTdcdTMwNUZcIik7XG5cdFx0XHR9XG5cdFx0fSwgMTUwMCk7XG5cdH1cbn1cblxuLy8gXHU4QTJEXHU1QjlBXHU3NTNCXHU5NzYyXG5jbGFzcyBBZHZhbmNlZEltYWdlU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuXHRwbHVnaW46IEFkdmFuY2VkSW1hZ2VQbHVnaW47XG5cblx0Y29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogQWR2YW5jZWRJbWFnZVBsdWdpbikge1xuXHRcdHN1cGVyKGFwcCwgcGx1Z2luKTtcblx0XHR0aGlzLnBsdWdpbiA9IHBsdWdpbjtcblx0fVxuXG5cdGRpc3BsYXkoKTogdm9pZCB7XG5cdFx0Y29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcblx0XHRjb250YWluZXJFbC5lbXB0eSgpO1xuXG5cdFx0Ly8gXHUzMEM3XHUzMEQ1XHUzMEE5XHUzMEVCXHUzMEM4XHUzMDZFXHUzMEQxXHUzMEZDXHUzMEJCXHUzMEYzXHUzMEM4XHU1MDI0XG5cdFx0bmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG5cdFx0XHQuc2V0TmFtZShcIlx1MzBDN1x1MzBENVx1MzBBOVx1MzBFQlx1MzBDOFx1MzA2RVx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1NTAyNFwiKVxuXHRcdFx0LnNldERlc2MoXCJcdTc1M0JcdTUwQ0ZcdTMwOTJcdTMwREFcdTMwRkNcdTMwQjlcdTMwQzhcdTMwNTdcdTMwNUZcdTMwNjhcdTMwNERcdTMwMDFcdTgxRUFcdTUyRDVcdTMwNjdcdTRFRDhcdTMwNEZcdTMwRDFcdTMwRkNcdTMwQkJcdTMwRjNcdTMwQzhcdTUwMjRcdUZGMDgxMFx1MzAxQzEwMFx1RkYwOVwiKVxuXHRcdFx0LmFkZFNsaWRlcigoc2xpZGVyKSA9PlxuXHRcdFx0XHRzbGlkZXJcblx0XHRcdFx0XHQuc2V0TGltaXRzKDEwLCAxMDAsIDUpXG5cdFx0XHRcdFx0LnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmRlZmF1bHRQZXJjZW50KVxuXHRcdFx0XHRcdC5zZXREeW5hbWljVG9vbHRpcCgpXG5cdFx0XHRcdFx0Lm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuXHRcdFx0XHRcdFx0dGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFBlcmNlbnQgPSB2YWx1ZTtcblx0XHRcdFx0XHRcdGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuXHRcdFx0XHRcdH0pXG5cdFx0XHQpO1xuXG5cdFx0Ly8gXHUzMEUyXHUzMEQwXHUzMEE0XHUzMEVCXHUzMDY3XHU4MUVBXHU1MkQ1MTAwJVx1ODg2OFx1NzkzQVxuXHRcdG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuXHRcdFx0LnNldE5hbWUoXCJcdTMwRTJcdTMwRDBcdTMwQTRcdTMwRUJcdTMwNjdcdTgxRUFcdTUyRDUxMDAlXHU4ODY4XHU3OTNBXCIpXG5cdFx0XHQuc2V0RGVzYyhcIlx1NzUzQlx1OTc2Mlx1NUU0NVx1MzA0Q1x1NUMwRlx1MzA1NVx1MzA0NFx1MzBDN1x1MzBEMFx1MzBBNFx1MzBCOVx1MzA2N1x1MzA2Rlx1MzAwMVx1MzBEMVx1MzBGQ1x1MzBCQlx1MzBGM1x1MzBDOFx1NjMwN1x1NUI5QVx1MzA2Qlx1OTVBMlx1NEZDMlx1MzA2QVx1MzA0Rlx1NzUzQlx1NTBDRlx1MzA5MjEwMCVcdTVFNDVcdTMwNjdcdTg4NjhcdTc5M0FcdTMwNTdcdTMwN0VcdTMwNTlcIilcblx0XHRcdC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cblx0XHRcdFx0dG9nZ2xlXG5cdFx0XHRcdFx0LnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLm1vYmlsZUF1dG9GdWxsKVxuXHRcdFx0XHRcdC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcblx0XHRcdFx0XHRcdHRoaXMucGx1Z2luLnNldHRpbmdzLm1vYmlsZUF1dG9GdWxsID0gdmFsdWU7XG5cdFx0XHRcdFx0XHRhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcblx0XHRcdFx0XHR9KVxuXHRcdFx0KTtcblxuXHRcdC8vIFx1MzBFMlx1MzBEMFx1MzBBNFx1MzBFQlx1NTIyNFx1NUI5QVx1MzA2RVx1MzA1N1x1MzA0RFx1MzA0NFx1NTAyNFxuXHRcdG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuXHRcdFx0LnNldE5hbWUoXCJcdTMwRTJcdTMwRDBcdTMwQTRcdTMwRUJcdTUyMjRcdTVCOUFcdTMwNkVcdTc1M0JcdTk3NjJcdTVFNDVcdUZGMDhweFx1RkYwOVwiKVxuXHRcdFx0LnNldERlc2MoXCJcdTMwNTNcdTMwNkVcdTVFNDVcdTRFRTVcdTRFMEJcdTMwNkVcdTMwQzdcdTMwRDBcdTMwQTRcdTMwQjlcdTMwOTJcdTMwRTJcdTMwRDBcdTMwQTRcdTMwRUJcdTMwNjhcdTMwNTdcdTMwNjZcdTYyNzFcdTMwNDRcdTMwN0VcdTMwNTlcdUZGMDhcdTUyMURcdTY3MUZcdTUwMjQ6IDc2OFx1RkYwOVwiKVxuXHRcdFx0LmFkZFRleHQoKHRleHQpID0+XG5cdFx0XHRcdHRleHRcblx0XHRcdFx0XHQuc2V0UGxhY2Vob2xkZXIoXCI3NjhcIilcblx0XHRcdFx0XHQuc2V0VmFsdWUoU3RyaW5nKHRoaXMucGx1Z2luLnNldHRpbmdzLm1vYmlsZVRocmVzaG9sZCkpXG5cdFx0XHRcdFx0Lm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuXHRcdFx0XHRcdFx0Y29uc3QgbnVtID0gcGFyc2VJbnQodmFsdWUsIDEwKTtcblx0XHRcdFx0XHRcdGlmICghaXNOYU4obnVtKSAmJiBudW0gPiAwKSB7XG5cdFx0XHRcdFx0XHRcdHRoaXMucGx1Z2luLnNldHRpbmdzLm1vYmlsZVRocmVzaG9sZCA9IG51bTtcblx0XHRcdFx0XHRcdFx0YXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fSlcblx0XHRcdCk7XG5cdH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsc0JBQWtIO0FBYWxILElBQU0sbUJBQTBDO0FBQUEsRUFDL0MsZ0JBQWdCO0FBQUEsRUFDaEIsZ0JBQWdCO0FBQUEsRUFDaEIsaUJBQWlCO0FBQ2xCO0FBR0EsSUFBTSxrQkFBa0I7QUFNeEIsSUFBTSxxQkFBcUI7QUFFM0IsSUFBcUIsc0JBQXJCLGNBQWlELHVCQUFPO0FBQUEsRUFBeEQ7QUFBQTtBQUNDLG9CQUFrQztBQUNsQyxTQUFRLFVBQW1DO0FBQzNDLFNBQVEsV0FBb0M7QUFFNUM7QUFBQSxTQUFRLGdCQUFzRDtBQUFBO0FBQUEsRUFFOUQsTUFBTSxTQUFTO0FBRWQsVUFBTSxLQUFLLGFBQWE7QUFHeEIsU0FBSyxrQkFBa0I7QUFHdkIsU0FBSyw4QkFBOEIsQ0FBQyxJQUFpQixRQUFzQztBQUMxRixXQUFLLGNBQWMsRUFBRTtBQUFBLElBQ3RCLENBQUM7QUFHRCxTQUFLO0FBQUEsTUFDSixLQUFLLElBQUksVUFBVSxHQUFHLGlCQUFpQixNQUFNO0FBQzVDLGFBQUsseUJBQXlCO0FBQzlCLGFBQUssaUJBQWlCO0FBQUEsTUFDdkIsQ0FBQztBQUFBLElBQ0Y7QUFHQSxTQUFLO0FBQUEsTUFDSixLQUFLLElBQUksVUFBVSxHQUFHLHNCQUFzQixNQUFNO0FBQ2pELGFBQUssaUJBQWlCO0FBQUEsTUFDdkIsQ0FBQztBQUFBLElBQ0Y7QUFJQSxTQUFLO0FBQUEsTUFDSixLQUFLLElBQUksVUFBVSxHQUFHLGlCQUFpQixNQUFNO0FBQzVDLGFBQUssaUJBQWlCO0FBQUEsTUFDdkIsQ0FBQztBQUFBLElBQ0Y7QUFHQSxTQUFLLElBQUksVUFBVSxjQUFjLE1BQU07QUFDdEMsV0FBSyx5QkFBeUI7QUFDOUIsV0FBSyxpQkFBaUI7QUFBQSxJQUN2QixDQUFDO0FBSUQsU0FBSztBQUFBLE1BQ0osS0FBSyxJQUFJLFVBQVUsR0FBRyxnQkFBZ0IsQ0FBQyxLQUFxQixXQUFXO0FBQ3RFLFlBQUksQ0FBQyxJQUFJO0FBQWU7QUFFeEIsY0FBTSxZQUFZLEtBQUssNkJBQTZCLElBQUksYUFBYTtBQUNyRSxZQUFJLENBQUM7QUFBVztBQUVoQixZQUFJLGVBQWU7QUFDbkIsYUFBSyx1QkFBdUIsV0FBVyxNQUFNO0FBQUEsTUFDOUMsQ0FBQztBQUFBLElBQ0Y7QUFHQSxTQUFLO0FBQUEsTUFDSixLQUFLLElBQUksVUFBVSxHQUFHLGVBQWUsQ0FBQyxLQUFnQixXQUFXO0FBQ2hFLFlBQUksQ0FBQyxJQUFJO0FBQWM7QUFDdkIsY0FBTSxZQUFZLEtBQUssNkJBQTZCLElBQUksWUFBWTtBQUNwRSxZQUFJLENBQUM7QUFBVztBQUNoQixZQUFJLGVBQWU7QUFDbkIsYUFBSyx1QkFBdUIsV0FBVyxNQUFNO0FBQUEsTUFDOUMsQ0FBQztBQUFBLElBQ0Y7QUFJQSxTQUFLLGlCQUFpQixVQUFVLFFBQVEsQ0FBQyxRQUF3QjtBQUNoRSxXQUFLLGdCQUFnQixHQUFHO0FBQUEsSUFDekIsQ0FBQztBQUdELFNBQUssY0FBYyxJQUFJLHdCQUF3QixLQUFLLEtBQUssSUFBSSxDQUFDO0FBQUEsRUFDL0Q7QUFBQSxFQUVBLFdBQVc7QUFFVixRQUFJLEtBQUssU0FBUztBQUNqQixXQUFLLFFBQVEsT0FBTztBQUNwQixXQUFLLFVBQVU7QUFBQSxJQUNoQjtBQUVBLFFBQUksS0FBSyxVQUFVO0FBQ2xCLFdBQUssU0FBUyxXQUFXO0FBQ3pCLFdBQUssV0FBVztBQUFBLElBQ2pCO0FBRUEsUUFBSSxLQUFLLGVBQWU7QUFDdkIsbUJBQWEsS0FBSyxhQUFhO0FBQy9CLFdBQUssZ0JBQWdCO0FBQUEsSUFDdEI7QUFBQSxFQUNEO0FBQUEsRUFFQSxNQUFNLGVBQWU7QUFDcEIsU0FBSyxXQUFXLE9BQU8sT0FBTyxDQUFDLEdBQUcsa0JBQWtCLE1BQU0sS0FBSyxTQUFTLENBQUM7QUFBQSxFQUMxRTtBQUFBLEVBRUEsTUFBTSxlQUFlO0FBQ3BCLFVBQU0sS0FBSyxTQUFTLEtBQUssUUFBUTtBQUVqQyxTQUFLLGtCQUFrQjtBQUFBLEVBQ3hCO0FBQUE7QUFBQSxFQUdBLG9CQUFvQjtBQUVuQixRQUFJLEtBQUssU0FBUztBQUNqQixXQUFLLFFBQVEsT0FBTztBQUFBLElBQ3JCO0FBRUEsU0FBSyxVQUFVLFNBQVMsY0FBYyxPQUFPO0FBQzdDLFNBQUssUUFBUSxLQUFLO0FBRWxCLFFBQUksS0FBSyxTQUFTLGdCQUFnQjtBQUVqQyxXQUFLLFFBQVEsY0FBYztBQUFBLHlCQUNMLEtBQUssU0FBUyxlQUFlO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFPcEQsT0FBTztBQUNOLFdBQUssUUFBUSxjQUFjO0FBQUEsSUFDNUI7QUFFQSxhQUFTLEtBQUssWUFBWSxLQUFLLE9BQU87QUFBQSxFQUN2QztBQUFBO0FBQUEsRUFHQSxjQUFjLElBQWlCO0FBQzlCLFVBQU0sU0FBUyxHQUFHLGlCQUFpQixLQUFLO0FBQ3hDLFdBQU8sUUFBUSxDQUFDLFFBQTBCO0FBRXpDLFlBQU0sTUFBTSxJQUFJO0FBQ2hCLFVBQUksQ0FBQyxLQUFLO0FBR1QsWUFBSSxJQUFJLFVBQVUsU0FBUyx3QkFBd0IsR0FBRztBQUNyRCxjQUFJLFVBQVUsT0FBTyx3QkFBd0I7QUFDN0MsY0FBSSxNQUFNLFFBQVE7QUFDbEIsY0FBSSxNQUFNLFdBQVc7QUFDckIsY0FBSSxNQUFNLFNBQVM7QUFBQSxRQUNwQjtBQUNBO0FBQUEsTUFDRDtBQUVBLFlBQU0sUUFBUSxJQUFJLE1BQU0sZUFBZTtBQUN2QyxVQUFJLENBQUMsT0FBTztBQUVYLFlBQUksSUFBSSxVQUFVLFNBQVMsd0JBQXdCLEdBQUc7QUFDckQsY0FBSSxVQUFVLE9BQU8sd0JBQXdCO0FBQzdDLGNBQUksTUFBTSxRQUFRO0FBQ2xCLGNBQUksTUFBTSxXQUFXO0FBQ3JCLGNBQUksTUFBTSxTQUFTO0FBQUEsUUFDcEI7QUFDQTtBQUFBLE1BQ0Q7QUFFQSxZQUFNLFVBQVUsU0FBUyxNQUFNLENBQUMsR0FBRyxFQUFFO0FBQ3JDLFVBQUksVUFBVSxLQUFLLFVBQVU7QUFBSztBQUdsQyxVQUFJLFVBQVUsSUFBSSx3QkFBd0I7QUFDMUMsVUFBSSxNQUFNLFFBQVEsR0FBRyxPQUFPO0FBQzVCLFVBQUksTUFBTSxXQUFXLEdBQUcsT0FBTztBQUMvQixVQUFJLE1BQU0sU0FBUztBQUFBLElBQ3BCLENBQUM7QUFJRCxVQUFNLFNBQVMsR0FBRyxpQkFBaUIsaUJBQWlCO0FBQ3BELFdBQU8sUUFBUSxDQUFDLFVBQW1CO0FBQ2xDLFlBQU0sTUFBTSxNQUFNLGFBQWEsS0FBSztBQUNwQyxVQUFJLENBQUM7QUFBSztBQUVWLFlBQU0sUUFBUSxJQUFJLE1BQU0sZUFBZTtBQUN2QyxVQUFJLENBQUM7QUFBTztBQUVaLFlBQU0sVUFBVSxTQUFTLE1BQU0sQ0FBQyxHQUFHLEVBQUU7QUFDckMsVUFBSSxVQUFVLEtBQUssVUFBVTtBQUFLO0FBR2xDLFlBQU0sTUFBTSxNQUFNLGNBQWMsS0FBSztBQUNyQyxVQUFJLEtBQUs7QUFDUixZQUFJLFVBQVUsSUFBSSx3QkFBd0I7QUFDMUMsWUFBSSxNQUFNLFFBQVEsR0FBRyxPQUFPO0FBQzVCLFlBQUksTUFBTSxXQUFXLEdBQUcsT0FBTztBQUMvQixZQUFJLE1BQU0sU0FBUztBQUFBLE1BQ3BCO0FBQUEsSUFDRCxDQUFDO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFHQSxtQkFBbUI7QUFDbEIsUUFBSSxLQUFLLGVBQWU7QUFDdkIsbUJBQWEsS0FBSyxhQUFhO0FBQUEsSUFDaEM7QUFDQSxTQUFLLGdCQUFnQixXQUFXLE1BQU07QUFDckMsWUFBTSxZQUFZLFNBQVMsY0FBYyxZQUFZO0FBQ3JELFVBQUksV0FBVztBQUNkLGFBQUssY0FBYyxTQUF3QjtBQUFBLE1BQzVDO0FBQUEsSUFDRCxHQUFHLEdBQUc7QUFBQSxFQUNQO0FBQUE7QUFBQSxFQUdBLDJCQUEyQjtBQUUxQixRQUFJLEtBQUssVUFBVTtBQUNsQixXQUFLLFNBQVMsV0FBVztBQUFBLElBQzFCO0FBRUEsU0FBSyxXQUFXLElBQUksaUJBQWlCLENBQUMsY0FBYztBQUNuRCxVQUFJLFlBQVk7QUFDaEIsaUJBQVcsWUFBWSxXQUFXO0FBRWpDLFlBQUksU0FBUyxXQUFXLFNBQVMsR0FBRztBQUNuQyxtQkFBUyxXQUFXLFFBQVEsQ0FBQyxTQUFTO0FBQ3JDLGdCQUFJLGdCQUFnQixhQUFhO0FBQ2hDLG1CQUFLLGNBQWMsSUFBSTtBQUFBLFlBQ3hCO0FBQUEsVUFDRCxDQUFDO0FBQUEsUUFDRjtBQUVBLFlBQUksU0FBUyxTQUFTLGNBQWM7QUFDbkMsc0JBQVk7QUFBQSxRQUNiO0FBQUEsTUFDRDtBQUNBLFVBQUksV0FBVztBQUNkLGFBQUssaUJBQWlCO0FBQUEsTUFDdkI7QUFBQSxJQUNELENBQUM7QUFHRCxVQUFNLFlBQVksU0FBUyxjQUFjLFlBQVk7QUFDckQsUUFBSSxXQUFXO0FBQ2QsV0FBSyxTQUFTLFFBQVEsV0FBVztBQUFBLFFBQ2hDLFdBQVc7QUFBQSxRQUNYLFNBQVM7QUFBQTtBQUFBLFFBRVQsWUFBWTtBQUFBLFFBQ1osaUJBQWlCLENBQUMsT0FBTyxPQUFPLE9BQU87QUFBQSxNQUN4QyxDQUFDO0FBQUEsSUFDRjtBQUdBLFNBQUssaUJBQWlCO0FBQUEsRUFDdkI7QUFBQTtBQUFBLEVBR0EsbUJBQTJCO0FBQzFCLFVBQU0sTUFBTSxvQkFBSSxLQUFLO0FBQ3JCLFVBQU0sTUFBTSxDQUFDLE1BQWMsT0FBTyxDQUFDLEVBQUUsU0FBUyxHQUFHLEdBQUc7QUFDcEQsV0FBTyxHQUFHLElBQUksWUFBWSxDQUFDLElBQUksSUFBSSxJQUFJLFNBQVMsSUFBSSxDQUFDLENBQUMsSUFBSSxJQUFJLElBQUksUUFBUSxDQUFDLENBQUMsSUFBSSxJQUFJLElBQUksU0FBUyxDQUFDLENBQUMsSUFBSSxJQUFJLElBQUksV0FBVyxDQUFDLENBQUMsSUFBSSxJQUFJLElBQUksV0FBVyxDQUFDLENBQUM7QUFBQSxFQUN0SjtBQUFBO0FBQUEsRUFHQSw2QkFBNkIsY0FBeUM7QUFDckUsYUFBUyxJQUFJLEdBQUcsSUFBSSxhQUFhLE1BQU0sUUFBUSxLQUFLO0FBQ25ELFlBQU0sT0FBTyxhQUFhLE1BQU0sQ0FBQztBQUNqQyxVQUFJLEtBQUssU0FBUyxVQUFVLEtBQUssS0FBSyxXQUFXLFFBQVEsR0FBRztBQUMzRCxlQUFPLEtBQUssVUFBVTtBQUFBLE1BQ3ZCO0FBQUEsSUFDRDtBQUNBLFdBQU87QUFBQSxFQUNSO0FBQUE7QUFBQSxFQUdBLE1BQU0sa0JBQWtCLFlBQW9CLFVBQWtCLEtBQThCO0FBQzNGLFVBQU0sU0FBUyxhQUFhLEdBQUcsVUFBVSxNQUFNO0FBQy9DLFFBQUksWUFBWSxHQUFHLE1BQU0sR0FBRyxRQUFRLElBQUksR0FBRztBQUMzQyxRQUFJLENBQUMsS0FBSyxJQUFJLE1BQU0sc0JBQXNCLFNBQVMsR0FBRztBQUNyRCxhQUFPO0FBQUEsSUFDUjtBQUNBLFFBQUksU0FBUztBQUNiLFdBQU8sTUFBTTtBQUNaLGtCQUFZLEdBQUcsTUFBTSxHQUFHLFFBQVEsSUFBSSxNQUFNLElBQUksR0FBRztBQUNqRCxVQUFJLENBQUMsS0FBSyxJQUFJLE1BQU0sc0JBQXNCLFNBQVMsR0FBRztBQUNyRCxlQUFPO0FBQUEsTUFDUjtBQUNBO0FBQUEsSUFDRDtBQUFBLEVBQ0Q7QUFBQTtBQUFBLEVBR0EsTUFBTSx1QkFBdUIsV0FBaUIsUUFBYTtBQUMxRCxVQUFNLGlCQUFpQixLQUFLLFNBQVM7QUFFckMsUUFBSTtBQUVILFlBQU0sYUFBYSxLQUFLLElBQUksVUFBVSxjQUFjO0FBQ3BELFlBQU0sV0FBVyxhQUFhLFdBQVcsV0FBVztBQUdwRCxZQUFNLFVBQVUsS0FBSyxpQkFBaUI7QUFFdEMsWUFBTSxNQUFNLFVBQVUsS0FBSyxNQUFNLEdBQUcsRUFBRSxJQUFJLEtBQUs7QUFDL0MsWUFBTSxjQUFjLEdBQUcsUUFBUSxJQUFJLE9BQU87QUFJMUMsWUFBTSxXQUFXLE1BQU0sS0FBSyxJQUFJLE1BQU0sK0JBQStCLGFBQWEsS0FBSyxVQUFVO0FBR2pHLFlBQU0sY0FBYyxNQUFNLFVBQVUsWUFBWTtBQUdoRCxZQUFNLFlBQVksTUFBTSxLQUFLLElBQUksTUFBTSxhQUFhLFVBQVUsV0FBVztBQUd6RSxZQUFNLGdCQUFnQixVQUFVO0FBR2hDLFlBQU0sV0FBVyxNQUFNLGFBQWEsSUFBSSxjQUFjO0FBQ3RELGFBQU8saUJBQWlCLFFBQVE7QUFBQSxJQUVqQyxTQUFTLEdBQUc7QUFDWCxVQUFJLHVCQUFPLDBFQUFjO0FBQUEsSUFDMUI7QUFBQSxFQUNEO0FBQUE7QUFBQTtBQUFBLEVBSUEsTUFBTSxnQkFBZ0IsS0FBcUI7QUFFMUMsVUFBTSxPQUFPLEtBQUssSUFBSSxVQUFVLG9CQUFvQiw0QkFBWTtBQUNoRSxRQUFJLENBQUM7QUFBTTtBQUNYLFVBQU0sU0FBUyxLQUFLO0FBR3BCLFVBQU0sWUFBWSxPQUFPLGFBQWE7QUFFdEMsVUFBTSxTQUFTLE9BQU8sVUFBVTtBQUNoQyxVQUFNLE9BQU8sT0FBTyxRQUFRLE9BQU8sSUFBSTtBQUd2QyxVQUFNLGNBQWMsYUFBYTtBQUNqQyx1QkFBbUIsWUFBWTtBQUMvQixVQUFNLFFBQVEsbUJBQW1CLEtBQUssV0FBVztBQUNqRCxRQUFJLENBQUM7QUFBTztBQUdaLFVBQU0sZ0JBQWdCLE1BQU0sQ0FBQztBQUc3QixVQUFNLFlBQVksS0FBSyxJQUFJLGNBQWMscUJBQXFCLGVBQWUsRUFBRTtBQUMvRSxRQUFJLENBQUMsYUFBYSxFQUFFLHFCQUFxQjtBQUFRO0FBR2pELFFBQUksZUFBZTtBQUduQixVQUFNLGFBQWEsYUFBYTtBQUdoQyxVQUFNLFVBQVUsVUFBVSxVQUFVLFVBQVU7QUFDOUMsUUFBSSx1QkFBTywwRUFBYztBQUd6QixlQUFXLFlBQVk7QUFDdEIsVUFBSTtBQUVILGNBQU0sWUFBWSxNQUFNLEtBQUssSUFBSSxNQUFNLFdBQVcsU0FBUztBQUczRCxjQUFNLE1BQU0sVUFBVSxVQUFVLFlBQVk7QUFDNUMsWUFBSSxXQUFXO0FBQ2YsWUFBSSxRQUFRLFNBQVMsUUFBUTtBQUFRLHFCQUFXO0FBQUEsaUJBQ3ZDLFFBQVE7QUFBTyxxQkFBVztBQUFBLGlCQUMxQixRQUFRO0FBQVEscUJBQVc7QUFBQSxpQkFDM0IsUUFBUTtBQUFPLHFCQUFXO0FBQUEsaUJBQzFCLFFBQVE7QUFBTyxxQkFBVztBQUFBLGlCQUMxQixRQUFRO0FBQVEscUJBQVc7QUFHcEMsY0FBTSxnQkFBZ0IsSUFBSSxjQUFjO0FBQUEsVUFDdkMsQ0FBQyxRQUFRLEdBQUcsSUFBSSxLQUFLLENBQUMsU0FBUyxHQUFHLEVBQUUsTUFBTSxTQUFTLENBQUM7QUFBQSxRQUNyRCxDQUFDO0FBQ0QsY0FBTSxVQUFVLFVBQVUsTUFBTSxDQUFDLGFBQWEsQ0FBQztBQUMvQyxZQUFJLHVCQUFPLDhEQUFZO0FBQUEsTUFDeEIsU0FBUyxHQUFHO0FBQ1gsWUFBSSx1QkFBTyxnRkFBZTtBQUFBLE1BQzNCO0FBQUEsSUFDRCxHQUFHLElBQUk7QUFBQSxFQUNSO0FBQ0Q7QUFHQSxJQUFNLDBCQUFOLGNBQXNDLGlDQUFpQjtBQUFBLEVBR3RELFlBQVksS0FBVSxRQUE2QjtBQUNsRCxVQUFNLEtBQUssTUFBTTtBQUNqQixTQUFLLFNBQVM7QUFBQSxFQUNmO0FBQUEsRUFFQSxVQUFnQjtBQUNmLFVBQU0sRUFBRSxZQUFZLElBQUk7QUFDeEIsZ0JBQVksTUFBTTtBQUdsQixRQUFJLHdCQUFRLFdBQVcsRUFDckIsUUFBUSwwRUFBYyxFQUN0QixRQUFRLG1LQUFpQyxFQUN6QztBQUFBLE1BQVUsQ0FBQyxXQUNYLE9BQ0UsVUFBVSxJQUFJLEtBQUssQ0FBQyxFQUNwQixTQUFTLEtBQUssT0FBTyxTQUFTLGNBQWMsRUFDNUMsa0JBQWtCLEVBQ2xCLFNBQVMsT0FBTyxVQUFVO0FBQzFCLGFBQUssT0FBTyxTQUFTLGlCQUFpQjtBQUN0QyxjQUFNLEtBQUssT0FBTyxhQUFhO0FBQUEsTUFDaEMsQ0FBQztBQUFBLElBQ0g7QUFHRCxRQUFJLHdCQUFRLFdBQVcsRUFDckIsUUFBUSw0REFBZSxFQUN2QixRQUFRLDhOQUEwQyxFQUNsRDtBQUFBLE1BQVUsQ0FBQyxXQUNYLE9BQ0UsU0FBUyxLQUFLLE9BQU8sU0FBUyxjQUFjLEVBQzVDLFNBQVMsT0FBTyxVQUFVO0FBQzFCLGFBQUssT0FBTyxTQUFTLGlCQUFpQjtBQUN0QyxjQUFNLEtBQUssT0FBTyxhQUFhO0FBQUEsTUFDaEMsQ0FBQztBQUFBLElBQ0g7QUFHRCxRQUFJLHdCQUFRLFdBQVcsRUFDckIsUUFBUSw0RUFBZ0IsRUFDeEIsUUFBUSx5S0FBa0MsRUFDMUM7QUFBQSxNQUFRLENBQUMsU0FDVCxLQUNFLGVBQWUsS0FBSyxFQUNwQixTQUFTLE9BQU8sS0FBSyxPQUFPLFNBQVMsZUFBZSxDQUFDLEVBQ3JELFNBQVMsT0FBTyxVQUFVO0FBQzFCLGNBQU0sTUFBTSxTQUFTLE9BQU8sRUFBRTtBQUM5QixZQUFJLENBQUMsTUFBTSxHQUFHLEtBQUssTUFBTSxHQUFHO0FBQzNCLGVBQUssT0FBTyxTQUFTLGtCQUFrQjtBQUN2QyxnQkFBTSxLQUFLLE9BQU8sYUFBYTtBQUFBLFFBQ2hDO0FBQUEsTUFDRCxDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0Y7QUFDRDsiLAogICJuYW1lcyI6IFtdCn0K
