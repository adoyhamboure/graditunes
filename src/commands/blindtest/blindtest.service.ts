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
  StringSelectMenuBuilder,
} from 'discord.js';
import { BlindtestState } from './types';
import { StreamingService } from '../streaming/streaming.service';
import { DeepseekService } from './deepseek.service';
import { GPTService } from './gpt.service';
import { distance } from 'fastest-levenshtein';
import { AnswerDto } from './answer.dto';

@Injectable()
export class BlindtestService implements OnModuleInit {
  private readonly logger = new Logger(BlindtestService.name);
  private blindtestStates = new Map<string, BlindtestState>();

  constructor(
    private readonly streamingService: StreamingService,
    private readonly deepseekService: DeepseekService,
    private readonly gptService: GPTService,
  ) {}

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
        difficulty: 'moyen', // Difficulté par défaut
        aiProvider: 'deepseek', // IA par défaut
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

    // Créer le menu de sélection de l'IA
    const aiSelect = new StringSelectMenuBuilder()
      .setCustomId('ai_select')
      .setPlaceholder("Sélectionnez l'IA à utiliser")
      .addOptions([
        {
          label: 'Deepseek',
          description: 'IA rapide et efficace',
          value: 'deepseek',
        },
        {
          label: 'GPT-4',
          description: 'IA plus sophistiquée',
          value: 'gpt',
        },
      ]);

