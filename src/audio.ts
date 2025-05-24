import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger, platform, platformConfig } from './utils.js';
import type { TTSResult } from './tts.js';

const execAsync = promisify(exec);

export interface AudioPlayerOptions {
  blackholeDevice?: string;
  enableDualOutput?: boolean;
  speakerDevice?: string;
}

export class AudioPlayer {
  private blackholeDevice: string;
  private enableDualOutput: boolean;
  private speakerDevice: string | undefined;

  constructor(options: AudioPlayerOptions = {}) {
    // プラットフォーム固有のデフォルト値
    const defaultBlackhole = platform.isWindows() 
      ? platformConfig.windows.defaultVirtualAudio
      : platformConfig.macOS.defaultVirtualAudio;

    this.blackholeDevice = options.blackholeDevice ?? defaultBlackhole;
    this.enableDualOutput = options.enableDualOutput || false;
    this.speakerDevice = options.speakerDevice;
  }

  // メモリベースの音声再生（メインメソッド） - 完全ネイティブ実装
  async playAudioFromBuffer(ttsResult: TTSResult): Promise<void> {
    // プラットフォーム別のネイティブ再生（一時ファイル完全不要）
    if (platform.isWindows()) {
      return this.playOnWindowsNative(ttsResult);
    }
    
    if (platform.isMacOS()) {
      return this.playOnMacOSNative(ttsResult);
    }

    // Linux等の場合（フォールバック）
    logger.warn(`プラットフォーム ${platform.current()} での完全メモリベース再生は未実装です`);
    throw new Error(`サポートされていないプラットフォーム: ${platform.current()}`);
  }

  // デュアル出力でのメモリベース再生
  async playWithDualOutputFromBuffer(ttsResult: TTSResult): Promise<void> {
    if (!this.enableDualOutput || !this.speakerDevice) {
      return this.playAudioFromBuffer(ttsResult);
    }

    try {
      if (platform.isWindows()) {
        // Windows: ネイティブデュアル再生
        await this.playOnWindowsDevicesNative(ttsResult);
      } else if (platform.isMacOS()) {
        // macOS: 複数デバイスでのネイティブ再生
        await this.playOnMacOSDevicesNative(ttsResult);
      } else {
        // フォールバック
        await this.playAudioFromBuffer(ttsResult);
      }
    } catch (error) {
      logger.error(`デュアル出力再生エラー: ${error}`);
      // フォールバック
      await this.playAudioFromBuffer(ttsResult);
    }
  }

  // afplayでのメモリベース再生（macOS専用）
  async playWithAfplayFromBuffer(ttsResult: TTSResult): Promise<void> {
    if (!platform.isMacOS()) {
      logger.warn('afplayはmacOSでのみ利用可能です。通常の再生方法を使用します。');
      return this.playAudioFromBuffer(ttsResult);
    }

    return this.playOnMacOSNative(ttsResult);
  }

