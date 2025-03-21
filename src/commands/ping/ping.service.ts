import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Context, SlashCommand, SlashCommandContext } from 'necord';

@Injectable()
export class PingService implements OnModuleInit {
  private readonly logger = new Logger(PingService.name);

  public onModuleInit() {
    this.logger.log('PingService has been initialized!');
  }

  @SlashCommand({
    name: 'ping',
    description: 'Responds with pong!',
  })
  public async onPing(@Context() [interaction]: SlashCommandContext) {
    return interaction.reply({ content: 'Pong!' });
  }
}
