import { VoicevoxEngine, VOICEVOX_PRESETS } from './voicevox.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface SpeakerInfo {
  id: number;
  name: string;
  style: string;
  speaker_uuid: string;
  version: string;
  isPreset: boolean;
  presetKey?: string | undefined;
}

async function generateSpeakersList(): Promise<void> {
  console.log('🎤 VOICEVOX 話者一覧を取得中...');

  // VOICEVOX エンジンを初期化
  const voicevoxEngine = new VoicevoxEngine({
    host: 'localhost',
    port: 50021,
    speakerId: 3,
    speedScale: 1.0,
    pitchScale: 0.0,
    intonationScale: 1.0,
    volumeScale: 1.0,
  });

  try {
    // 接続確認
    const isConnected = await voicevoxEngine.checkConnection();
    if (!isConnected) {
      console.error('❌ VOICEVOX サーバーに接続できません');
      console.log('💡 VOICEVOX アプリケーションが起動していることを確認してください');
      console.log('💡 http://localhost:50021 にアクセス可能か確認してください');
      process.exit(1);
    }

    // 話者一覧を取得
    const speakers = await voicevoxEngine.getSpeakers();
    if (speakers.length === 0) {
      console.error('❌ 話者一覧を取得できませんでした');
      process.exit(1);
    }

    console.log(`✅ ${speakers.length} 人の話者を取得しました`);

    // プリセットマップを作成
    const presetMap = new Map<number, { key: string; name: string; style: string }>();
    for (const [key, preset] of Object.entries(VOICEVOX_PRESETS)) {
      presetMap.set(preset.id, { key, name: preset.name, style: preset.style });
    }

    // 話者情報を整理
    const speakerInfos: SpeakerInfo[] = [];
    for (const speaker of speakers) {
      for (const style of speaker.styles) {
        const preset = presetMap.get(style.id);
        speakerInfos.push({
          id: style.id,
          name: speaker.name,
          style: style.name,
          speaker_uuid: speaker.speaker_uuid,
          version: speaker.version,
          isPreset: !!preset,
          presetKey: preset?.key,
        });
      }
    }

    // ID順でソート
    speakerInfos.sort((a, b) => a.id - b.id);

    // マークダウンを生成
    const markdown = generateMarkdown(speakerInfos);

    // ファイルに保存
    const outputPath = join(process.cwd(), 'VOICEVOX_SPEAKERS.md');
    writeFileSync(outputPath, markdown, 'utf-8');

    console.log(`📝 話者一覧を保存しました: ${outputPath}`);
    console.log(`📊 総話者数: ${speakerInfos.length} 人`);
    console.log(`⭐ プリセット対応: ${speakerInfos.filter(s => s.isPreset).length} 人`);

  } catch (error) {
    console.error('❌ エラーが発生しました:', error);
    process.exit(1);
  }
}

function generateMarkdown(speakers: SpeakerInfo[]): string {
  const now = new Date().toLocaleString('ja-JP');
  
  let markdown = `# VOICEVOX 話者一覧

> 生成日時: ${now}  
> 総話者数: ${speakers.length} 人  
> プリセット対応: ${speakers.filter(s => s.isPreset).length} 人

## 📋 完全一覧表

| ID | 話者名 | スタイル | プリセット | UUID | バージョン |
|---:|--------|----------|------------|------|------------|
`;

  for (const speaker of speakers) {
    const presetInfo = speaker.isPreset 
      ? `✅ \`${speaker.presetKey}\``
      : '❌';
    
    markdown += `| ${speaker.id} | ${speaker.name} | ${speaker.style} | ${presetInfo} | \`${speaker.speaker_uuid.substring(0, 8)}...\` | ${speaker.version} |\n`;
  }

  // プリセット対応話者の詳細
  const presetSpeakers = speakers.filter(s => s.isPreset);
  if (presetSpeakers.length > 0) {
    markdown += `\n## ⭐ プリセット対応話者

| プリセットキー | ID | 話者名 | スタイル | 使用例 |
|---------------|---:|--------|----------|--------|
`;

    for (const speaker of presetSpeakers) {
      markdown += `| \`${speaker.presetKey}\` | ${speaker.id} | ${speaker.name} | ${speaker.style} | \`--voicevox-speaker ${speaker.id}\` |\n`;
    }
  }

  // 話者別グループ
  const speakerGroups = new Map<string, SpeakerInfo[]>();
  for (const speaker of speakers) {
    if (!speakerGroups.has(speaker.name)) {
      speakerGroups.set(speaker.name, []);
    }
    const group = speakerGroups.get(speaker.name);
    if (group) {
      group.push(speaker);
    }
  }

  markdown += `\n## 👥 話者別一覧

`;

  for (const [speakerName, styles] of speakerGroups) {
    markdown += `### ${speakerName}\n\n`;
    markdown += '| ID | スタイル | プリセット |\n';
    markdown += '|---:|----------|------------|\n';
    
    for (const style of styles.sort((a, b) => a.id - b.id)) {
      const presetInfo = style.isPreset 
        ? `✅ \`${style.presetKey}\``
        : '❌';
      markdown += `| ${style.id} | ${style.style} | ${presetInfo} |\n`;
    }
    markdown += '\n';
  }

  // 使用方法
  markdown += `## 🚀 使用方法

### 環境変数での設定
\`\`\`env
# ずんだもん（ノーマル）を使用
TTS_ENGINE=voicevox
VOICEVOX_SPEAKER=3

# 四国めたん（あまあま）を使用
TTS_ENGINE=voicevox
VOICEVOX_SPEAKER=0
\`\`\`

### CLI オプションでの設定
\`\`\`bash
# ずんだもん（ノーマル）
npx tsx src/index.ts --engine voicevox --voicevox-speaker 3

# 春日部つむぎ
npx tsx src/index.ts --engine voicevox --voicevox-speaker 8

# 青山龍星
npx tsx src/index.ts --engine voicevox --voicevox-speaker 13
\`\`\`

### プリセット一覧表示
\`\`\`bash
npx tsx src/index.ts list-presets
\`\`\`

## 📝 注意事項

- **ID** は VOICEVOX API で使用する話者IDです
- **プリセット** 対応話者は \`VOICEVOX_PRESETS\` で定義済みです
- **UUID** は話者の一意識別子です（省略表示）
- **バージョン** は話者モデルのバージョンです

## 🔗 関連リンク

- [VOICEVOX 公式サイト](https://voicevox.hiroshiba.jp/)
- [VOICEVOX API ドキュメント](http://localhost:50021/docs)
- [Discord TTS Bridge README](./README.md)

---

*このファイルは自動生成されました。最新情報は \`npm run generate-speakers\` で更新してください。*
`;

  return markdown;
}

// スクリプト実行
if (import.meta.url === `file://${process.argv[1]}`) {
  generateSpeakersList().catch(console.error);
}

export { generateSpeakersList }; 