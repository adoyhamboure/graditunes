import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { NecordModule } from 'necord';
import { GatewayIntentBits } from 'discord.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CommandsModule } from './commands/commands.module';

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
    CommandsModule,
  ],
  providers: [AppService],
})
export class AppModule {}
