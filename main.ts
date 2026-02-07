import { Plugin, PluginSettingTab, App, Setting, MarkdownPostProcessorContext, MarkdownView, TFile, Notice } from "obsidian";

// プラグインの設定の型定義
interface AdvancedImageSettings {
	// デフォルトのパーセント値（画像ペースト時に自動で付く値）
	defaultPercent: number;
	// モバイルで自動100%表示にするかどうか
	mobileAutoFull: boolean;
	// モバイル判定の画面幅しきい値（px）
	mobileThreshold: number;
}

// 設定の初期値
const DEFAULT_SETTINGS: AdvancedImageSettings = {
	defaultPercent: 50,
	mobileAutoFull: true,
	mobileThreshold: 768,
};

// パーセント指定のパターン（例: "50%" や "image 50%"）
const PERCENT_PATTERN = /(\d{1,3})%$/;

// 画像の拡張子一覧
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "avif", "heic", "tif", "tiff"];

// 画像リンクのパターン: ![[ファイル名.拡張子]] または ![[ファイル名.拡張子|...]]
const IMAGE_LINK_PATTERN = /!\[\[([^\]|]+\.(png|jpg|jpeg|gif|bmp|svg|webp|avif|heic|tif|tiff))(\|[^\]]*)?\]\]/gi;

