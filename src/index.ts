#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';
import { DiscordTTSClient } from './discord.js';
import { TTSEngine, type TTSOptions, type UnifiedTTSOptions } from './tts.js';
import { AudioPlayer } from './audio.js';
import { logger, sleep, platform } from './utils.js';
import { VOICEVOX_PRESETS } from './voicevox.js';

// 環境変数読み込み
dotenv.config();

interface AppOptions {
  token: string;
  channel: string;
  voice: string;
  rate: number;
  volume: number;
  blackhole: string;
  useAfplay: boolean;
  allowedUserIds?: string[]; // 許可されたユーザーIDの配列
  enableDualOutput?: boolean; // デュアル出力を有効にする
  speakerDevice?: string; // 追加で再生するスピーカーデバイス名
  engine: 'system' | 'voicevox'; // TTSエンジン選択
  voicevoxHost: string; // VOICEVOXホスト
  voicevoxPort: number; // VOICEVOXポート
  voicevoxSpeaker: number; // VOICEVOXスピーカーID
  voicevoxSpeed: number; // VOICEVOX話速
  voicevoxPitch: number; // VOICEVOXピッチ
  voicevoxIntonation: number; // VOICEVOXイントネーション
  voicevoxVolume: number; // VOICEVOX音量
}

class DiscordTTSBridge {
  private discordClient: DiscordTTSClient;
  private ttsEngine: TTSEngine;
  private audioPlayer: AudioPlayer;
  private options: AppOptions;
  private isProcessing = false;

  constructor(options: AppOptions) {
    this.options = options;
    
    // TTS エンジン初期化
    const ttsOptions: Partial<UnifiedTTSOptions> = {
      engine: options.engine,
      voice: options.voice,
      rate: options.rate,
      volume: options.volume,
    };

    if (options.engine === 'voicevox') {
      ttsOptions.voicevoxOptions = {
        host: options.voicevoxHost,
        port: options.voicevoxPort,
        speakerId: options.voicevoxSpeaker,
        speedScale: options.voicevoxSpeed,
        pitchScale: options.voicevoxPitch,
        intonationScale: options.voicevoxIntonation,
        volumeScale: options.voicevoxVolume,
      };
    }

    this.ttsEngine = new TTSEngine(ttsOptions);
    
    // オーディオプレイヤー初期化
    this.audioPlayer = new AudioPlayer({
      blackholeDevice: options.blackhole,
      ...(options.enableDualOutput && { enableDualOutput: options.enableDualOutput }),
      ...(options.speakerDevice && { speakerDevice: options.speakerDevice }),
    });

    // Discord クライアント初期化
    this.discordClient = new DiscordTTSClient({
      token: options.token,
      channelId: options.channel,
      onMessage: this.handleMessage.bind(this),
      ...(options.allowedUserIds && { allowedUserIds: options.allowedUserIds }),
    });
  }

  private async handleMessage(text: string, author: string): Promise<void> {
    if (this.isProcessing) {
      logger.warn('他のメッセージを処理中のため、スキップします');
      return;
    }

    this.isProcessing = true;
    let audioFilePath: string | undefined;

    try {
      // TTS 合成
      const ttsOptions: TTSOptions = {
        voice: this.options.voice,
        rate: this.options.rate,
        volume: this.options.volume,
      };

      audioFilePath = await this.ttsEngine.synthesize(text, ttsOptions);

      // BlackHole デバイスに切り替え
      await this.audioPlayer.switchToBlackHole();

      // 音声再生
      if (this.options.useAfplay) {
        await this.audioPlayer.playWithAfplay(audioFilePath);
      } else if (this.options.enableDualOutput) {
        await this.audioPlayer.playWithDualOutput(audioFilePath);
      } else {
        await this.audioPlayer.playAudio(audioFilePath);
      }

      logger.info(`読み上げ完了: [${author}] ${text.substring(0, 50)}...`);

    } catch (error) {
      logger.error(`メッセージ処理エラー: ${error}`);
    } finally {
      // 一時ファイル削除
      if (audioFilePath) {
        await this.ttsEngine.cleanupFile(audioFilePath);
      }
      this.isProcessing = false;
    }
  }

