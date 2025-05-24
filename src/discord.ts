import { Client, GatewayIntentBits, Events, Message, ActivityType } from 'discord.js';
import { logger, cleanMessageText } from './utils.js';

export interface DiscordClientOptions {
  token: string;
  channelId: string;
  onMessage: (text: string, author: string) => Promise<void>;
  allowedUserIds?: string[]; // 許可されたユーザーIDの配列（未設定時は全ユーザー許可）
}

export class DiscordTTSClient {
  private client: Client;
  private options: DiscordClientOptions;

  constructor(options: DiscordClientOptions) {
    this.options = options;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on(Events.ClientReady, () => {
      logger.info(`Discord に ${this.client.user?.tag} としてログインしました`);
      
      // 許可ユーザー情報をログ出力
      if (this.options.allowedUserIds && this.options.allowedUserIds.length > 0) {
        logger.info(`許可されたユーザー: ${this.options.allowedUserIds.join(', ')}`);
      } else {
        logger.info('全ユーザーのメッセージを読み上げます');
      }
      
      // プレゼンス設定
      this.client.user?.setActivity('🔊 読み上げ中…', {
        type: ActivityType.Custom,
      });
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        logger.error(`メッセージ処理エラー: ${error}`);
      }
    });

    this.client.on(Events.Error, (error) => {
      logger.error(`Discord クライアントエラー: ${error}`);
    });

    this.client.on(Events.Warn, (warning) => {
      logger.warn(`Discord 警告: ${warning}`);
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    // Bot 自身のメッセージは無視
    if (message.author.bot) {
      return;
    }

    // 指定チャンネル以外は無視
    if (message.channel.id !== this.options.channelId) {
      return;
    }

    // 許可されたユーザーのチェック
    if (this.options.allowedUserIds && this.options.allowedUserIds.length > 0) {
      if (!this.options.allowedUserIds.includes(message.author.id)) {
        logger.debug(`ユーザー "${message.author.displayName}" (${message.author.id}) は許可リストにないため、スキップします`);
        return;
      }
    }

    // メッセージテキストをクリーンアップ
    const cleanedText = cleanMessageText(message.content);
    if (!cleanedText) {
      logger.debug(`読み上げスキップ: "${message.content}"`);
      return;
    }

    logger.info(`メッセージ受信: [${message.author.displayName}] (${message.author.id}) ${cleanedText}`);

    try {
      await this.options.onMessage(cleanedText, message.author.displayName);
    } catch (error) {
      logger.error(`メッセージ処理コールバックエラー: ${error}`);
    }
  }

  async connect(): Promise<void> {
    try {
      logger.info('Discord に接続中...');
      await this.client.login(this.options.token);
    } catch (error) {
      logger.error(`Discord 接続エラー: ${error}`);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      logger.info('Discord から切断中...');
      this.client.destroy();
    } catch (error) {
      logger.error(`Discord 切断エラー: ${error}`);
      throw error;
    }
  }

  isReady(): boolean {
    return this.client.isReady();
  }

  getChannelInfo() {
    if (!this.client.isReady()) {
      return null;
    }

    const channel = this.client.channels.cache.get(this.options.channelId);
    return channel;
  }
} 