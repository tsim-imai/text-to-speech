import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger, platform, platformConfig } from './utils.js';
import { VoicevoxEngine, type VoicevoxOptions, VOICEVOX_PRESETS } from './voicevox.js';

const execAsync = promisify(exec);

export interface TTSOptions {
  voice: string;
  rate: number;
  volume: number;
}

export interface UnifiedTTSOptions extends TTSOptions {
  engine: 'system' | 'voicevox'; // 'macos' -> 'system' に変更
  voicevoxOptions?: Partial<VoicevoxOptions>;
}

export interface TTSResult {
  audioBuffer: Buffer;
  format: string; // 'wav' | 'aiff' | 'mp3' etc.
  sampleRate?: number;
  channels?: number;
}

export class TTSEngine {
  private voicevoxEngine?: VoicevoxEngine;
  private engine: 'system' | 'voicevox';

  constructor(options?: Partial<UnifiedTTSOptions>) {
    this.engine = options?.engine || 'system';

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

  async synthesize(text: string, options: TTSOptions): Promise<TTSResult> {
    if (this.engine === 'voicevox' && this.voicevoxEngine) {
      return this.synthesizeWithVoicevox(text);
    }
    return this.synthesizeWithSystemTTS(text, options);
  }

  private async synthesizeWithVoicevox(text: string): Promise<TTSResult> {
    if (!this.voicevoxEngine) {
      throw new Error('VOICEVOXエンジンが初期化されていません');
    }

    try {
      logger.info(`VOICEVOX音声合成開始（メモリ）: ${text.substring(0, 50)}...`);
      
      // VOICEVOXから直接Bufferを取得
      const audioBuffer = await this.voicevoxEngine.synthesizeToBuffer(text);
      
      logger.info(`VOICEVOX音声合成完了（メモリ）: ${audioBuffer.length} bytes`);
      
      return {
        audioBuffer,
        format: 'wav',
        sampleRate: 24000, // VOICEVOXのデフォルトサンプルレート
        channels: 1, // モノラル
      };
    } catch (error) {
      logger.error(`VOICEVOX合成エラー、システムTTSにフォールバック: ${error}`);
      
      // フォールバック: システムTTSを使用
      return this.synthesizeWithSystemTTS(text, {
        voice: platform.isWindows() ? 'Haruka' : 'Kyoko',
        rate: 230,
        volume: 50,
      });
    }
  }

  private async synthesizeWithSystemTTS(text: string, options: TTSOptions): Promise<TTSResult> {
    if (platform.isWindows()) {
      return this.synthesizeWithWindowsTTS(text, options);
    }
    if (platform.isMacOS()) {
      return this.synthesizeWithMacOSTTS(text, options);
    }
    throw new Error(`プラットフォーム ${platform.current()} はサポートされていません`);
  }

  private async synthesizeWithWindowsTTS(text: string, options: TTSOptions): Promise<TTSResult> {
    // Windows SAPI using PowerShell でメモリストリームに出力
    const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("${options.voice}")
$synth.Rate = ${Math.round((options.rate - 200) / 50)} # Convert to SAPI rate (-10 to 10)
$synth.Volume = ${options.volume}

# メモリストリームに出力
$memoryStream = New-Object System.IO.MemoryStream
$synth.SetOutputToWaveStream($memoryStream)
$synth.Speak("${text.replace(/"/g, '`"')}")

# バイナリデータを標準出力にBase64エンコードで出力
$bytes = $memoryStream.ToArray()
[System.Convert]::ToBase64String($bytes)

$synth.Dispose()
$memoryStream.Dispose()
    `.trim();

    try {
      logger.info(`Windows TTS合成開始（メモリ）: ${text.substring(0, 50)}...`);
      
      const { stdout } = await execAsync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`);
      const base64Data = stdout.trim();
      const audioBuffer = Buffer.from(base64Data, 'base64');
      
      logger.info(`Windows TTS合成完了（メモリ）: ${audioBuffer.length} bytes`);
      
      return {
        audioBuffer,
        format: 'wav',
        sampleRate: 22050, // Windows SAPIのデフォルト
        channels: 1,
      };
    } catch (error) {
      logger.error(`Windows TTS合成エラー: ${error}`);
      throw error;
    }
  }

  private async synthesizeWithMacOSTTS(text: string, options: TTSOptions): Promise<TTSResult> {
    // macOS sayコマンドでstdoutに直接出力
    const command = [
      'say',
      '-v', options.voice,
      '-r', options.rate.toString(),
      '--data-format=LEF32@22050', // リニアPCM形式で出力
      '-o', '-', // 標準出力に出力
      `"${text.replace(/"/g, '\\"')}"`
    ].join(' ');

    try {
      logger.info(`macOS TTS合成開始（メモリ）: ${text.substring(0, 50)}...`);
      
      const { stdout } = await execAsync(command, { encoding: 'buffer' });
      const audioBuffer = stdout as Buffer;
      
      logger.info(`macOS TTS合成完了（メモリ）: ${audioBuffer.length} bytes`);
      
      return {
        audioBuffer,
        format: 'raw', // PCMデータ
        sampleRate: 22050,
        channels: 1,
      };
    } catch (error) {
      logger.error(`macOS TTS合成エラー: ${error}`);
      throw error;
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
    }

    // システム TTS の音声一覧取得
    if (platform.isWindows()) {
      return this.getWindowsVoices();
    }
    if (platform.isMacOS()) {
      return this.getMacOSVoices();
    }
    
    return ['default'];
  }

  private async getWindowsVoices(): Promise<string[]> {
    try {
      const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
$synth.Dispose()
      `.trim();

      const { stdout } = await execAsync(`powershell -Command "${psScript}"`);
      const voices = stdout
        .split('\n')
        .map(line => line.trim())
        .filter(voice => voice);
      
      return voices.length > 0 ? voices : [...platformConfig.windows.supportedVoices];
    } catch (error) {
      logger.error(`Windows TTS音声一覧取得エラー: ${error}`);
      return [...platformConfig.windows.supportedVoices];
    }
  }

  private async getMacOSVoices(): Promise<string[]> {
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
      return [...platformConfig.macOS.supportedVoices];
    }
  }

  async checkEngineAvailability(): Promise<{ system: boolean; voicevox: boolean }> {
    const result = { system: false, voicevox: false };

    // システム TTS チェック
    try {
      if (platform.isWindows()) {
        // Windows SAPI の確認
        const psScript = 'Add-Type -AssemblyName System.Speech; Write-Output "OK"';
        await execAsync(`powershell -Command "${psScript}"`);
        result.system = true;
      } else if (platform.isMacOS()) {
        // macOS say コマンドの確認
        await execAsync('say -v "?" | head -1');
        result.system = true;
      }
    } catch (error) {
      logger.debug(`システムTTS利用不可: ${error}`);
    }

    // VOICEVOX チェック
    if (this.voicevoxEngine) {
      result.voicevox = await this.voicevoxEngine.checkConnection();
    }

    return result;
  }

  getEngineInfo(): string {
    if (this.engine === 'voicevox') {
      return 'VOICEVOX (メモリ)';
    }
    
    if (platform.isWindows()) {
      return 'Windows SAPI (メモリ)';
    }
    if (platform.isMacOS()) {
      return 'macOS TTS (メモリ)';
    }
    return 'System TTS (メモリ)';
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