  async start(): Promise<void> {
    try {
      logger.info('=== Discord TTS Bridge 開始 ===');
      logger.info(`プラットフォーム: ${platform.current()}`);
      logger.info(`使用エンジン: ${this.ttsEngine.getEngineInfo()}`);
      
      // 許可ユーザー設定をログ出力
      if (this.options.allowedUserIds?.length) {
        logger.info(`読み上げ許可ユーザー: ${this.options.allowedUserIds.length} 人`);
      }
      
      // 前提条件チェック
      await this.checkPrerequisites();
      
      // Discord 接続
      await this.discordClient.connect();
      
      logger.info('アプリケーション準備完了。Ctrl+C で終了します。');
      
      // 終了シグナル処理
      process.on('SIGINT', () => {
        logger.info('終了信号を受信しました...');
        void this.shutdown();
      });

      process.on('SIGTERM', () => {
        logger.info('終了信号を受信しました...');
        void this.shutdown();
      });

    } catch (error) {
      logger.error(`アプリケーション開始エラー: ${error}`);
      process.exit(1);
    }
  }

  private async checkPrerequisites(): Promise<void> {
    logger.info('前提条件をチェック中...');

    // TTSエンジンの可用性チェック
    const engineAvailability = await this.ttsEngine.checkEngineAvailability();
    logger.info(`TTSエンジン可用性: システム=${engineAvailability.system}, VOICEVOX=${engineAvailability.voicevox}`);

    if (this.options.engine === 'voicevox' && !engineAvailability.voicevox) {
      logger.warn('VOICEVOXが利用できません。システムTTSにフォールバックします。');
    }

    // 仮想音声デバイス確認
    const virtualAudioExists = await this.audioPlayer.checkBlackHoleInstalled();
    if (!virtualAudioExists) {
      logger.warn(`仮想音声デバイス "${this.options.blackhole}" が見つかりません`);
      const devices = await this.audioPlayer.listOutputDevices();
      logger.info('利用可能な出力デバイス:', devices);
      
      if (platform.isWindows()) {
        logger.info('Windows用仮想音声ドライバのインストールを推奨: VB-Audio Virtual Cable');
      } else if (platform.isMacOS()) {
        logger.info('macOS用仮想音声ドライバのインストールを推奨: BlackHole 2ch');
      }
    }

    // TTS 音声確認
    const voices = await this.ttsEngine.getAvailableVoices();
    if (this.options.engine === 'system' && !voices.includes(this.options.voice)) {
      logger.warn(`音声 "${this.options.voice}" が見つかりません`);
      logger.info('利用可能な音声:', voices.slice(0, 10));
    }

    logger.info('前提条件チェック完了');
  }

  private async shutdown(): Promise<void> {
    logger.info('アプリケーションを終了中...');
    
    try {
      await this.discordClient.disconnect();
      await sleep(1000);
      logger.info('正常に終了しました');
      process.exit(0);
    } catch (error) {
      logger.error(`終了エラー: ${error}`);
      process.exit(1);
    }
  }
}

// CLI 設定
const program = new Command();

program
  .name('discord-tts-bridge')
  .description('Discord テキストチャンネルのメッセージを macOS TTS または VOICEVOX で読み上げるアプリ')
  .version('1.0.0')
  .option('-t, --token <token>', 'Discord Bot トークン', process.env['BOT_TOKEN'])
  .option('-c, --channel <id>', 'テキストチャンネル ID', process.env['CHANNEL_ID'])
  .option('-v, --voice <voice>', 'TTS 音声', process.env['TTS_VOICE'] || 'Kyoko')
  .option('-r, --rate <rate>', '話速 (文字/分)', process.env['TTS_RATE'] || '230')
  .option('--volume <volume>', '音量 (0-100)', process.env['TTS_VOLUME'] || '50')
  .option('-b, --blackhole <device>', 'BlackHole デバイス名', process.env['BLACKHOLE_DEVICE'] || 'BlackHole 2ch')
  .option('--afplay', 'afplay コマンドを使用', process.env['USE_AFPLAY'] === 'true')
  .option('-u, --allowed-users <users>', '読み上げを許可するユーザーID（カンマ区切り）', process.env['ALLOWED_USERS'] || '')
  .option('--enable-dual-output', 'デュアル出力を有効にする', process.env['ENABLE_DUAL_OUTPUT'] === 'true')
  .option('--speaker-device <device>', '追加で再生するスピーカーデバイス名', process.env['SPEAKER_DEVICE'])
  .option('--engine <engine>', 'TTSエンジン (system/voicevox)', process.env['TTS_ENGINE'] || 'system')
  .option('--voicevox-host <host>', 'VOICEVOXホスト', process.env['VOICEVOX_HOST'] || 'localhost')
  .option('--voicevox-port <port>', 'VOICEVOXポート', process.env['VOICEVOX_PORT'] || '50021')
  .option('--voicevox-speaker <id>', 'VOICEVOXスピーカーID', process.env['VOICEVOX_SPEAKER'] || '3')
  .option('--voicevox-speed <speed>', 'VOICEVOX話速倍率', process.env['VOICEVOX_SPEED'] || '1.0')
  .option('--voicevox-pitch <pitch>', 'VOICEVOXピッチ調整', process.env['VOICEVOX_PITCH'] || '0.0')
  .option('--voicevox-intonation <intonation>', 'VOICEVOXイントネーション倍率', process.env['VOICEVOX_INTONATION'] || '1.0')
  .option('--voicevox-volume <volume>', 'VOICEVOX音量倍率', process.env['VOICEVOX_VOLUME'] || '1.0')
  .action(() => {
    // メインアプリケーションの実行処理
    startMainApplication();
  });

