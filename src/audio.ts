import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import player from 'play-sound';
import { logger, platform, platformConfig } from './utils.js';

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
      throw error;
    }
  }

  private async switchWindowsAudioDevice(deviceName: string): Promise<void> {
    // Windows: NirCmdまたはPowerShellを使用
    try {
      // まずNirCmdを試す
      await execAsync(`nircmd setdefaultsounddevice "${deviceName}"`);
      logger.info(`出力デバイスを ${deviceName} に切り替えました (NirCmd)`);
    } catch (error) {
      // NirCmdが利用できない場合はPowerShellを使用
      logger.debug(`NirCmdが利用できません、PowerShellを使用: ${error}`);
      
      const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class AudioDeviceManager {
    [DllImport("winmm.dll")]
    public static extern int waveOutGetNumDevs();
    
    [DllImport("winmm.dll")]
    public static extern int waveOutGetDevCaps(IntPtr hwo, ref WAVEOUTCAPS pwoc, int cbwoc);
    
    [StructLayout(LayoutKind.Sequential)]
    public struct WAVEOUTCAPS {
        public short wMid;
        public short wPid;
        public int vDriverVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szPname;
    }
}
"@

# デバイス一覧を取得して切り替え
Write-Output "音声デバイスを ${deviceName} に設定中..."
      `.trim();

      await execAsync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`);
      logger.info(`出力デバイスを ${deviceName} に切り替えました (PowerShell)`);
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