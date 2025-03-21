import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';

config();

const rest = new REST().setToken(process.env.DISCORD_TOKEN || '');

void (async () => {
  try {
    console.log('Started removing application commands...');

    // Remove global commands
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID || ''), {
      body: [],
    });
    console.log('Successfully removed all global commands.');

    // Remove guild-specific commands
    if (process.env.DISCORD_DEVELOPMENT_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(
          process.env.CLIENT_ID || '',
          process.env.DISCORD_DEVELOPMENT_GUILD_ID,
        ),
        { body: [] },
      );
      console.log('Successfully removed all guild-specific commands.');
    }

    console.log(
      "All commands have been removed. The bot will now use Necord's built-in command registration.",
    );
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error removing commands:', error.message);
    } else {
      console.error('Unknown error removing commands:', error);
    }
  }
})();