  // Windows完全ネイティブ再生
  private async playOnWindowsNative(ttsResult: TTSResult): Promise<void> {
    const base64Audio = ttsResult.audioBuffer.toString('base64');
    
    const psScript = `
Add-Type -AssemblyName PresentationCore
$audioBytes = [System.Convert]::FromBase64String("${base64Audio}")
$stream = New-Object System.IO.MemoryStream(,$audioBytes)

$player = New-Object System.Windows.Media.MediaPlayer
$player.Open($stream)
$player.Play()

# 再生完了まで待機
$timeout = 30000  # 30秒タイムアウト
$elapsed = 0
while($player.Position -lt $player.NaturalDuration.TimeSpan -and $player.NaturalDuration.HasTimeSpan -and $elapsed -lt $timeout) {
  Start-Sleep -Milliseconds 100
  $elapsed += 100
}

$player.Stop()
$player.Close()
$stream.Dispose()
    `.trim();

    try {
      logger.info(`Windows ネイティブ再生開始（完全メモリ）: ${ttsResult.format}, ${ttsResult.audioBuffer.length} bytes`);
      await execAsync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`);
      logger.info('Windows ネイティブ再生完了（完全メモリ）');
    } catch (error) {
      logger.error(`Windows ネイティブ再生エラー: ${error}`);
      throw error;
    }
  }

  // macOS完全ネイティブ再生
  private async playOnMacOSNative(ttsResult: TTSResult): Promise<void> {
    if (ttsResult.format === 'raw') {
      // PCMデータはafplay stdin経由（完全メモリベース）
      return this.playRawPCMWithAfplay(ttsResult);
    }

    // WAV, AIFF等のファイルフォーマットもafplay stdin経由
    return this.playAudioFormatWithAfplay(ttsResult);
  }

  // Windowsでの複数デバイス再生（完全ネイティブ）
  private async playOnWindowsDevicesNative(ttsResult: TTSResult): Promise<void> {
    const base64Audio = ttsResult.audioBuffer.toString('base64');
    
    const psScript = `
Add-Type -AssemblyName PresentationCore
$audioBytes = [System.Convert]::FromBase64String("${base64Audio}")
$stream1 = New-Object System.IO.MemoryStream(,$audioBytes)
$stream2 = New-Object System.IO.MemoryStream(,$audioBytes)

$player1 = New-Object System.Windows.Media.MediaPlayer
$player2 = New-Object System.Windows.Media.MediaPlayer

$player1.Open($stream1)
$player2.Open($stream2)

$player1.Play()
$player2.Play()

# 再生完了まで待機
$timeout = 30000  # 30秒タイムアウト
$elapsed = 0
while($player1.Position -lt $player1.NaturalDuration.TimeSpan -and $player1.NaturalDuration.HasTimeSpan -and $elapsed -lt $timeout) {
  Start-Sleep -Milliseconds 100
  $elapsed += 100
}

$player1.Stop()
$player2.Stop()
$player1.Close()
$player2.Close()
$stream1.Dispose()
$stream2.Dispose()
    `.trim();

    try {
      logger.info(`Windows デュアル出力再生開始（完全ネイティブ）: ${ttsResult.audioBuffer.length} bytes`);
      await execAsync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`);
      logger.info('Windows デュアル出力再生完了（完全ネイティブ）');
    } catch (error) {
      logger.error(`Windows ネイティブデュアル再生エラー: ${error}`);
      throw error;
    }
  }

  // macOSでの複数デバイス再生（完全ネイティブ）
  private async playOnMacOSDevicesNative(ttsResult: TTSResult): Promise<void> {
    if (!this.speakerDevice) {
      throw new Error('スピーカーデバイスが指定されていません');
    }

    // 複数デバイスで同時ネイティブ再生
    const promises = [
      this.playOnSpecificMacOSDeviceNative(ttsResult, this.blackholeDevice),
      this.playOnSpecificMacOSDeviceNative(ttsResult, this.speakerDevice),
    ];
    await Promise.all(promises);
  }

  // 特定デバイスでの完全ネイティブ再生
  private async playOnSpecificMacOSDeviceNative(ttsResult: TTSResult, deviceName: string): Promise<void> {
    const originalDevice = await this.getCurrentOutputDevice();
    
    try {
      await this.switchToDevice(deviceName);
      await this.playOnMacOSNative(ttsResult);
    } finally {
      if (originalDevice) {
        await this.switchToDevice(originalDevice);
      }
    }
  }

  // 音声フォーマットをafplayで再生（完全メモリベース）
  private async playAudioFormatWithAfplay(ttsResult: TTSResult): Promise<void> {
    try {
      logger.info(`macOS 音声フォーマット再生開始（完全メモリ）: ${ttsResult.format}, ${ttsResult.audioBuffer.length} bytes`);
      
      const { spawn } = await import('node:child_process');
      const afplayProcess = spawn('afplay', ['-'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // 音声データを標準入力に送信
      afplayProcess.stdin.write(ttsResult.audioBuffer);
      afplayProcess.stdin.end();

      return new Promise((resolve, reject) => {
        afplayProcess.on('close', (code) => {
          if (code === 0) {
            logger.info('macOS 音声フォーマット再生完了（完全メモリ）');
            resolve();
          } else {
            reject(new Error(`afplay process exited with code ${code}`));
          }
        });

        afplayProcess.on('error', (error) => {
          logger.error(`afplay process error: ${error}`);
          reject(error);
        });
      });

    } catch (error) {
      logger.error(`macOS 音声フォーマット再生エラー: ${error}`);
      throw error;
    }
  }

  // PCMデータをafplayで直接再生（完全メモリベース）
  private async playRawPCMWithAfplay(ttsResult: TTSResult): Promise<void> {
    const sampleRate = ttsResult.sampleRate || 22050;
    const channels = ttsResult.channels || 1;
    
    // afplayのPCMフォーマット指定
    const formatSpec = `LEF32@${sampleRate}`;

    try {
      logger.info(`PCM音声再生開始（完全メモリ）: ${ttsResult.audioBuffer.length} bytes`);
      
      const { spawn } = await import('node:child_process');
      const afplayProcess = spawn('afplay', [
        '--file-format', 'caff',
        '--data-format', formatSpec,
        '--channels', channels.toString(),
        '-'
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // 音声データを標準入力に送信
      afplayProcess.stdin.write(ttsResult.audioBuffer);
      afplayProcess.stdin.end();

      return new Promise((resolve, reject) => {
        afplayProcess.on('close', (code) => {
          if (code === 0) {
            logger.info('PCM音声再生完了（完全メモリ）');
            resolve();
          } else {
            reject(new Error(`afplay process exited with code ${code}`));
          }
        });

        afplayProcess.on('error', (error) => {
          logger.error(`afplay process error: ${error}`);
          reject(error);
        });
      });

    } catch (error) {
      logger.error(`PCM音声再生エラー: ${error}`);
      throw error;
    }
  }

  async switchToBlackHole(): Promise<void> {
    return this.switchToDevice(this.blackholeDevice);
  }

  async switchToDevice(deviceName: string): Promise<void> {
    try {
      if (platform.isWindows()) {
        await this.switchWindowsAudioDevice(deviceName);
      } else if (platform.isMacOS()) {
        await this.switchMacOSAudioDevice(deviceName);
      } else {
        logger.warn(`音声デバイス切り替えは ${platform.current()} でサポートされていません`);
      }
    } catch (error) {
      logger.error(`音声デバイス切り替えエラー: ${error}`);
      // 音声デバイス切り替えエラーは致命的ではないため、警告のみでスキップ
      logger.warn('音声デバイス切り替えをスキップして続行します');
    }
  }

  private async switchWindowsAudioDevice(deviceName: string): Promise<void> {
    // Windows: まずNirCmdを試す（推奨）
    try {
      await execAsync(`nircmd setdefaultsounddevice "${deviceName}"`);
      logger.info(`出力デバイスを ${deviceName} に切り替えました (NirCmd)`);
      return;
    } catch (nircmdError) {
      logger.debug(`NirCmdが利用できません: ${nircmdError}`);
    }

    // NirCmdが利用できない場合は、複雑なPowerShellスクリプトは使わず警告のみ
    try {
      // 簡単なPowerShellコマンドでデバイス確認のみ
      const psScript = 'Get-WmiObject -Class Win32_SoundDevice | Select-Object -First 1 -ExpandProperty Name';
      const { stdout } = await execAsync(`powershell -Command "${psScript}"`);
      logger.info(`現在の音声デバイス: ${stdout.trim()}`);
      logger.warn('PowerShellによる音声デバイス切り替えは複雑なため、スキップします。NirCmdの使用を推奨します。');
      logger.info('NirCmdダウンロード: https://www.nirsoft.net/utils/nircmd.html');
    } catch (error) {
      logger.warn(`Windows音声デバイス情報取得エラー: ${error}`);
      logger.warn('音声デバイス切り替えをスキップします');
    }
  }

  private async switchMacOSAudioDevice(deviceName: string): Promise<void> {
    await execAsync(`SwitchAudioSource -s "${deviceName}"`);
    logger.info(`出力デバイスを ${deviceName} に切り替えました`);
  }

  async getCurrentOutputDevice(): Promise<string | null> {
    try {
      if (platform.isWindows()) {
        return this.getCurrentWindowsDevice();
      }
      if (platform.isMacOS()) {
        return this.getCurrentMacOSDevice();
      }
      return null;
    } catch (error) {
      logger.debug(`現在の出力デバイス取得エラー: ${error}`);
      return null;
    }
  }

  private async getCurrentWindowsDevice(): Promise<string | null> {
    try {
      const psScript = 'Get-WmiObject -Class Win32_SoundDevice | Where-Object {$_.Status -eq "OK"} | Select-Object -First 1 -ExpandProperty Name';

      const { stdout } = await execAsync(`powershell -Command "${psScript}"`);
      return stdout.trim() || null;
    } catch (error) {
      logger.debug(`Windows音声デバイス取得エラー: ${error}`);
      return null;
    }
  }

  private async getCurrentMacOSDevice(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('SwitchAudioSource -c');
      return stdout.trim() || null;
    } catch (error) {
      logger.debug(`macOS音声デバイス取得エラー: ${error}`);
      return null;
    }
  }

  async listOutputDevices(): Promise<string[]> {
    try {
      if (platform.isWindows()) {
        return this.listWindowsDevices();
      }
      if (platform.isMacOS()) {
        return this.listMacOSDevices();
      }
      return [];
    } catch (error) {
      logger.error(`音声デバイス一覧取得エラー: ${error}`);
      return [];
    }
  }

  private async listWindowsDevices(): Promise<string[]> {
    try {
      const psScript = 'Get-WmiObject -Class Win32_SoundDevice | Where-Object {$_.Status -eq "OK"} | Select-Object -ExpandProperty Name';

      const { stdout } = await execAsync(`powershell -Command "${psScript}"`);
      return stdout
        .split('\n')
        .map(line => line.trim())
        .filter(device => device);
    } catch (error) {
      logger.debug(`Windows音声デバイス一覧取得エラー: ${error}`);
      return ['Default Device'];
    }
  }

  private async listMacOSDevices(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('SwitchAudioSource -a -t output');
      return stdout
        .split('\n')
        .map(line => line.trim())
        .filter(device => device);
    } catch (error) {
      logger.debug(`macOS音声デバイス一覧取得エラー: ${error}`);
      return ['Built-in Output'];
    }
  }

  async checkBlackHoleInstalled(): Promise<boolean> {
    try {
      const devices = await this.listOutputDevices();
      return devices.some(device => 
        device.toLowerCase().includes(this.blackholeDevice.toLowerCase())
      );
    } catch (error) {
      logger.debug(`仮想音声デバイス確認エラー: ${error}`);
      return false;
    }
  }

  // 後方互換性のためのメソッド（内部で完全メモリベース実装を使用）
  async playAudio(filePath: string): Promise<void> {
    logger.warn(`従来のファイルベース再生は非推奨です: ${filePath}`);
    logger.info('メモリベース再生への移行を推奨します');
    // ファイル内容を読み込んでメモリベース再生にリダイレクト
    try {
      const { readFileSync } = await import('node:fs');
      const audioBuffer = readFileSync(filePath);
      const ttsResult = {
        audioBuffer,
        format: filePath.endsWith('.wav') ? 'wav' : 'unknown',
        sampleRate: 22050,
        channels: 1,
      };
      await this.playAudioFromBuffer(ttsResult);
    } catch (error) {
      logger.error(`ファイルベース再生エラー: ${error}`);
      throw error;
    }
  }

  async playWithAfplay(filePath: string): Promise<void> {
    logger.warn(`従来のafplay再生は非推奨です: ${filePath}`);
    logger.info('メモリベース再生への移行を推奨します');
    return this.playAudio(filePath);
  }

  async playWithDualOutput(filePath: string): Promise<void> {
    logger.warn(`従来のデュアル出力再生は非推奨です: ${filePath}`);
    logger.info('メモリベース再生への移行を推奨します');
    return this.playAudio(filePath);
  }
} 