import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import player from 'play-sound';
import { logger, platform, platformConfig } from './utils.js';
import type { TTSResult } from './tts.js';

const execAsync = promisify(exec);

export interface AudioPlayerOptions {
  blackholeDevice?: string;
  enableDualOutput?: boolean;
  speakerDevice?: string;
}

export class AudioPlayer {
  private audioPlayer: ReturnType<typeof player>;
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
    this.audioPlayer = player();
  }

  // メモリベースの音声再生（メインメソッド）
  async playAudioFromBuffer(ttsResult: TTSResult): Promise<void> {
    // プラットフォーム別の最適化された再生方法を選択
    if (platform.isMacOS() && ttsResult.format === 'raw') {
      // PCMデータはafplayで直接再生（一時ファイル不要）
      return this.playRawPCMWithAfplay(ttsResult);
    }

    if (platform.isWindows() && ttsResult.format === 'wav') {
      // WAVデータはPowerShellで直接再生（一時ファイル不要）
      return this.playWAVWithPowerShell(ttsResult);
    }

    // フォールバック: 最小限の一時ファイル使用
    const tempFilePath = await this.bufferToTempFile(ttsResult);
    
    try {
      await this.playAudio(tempFilePath);
    } finally {
      await this.cleanupTempFile(tempFilePath);
    }
  }

  // デュアル出力でのメモリベース再生
  async playWithDualOutputFromBuffer(ttsResult: TTSResult): Promise<void> {
    if (!this.enableDualOutput || !this.speakerDevice) {
      return this.playAudioFromBuffer(ttsResult);
    }

    try {
      if (platform.isWindows() && ttsResult.format === 'wav') {
        // Windows: メモリベースデュアル再生
        await this.playOnWindowsDevicesFromBuffer(ttsResult);
      } else if (platform.isMacOS()) {
        // macOS: 複数デバイスでの再生
        await this.playOnMacOSDevicesFromBuffer(ttsResult);
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

    if (ttsResult.format === 'raw') {
      // PCMデータの場合は標準入力経由で再生（完全メモリベース）
      return this.playRawPCMWithAfplay(ttsResult);
    }

    // WAVファイルの場合は一時ファイル経由
    const tempFilePath = await this.bufferToTempFile(ttsResult);
    
    try {
      await this.playWithAfplay(tempFilePath);
    } finally {
      await this.cleanupTempFile(tempFilePath);
    }
  }

  // WindowsでPowerShellを使った完全メモリベースWAV再生
  private async playWAVWithPowerShell(ttsResult: TTSResult): Promise<void> {
    const base64Audio = ttsResult.audioBuffer.toString('base64');
    
    const psScript = `
Add-Type -AssemblyName PresentationCore
$audioBytes = [System.Convert]::FromBase64String("${base64Audio}")
$stream = New-Object System.IO.MemoryStream(,$audioBytes)

$player = New-Object System.Windows.Media.MediaPlayer
$player.Open($stream)
$player.Play()

# 再生完了まで待機
while($player.Position -lt $player.NaturalDuration.TimeSpan -and $player.NaturalDuration.HasTimeSpan) {
  Start-Sleep -Milliseconds 100
}

$player.Stop()
$player.Close()
$stream.Dispose()
    `.trim();

    try {
      logger.info(`Windows WAV再生開始（完全メモリ）: ${ttsResult.audioBuffer.length} bytes`);
      await execAsync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`);
      logger.info('Windows WAV再生完了（完全メモリ）');
    } catch (error) {
      logger.error(`Windows メモリベースWAV再生エラー: ${error}`);
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

  // macOSでの複数デバイス再生（完全メモリベース対応）
  private async playOnMacOSDevicesFromBuffer(ttsResult: TTSResult): Promise<void> {
    if (!this.speakerDevice) {
      throw new Error('スピーカーデバイスが指定されていません');
    }

    if (ttsResult.format === 'raw') {
      // PCMデータの場合は完全メモリベース
      const promises = [
        this.playOnSpecificMacOSDeviceFromBuffer(ttsResult, this.blackholeDevice),
        this.playOnSpecificMacOSDeviceFromBuffer(ttsResult, this.speakerDevice),
      ];
      await Promise.all(promises);
    } else {
      // WAVファイルの場合は一時ファイル経由
      const tempFilePath = await this.bufferToTempFile(ttsResult);
      try {
        await this.playOnMacOSDevices(tempFilePath);
      } finally {
        await this.cleanupTempFile(tempFilePath);
      }
    }
  }

  // 特定デバイスでの完全メモリベース再生
  private async playOnSpecificMacOSDeviceFromBuffer(ttsResult: TTSResult, deviceName: string): Promise<void> {
    const originalDevice = await this.getCurrentOutputDevice();
    
    try {
      await this.switchToDevice(deviceName);
      await this.playRawPCMWithAfplay(ttsResult);
    } finally {
      if (originalDevice) {
        await this.switchToDevice(originalDevice);
      }
    }
  }

  // Windowsでの複数デバイス再生（メモリベース）
  private async playOnWindowsDevicesFromBuffer(ttsResult: TTSResult): Promise<void> {
    if (ttsResult.format !== 'wav') {
      // WAVでない場合は一時ファイル経由
      const tempFilePath = await this.bufferToTempFile(ttsResult);
      try {
        await this.playOnWindowsDevices(tempFilePath);
      } finally {
        await this.cleanupTempFile(tempFilePath);
      }
      return;
    }

    // WAVデータを直接メモリで扱う（完全メモリベース）
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
while($player1.Position -lt $player1.NaturalDuration.TimeSpan -and $player1.NaturalDuration.HasTimeSpan) {
  Start-Sleep -Milliseconds 100
}

$player1.Stop()
$player2.Stop()
$player1.Close()
$player2.Close()
$stream1.Dispose()
$stream2.Dispose()
    `.trim();

    try {
      logger.info(`Windows デュアル出力再生開始（完全メモリ）: ${ttsResult.audioBuffer.length} bytes`);
      await execAsync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`);
      logger.info('Windows デュアル出力再生完了（完全メモリ）');
    } catch (error) {
      logger.error(`Windows メモリベース再生エラー: ${error}`);
      // フォールバック
      await this.playAudioFromBuffer(ttsResult);
    }
  }

  // Bufferを一時ファイルに変換（最後の手段）
  private async bufferToTempFile(ttsResult: TTSResult): Promise<string> {
    // 一時ディレクトリを遅延作成（本当に必要な時のみ）
    const tempDir = join(process.cwd(), 'temp_audio');
    if (!existsSync(tempDir)) {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(tempDir, { recursive: true });
      logger.debug(`一時ディレクトリ作成: ${tempDir}`);
    }

    const extension = this.getFileExtension(ttsResult.format);
    const filename = `tts_memory_${Date.now()}_${Math.random().toString(36).substring(7)}.${extension}`;
    const filePath = join(tempDir, filename);

    writeFileSync(filePath, ttsResult.audioBuffer);
    logger.debug(`一時ファイル作成（フォールバック）: ${filePath} (${ttsResult.audioBuffer.length} bytes)`);
    
    return filePath;
  }

  // フォーマットから拡張子を取得
  private getFileExtension(format: string): string {
    switch (format) {
      case 'wav': return 'wav';
      case 'aiff': return 'aiff';
      case 'mp3': return 'mp3';
      case 'raw': return 'raw';
      default: return 'wav';
    }
  }

  // 一時ファイル削除
  private async cleanupTempFile(filePath: string): Promise<void> {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        logger.debug(`一時ファイル削除: ${filePath}`);
      }
    } catch (error) {
      logger.warn(`一時ファイル削除エラー: ${error}`);
    }
  }

  // 既存メソッドはそのまま保持（後方互換性）
  async playAudio(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info(`音声再生開始: ${filePath}`);
      
      this.audioPlayer.play(filePath, (err) => {
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
    if (!platform.isMacOS()) {
      logger.warn('afplayはmacOSでのみ利用可能です。通常の再生方法を使用します。');
      return this.playAudio(filePath);
    }

    try {
      logger.info(`音声再生開始 (afplay): ${filePath}`);
      await execAsync(`afplay "${filePath}"`);
      logger.info(`音声再生完了 (afplay): ${filePath}`);
    } catch (error) {
      logger.error(`afplay再生エラー: ${error}`);
      throw error;
    }
  }

  async playWithDualOutput(filePath: string): Promise<void> {
    if (!this.enableDualOutput || !this.speakerDevice) {
      return this.playAudio(filePath);
    }

    try {
      logger.info(`デュアル出力再生開始: ${filePath}`);

      if (platform.isWindows()) {
        // Windows: 複数デバイスへの同時再生
        await this.playOnWindowsDevices(filePath);
      } else if (platform.isMacOS()) {
        // macOS: SwitchAudioSourceを使用
        await this.playOnMacOSDevices(filePath);
      } else {
        // フォールバック
        await this.playAudio(filePath);
      }
    } catch (error) {
      logger.error(`デュアル出力再生エラー: ${error}`);
      // フォールバック
      await this.playAudio(filePath);
    }
  }

  private async playOnWindowsDevices(filePath: string): Promise<void> {
    // Windows PowerShellを使用して複数デバイスに再生
    const psScript = `
Add-Type -AssemblyName PresentationCore
$player1 = New-Object System.Windows.Media.MediaPlayer
$player2 = New-Object System.Windows.Media.MediaPlayer

$player1.Open("${filePath.replace(/\\/g, '/')}")
$player2.Open("${filePath.replace(/\\/g, '/')}")

$player1.Play()
$player2.Play()

# 再生完了まで待機
while($player1.Position -lt $player1.NaturalDuration.TimeSpan) {
  Start-Sleep -Milliseconds 100
}

$player1.Stop()
$player2.Stop()
$player1.Close()
$player2.Close()
    `.trim();

    await execAsync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`);
  }

  private async playOnMacOSDevices(filePath: string): Promise<void> {
    // macOS: 複数デバイスに同時再生
    if (!this.speakerDevice) {
      throw new Error('スピーカーデバイスが指定されていません');
    }

    const promises = [
      this.playOnSpecificMacOSDevice(filePath, this.blackholeDevice),
      this.playOnSpecificMacOSDevice(filePath, this.speakerDevice),
    ];

    await Promise.all(promises);
  }

  private async playOnSpecificMacOSDevice(filePath: string, deviceName: string): Promise<void> {
    // 一時的にデバイスを切り替えて再生
    const originalDevice = await this.getCurrentOutputDevice();
    
    try {
      await this.switchToDevice(deviceName);
      await this.playWithAfplay(filePath);
    } finally {
      if (originalDevice) {
        await this.switchToDevice(originalDevice);
      }
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
      const psScript = `
Get-WmiObject -Class Win32_SoundDevice | Where-Object {$_.Status -eq "OK"} | Select-Object -First 1 -ExpandProperty Name
      `.trim();

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
      const psScript = `
Get-WmiObject -Class Win32_SoundDevice | Where-Object {$_.Status -eq "OK"} | Select-Object -ExpandProperty Name
      `.trim();

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
} 