import winston from 'winston';

// ロガーのセットアップ
export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'discord-tts-bridge.log' })
  ],
});

// メッセージのテキスト処理
export function cleanMessageText(text: string): string | null {
  // 空文字列や空白のみは除外
  if (!text.trim()) {
    return null;
  }

  // # で始まる行は読み上げない
  if (text.startsWith('#')) {
    return null;
  }

  // URL を "リンク" に置換
  let cleanedText = text.replace(
    /https?:\/\/[^\s]+/g,
    'リンク'
  );

  // Discord メンションを置換
  cleanedText = cleanedText.replace(/<@!?(\d+)>/g, 'ユーザー');
  cleanedText = cleanedText.replace(/<@&(\d+)>/g, 'ロール');
  cleanedText = cleanedText.replace(/<#(\d+)>/g, 'チャンネル');

  // 改行を句読点に置換
  cleanedText = cleanedText.replace(/\n+/g, '。');

  // 絵文字を削除（基本的なUnicode絵文字）
  cleanedText = cleanedText.replace(/[\u{1F600}-\u{1F64F}]/gu, '');
  cleanedText = cleanedText.replace(/[\u{1F300}-\u{1F5FF}]/gu, '');
  cleanedText = cleanedText.replace(/[\u{1F680}-\u{1F6FF}]/gu, '');
  cleanedText = cleanedText.replace(/[\u{2600}-\u{26FF}]/gu, '');
  cleanedText = cleanedText.replace(/[\u{2700}-\u{27BF}]/gu, '');

  return cleanedText.trim();
}

// 睡眠関数
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ファイル名を安全にする
export function sanitizeFilename(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '_')
    .substring(0, 50);
} 