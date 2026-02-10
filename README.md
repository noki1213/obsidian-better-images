> Japanese documentation is available below. (日本語ドキュメントは下部にあります)

# Better Images

An Obsidian plugin that lets you control image sizes using percentage values. Images pasted or dropped into notes automatically get a default size, and mobile devices display images at full width for readability.

## Features

### Percentage-based Image Sizing

Control image width by adding a percentage to the alt text of an image link.

Syntax: `![[image.png|50%]]`

- Supported values: 1% to 100%.
- Works in both Reading mode and Live Preview mode.
- Supported image formats: png, jpg, jpeg, gif, bmp, svg, webp, avif, heic, tif, tiff.
- Height adjusts automatically to maintain the aspect ratio.

### Auto-paste with Default Percentage

When you paste or drag-and-drop an image into a note, the plugin automatically:

- Saves the image to the vault's attachments folder.
- Inserts a link with the default percentage applied (e.g., `![[notename_2024-01-15_12-30-00.png|50%]]`).
- Names the file using the pattern: notename_datetime.extension.
- Handles duplicate filenames by adding a number suffix.

### Image Copy

When your cursor is on a line containing an image link and you copy (Ctrl/Cmd+C):

1. The text of the image link is copied to the clipboard first.
2. After a short delay, the actual image data overwrites the clipboard, so you can paste the image into other applications.
3. GIF files use a special copy method on macOS.
4. Supported formats for image data copy: png, jpg, jpeg, webp, bmp, svg, avif.

### Mobile Auto-Full Width

- On devices with small screens, images are automatically displayed at 100% width regardless of the percentage setting.
- This ensures images remain readable on mobile devices.
- The screen width threshold is configurable (default: 768px).
- Uses CSS media queries for responsive behavior.

### Live Preview Support

- Images are processed in real time as you edit in Live Preview mode.
- A MutationObserver watches for DOM changes in the workspace.
- Debounced scanning prevents excessive processing during rapid edits.

## Settings

- Default percentage: The percentage value automatically applied to pasted images (10 to 100, in steps of 5).
- Mobile auto 100% display: When enabled, images are shown at full width on small screens.
- Mobile screen width threshold: The screen width in pixels below which images are displayed at 100% (default: 768).

## Installation

### Via BRAT

1. Install the BRAT plugin.
2. Add `noki1213/obsidian-better-images` as a beta plugin.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create a folder named `obsidian-better-images` in your vault's `.obsidian/plugins/` directory.
3. Place the downloaded files in that folder.
4. Enable the plugin in Obsidian settings.

---

# Better Images

画像サイズをパーセント値で制御できる Obsidian プラグインです。ノートに貼り付けた画像には自動的にデフォルトサイズが設定され、モバイルデバイスでは読みやすいように画像が全幅で表示されます。

## 機能

### パーセント指定による画像サイズ変更

画像リンクの alt テキストにパーセント値を追加して、画像の幅を制御します。

書き方: `![[image.png|50%]]`

- 指定可能な値: 1% から 100%。
- 閲覧モードとライブプレビューモードの両方で動作します。
- 対応する画像形式: png, jpg, jpeg, gif, bmp, svg, webp, avif, heic, tif, tiff。
- 高さはアスペクト比を維持するように自動調整されます。

### デフォルトパーセントでの自動ペースト

画像をノートに貼り付けたりドラッグ&ドロップしたりすると、プラグインが自動的に以下を行います。

- Vault の添付ファイルフォルダに画像を保存します。
- デフォルトのパーセント値を適用したリンクを挿入します（例: `![[notename_2024-01-15_12-30-00.png|50%]]`）。
- ファイル名はノート名_日時.拡張子のパターンで付けられます。
- ファイル名が重複する場合は、数字のサフィックスが追加されます。

### 画像のコピー

カーソルが画像リンクを含む行にあるときにコピー（Ctrl/Cmd+C）すると:

1. まず画像リンクのテキストがクリップボードにコピーされます。
2. 少し後に、実際の画像データがクリップボードを上書きするため、他のアプリケーションに画像として貼り付けられます。
3. GIF ファイルは macOS で専用のコピー方法を使用します。
4. 画像データコピー対応フォーマット: png, jpg, jpeg, webp, bmp, svg, avif。

### モバイル自動全幅表示

- 画面幅が小さいデバイスでは、パーセント指定に関係なく画像が自動的に 100% 幅で表示されます。
- モバイルデバイスでの画像の視認性を確保します。
- 画面幅のしきい値は設定で変更できます（デフォルト: 768px）。
- CSS メディアクエリによるレスポンシブ対応です。

### ライブプレビュー対応

- ライブプレビューモードで編集中もリアルタイムで画像が処理されます。
- MutationObserver がワークスペースの DOM 変更を監視します。
- 高速な編集中の過剰処理を防ぐためにデバウンス制御されています。

## 設定

- デフォルトのパーセント値: 画像を貼り付けたときに自動で付くパーセント値（10 から 100、5刻み）。
- モバイルで自動100%表示: 有効にすると、小さい画面では画像が全幅で表示されます。
- モバイル判定の画面幅（px）: この幅以下のデバイスをモバイルとして扱います（デフォルト: 768）。

## インストール

### BRAT 経由

1. BRAT プラグインをインストールします。
2. `noki1213/obsidian-better-images` をベータプラグインとして追加します。

### 手動インストール

1. 最新リリースから `main.js`、`manifest.json`、`styles.css` をダウンロードします。
2. Vault の `.obsidian/plugins/` に `obsidian-better-images` フォルダを作成します。
3. ダウンロードしたファイルをそのフォルダに配置します。
4. Obsidian の設定でプラグインを有効にします。
