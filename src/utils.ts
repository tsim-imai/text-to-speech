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
    .replace(/[^\w\s-]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

// プラットフォーム検出
export const platform = {
  isMacOS: () => process.platform === 'darwin',
  isWindows: () => process.platform === 'win32',
  isLinux: () => process.platform === 'linux',
  current: () => process.platform,
};

// クロスプラットフォーム対応のパス区切り文字
export const pathSeparator = process.platform === 'win32' ? '\\' : '/';

// Windows用のコマンド実行ヘルパー
export function getShellCommand(command: string): { shell: string; args: string[] } {
  if (platform.isWindows()) {
    return {
      shell: 'powershell.exe',
      args: ['-Command', command],
    };
  }
  return {
    shell: '/bin/bash',
    args: ['-c', command],
  };
}

// Windows用の音声ファイル形式
export function getAudioFormat(): string {
  if (platform.isWindows()) {
    return 'wav'; // Windows Media Formatに対応
  }
  return 'aiff'; // macOSはAIFF
}

// プラットフォーム固有の設定
export const platformConfig = {
  macOS: {
    ttsCommand: 'say',
    audioSwitcher: 'SwitchAudioSource',
    defaultVirtualAudio: 'BlackHole 2ch',
    audioPlayer: 'afplay',
    supportedVoices: ['Kyoko', 'Otoya', 'O-ren'],
  },
  windows: {
    ttsCommand: 'powershell',
    audioSwitcher: 'nircmd', // NirCmd for audio switching
    defaultVirtualAudio: 'CABLE Input (VB-Audio Virtual Cable)',
    audioPlayer: 'powershell', // PowerShell media player
    supportedVoices: ['Haruka', 'Ayumi', 'Ichiro'], // Windows Japanese voices
  },
  linux: {
    ttsCommand: 'espeak',
    audioSwitcher: 'pactl',
    defaultVirtualAudio: 'pulse',
    audioPlayer: 'aplay',
    supportedVoices: ['default'],
  },
} as const; 