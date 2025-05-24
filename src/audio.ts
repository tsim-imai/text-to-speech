import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import player from 'play-sound';
import { logger, sleep } from './utils.js';

const execAsync = promisify(exec);

export interface AudioPlayerOptions {
  blackholeDevice: string;
  enableDualOutput?: boolean; // デュアル出力（BlackHole + スピーカー）を有効にする
  speakerDevice?: string; // 追加で再生するスピーカーデバイス名
}

export class AudioPlayer {
  private player = player();
  private options: AudioPlayerOptions;

  constructor(options: AudioPlayerOptions) {
    this.options = options;
  }

  async switchToBlackHole(): Promise<void> {
    try {
      // SwitchAudioSource で出力デバイスを BlackHole に切り替え
      const command = `SwitchAudioSource -s "${this.options.blackholeDevice}"`;
      await execAsync(command);
      logger.info(`出力デバイスを ${this.options.blackholeDevice} に切り替えました`);
      
      // 切り替え完了まで少し待機
      await sleep(500);
    } catch (error) {
      logger.error(`出力デバイス切り替えエラー: ${error}`);
      throw new Error(`BlackHole デバイスへの切り替えに失敗しました: ${error}`);
    }
  }

  async playAudio(filePath: string): Promise<void> {
    if (!existsSync(filePath)) {
      throw new Error(`音声ファイルが見つかりません: ${filePath}`);
    }

    return new Promise((resolve, reject) => {
      logger.info(`音声再生開始: ${filePath}`);
      
      this.player.play(filePath, (err) => {
        if (err) {
          logger.error(`音声再生エラー: ${err}`);
          reject(err);
        } else {
          logger.info(`音声再生完了: ${filePath}`);
          resolve();
        }
      });
    });
  }

  async playWithAfplay(filePath: string): Promise<void> {
    if (!existsSync(filePath)) {
      throw new Error(`音声ファイルが見つかりません: ${filePath}`);
    }

    try {
      logger.info(`afplay で音声再生開始: ${filePath}`);
      await execAsync(`afplay "${filePath}"`);
      logger.info(`afplay で音声再生完了: ${filePath}`);
    } catch (error) {
      logger.error(`afplay エラー: ${error}`);
      throw error;
    }
  }

  async playWithDualOutput(filePath: string): Promise<void> {
    if (!existsSync(filePath)) {
      throw new Error(`音声ファイルが見つかりません: ${filePath}`);
    }

    if (!this.options.enableDualOutput) {
      // デュアル出力が無効の場合は通常再生
      return this.playWithAfplay(filePath);
    }

    try {
      logger.info(`デュアル出力で音声再生開始: ${filePath}`);
      
      // 並列で両方のデバイスに再生
      const promises: Promise<void>[] = [];

      // BlackHole への再生
      promises.push(this.playToDevice(filePath, this.options.blackholeDevice));

      // スピーカーへの再生（指定されている場合）
      if (this.options.speakerDevice) {
        promises.push(this.playToDevice(filePath, this.options.speakerDevice));
      }

      await Promise.all(promises);
      logger.info(`デュアル出力で音声再生完了: ${filePath}`);
    } catch (error) {
      logger.error(`デュアル出力エラー: ${error}`);
      throw error;
    }
  }

  private async playToDevice(filePath: string, deviceName: string): Promise<void> {
    try {
      // 一時的にデバイスを切り替えて再生
      await execAsync(`SwitchAudioSource -s "${deviceName}"`);
      await sleep(100); // デバイス切り替え待機
      await execAsync(`afplay "${filePath}"`);
    } catch (error) {
      logger.warn(`デバイス ${deviceName} での再生エラー: ${error}`);
      throw error;
    }
  }

  async checkBlackHoleInstalled(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('SwitchAudioSource -a -t output');
      return stdout.includes(this.options.blackholeDevice);
    } catch (error) {
      logger.warn(`BlackHole 確認エラー: ${error}`);
      return false;
    }
  }

  async getCurrentAudioDevice(): Promise<string> {
    try {
      const { stdout } = await execAsync('SwitchAudioSource -c');
      return stdout.trim();
    } catch (error) {
      logger.error(`現在のオーディオデバイス取得エラー: ${error}`);
      return 'Unknown';
    }
  }

  async listOutputDevices(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('SwitchAudioSource -a -t output');
      return stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.trim());
    } catch (error) {
      logger.error(`出力デバイス一覧取得エラー: ${error}`);
      return [];
    }
  }
} 