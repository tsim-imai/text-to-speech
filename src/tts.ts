import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { logger, sanitizeFilename } from './utils.js';
import { VoicevoxEngine, type VoicevoxOptions, VOICEVOX_PRESETS } from './voicevox.js';

const execAsync = promisify(exec);

export interface TTSOptions {
  voice: string;
  rate: number;
  volume: number;
}

export interface UnifiedTTSOptions extends TTSOptions {
  engine: 'macos' | 'voicevox';
  voicevoxOptions?: Partial<VoicevoxOptions>;
}

export class TTSEngine {
  private outputDir: string;
  private voicevoxEngine?: VoicevoxEngine;
  private engine: 'macos' | 'voicevox';

  constructor(options?: Partial<UnifiedTTSOptions>) {
    this.outputDir = join(process.cwd(), 'temp_audio');
    this.engine = options?.engine || 'macos';
    
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }

    // VOICEVOXエンジンの初期化
    if (this.engine === 'voicevox') {
      const voicevoxOptions: VoicevoxOptions = {
        host: options?.voicevoxOptions?.host || 'localhost',
        port: options?.voicevoxOptions?.port || 50021,
        speakerId: options?.voicevoxOptions?.speakerId || 3, // ずんだもん（ノーマル）
        speedScale: options?.voicevoxOptions?.speedScale || 1.0,
        pitchScale: options?.voicevoxOptions?.pitchScale || 0.0,
        intonationScale: options?.voicevoxOptions?.intonationScale || 1.0,
        volumeScale: options?.voicevoxOptions?.volumeScale || 1.0,
      };
      
      this.voicevoxEngine = new VoicevoxEngine(voicevoxOptions);
    }
  }

  async synthesize(text: string, options: TTSOptions): Promise<string> {
    if (this.engine === 'voicevox' && this.voicevoxEngine) {
      return this.synthesizeWithVoicevox(text);
    }
    return this.synthesizeWithMacOS(text, options);
  }

  private async synthesizeWithVoicevox(text: string): Promise<string> {
    if (!this.voicevoxEngine) {
      throw new Error('VOICEVOXエンジンが初期化されていません');
    }

    try {
      return await this.voicevoxEngine.synthesize(text);
    } catch (error) {
      logger.error(`VOICEVOX合成エラー、macOS TTSにフォールバック: ${error}`);
      
      // フォールバック: macOS TTSを使用
      return this.synthesizeWithMacOS(text, {
        voice: 'Kyoko',
        rate: 230,
        volume: 50,
      });
    }
  }

  private async synthesizeWithMacOS(text: string, options: TTSOptions): Promise<string> {
    const filename = `tts_${Date.now()}_${sanitizeFilename(text)}.aiff`;
    const outputPath = join(this.outputDir, filename);

    const command = [
      'say',
      '-v', options.voice,
      '-r', options.rate.toString(),
      '-o', `"${outputPath}"`,
      `"${text.replace(/"/g, '\\"')}"`
    ].join(' ');

    try {
      logger.info(`macOS TTS合成開始: ${text.substring(0, 50)}...`);
      await execAsync(command);
      
      if (!existsSync(outputPath)) {
        throw new Error(`音声ファイルの生成に失敗しました: ${outputPath}`);
      }

      logger.info(`macOS TTS合成完了: ${outputPath}`);
      return outputPath;
    } catch (error) {
      logger.error(`macOS TTS合成エラー: ${error}`);
      throw error;
    }
  }

  async cleanupFile(filePath: string): Promise<void> {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        logger.debug(`一時ファイル削除: ${filePath}`);
      }
    } catch (error) {
      logger.warn(`ファイル削除エラー: ${error}`);
    }
  }

  async getAvailableVoices(): Promise<string[]> {
    if (this.engine === 'voicevox' && this.voicevoxEngine) {
      try {
        const speakers = await this.voicevoxEngine.getSpeakers();
        const voices: string[] = [];
        
        for (const speaker of speakers) {
          for (const style of speaker.styles) {
            voices.push(`${speaker.name} (${style.name}) [ID: ${style.id}]`);
          }
        }
        
        return voices;
      } catch (error) {
        logger.error(`VOICEVOX音声一覧取得エラー: ${error}`);
        return Object.keys(VOICEVOX_PRESETS);
      }
    } else {
      // macOS TTSの音声一覧取得
      try {
        const { stdout } = await execAsync('say -v "?"');
        const voices = stdout
          .split('\n')
          .filter(line => line.trim())
          .map(line => line.split(/\s+/)[0])
          .filter(voice => voice);
        
        return voices;
      } catch (error) {
        logger.error(`macOS TTS音声一覧取得エラー: ${error}`);
        return ['Kyoko', 'Otoya', 'O-ren']; // デフォルト日本語音声
      }
    }
  }

  async checkEngineAvailability(): Promise<{ macos: boolean; voicevox: boolean }> {
    const result = { macos: false, voicevox: false };

    // macOS TTS チェック
    try {
      await execAsync('say -v "?" | head -1');
      result.macos = true;
    } catch (error) {
      logger.debug(`macOS TTS利用不可: ${error}`);
    }

    // VOICEVOX チェック
    if (this.voicevoxEngine) {
      result.voicevox = await this.voicevoxEngine.checkConnection();
    }

    return result;
  }

  getEngineInfo(): string {
    return this.engine === 'voicevox' ? 'VOICEVOX' : 'macOS TTS';
  }

  async getVoicevoxPresets(): Promise<Array<{ key: string; name: string; style: string; id: number }>> {
    return Object.entries(VOICEVOX_PRESETS).map(([key, value]) => ({
      key,
      name: value.name,
      style: value.style,
      id: value.id,
    }));
  }
} 