export default class AdvancedImagePlugin extends Plugin {
	settings: AdvancedImageSettings = DEFAULT_SETTINGS;
	private styleEl: HTMLStyleElement | null = null;
	private observer: MutationObserver | null = null;
	// 再スキャンが連続で走りすぎないよう制御するタイマー
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	async onload() {
		// 設定を読み込む
		await this.loadSettings();

		// モバイル用のCSS（メディアクエリ）を動的に追加
		this.updateMobileStyle();

		// Reading View（閲覧モード）で画像のパーセント表示を処理する
		this.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			this.processImages(el);
		});

		// Live Preview（編集モード）で画像のパーセント表示を処理する
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.setupLivePreviewObserver();
				this.debouncedScanAll();
			})
		);

		// ノートを切り替えたときにも再スキャンする
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.debouncedScanAll();
			})
		);

		// エディタの内容が変わったときにも再スキャンする
		// （Live Previewで |50% → |30% のように書き換えたときに反映するため）
		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				this.debouncedScanAll();
			})
		);

		// 初回の設定
		this.app.workspace.onLayoutReady(() => {
			this.setupLivePreviewObserver();
			this.debouncedScanAll();
		});

		// 画像をペーストしたとき、Obsidianのデフォルト処理を止めて
		// 自分で正しいファイル名で保存する（image-converter と同じ方式）
		this.registerEvent(
			this.app.workspace.on("editor-paste", (evt: ClipboardEvent, editor) => {
				if (!evt.clipboardData) return;
				// クリップボードに画像ファイルがあるか確認する
				const imageFile = this.getImageFileFromDataTransfer(evt.clipboardData);
				if (!imageFile) return;
				// Obsidianのデフォルトのペースト処理を止める
				evt.preventDefault();
				this.saveImageAndInsertLink(imageFile, editor);
			})
		);

		// 画像をドロップしたとき
		this.registerEvent(
			this.app.workspace.on("editor-drop", (evt: DragEvent, editor) => {
				if (!evt.dataTransfer) return;
				const imageFile = this.getImageFileFromDataTransfer(evt.dataTransfer);
				if (!imageFile) return;
				evt.preventDefault();
				this.saveImageAndInsertLink(imageFile, editor);
			})
		);

		// コピー（Cmd+C）したとき、カーソル行が画像リンクなら
		// テキストと画像データの両方をクリップボードに入れる
		this.registerDomEvent(document, "copy", (evt: ClipboardEvent) => {
			this.handleImageCopy(evt);
		});

		// 設定画面を追加
		this.addSettingTab(new AdvancedImageSettingTab(this.app, this));
	}

	onunload() {
		// プラグインを無効にしたとき、追加したスタイルを削除する
		if (this.styleEl) {
			this.styleEl.remove();
			this.styleEl = null;
		}
		// MutationObserverを停止する
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
		// タイマーを停止する
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
		// 設定変更時にモバイルスタイルを更新する
		this.updateMobileStyle();
	}

	// モバイル用のCSSを動的に生成して追加する
	updateMobileStyle() {
		// 既存のスタイル要素があれば削除
		if (this.styleEl) {
			this.styleEl.remove();
		}

		this.styleEl = document.createElement("style");
		this.styleEl.id = "advanced-image-mobile-style";

		if (this.settings.mobileAutoFull) {
			// モバイルではパーセント指定に関係なく100%幅で表示する
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
	processImages(el: HTMLElement) {
		const images = el.querySelectorAll("img");
		images.forEach((img: HTMLImageElement) => {
			// altテキストからパーセント値を取得する
			const alt = img.alt;
			if (!alt) {
				// altがない場合、パーセント指定が削除された可能性がある
				// 以前適用したスタイルをリセットする
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
				// パーセントパターンに一致しない場合もリセットする
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

			// パーセントに基づいて幅を設定する
			img.classList.add("advanced-image-percent");
			img.style.width = `${percent}%`;
			img.style.maxWidth = `${percent}%`;
			img.style.height = "auto";
		});

		// Live Preview では .internal-embed 要素の中に画像がある
		// .internal-embed の alt 属性にパーセント値が入っている場合もある
		const embeds = el.querySelectorAll(".internal-embed");
		embeds.forEach((embed: Element) => {
			const alt = embed.getAttribute("alt");
			if (!alt) return;

			const match = alt.match(PERCENT_PATTERN);
			if (!match) return;

			const percent = parseInt(match[1], 10);
			if (percent < 1 || percent > 100) return;

			// embed 内の画像にスタイルを適用する
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
				this.processImages(workspace as HTMLElement);
			}
		}, 100);
	}

	// Live Preview モードで画像を監視して処理する
	setupLivePreviewObserver() {
		// 既存のObserverを停止
		if (this.observer) {
			this.observer.disconnect();
		}

		this.observer = new MutationObserver((mutations) => {
			let needsScan = false;
			for (const mutation of mutations) {
				// 新しく追加されたノードの中から画像を探す
				if (mutation.addedNodes.length > 0) {
					mutation.addedNodes.forEach((node) => {
						if (node instanceof HTMLElement) {
							this.processImages(node);
						}
					});
				}
				// 属性が変わった場合（altテキストの変更など）も再スキャンする
				if (mutation.type === "attributes") {
					needsScan = true;
				}
			}
			if (needsScan) {
				this.debouncedScanAll();
			}
		});

		// ワークスペース全体を監視する
		const container = document.querySelector(".workspace");
		if (container) {
			this.observer.observe(container, {
				childList: true,
				subtree: true,
				// 属性の変更も監視する（alt, src などの変化を検知するため）
				attributes: true,
				attributeFilter: ["alt", "src", "class"],
			});
		}

		// 既に表示されている画像も処理する
		this.debouncedScanAll();
	}

	// 現在の日時を YYYY-MM-DD_HH-mm-ss 形式で返す
	getFormattedDate(): string {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
	}

	// DataTransfer（クリップボードやドラッグデータ）から画像ファイルを取り出す
	getImageFileFromDataTransfer(dataTransfer: DataTransfer): File | null {
		for (let i = 0; i < dataTransfer.items.length; i++) {
			const item = dataTransfer.items[i];
			if (item.kind === "file" && item.type.startsWith("image/")) {
				return item.getAsFile();
			}
		}
		return null;
	}

	// 同名ファイルがある場合、数字サフィックスを付けたパスを返す
	async getUniqueFilePath(folderPath: string, baseName: string, ext: string): Promise<string> {
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
	async saveImageAndInsertLink(imageFile: File, editor: any) {
		const defaultPercent = this.settings.defaultPercent;

		try {
			// 現在のノート情報を取得
			const activeFile = this.app.workspace.getActiveFile();
			const noteName = activeFile ? activeFile.basename : "untitled";

			// ファイル名を作る: ノート名_日時.拡張子
			const dateStr = this.getFormattedDate();
			// 元の拡張子を取得（image/png → png）
			const ext = imageFile.name.split(".").pop() || "png";
			const newBaseName = `${noteName}_${dateStr}`;

			// 保存先フォルダを取得（Obsidianの添付ファイル設定を使う）
			// @ts-ignore - getAvailablePathForAttachments は内部APIだが安定して使える
			const savePath = await this.app.vault.getAvailablePathForAttachments(newBaseName, ext, activeFile);

			// 画像データを読み込む
			const arrayBuffer = await imageFile.arrayBuffer();

			// Vaultにファイルを保存する
			const savedFile = await this.app.vault.createBinary(savePath, arrayBuffer);

			// ファイル名だけ取り出す（フォルダパスは不要）
			const savedFileName = savedFile.name;

			// エディタにリンクを挿入する
			const linkText = `![[${savedFileName}|${defaultPercent}%]]`;
			editor.replaceSelection(linkText);

		} catch (e) {
			new Notice("画像の保存に失敗しました");
		}
	}

	// コピー時に、カーソル行が画像リンクなら
	// 最初にテキストをコピー → 少し後に画像データでクリップボードを上書きする
	async handleImageCopy(evt: ClipboardEvent) {
		// アクティブなエディタを取得
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;

		// 選択範囲があるかチェック
		const selection = editor.getSelection();
		// カーソルがある行のテキストを取得
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		// 選択範囲 または 行全体から画像リンクを探す
		const textToCheck = selection || line;
		IMAGE_LINK_PATTERN.lastIndex = 0;
		const match = IMAGE_LINK_PATTERN.exec(textToCheck);
		if (!match) return;

		// 画像リンクが見つかった
		const imageFilename = match[1];

		// 画像ファイルを探す
		const imageFile = this.app.metadataCache.getFirstLinkpathDest(imageFilename, "");
		if (!imageFile || !(imageFile instanceof TFile)) return;

		// デフォルトのコピーを止めて、自分で処理する
		evt.preventDefault();

		// コピーするテキスト（選択範囲があればそれ、なければ行全体）
		const textToCopy = selection || line;

		// ① まずテキストをクリップボードにコピーする
		await navigator.clipboard.writeText(textToCopy);
		new Notice("テキストをコピーしました");

		// ② 1.5秒後に画像データでクリップボードを上書きする
		setTimeout(async () => {
			try {
				// 画像ファイルのバイナリデータを読み込む
				const imageData = await this.app.vault.readBinary(imageFile);

				// 画像の MIME タイプを判定する（例: image/png, image/jpeg）
				const ext = imageFile.extension.toLowerCase();
				let mimeType = "image/png";
				if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
				else if (ext === "gif") mimeType = "image/gif";
				else if (ext === "webp") mimeType = "image/webp";
				else if (ext === "bmp") mimeType = "image/bmp";
				else if (ext === "svg") mimeType = "image/svg+xml";
				else if (ext === "avif") mimeType = "image/avif";

				// クリップボードを画像データで上書きする
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

// 設定画面
class AdvancedImageSettingTab extends PluginSettingTab {
	plugin: AdvancedImagePlugin;

	constructor(app: App, plugin: AdvancedImagePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// デフォルトのパーセント値
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

		// モバイルで自動100%表示
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

		// モバイル判定のしきい値
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