    const aiRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      aiSelect,
    );

    // Créer l'embed d'information
    const embed = new EmbedBuilder()
      .setTitle('🎮 Configuration du Blindtest')
      .setDescription(
        "Sélectionnez d'abord l'IA à utiliser, puis la difficulté, et enfin remplissez le formulaire.",
      )
      .setColor('#0099ff');

    // Envoyer le message avec le menu de sélection
    const message = await interaction.reply({
      embeds: [embed],
      components: [aiRow],
      flags: 64,
    });

    // Créer le collector pour le menu de sélection de l'IA
    const aiCollector = message.createMessageComponentCollector({
      time: 60000, // 1 minute
    });

    aiCollector.on('collect', (i) => {
      if (i.customId === 'ai_select' && 'values' in i) {
        const aiProviderValue = i.values[0];
        // Vérifier que la valeur est bien 'deepseek' ou 'gpt'
        if (aiProviderValue !== 'deepseek' && aiProviderValue !== 'gpt') {
          this.logger.error(`Invalid AI provider value: ${aiProviderValue}`);
          return;
        }
        const state = this.getBlindtestState(i.guildId!);
        state.aiProvider = aiProviderValue;

        // Créer le menu de sélection de difficulté
        const difficultySelect = new StringSelectMenuBuilder()
          .setCustomId('difficulty_select')
          .setPlaceholder('Sélectionnez la difficulté')
          .addOptions([
            {
              label: 'Facile',
              description: 'Questions simples et reconnaissables',
              value: 'facile',
            },
            {
              label: 'Moyen',
              description: 'Questions moyennement difficiles',
              value: 'moyen',
            },
            {
              label: 'Difficile',
              description: 'Questions pour les experts',
              value: 'difficile',
            },
            {
              label: 'Impossible',
              description: 'Questions extrêmement difficiles',
              value: 'impossible',
            },
          ]);

        const difficultyRow =
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            difficultySelect,
          );

        // Mettre à jour le message avec le menu de difficulté
        void i.update({
          embeds: [embed],
          components: [difficultyRow],
        });

        // Créer le collector pour le menu de sélection de difficulté
        const difficultyCollector = message.createMessageComponentCollector({
          time: 60000,
        });

        difficultyCollector.on('collect', (j) => {
          if (j.customId === 'difficulty_select' && 'values' in j) {
            const difficulty = j.values[0];
            state.difficulty = difficulty;

            // Créer le modal avec la difficulté sélectionnée
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

            const promptInput = new TextInputBuilder()
              .setCustomId('prompt_input')
              .setLabel('Thème du blindtest')
              .setPlaceholder('ex: musique de jeux vidéo')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(100);

            const questionCountInput = new TextInputBuilder()
              .setCustomId('question_count_input')
              .setLabel('Nombre de questions')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue('10')
              .setMaxLength(2);

            const answerTypeInput = new TextInputBuilder()
              .setCustomId('answer_type_input')
              .setLabel('Type de réponse attendu')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('ex: nom du jeu, artiste, titre de la musique')
              .setMaxLength(50);

            const firstActionRow =
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                durationInput,
              );
            const secondActionRow =
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                promptInput,
              );
            const thirdActionRow =
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                questionCountInput,
              );
            const fourthActionRow =
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                answerTypeInput,
              );

            modal.addComponents(
              firstActionRow,
              secondActionRow,
              thirdActionRow,
              fourthActionRow,
            );

            void j.showModal(modal);
          }
        });

        difficultyCollector.on('end', () => {
          // Désactiver le menu de sélection de difficulté une fois le temps écoulé
          const disabledDifficultySelect = new StringSelectMenuBuilder()
            .setCustomId('difficulty_select')
            .setPlaceholder('Sélectionnez la difficulté')
            .addOptions([
              {
                label: 'Facile',
                description: 'Questions simples et reconnaissables',
                value: 'facile',
              },
              {
                label: 'Moyen',
                description: 'Questions moyennement difficiles',
                value: 'moyen',
              },
              {
                label: 'Difficile',
                description: 'Questions pour les experts',
                value: 'difficile',
              },
              {
                label: 'Impossible',
                description: 'Questions extrêmement difficiles',
                value: 'impossible',
              },
            ])
            .setDisabled(true);

          const disabledDifficultyRow =
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              disabledDifficultySelect,
            );
          void interaction.editReply({
            components: [disabledDifficultyRow],
          });
        });
      }
    });

    aiCollector.on('end', () => {
      // Désactiver le menu de sélection de l'IA une fois le temps écoulé
      const disabledAiSelect = new StringSelectMenuBuilder()
        .setCustomId('ai_select')
        .setPlaceholder("Sélectionnez l'IA à utiliser")
        .addOptions([
          {
            label: 'Deepseek',
            description: 'IA rapide et efficace',
            value: 'deepseek',
          },
          {
            label: 'GPT-4',
            description: 'IA plus sophistiquée',
            value: 'gpt',
          },
        ])
        .setDisabled(true);

      const disabledAiRow =
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          disabledAiSelect,
        );
      void interaction.editReply({ components: [disabledAiRow] });
    });
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
    const prompt = interaction.fields.getTextInputValue('prompt_input');
    const questionCount = parseInt(
      interaction.fields.getTextInputValue('question_count_input'),
      10,
    );
    const answerType =
      interaction.fields.getTextInputValue('answer_type_input');

    if (isNaN(duration) || duration < 10 || duration > 300) {
      await interaction.reply({
        content: 'La durée doit être un nombre entre 10 et 300 secondes.',
        flags: 64, // Ephemeral
      });
      return;
    }

    if (isNaN(questionCount) || questionCount < 1 || questionCount > 50) {
      await interaction.reply({
        content: 'Le nombre de questions doit être entre 1 et 50.',
        flags: 64, // Ephemeral
      });
      return;
    }

    state.duration = duration;

    // Répondre immédiatement avec un message de chargement
    await interaction.reply({
      content: '🎵 Génération du blindtest en cours...',
      flags: 64, // Ephemeral
    });

    try {
      // Générer le blindtest avec l'IA sélectionnée
      if (interaction.channel?.isTextBased()) {
        const textChannel = interaction.channel as TextChannel;
        await textChannel.send(
          `🤖 Génération des questions avec ${state.aiProvider === 'gpt' ? 'GPT-4' : 'Deepseek'}...`,
        );
      }

      const blindtest = await (
        state.aiProvider === 'gpt' ? this.gptService : this.deepseekService
      ).generateBlindtest(prompt, questionCount, answerType, state.difficulty);

      if (interaction.channel?.isTextBased()) {
        const textChannel = interaction.channel as TextChannel;
        await textChannel.send('Recherche des vidéos YouTube...');
      }

      // Pour chaque question, chercher une URL YouTube correspondante
      let foundVideos = 0;
      const batchSize = 5; // Traiter les questions par lots

      for (let i = 0; i < blindtest.questions.length; i += batchSize) {
        const batch = blindtest.questions.slice(i, i + batchSize);

        // Attendre entre chaque lot pour éviter de surcharger l'API
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        for (const question of batch) {
          try {
            const searchQuery = `${question.youtubeSearch}`;
            this.logger.log(`Recherche YouTube pour: ${searchQuery}`);

            const videoUrl =
              await this.streamingService.searchAndGetVideoUrl(searchQuery);
            if (!videoUrl) {
              this.logger.warn(
                `Aucune URL YouTube trouvée pour la question: ${searchQuery}`,
              );
              continue;
            }
            question.url = videoUrl;
            foundVideos++;
            this.logger.log(`Vidéo trouvée pour: ${searchQuery}`);
          } catch (error) {
            this.logger.error(
              `Erreur lors de la recherche de l'URL YouTube pour la question: ${error}`,
            );
          }
        }

        // Mettre à jour le message de progression
        if (interaction.channel?.isTextBased()) {
          const textChannel = interaction.channel as TextChannel;
          const progress = Math.round(
            (foundVideos / blindtest.questions.length) * 100,
          );
          await textChannel.send(
            `🎵 Recherche des vidéos en cours... ${foundVideos}/${blindtest.questions.length} (${progress}%)`,
          );
        }
      }

      // Vérifier si toutes les questions ont une URL
      const questionsWithoutUrl = blindtest.questions.filter((q) => !q.url);
      if (questionsWithoutUrl.length > 0) {
        this.logger.warn(
          `${questionsWithoutUrl.length} questions n'ont pas d'URL YouTube`,
        );
        if (interaction.channel?.isTextBased()) {
          const textChannel = interaction.channel as TextChannel;
          await textChannel.send(
            `⚠️ ${questionsWithoutUrl.length} questions n'ont pas de vidéo associée`,
          );
        }
      }

      if (interaction.channel?.isTextBased()) {
        const textChannel = interaction.channel as TextChannel;
        await textChannel.send(
          `✅ ${foundVideos} vidéos trouvées sur ${blindtest.questions.length} questions`,
        );
      }

      state.blindtest = blindtest;
      state.isActive = false;
      state.currentQuestionIndex = 0;
      state.scores.clear();

      const embed = new EmbedBuilder()
        .setTitle('🎮 Blindtest Prêt !')
        .setDescription(
          `Thème: **${blindtest.theme}**\nNombre de questions: **${blindtest.questions.length}**\nDurée par question: **${duration} secondes**\nType de réponse attendu: **${blindtest.answerType}**\nDifficulté: **${state.difficulty}**\nIA utilisée: **${state.aiProvider === 'gpt' ? 'GPT-4' : 'Deepseek'}**\nVidéos trouvées: **${foundVideos}/${blindtest.questions.length}**`,
        )
        .setColor('#00ff00');

      // Envoyer le message final dans le canal
      if (interaction.channel?.isTextBased()) {
        const textChannel = interaction.channel as TextChannel;
        await textChannel.send({ embeds: [embed] });
      }
    } catch (error) {
      this.logger.error(`Error preparing blindtest: ${error}`);
      // Envoyer le message d'erreur dans le canal
      if (interaction.channel?.isTextBased()) {
        const textChannel = interaction.channel as TextChannel;
        await textChannel.send({
          content:
            'Une erreur est survenue lors de la préparation du blindtest. Veuillez réessayer.',
        });
      }
    }
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

    // Vérifier si le blindtest est toujours actif
    if (!state.isActive) {
      return;
    }

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
          let videoUrl = currentQuestion.url;

          // Si l'URL n'est pas définie, rechercher la vidéo avec youtubeSearch
          if (!videoUrl && currentQuestion.youtubeSearch) {
            videoUrl = await this.streamingService.searchAndGetVideoUrl(
              currentQuestion.youtubeSearch,
            );
          }

          if (!videoUrl) {
            throw new Error('URL de la musique non définie');
          }

          await this.streamingService.playMusic(
            interaction.guildId,
            voiceChannel.id,
            videoUrl,
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
          `Question ${state.currentQuestionIndex + 1}/${state.blindtest!.questions.length}\nType de réponse attendu: **${state.blindtest!.answerType}**\nCliquez sur le bouton ci-dessous pour répondre !`,
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
        const embed = new EmbedBuilder()
          .setTitle('⏰ Temps écoulé !')
          .setDescription(
            `La réponse était : **${currentQuestion.displayableAnswer}**\nTitre : **${currentQuestion.meta.title}**\nCompositeur : **${currentQuestion.meta.composer}**`,
          )
          .setColor('#ff0000');

        if (interaction.channel?.isTextBased()) {
          const textChannel = interaction.channel as TextChannel;
          void textChannel.send({ embeds: [embed] });
        }

        // Vérifier si le blindtest est toujours actif avant de continuer
        if (!state.isActive) {
          return;
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
              // Vérifier si le blindtest est toujours actif avant de continuer
              if (!state.isActive) {
                return;
              }
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
        `La réponse était : **${currentQuestion.displayableAnswer}**\nTitre : **${currentQuestion.meta.title}**\nCompositeur : **${currentQuestion.meta.composer}**`,
      )
      .setColor('#00ff00');

    await textChannel.send({ embeds: [embed] });

    // Attendre 5 secondes
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Vérifier si le blindtest est toujours actif avant de continuer
    if (!state.isActive) {
      return;
    }

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

  @SlashCommand({
    name: 'blindtest-stop',
    description: 'Arrête le blindtest en cours et affiche les scores',
  })
  public async onBlindtestStop(
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
    if (!state.isActive || !state.blindtest) {
      await interaction.reply({
        content: "Aucun blindtest n'est en cours.",
        flags: 64, // Ephemeral
      });
      return;
    }

    // Arrêter la musique
    if (interaction.guildId) {
      const player = this.streamingService.getPlayer(interaction.guildId);
      if (player) {
        player.stop();
      }
    }

    // Nettoyer le timeout en cours
    if (state.currentTimeout) {
      clearTimeout(state.currentTimeout);
      state.currentTimeout = undefined;
    }

    // Désactiver le blindtest
    state.isActive = false;

    const embed = new EmbedBuilder()
      .setTitle('🏁 Blindtest Arrêté !')
      .setDescription('Voici les scores finaux :')
      .setColor('#ffd700');

    const scores = Array.from(state.scores.entries()).sort(
      (a, b) => b[1] - a[1],
    );

    if (scores.length === 0) {
      embed.addFields({
        name: 'Aucun point',
        value: "Personne n'a marqué de points dans ce blindtest.",
      });
    } else {
      for (const [userId, score] of scores) {
        const user = await interaction.client.users.fetch(userId);
        embed.addFields({ name: user.username, value: `${score} points` });
      }
    }

    await interaction.reply({ embeds: [embed] });
  }
}