// VOICEVOXプリセット表示コマンド
program
  .command('list-presets')
  .description('VOICEVOXキャラクタープリセット一覧を表示')
  .action(() => {
    console.log('\n=== VOICEVOXキャラクタープリセット ===');
    for (const [key, value] of Object.entries(VOICEVOX_PRESETS)) {
      console.log(`${key.padEnd(20)} : ${value.name} (${value.style}) [ID: ${value.id}]`);
    }
    console.log('\n使用例:');
    console.log(`npx tsx src/index.ts --engine voicevox --voicevox-speaker ${VOICEVOX_PRESETS.zundamon.id} # ずんだもん`);
    process.exit(0);
  });

program.parse();

// サブコマンドが実行された場合はここで終了するため、以下はメインアプリケーションの処理

function startMainApplication(): void {
  const options = program.opts<{
    token?: string;
    channel?: string;
    voice: string;
    rate: string;
    volume: string;
    blackhole: string;
    afplay: boolean;
    allowedUsers: string;
    enableDualOutput: boolean;
    speakerDevice: string;
    engine: string;
    voicevoxHost: string;
    voicevoxPort: string;
    voicevoxSpeaker: string;
    voicevoxSpeed: string;
    voicevoxPitch: string;
    voicevoxIntonation: string;
    voicevoxVolume: string;
  }>();

  // 必須オプションチェック
  if (!options.token) {
    logger.error('Discord Bot トークンが指定されていません。--token オプションまたは BOT_TOKEN 環境変数を設定してください。');
    process.exit(1);
  }

  if (!options.channel) {
    logger.error('チャンネル ID が指定されていません。--channel オプションまたは CHANNEL_ID 環境変数を設定してください。');
    process.exit(1);
  }

  // エンジン選択チェック
  if (options.engine !== 'system' && options.engine !== 'voicevox') {
    logger.error('--engine は "system" または "voicevox" を指定してください。');
    process.exit(1);
  }

  // 許可ユーザーIDの処理
  let allowedUserIds: string[] | undefined;
  if (options.allowedUsers?.trim()) {
    allowedUserIds = options.allowedUsers
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0);
    
    if (allowedUserIds.length === 0) {
      allowedUserIds = undefined;
    }
  }

  // アプリケーション開始
  const app = new DiscordTTSBridge({
    token: options.token,
    channel: options.channel,
    voice: options.voice,
    rate: Number.parseInt(options.rate, 10),
    volume: Number.parseInt(options.volume, 10),
    blackhole: options.blackhole,
    useAfplay: options.afplay,
    enableDualOutput: options.enableDualOutput,
    speakerDevice: options.speakerDevice,
    engine: options.engine as 'system' | 'voicevox',
    voicevoxHost: options.voicevoxHost,
    voicevoxPort: Number.parseInt(options.voicevoxPort, 10),
    voicevoxSpeaker: Number.parseInt(options.voicevoxSpeaker, 10),
    voicevoxSpeed: Number.parseFloat(options.voicevoxSpeed),
    voicevoxPitch: Number.parseFloat(options.voicevoxPitch),
    voicevoxIntonation: Number.parseFloat(options.voicevoxIntonation),
    voicevoxVolume: Number.parseFloat(options.voicevoxVolume),
    ...(allowedUserIds && { allowedUserIds }),
  });

  app.start().catch((error) => {
    logger.error(`アプリケーション起動エラー: ${error}`);
    process.exit(1);
  });
} 