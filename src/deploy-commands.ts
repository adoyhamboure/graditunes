import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { REST, Routes } from 'discord.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const token = configService.get<string>('DISCORD_TOKEN');
  const clientId = configService.get<string>('CLIENT_ID');
  const guildId = configService.get<string>('DISCORD_DEVELOPMENT_GUILD_ID');

  if (!token || !clientId) {
    console.error(
      'Missing required environment variables: DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID',
    );
    await app.close();
    return;
  }

  const rest = new REST().setToken(token);

  try {
    console.log('Started removing application commands...');

    // Supprimer toutes les commandes globales
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log('Successfully removed all global commands.');

    // Supprimer toutes les commandes spécifiques au serveur de développement
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: [],
      });
      console.log('Successfully removed all guild commands.');
    }

    console.log('All commands have been removed.');
    console.log("The bot will now use Necord's built-in command registration.");
  } catch (error) {
    console.error('Error removing commands:', error);
  }

  await app.close();
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
