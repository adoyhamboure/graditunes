import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NecordModule } from 'necord';
import { GatewayIntentBits } from 'discord.js';
import { MusicModule } from './modules/music/music.module';
import { AiModule } from './modules/ai/ai.module';
import { GamesModule } from './modules/games/games.module';
import { CommonModule } from './modules/common/common.module';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    NecordModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        token: configService.get<string>('DISCORD_TOKEN') || '',
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildVoiceStates,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
        development: [
          configService.get<string>('DISCORD_DEVELOPMENT_GUILD_ID') || '',
        ],
      }),
    }),
    MusicModule,
    AiModule,
    GamesModule,
    CommonModule,
  ],
  controllers: [],
  providers: [AppService],
})
export class AppModule {}
