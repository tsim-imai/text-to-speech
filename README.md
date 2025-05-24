# Discord TTS Bridge

Discord テキストチャンネルのメッセージを **メモリベース音声処理** でリアルタイム読み上げするクロスプラットフォーム対応アプリケーションです。

## ✨ 特徴

- 🎯 **メモリベース高速処理**: 一時ファイル不要で高速音声合成・再生
- 🌐 **クロスプラットフォーム**: Windows・macOS 両対応
- 🎭 **複数TTS対応**: システムTTS (Windows SAPI/macOS TTS) + VOICEVOX
- 🔊 **デュアル出力**: 配信用（仮想デバイス）+ モニター用（実デバイス）同時再生
- ⚙️ **環境変数対応**: `.env` ファイルと CLI オプション両方をサポート
- 👥 **ユーザーフィルタリング**: 特定ユーザーのみ読み上げ可能
- 🎮 **配信特化設計**: OBS等の配信ソフトとの連携を重視

## 🚀 パフォーマンス向上

### 完全メモリベース処理
- ✅ **超高速**: ディスクI/O完全排除
- ✅ **ゼロファイル**: 一時ファイル作成完全不要
- ✅ **完全メモリ**: 音声データは全てメモリ内処理
- ✅ **プラットフォーム最適化**: 各OSの最適な方法で直接再生

### プラットフォーム別最適化
- **Windows WAV**: PowerShell MemoryStream による完全メモリ再生
- **macOS PCM**: afplay stdin による完全メモリ再生
- **VOICEVOX**: Buffer直接変換による完全メモリ処理

### 従来の問題点（完全解決）
- ❌ 一時ファイルの作成・削除による遅延 → ✅ **完全排除**
- ❌ ディスク容量の消費 → ✅ **完全排除**
- ❌ ファイルI/Oによるボトルネック → ✅ **完全排除**
- ❌ temp_audioディレクトリの作成 → ✅ **完全排除**

## 🛠️ インストール

### 前提条件

