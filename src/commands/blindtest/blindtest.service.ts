import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext } from 'necord';
import {
  EmbedBuilder,
  ChatInputCommandInteraction,
  TextChannel,
} from 'discord.js';
import { Blindtest, BlindtestState } from './types';
import { StreamingService } from '../streaming/streaming.service';
import { distance } from 'fastest-levenshtein';
import { PlayDto } from '../streaming/play.dto';
import { AnswerDto } from './answer.dto';

@Injectable()
export class BlindtestService implements OnModuleInit {
  private readonly logger = new Logger(BlindtestService.name);
  private blindtestStates = new Map<string, BlindtestState>();

  constructor(private readonly streamingService: StreamingService) {}

  public onModuleInit() {
    this.logger.log('BlindtestService has been initialized!');
  }

  private getBlindtestState(guildId: string): BlindtestState {
    if (!this.blindtestStates.has(guildId)) {
      this.blindtestStates.set(guildId, {
        isActive: false,
        currentQuestionIndex: 0,
        scores: new Map(),
        blindtest: null,
      });
    }
    return this.blindtestStates.get(guildId)!;
  }

  @SlashCommand({
    name: 'blindtest-prepare',
    description: 'Prépare un blindtest avec un thème spécifique',
  })
  public async onBlindtestPrepare(
    @Context() [interaction]: SlashCommandContext,
  ): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'Cette commande ne peut être utilisée que dans un serveur.',
        ephemeral: true,
      });
      return;
    }

    const state = this.getBlindtestState(interaction.guild.id);

    // Pour l'instant, on utilise un blindtest en dur
    const blindtest: Blindtest = {
      theme: 'Video Game Soundtracks',
      questions: [
        {
          url: 'https://www.youtube.com/watch?v=aQ6Fq-LfDZQ&list=RDaQ6Fq-LfDZQ&start_radio=1',
          acceptable_answers: [
            'The Legend of Zelda: Ocarina of Time',
            'Zelda: Ocarina of Time',
            'Ocarina of Time',
          ],
          meta: {
            type: 'video game',
            source: 'The Legend of Zelda: Ocarina of Time',
            title: 'Gerudo Valley',
            composer: 'Koji Kondo',
          },
        },
        {
          url: 'https://www.youtube.com/watch?v=wDgQdr8ZkTw&list=RDwDgQdr8ZkTw&start_radio=1',
          acceptable_answers: ['Undertale'],
          meta: {
            type: 'video game',
            source: 'Undertale',
            title: 'Megalovania',
            composer: 'Toby Fox',
          },
        },
      ],
    };

    state.blindtest = blindtest;
    state.isActive = false;
    state.currentQuestionIndex = 0;
    state.scores.clear();

    const embed = new EmbedBuilder()
      .setTitle('🎮 Blindtest Prêt !')
      .setDescription(
        `Thème: **${blindtest.theme}**\nNombre de questions: **${blindtest.questions.length}**`,
      )
      .setColor('#00ff00');

    await interaction.reply({ embeds: [embed] });
  }

  @SlashCommand({
    name: 'blindtest-start',
    description: 'Démarre le blindtest',
  })
  public async onBlindtestStart(
    @Context() [interaction]: SlashCommandContext,
  ): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'Cette commande ne peut être utilisée que dans un serveur.',
        ephemeral: true,
      });
      return;
    }

    const state = this.getBlindtestState(interaction.guild.id);

    if (!state.blindtest) {
      await interaction.reply({
        content:
          "Aucun blindtest n'est préparé. Utilisez `/blindtest-prepare` d'abord.",
        ephemeral: true,
      });
      return;
    }

    if (state.isActive) {
      await interaction.reply({
        content: 'Un blindtest est déjà en cours !',
        ephemeral: true,
      });
      return;
    }

    state.isActive = true;
    await this.playCurrentQuestion(interaction as ChatInputCommandInteraction);
  }

  private async playCurrentQuestion(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.guild) return;

    const state = this.getBlindtestState(interaction.guild.id);
    const currentQuestion =
      state.blindtest!.questions[state.currentQuestionIndex];

    // Jouer la musique
    const playDto = new PlayDto();
    playDto.url = currentQuestion.url;
    await this.streamingService.onPlay(
      [interaction] as SlashCommandContext,
      playDto,
    );

    // Envoyer le message avec les instructions
    if (interaction.channel?.isTextBased()) {
      const textChannel = interaction.channel as TextChannel;
      const questionEmbed = new EmbedBuilder()
        .setTitle('🎵 Question en cours')
        .setDescription(
          `Question ${state.currentQuestionIndex + 1}/${state.blindtest!.questions.length}\nUtilisez la commande \`/answer\` pour répondre !`,
        )
        .setColor('#0099ff');

      await textChannel.send({ embeds: [questionEmbed] });
    }

    // Attendre 30 secondes avant de passer à la question suivante
    setTimeout(() => {
      if (state.isActive) {
        const correctAnswer = currentQuestion.meta.source;
        const embed = new EmbedBuilder()
          .setTitle('⏰ Temps écoulé !')
          .setDescription(
            `La réponse était : **${correctAnswer}**\nTitre : **${currentQuestion.meta.title}**\nCompositeur : **${currentQuestion.meta.composer}**`,
          )
          .setColor('#ff0000');

        if (interaction.channel?.isTextBased()) {
          const textChannel = interaction.channel as TextChannel;
          void textChannel.send({ embeds: [embed] });
        }

        // Passer à la question suivante
        state.currentQuestionIndex++;
        if (state.currentQuestionIndex < state.blindtest!.questions.length) {
          void this.playCurrentQuestion(interaction);
        } else {
          void this.endBlindtest(interaction);
        }
      }
    }, 30000);
  }

  private async endBlindtest(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.guild) return;

    const state = this.getBlindtestState(interaction.guild.id);
    state.isActive = false;

    const embed = new EmbedBuilder()
      .setTitle('🏆 Blindtest Terminé !')
      .setDescription('Voici les scores :')
      .setColor('#ffd700');

    const scores = Array.from(state.scores.entries()).sort(
      (a, b) => b[1] - a[1],
    );

    for (const [userId, score] of scores) {
      const user = await interaction.client.users.fetch(userId);
      embed.addFields({ name: user.username, value: `${score} points` });
    }

    if (interaction.channel?.isTextBased()) {
      const textChannel = interaction.channel as TextChannel;
      await textChannel.send({ embeds: [embed] });
    }
  }

  @SlashCommand({
    name: 'answer',
    description: 'Donne une réponse pour le blindtest en cours',
  })
  public async onAnswer(
    @Context() [interaction]: SlashCommandContext,
    @Options() { reponse }: AnswerDto,
  ): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'Cette commande ne peut être utilisée que dans un serveur.',
        ephemeral: true,
      });
      return;
    }

    const state = this.getBlindtestState(interaction.guild.id);
    if (!state.isActive || !state.blindtest) {
      await interaction.reply({
        content: "Aucun blindtest n'est en cours.",
        ephemeral: true,
      });
      return;
    }

    const currentQuestion =
      state.blindtest.questions[state.currentQuestionIndex];
    const userAnswer = reponse;

    // Vérifier si la réponse est correcte avec une distance de Levenshtein acceptable
    const isCorrect = currentQuestion.acceptable_answers.some(
      (answer) => distance(userAnswer.toLowerCase(), answer.toLowerCase()) <= 2,
    );

    if (isCorrect) {
      const currentScore = state.scores.get(interaction.user.id) || 0;
      state.scores.set(interaction.user.id, currentScore + 1);

      await interaction.reply({
        content: '✅ Correct ! +1 point',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: '❌ Incorrect, essayez encore !',
        ephemeral: true,
      });
    }
  }
}
