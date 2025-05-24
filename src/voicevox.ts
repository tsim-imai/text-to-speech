import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { logger, sanitizeFilename } from './utils.js';

export interface VoicevoxOptions {
  host: string;
  port: number;
  speakerId: number;
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
}

export interface VoicevoxSpeaker {
  name: string;
  speaker_uuid: string;
  styles: VoicevoxStyle[];
  version: string;
}

export interface VoicevoxStyle {
  name: string;
  id: number;
  type: string;
}

export interface AudioQuery {
  accent_phrases: unknown[];
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  outputSamplingRate: number;
  outputStereo: boolean;
  kana?: string;
}

export class VoicevoxEngine {
  private options: VoicevoxOptions;
  private outputDir: string;
  private baseUrl: string;

  constructor(options: VoicevoxOptions) {
    this.options = options;
    this.outputDir = join(process.cwd(), 'temp_audio');
    this.baseUrl = `http://${options.host}:${options.port}`;
    
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async synthesize(text: string): Promise<string> {
    const filename = `voicevox_${Date.now()}_${sanitizeFilename(text)}.wav`;
    const outputPath = join(this.outputDir, filename);

    try {
      logger.info(`VOICEVOX音声合成開始: ${text.substring(0, 50)}...`);
      
      // 1. 音声クエリを作成
      const audioQuery = await this.createAudioQuery(text);
      
      // 2. 音声合成
      const audioBuffer = await this.synthesizeAudio(audioQuery);
      
      // 3. ファイルに保存
      writeFileSync(outputPath, audioBuffer);
      
      logger.info(`VOICEVOX音声合成完了: ${outputPath}`);
      return outputPath;
    } catch (error) {
      logger.error(`VOICEVOX音声合成エラー: ${error}`);
      throw error;
    }
  }

  private async createAudioQuery(text: string): Promise<AudioQuery> {
    const url = `${this.baseUrl}/audio_query`;
    const params = new URLSearchParams({
      text: text,
      speaker: this.options.speakerId.toString(),
    });

    const response = await fetch(`${url}?${params}`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`音声クエリ作成エラー: ${response.status} ${response.statusText}`);
    }

    const audioQuery = await response.json() as AudioQuery;
    
    // 音声パラメータを調整
    audioQuery.speedScale = this.options.speedScale;
    audioQuery.pitchScale = this.options.pitchScale;
    audioQuery.intonationScale = this.options.intonationScale;
    audioQuery.volumeScale = this.options.volumeScale;

    return audioQuery;
  }

  private async synthesizeAudio(audioQuery: AudioQuery): Promise<Buffer> {
    const url = `${this.baseUrl}/synthesis`;
    const params = new URLSearchParams({
      speaker: this.options.speakerId.toString(),
    });

    const response = await fetch(`${url}?${params}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(audioQuery),
    });

    if (!response.ok) {
      throw new Error(`音声合成エラー: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async getSpeakers(): Promise<VoicevoxSpeaker[]> {
    try {
      const response = await fetch(`${this.baseUrl}/speakers`);
      
      if (!response.ok) {
        throw new Error(`スピーカー一覧取得エラー: ${response.status} ${response.statusText}`);
      }

      return await response.json() as VoicevoxSpeaker[];
    } catch (error) {
      logger.error(`スピーカー一覧取得エラー: ${error}`);
      return [];
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${this.baseUrl}/version`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      logger.warn(`VOICEVOX接続確認エラー: ${error}`);
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/version`);
      
      if (!response.ok) {
        throw new Error(`バージョン取得エラー: ${response.status} ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      logger.error(`バージョン取得エラー: ${error}`);
      return 'Unknown';
    }
  }
}

// よく使われるキャラクターのプリセット
export const VOICEVOX_PRESETS = {
  zundamon: { id: 3, name: 'ずんだもん', style: 'ノーマル' },
  zundamon_amaama: { id: 1, name: 'ずんだもん', style: 'あまあま' },
  zundamon_tuntun: { id: 5, name: 'ずんだもん', style: 'ツンツン' },
  metan: { id: 2, name: '四国めたん', style: 'ノーマル' },
  metan_amaama: { id: 0, name: '四国めたん', style: 'あまあま' },
  tsumugi: { id: 8, name: '春日部つむぎ', style: 'ノーマル' },
  ryusei: { id: 13, name: '青山龍星', style: 'ノーマル' },
  hau: { id: 10, name: '波音リツ', style: 'ノーマル' },
} as const;

export function getPresetBySpeakerId(speakerId: number): string {
  const preset = Object.entries(VOICEVOX_PRESETS).find(
    ([, value]) => value.id === speakerId
  );
  return preset ? `${preset[1].name} (${preset[1].style})` : `Speaker ID: ${speakerId}`;
} 