#### Windows
- **仮想音声ドライバ**: [VB-Audio Virtual Cable](https://vb-audio.com/Cable/)
- **PowerShell**: Windows 10/11 標準搭載
- **Windows SAPI**: 標準搭載（追加音声パックで音声追加可能）

#### macOS
- **仮想音声ドライバ**: [BlackHole 2ch](https://github.com/ExistentialAudio/BlackHole)
- **SwitchAudioSource**: `brew install switchaudio-osx`

### プロジェクトセットアップ

```bash
# リポジトリクローン
git clone <repository-url>
cd discord-tts-bridge

# 依存関係インストール
npm install

# 環境変数設定
cp env.example .env
# .env ファイルを編集
```

## ⚙️ 設定

### 環境変数（`.env`）

```env
# Discord設定
BOT_TOKEN="your_discord_bot_token_here"
CHANNEL_ID="your_text_channel_id_here"

# TTS設定
TTS_ENGINE="system"                    # system(OS標準) or voicevox
TTS_VOICE="Kyoko"                      # Windows: Haruka, Sayaka | macOS: Kyoko, Otoya
TTS_RATE="230"                         # 話速 (文字/分)
TTS_VOLUME="50"                        # 音量 (0-100)

# 音声出力設定
BLACKHOLE_DEVICE="BlackHole 2ch"       # Windows: "CABLE Input" | macOS: "BlackHole 2ch"
USE_AFPLAY="false"                     # macOS専用: afplayコマンド使用
ENABLE_DUAL_OUTPUT="false"             # デュアル出力有効化
SPEAKER_DEVICE=""                      # 実デバイス名（デュアル出力時）

# ユーザーフィルタリング
ALLOWED_USERS=""                       # 許可ユーザーID（カンマ区切り）

# VOICEVOX設定（TTS_ENGINE="voicevox"時）
VOICEVOX_HOST="localhost"
VOICEVOX_PORT="50021"
VOICEVOX_SPEAKER="3"                   # 3=ずんだもん(ノーマル)
VOICEVOX_SPEED="1.0"                   # 話速倍率
VOICEVOX_PITCH="0.0"                   # ピッチ調整
VOICEVOX_INTONATION="1.0"              # イントネーション
VOICEVOX_VOLUME="1.0"                  # 音量倍率
```

### 実行例

```bash
# 環境変数ベース実行
npm start

# CLI オプション併用
npx tsx src/index.ts --engine voicevox --voicevox-speaker 3

# VOICEVOXキャラクター一覧
npx tsx src/index.ts list-presets
```

## 🎮 配信者向けセットアップ

### 1. 基本設定（Windows）
```env
BOT_TOKEN="YOUR_BOT_TOKEN"
CHANNEL_ID="YOUR_CHANNEL_ID"
TTS_ENGINE="system"
TTS_VOICE="Haruka"
BLACKHOLE_DEVICE="CABLE Input"
ENABLE_DUAL_OUTPUT="true"
SPEAKER_DEVICE="スピーカー (Realtek High Definition Audio)"
```

### 2. VOICEVOX使用（ずんだもん）
```env
TTS_ENGINE="voicevox"
VOICEVOX_SPEAKER="3"
VOICEVOX_SPEED="1.2"
VOICEVOX_VOLUME="0.8"
```

### 3. モデレーター限定
```env
ALLOWED_USERS="123456789012345678,987654321098765432"
```

## 🎯 VOICEVOX キャラクター

| キー | キャラクター | スタイル | ID |
|------|-------------|----------|-----|
| `zundamon` | ずんだもん | ノーマル | 3 |
| `zundamon_amaama` | ずんだもん | あまあま | 1 |
| `zundamon_tuntun` | ずんだもん | ツンツン | 5 |
| `metan` | 四国めたん | ノーマル | 2 |
| `tsumugi` | 春日部つむぎ | ノーマル | 8 |
| `ryusei` | 青山龍星 | ノーマル | 13 |
| `hau` | 波音リツ | ノーマル | 10 |

## 🔧 CLI オプション

| オプション | 環境変数 | デフォルト | 説明 |
|-----------|----------|-----------|------|
| `-t, --token` | `BOT_TOKEN` | - | Discord Bot トークン |
| `-c, --channel` | `CHANNEL_ID` | - | テキストチャンネル ID |
| `-v, --voice` | `TTS_VOICE` | `Kyoko` | TTS 音声 |
| `-r, --rate` | `TTS_RATE` | `230` | 話速 (文字/分) |
| `--volume` | `TTS_VOLUME` | `50` | 音量 (0-100) |
| `-b, --blackhole` | `BLACKHOLE_DEVICE` | `BlackHole 2ch` | 仮想音声デバイス名 |
| `--afplay` | `USE_AFPLAY` | `false` | afplay使用 (macOS) |
| `-u, --allowed-users` | `ALLOWED_USERS` | - | 許可ユーザーID |
| `--enable-dual-output` | `ENABLE_DUAL_OUTPUT` | `false` | デュアル出力 |
| `--speaker-device` | `SPEAKER_DEVICE` | - | 実デバイス名 |
| `--engine` | `TTS_ENGINE` | `system` | TTSエンジン |
| `--voicevox-*` | `VOICEVOX_*` | 各種 | VOICEVOX設定 |

## 📋 動作確認

### システム TTS テスト
```bash
# Windows
npx tsx src/index.ts --engine system --voice "Haruka"

# macOS
npx tsx src/index.ts --engine system --voice "Kyoko"
```

### VOICEVOX テスト
```bash
# VOICEVOXサーバー起動後
npx tsx src/index.ts --engine voicevox --voicevox-speaker 3
```

## 🎛️ 音声デバイス設定

### Windows設定例
```
仮想デバイス: "CABLE Input (VB-Audio Virtual Cable)"
実デバイス: "スピーカー (Realtek High Definition Audio)"
```

### macOS設定例
```
仮想デバイス: "BlackHole 2ch"
実デバイス: "Built-in Output"
```

## 🚨 トラブルシューティング

### よくある問題

1. **仮想音声デバイスが見つからない**
   - Windows: VB-Audio Virtual Cable をインストール
   - macOS: BlackHole 2ch をインストール

2. **VOICEVOX接続エラー**
   - VOICEVOX アプリケーションが起動しているか確認
   - `http://localhost:50021` にアクセス可能か確認

3. **音声が再生されない**
   - デバイス名が正確か確認
   - 音声出力設定を確認

4. **Windows音声デバイス切り替えエラー**
   - **VOICEVOX使用時**: 音声デバイス切り替えは自動でスキップされます
   - **システムTTS使用時**: NirCmd のインストールを推奨
   ```bash
   # NirCmd ダウンロード: https://www.nirsoft.net/utils/nircmd.html
   # nircmd.exe をPATHに追加するか、プロジェクトフォルダに配置
   ```

5. **メモリベース処理エラー**
   - システムの空きメモリを確認
   - 大量のメッセージ同時処理を避ける

### Windows特有の対処法

#### VOICEVOX推奨設定
```env
# VOICEVOX使用時（音声デバイス切り替えなし）
TTS_ENGINE="voicevox"
VOICEVOX_SPEAKER="3"  # ずんだもん
# BLACKHOLE_DEVICE の設定は不要（切り替えスキップ）
```

#### システムTTS使用時
```env
# システムTTS使用時（NirCmd推奨）
TTS_ENGINE="system"
TTS_VOICE="Haruka"
BLACKHOLE_DEVICE="CABLE Input (VB-Audio Virtual Cable)"
# NirCmd インストール必須
```

### デバッグ実行
```bash
# 詳細ログ表示
DEBUG=* npx tsx src/index.ts

# デバイス一覧確認
npx tsx src/index.ts --list-devices
```

## 📜 ライセンス

MIT License

## 🤝 貢献

Issue や Pull Request をお待ちしています！

---

**🎉 メモリベース高速処理により、よりスムーズな配信体験をお楽しみください！**