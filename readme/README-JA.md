<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Skynet Logo" />

<h1>Skynet</h1>

<p>セルフホスト型 SSH 管理とリモートデスクトップアクセス</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
  日本語 ·
  <a href="README-KO.md">한국어</a> ·
  <a href="README-FR.md">Français</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  <a href="README-ES.md">Español</a> ·
  <a href="README-PT.md">Português</a> ·
  <a href="README-RU.md">Русский</a> ·
  <a href="README-AR.md">العربية</a> ·
  <a href="README-HI.md">हिन्दी</a> ·
  <a href="README-TR.md">Türkçe</a> ·
  <a href="README-VI.md">Tiếng Việt</a> ·
  <a href="README-IT.md">Italiano</a>
</p>

<p>
  <img src="https://img.shields.io/github/stars/Skynet-SSH/Skynet?style=flat&label=Stars&color=F39044&labelColor=1a1a1a" />
  <img src="https://img.shields.io/github/forks/Skynet-SSH/Skynet?style=flat&label=Forks&color=F39044&labelColor=1a1a1a" />
  <img src="https://img.shields.io/github/v/release/Skynet-SSH/Skynet?style=flat&label=Release&color=F39044&labelColor=1a1a1a&v=1" />
  <a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720?color=F39044&labelColor=1a1a1a" /></a>
</p>

<br />

<img src="../repo-images/Skynet Header.png" alt="Skynet Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>2025年9月1日に達成</sub>
</p>

</div>

<br />

## 概要

Skynetは、オープンソースで永久無料のセルフホスト型オールインワンサーバー管理プラットフォームです。単一の直感的なインターフェースを通じて、サーバーとインフラストラクチャを管理するマルチプラットフォームソリューションを提供します。Skynetは、SSHターミナルアクセス、リモートデスクトップ制御（RDP、VNC、Telnet）、SSHトンネリング機能、リモートSSHファイル管理、およびその他多くのツールを提供します。Skynetは、すべてのプラットフォームで利用可能なTermiusの完全無料でセルフホスト可能な代替ソリューションです。

<br />

## 機能

<table>
<tr>
<td width="50%" valign="top">

**SSHターミナルアクセス:**
ブラウザ風タブシステムによる分割画面対応（最大4パネル）のフル機能ターミナル。一般的なターミナルテーマ、フォント、その他のコンポーネントを含むターミナルカスタマイズに対応しています。

</td>
<td width="50%" valign="top">

**リモートデスクトップアクセス:**
ブラウザ上でRDP、VNC、Telnetをサポート、完全なカスタマイズと分割画面に対応しています。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSHトンネル管理:**
自動再接続とヘルスモニタリング、ローカル・リモート・ダイナミックSOCKSフォワーディングを備えたサーバー間SSHトンネルの作成・管理が可能です。デスクトップクライアント対サーバーのトンネル設定はデスクトップインストールごとにローカルに保存され、オプションのC2Sプリセットスナップショットをサーバーに保存・名前変更・読み込み・削除してクライアント間でローカルトンネル設定を移動できます。

</td>
<td width="50%" valign="top">

**リモートファイルマネージャー:**
コード、画像、音声、動画の表示・編集に対応し、リモートサーバー上のファイルを直接管理できます。sudo対応でファイルのアップロード、ダウンロード、名前変更、削除、移動をシームレスに実行できます。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker管理:**
コンテナの起動、停止、一時停止、削除。コンテナの統計情報を表示。docker execターミナルでコンテナを操作。PortainerやDockgeの代替ではなく、コンテナの作成よりも簡易的な管理を目的としています。

</td>
<td width="50%" valign="top">

**SSHホストマネージャー:**
タグやフォルダでSSH接続を保存、整理、管理し、再利用可能なログイン情報を簡単に保存しながらSSHキーのデプロイを自動化できます。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**サーバー統計:**
ほとんどのLinuxベースのサーバーで、CPU、メモリ、ディスク使用量、ネットワーク、アップタイム、システム情報、ファイアウォール、ポートモニターを表示できます。

</td>
<td width="50%" valign="top">

**ユーザー認証:**
管理者コントロールとOIDC（アクセス制御付き）および2FA（TOTP）対応による安全なユーザー管理。すべてのプラットフォームでアクティブなユーザーセッションを表示し、権限を取り消し可能。OIDC/ローカルアカウントの連携が可能です。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**RBAC:**
ロールを作成し、ユーザー/ロール間でホストを共有できます。

</td>
<td width="50%" valign="top">

