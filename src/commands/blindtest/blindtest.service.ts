import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Context, Options, SlashCommand, SlashCommandContext } from 'necord';
import {
  EmbedBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  GuildMember,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
} from 'discord.js';
import { Blindtest, BlindtestState } from './types';
import { StreamingService } from '../streaming/streaming.service';
import { distance } from 'fastest-levenshtein';
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
        isQuestionSolved: false,
        duration: 30, // Durée par défaut de 30 secondes
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
        flags: 64, // Ephemeral
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('blindtest_prepare_modal')
      .setTitle('Configuration du Blindtest');

    const durationInput = new TextInputBuilder()
      .setCustomId('duration_input')
      .setLabel('Durée par question (en secondes)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue('30')
      .setMaxLength(3);

    const firstActionRow =
      new ActionRowBuilder<TextInputBuilder>().addComponents(durationInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
  }

  public async handleBlindtestPrepareModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'Cette commande ne peut être utilisée que dans un serveur.',
        flags: 64, // Ephemeral
      });
      return;
    }

    const state = this.getBlindtestState(interaction.guild.id);
    const duration = parseInt(
      interaction.fields.getTextInputValue('duration_input'),
      10,
    );

    if (isNaN(duration) || duration < 10 || duration > 300) {
      await interaction.reply({
        content: 'La durée doit être un nombre entre 10 et 300 secondes.',
        flags: 64, // Ephemeral
      });
      return;
    }

    state.duration = duration;

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
        `Thème: **${blindtest.theme}**\nNombre de questions: **${blindtest.questions.length}**\nDurée par question: **${duration} secondes**`,
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
        flags: 64, // Ephemeral
      });
      return;
    }

    const state = this.getBlindtestState(interaction.guild.id);

    if (!state.blindtest) {
      await interaction.reply({
        content:
          "Aucun blindtest n'est préparé. Utilisez `/blindtest-prepare` d'abord.",
        flags: 64, // Ephemeral
      });
      return;
    }

    if (state.isActive) {
      await interaction.reply({
        content: 'Un blindtest est déjà en cours !',
        flags: 64, // Ephemeral
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
    state.isQuestionSolved = false; // Réinitialiser l'état pour la nouvelle question

    // Nettoyer le timeout précédent s'il existe
    if (state.currentTimeout) {
      clearTimeout(state.currentTimeout);
      state.currentTimeout = undefined;
    }

    const currentQuestion =
      state.blindtest!.questions[state.currentQuestionIndex];

    // Afficher les scores actuels
    if (interaction.channel?.isTextBased()) {
      const textChannel = interaction.channel as TextChannel;
      const scores = Array.from(state.scores.entries()).sort(
        (a, b) => b[1] - a[1],
      );

      if (scores.length > 0 && scores.some(([, score]) => score > 0)) {
        const scoresEmbed = new EmbedBuilder()
          .setTitle('🎯 Scores actuels')
          .setColor('#00ff00');

        for (const [userId, score] of scores) {
          const user = await interaction.client.users.fetch(userId);
          scoresEmbed.addFields({
            name: user.username,
            value: `${score} points`,
          });
        }

        await textChannel.send({ embeds: [scoresEmbed] });
      }
    }

    // Jouer la musique directement avec playMusic
    if (interaction.guildId && interaction.member && interaction.guild) {
      const member = interaction.member as GuildMember;
      const voiceChannel = member.voice.channel;
      if (voiceChannel) {
        try {
          await this.streamingService.playMusic(
            interaction.guildId,
            voiceChannel.id,
            currentQuestion.url,
            { voiceAdapterCreator: interaction.guild.voiceAdapterCreator },
          );
        } catch (error) {
          this.logger.error(
            `Erreur lors de la lecture de la musique: ${error}`,
          );

          // Envoyer un message d'erreur dans le canal de texte
          if (interaction.channel?.isTextBased()) {
            const textChannel = interaction.channel as TextChannel;
            const errorEmbed = new EmbedBuilder()
              .setTitle('❌ Erreur de lecture')
              .setDescription(
                'Une erreur est survenue lors de la lecture de la musique. Passage à la question suivante...',
              )
              .setColor('#ff0000');

            await textChannel.send({ embeds: [errorEmbed] });
          }

          // Passer à la question suivante
          state.currentQuestionIndex++;
          if (state.currentQuestionIndex < state.blindtest!.questions.length) {
            if (interaction.channel?.isTextBased()) {
              const textChannel = interaction.channel as TextChannel;
              await textChannel.send('🎵 Question suivante...');
            }
            await this.playCurrentQuestion(interaction);
          } else {
            await this.endBlindtest(interaction);
          }
          return;
        }
      }
    }

    // Créer le bouton de réponse
    const answerButton = new ButtonBuilder()
      .setCustomId('answer_question')
      .setLabel('Répondre')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✍️');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      answerButton,
    );

    // Envoyer le message avec les instructions et le bouton
    if (interaction.channel?.isTextBased()) {
      const textChannel = interaction.channel as TextChannel;
      const questionEmbed = new EmbedBuilder()
        .setTitle('🎵 Question en cours')
        .setDescription(
          `Question ${state.currentQuestionIndex + 1}/${state.blindtest!.questions.length}\nCliquez sur le bouton ci-dessous pour répondre !`,
        )
        .setColor('#0099ff');

      const message = await textChannel.send({
        embeds: [questionEmbed],
        components: [row],
      });

      // Stocker le message ID dans l'état
      state.currentMessageId = message.id;

      // Ajouter le gestionnaire de bouton
      const collector = message.createMessageComponentCollector({
        time: 20000,
      });

      collector.on('collect', (i) => {
        if (i.customId === 'answer_question' && !state.isQuestionSolved) {
          const modal = new ModalBuilder()
            .setCustomId('answer_modal')
            .setTitle('Répondre à la question');

          const answerInput = new TextInputBuilder()
            .setCustomId('answer_input')
            .setLabel('Votre réponse')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100);

          const firstActionRow =
            new ActionRowBuilder<TextInputBuilder>().addComponents(answerInput);
          modal.addComponents(firstActionRow);

          void i.showModal(modal);
        }
      });

      collector.on('end', () => {
        // Supprimer le bouton une fois le temps écoulé
        void message.edit({ components: [] });
      });
    }

    // Attendre 20 secondes avant de passer à la question suivante
    state.currentTimeout = setTimeout(() => {
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
          // Utiliser le canal de texte pour envoyer un message
          if (interaction.channel?.isTextBased()) {
            const textChannel = interaction.channel as TextChannel;
            void textChannel.send('🎵 Question suivante dans 5 secondes...');

            // Attendre 5 secondes
            setTimeout(() => {
              void textChannel.send('🎵 Question suivante...');
              void this.playCurrentQuestion(interaction);
            }, 5000);
          }
        } else {
          // Arrêter la musique avant de terminer le blindtest
          if (interaction.guildId) {
            const player = this.streamingService.getPlayer(interaction.guildId);
            if (player) {
              player.stop();
            }
          }
          void this.endBlindtest(interaction);
        }
      }
    }, state.duration * 1000); // Convertir les secondes en millisecondes
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
        flags: 64, // Ephemeral
      });
      return;
    }

    const state = this.getBlindtestState(interaction.guild.id);
    if (!state.isActive || !state.blindtest) {
      await interaction.reply({
        content: "Aucun blindtest n'est en cours.",
        flags: 64, // Ephemeral
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
        flags: 64, // Ephemeral
      });
    } else {
      await interaction.reply({
        content: '❌ Incorrect, essayez encore !',
        flags: 64, // Ephemeral
      });
    }
  }

  private checkAllPlayersAnswered(
    interaction: ModalSubmitInteraction,
    state: BlindtestState,
  ): boolean {
    if (!interaction.guild) return false;

    const voiceChannel = (interaction.member as GuildMember).voice.channel;
    if (!voiceChannel) return false;

    // Obtenir tous les membres du salon vocal
    const voiceMembers = voiceChannel.members;

    // Vérifier si tous les membres ont répondu correctement
    for (const [memberId, member] of voiceMembers) {
      // Ignorer les bots
      if (member.user.bot) continue;

      // Vérifier si le membre a des points dans le score
      if (!state.scores.has(memberId)) {
        return false;
      }
    }

    return true;
  }

  private async handleAllPlayersAnswered(
    interaction: ModalSubmitInteraction,
    state: BlindtestState,
  ): Promise<void> {
    if (!interaction.guild) return;

    const textChannel = interaction.channel as TextChannel;
    const currentQuestion =
      state.blindtest!.questions[state.currentQuestionIndex];

    const embed = new EmbedBuilder()
      .setTitle('🎉 Tous les joueurs ont trouvé la réponse !')
      .setDescription(
        `La réponse était : **${currentQuestion.meta.source}**\nTitre : **${currentQuestion.meta.title}**\nCompositeur : **${currentQuestion.meta.composer}**`,
      )
      .setColor('#00ff00');

    await textChannel.send({ embeds: [embed] });

    // Attendre 5 secondes
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Passer à la question suivante ou terminer le blindtest
    state.currentQuestionIndex++;
    if (state.currentQuestionIndex < state.blindtest!.questions.length) {
      await textChannel.send('🎵 Question suivante...');
      // Créer un ChatInputCommandInteraction factice pour playCurrentQuestion
      const fakeInteraction = {
        ...interaction,
        guild: interaction.guild,
        guildId: interaction.guildId,
        channel: interaction.channel,
        member: interaction.member,
        client: interaction.client,
      } as unknown as ChatInputCommandInteraction;
      await this.playCurrentQuestion(fakeInteraction);
    } else {
      // Arrêter la musique avant de terminer le blindtest
      if (interaction.guildId) {
        const player = this.streamingService.getPlayer(interaction.guildId);
        if (player) {
          player.stop();
        }
      }
      // Créer un ChatInputCommandInteraction factice pour endBlindtest
      const fakeInteraction = {
        ...interaction,
        guild: interaction.guild,
        guildId: interaction.guildId,
        channel: interaction.channel,
        member: interaction.member,
        client: interaction.client,
      } as unknown as ChatInputCommandInteraction;
      await this.endBlindtest(fakeInteraction);
    }
  }

  public async handleAnswerModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'Cette commande ne peut être utilisée que dans un serveur.',
        flags: 64, // Ephemeral
      });
      return;
    }

    const state = this.getBlindtestState(interaction.guild.id);
    if (!state.isActive || !state.blindtest) {
      await interaction.reply({
        content: "Aucun blindtest n'est en cours.",
        flags: 64, // Ephemeral
      });
      return;
    }

    const currentQuestion =
      state.blindtest.questions[state.currentQuestionIndex];
    const userAnswer = interaction.fields.getTextInputValue('answer_input');

    // Vérifier si la réponse est correcte avec une distance de Levenshtein acceptable
    const isCorrect = currentQuestion.acceptable_answers.some(
      (answer) => distance(userAnswer.toLowerCase(), answer.toLowerCase()) <= 2,
    );

    if (isCorrect && !state.isQuestionSolved) {
      state.isQuestionSolved = true;
      const currentScore = state.scores.get(interaction.user.id) || 0;
      state.scores.set(interaction.user.id, currentScore + 1);

      // Désactiver le bouton dans le message
      if (interaction.channel?.isTextBased() && state.currentMessageId) {
        try {
          const textChannel = interaction.channel as TextChannel;
          const message = await textChannel.messages.fetch(
            state.currentMessageId,
          );
          if (message) {
            const disabledButton = new ButtonBuilder()
              .setCustomId('answer_question')
              .setLabel('Répondu')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('✅')
              .setDisabled(true);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
              disabledButton,
            );
            await message.edit({ components: [row] });
          }
        } catch (error) {
          this.logger.error(
            `Erreur lors de la désactivation du bouton: ${error}`,
          );
        }
      }

      // Envoyer un message public pour la bonne réponse
      if (interaction.channel?.isTextBased()) {
        const textChannel = interaction.channel as TextChannel;
        const correctAnswerEmbed = new EmbedBuilder()
          .setTitle('🎉 Bonne réponse !')
          .setDescription(
            `${interaction.user.username} a trouvé la bonne réponse !`,
          )
          .setColor('#00ff00');

        void textChannel.send({ embeds: [correctAnswerEmbed] });
      }

      await interaction.reply({
        content: '✅ Correct ! +1 point',
        flags: 64, // Ephemeral
      });

      // Vérifier si tous les joueurs ont répondu
      const allPlayersAnswered = this.checkAllPlayersAnswered(
        interaction,
        state,
      );
      if (allPlayersAnswered) {
        await this.handleAllPlayersAnswered(interaction, state);
      }
    } else if (state.isQuestionSolved) {
      await interaction.reply({
        content: '❌ Cette question a déjà été résolue !',
        flags: 64, // Ephemeral
      });
    } else {
      await interaction.reply({
        content: '❌ Incorrect, essayez encore !',
        flags: 64, // Ephemeral
      });
    }
  }
}