**データベース暗号化:**
バックエンドは暗号化されたSQLiteデータベースファイルとして保存されます。詳細は[ドキュメント](https://docs.skynet.site/security)をご覧ください。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**ネットワークグラフ:**
ダッシュボードをカスタマイズして、SSH接続に基づくホームラボのネットワークをステータス表示付きで可視化できます。

</td>
<td width="50%" valign="top">

**SSHツール:**
ワンクリックで実行できる再利用可能なコマンドスニペットの作成。複数の開いているターミナルに対して同時にコマンドを実行できます。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**永続タブ:**
ユーザープロフィールで有効にすると、SSHセッションとタブがデバイス/更新をまたいで開いたまま保持されます。

</td>
<td width="50%" valign="top">

**多言語対応:**
約30言語の組み込みサポート（[Crowdin](https://docs.skynet.site/translations)で管理されています）。

</td>
</tr>
</table>

<br />

<details>
<summary><b>その他の機能</b></summary>
<br />

- **ダッシュボード** - ダッシュボードでサーバー情報を一目で確認できます
- **APIキー** - 自動化/CI用に有効期限付きのユーザースコープAPIキーを作成できます
- **データのエクスポート/インポート** - SSHホスト、認証情報、ファイルマネージャーデータのエクスポートとインポートが可能です
- **自動SSL設定** - HTTPSリダイレクト付きの組み込みSSL証明書生成・管理が可能です
- **モダンUI** - React、Tailwind CSS、Shadcnで構築された、デスクトップ/モバイル対応のクリーンなインターフェース。ライト、ダーク、Draculaなど、多くの異なるUIテーマから選択可能。URLルートで任意の接続をフルスクリーンで開くことができます。
- **コマンド履歴** - 過去に実行したSSHコマンドの自動補完と表示が可能です
- **クイック接続** - 接続データを保存せずにサーバーに接続できます
- **コマンドパレット** - 左Shiftキーを2回押すことで、キーボードからSSH接続に素早くアクセスできます
- **SSH機能充実** - ジャンプホスト、Warpgate、TOTPベースの接続、SOCKS5、ホストキー検証、パスワード自動入力、[OPKSSH](https://github.com/openpubkey/opkssh)、tmux、ポート敲き（port knocking）などに対応しています

</details>

<br />

## プラットフォーム対応

<table align="center">
<tr>
<th align="center">プラットフォーム</th>
<th align="center">配布形式</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>あらゆる最新ブラウザ（Chrome、Safari、Firefox）· PWA対応</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>ポータブル版 · MSIインストーラー · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>ポータブル版 · AUR · AppImage · Deb · Flatpak</td>
</tr>
<tr>
<td align="center"><b>macOS</b> <sub>x64/ia32, v12.0+</sub></td>
<td>Apple App Store · DMG · Homebrew</td>
</tr>
<tr>
<td align="center"><b>iOS/iPadOS</b> <sub>v15.1+</sub></td>
<td>Apple App Store · IPA</td>
</tr>
<tr>
<td align="center"><b>Android</b> <sub>v7.0+</sub></td>
<td>Google Play Store · APK</td>
</tr>
</table>

<br />

## スクリーンショット

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@SkynetSSH/videos)

<sub>YouTubeでアップデートの概要を視聴する</sub>

<br />
<br />

<table>
<tr>
<td><img src="../repo-images/Image 1.png" alt="Skynet Screenshot 1" width="400" /></td>
<td><img src="../repo-images/Image 2.png" alt="Skynet Screenshot 2" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 3.png" alt="Skynet Screenshot 3" width="400" /></td>
<td><img src="../repo-images/Image 4.png" alt="Skynet Screenshot 4" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 5.png" alt="Skynet Screenshot 5" width="400" /></td>
<td><img src="../repo-images/Image 6.png" alt="Skynet Screenshot 6" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 7.png" alt="Skynet Screenshot 7" width="400" /></td>
<td><img src="../repo-images/Image 8.png" alt="Skynet Screenshot 8" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 9.png" alt="Skynet Screenshot 9" width="400" /></td>
<td><img src="../repo-images/Image 10.png" alt="Skynet Screenshot 10" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 11.png" alt="Skynet Screenshot 11" width="400" /></td>
<td><img src="../repo-images/Image 12.png" alt="Skynet Screenshot 12" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 13.png" alt="Skynet Screenshot 13" width="400" /></td>
<td><img src="../repo-images/Image 14.png" alt="Skynet Screenshot 14" width="400" /></td>
</tr>
</table>

<sub>動画や画像の一部は最新ではない場合や、機能を完全に紹介できていない場合があります。</sub>

</div>

<br />

## 予定されている機能

すべての予定機能については[Projects](https://github.com/orgs/Skynet-SSH/projects/2)をご覧ください。コントリビュートをご希望の方は[Contributing](https://github.com/Skynet-SSH/Skynet/blob/main/CONTRIBUTING.md)をご覧ください。

<br />

## スポンサー

<div align="center">

<br />

<a href="https://www.digitalocean.com/">
  <img src="https://opensource.nyc3.cdn.digitaloceanspaces.com/attribution/assets/SVG/DO_Logo_horizontal_blue.svg" height="40" alt="DigitalOcean" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://crowdin.com/">
  <img src="https://support.crowdin.com/assets/logos/core-logo/svg/crowdin-core-logo-cDark.svg" height="40" alt="Crowdin" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.blacksmith.sh/">
  <img src="https://cdn.prod.website-files.com/681bfb0c9a4601bc6e288ec4/683ca9e2c5186757092611b8_e8cb22127df4da0811c4120a523722d2_logo-backsmith-wordmark-light.svg" height="40" alt="Blacksmith" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.cloudflare.com/">
  <img src="https://sirv.sirv.com/website/screenshots/cloudflare/cloudflare-logo.png?w=300" height="40" alt="Cloudflare" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://tailscale.com/">
  <img src="https://drive.google.com/uc?export=view&id=1lIxkJuX6M23bW-2FElhT0rQieTrzaVSL" height="40" alt="Tailscale" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://akamai.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/8/8b/Akamai_logo.svg" height="40" alt="Akamai" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://aws.amazon.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Amazon_Web_Services_Logo.svg/960px-Amazon_Web_Services_Logo.svg.png" height="40" alt="AWS" />
</a>

</div>

<br />

## サポート

Skynetに関するヘルプや機能リクエストが必要な場合は、[Issues](https://github.com/Skynet-SSH/Support/issues)ページにアクセスし、ログインして`New Issue`を押してください。Issueはできるだけ詳細に記述し、英語での記述が望ましいです。また、[Discord](https://discord.gg/jVQGdvHDrf)サーバーに参加してサポートチャンネルを利用することもできますが、応答時間が長くなる場合があります。

<br />

## ライセンス

Apache License Version 2.0のもとで配布されています。詳細は`LICENSE`をご覧ください。
