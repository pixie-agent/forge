import type { DictKey } from './dict.zh'

/**
 * Dictionnaire français. Reflète `dict.zh.ts` clé par clé ; le type ci-dessous fait
 * d'une clé manquante une erreur de compilation, donc aucune chaîne ne peut
 * être livrée non traduite par inadvertance.
 */
export const fr: Record<DictKey, string> = {
  // ---------- commun ----------
  'common.loading': 'Chargement…',
  'common.copy': 'Copier',
  'common.copied': 'Copié ✓',
  'common.delete': 'Supprimer',
  'common.cancel': 'Annuler',
  'common.confirm': 'Confirmer',
  'common.save': 'Enregistrer',
  'common.saving': 'Enregistrement…',
  'common.close': 'Fermer',
  'common.retry': 'Réessayer',
  'common.open': 'Ouvrir',
  'common.refresh': 'Actualiser',
  'common.empty': '—',
  'common.unknown': 'Inconnu',
  'common.yes': 'Oui',
  'common.no': 'Non',
  'common.search': 'Rechercher',
  'common.language': 'Langue',
  'common.version': 'Version',
  'common.more': 'Plus d’actions',

  // ---------- thème / environnement ----------
  'theme.toLight': 'Passer au thème clair',
  'theme.toDark': 'Passer au thème sombre',
  'theme.toggle': 'Changer de thème',
  'env.stagingHint': 'Ceci est un environnement de test : les données et les artefacts sont totalement isolés de la production',

  // ---------- barre supérieure ----------
  'topbar.credits': 'Crédits',
  'topbar.logout': 'Se déconnecter',
  'topbar.account': 'Compte',

  // ---------- page d’accueil ----------
  'landing.enterWorkspace': 'Ouvrir l’espace de travail',
  'landing.loginOrRegister': 'Se connecter / S’inscrire',
  'landing.heroPrefix': 'Transformez votre idée en',
  'landing.heroSep': ' ',
  'landing.heroHighlight': 'un site web prêt à être publié',
  'landing.subtitle':
    'Décrivez ce que vous voulez. L’IA planifie et écrit le code, et quelques instants plus tard vous obtenez une vraie page fonctionnelle que vous pouvez publier et partager.',
  'landing.placeholder':
    'par ex. Un site pour une boulangerie de quartier, avec ses pains emblématiques, ses prix et ses réservations…',
  'landing.creditHint': '{cost} crédit par génération · {signup} crédits offerts à l’inscription',
  'landing.start': 'Commencer la génération',
  'landing.creating': 'Création…',
  'landing.example1': 'Café de spécialité',
  'landing.example2': 'Portfolio personnel',
  'landing.example3': 'Page d’atterrissage d’un produit SaaS',
  'landing.example4': 'Blog de recettes maison',
  'landing.example5': 'Service de garde d’animaux',
  'landing.example6': 'Studio d’organisation de mariages',
  'landing.showcaseTitle': 'Exemples à la une',
  'landing.showcaseSubtitle': 'Des sites créés avec Forge. Ouvrez-en un, ou clonez-le pour le faire vôtre.',
  'landing.showcaseClone': 'Cloner',
  'landing.showcaseCloning': 'Clonage…',

  // ---------- connexion / inscription ----------
  'login.login': 'Se connecter',
  'login.register': 'S’inscrire',
  'login.registerWithCredits': 'S’inscrire ({credits} crédits après vérification)',
  'login.continueIdea': 'Poursuivre après connexion : {idea}',
  'login.continueClone': 'L’exemple sélectionné sera cloné après votre connexion, puis vous pourrez continuer à l’affiner',
  'login.withGoogle': 'Continuer avec Google',
  'login.or': 'ou',
  'login.email': 'E-mail',
  'login.password': 'Mot de passe (au moins 6 caractères)',
  'login.submitting': 'Envoi…',
  'login.mergeHint': 'Se connecter avec Google et avec un mot de passe en utilisant la même adresse e-mail donne un seul compte',
  'login.checkEmailTitle': 'Vérifiez votre e-mail',
  'login.checkEmailBody':
    'Nous avons envoyé un e-mail de vérification à {email}. Cliquez sur le lien de cet e-mail pour terminer ; vous serez connecté automatiquement et recevrez {credits} crédits.',
  'login.checkEmailFailed':
    'Votre compte a été créé, mais l’e-mail de vérification n’a pas pu être envoyé. Cliquez sur « Renvoyer l’e-mail de vérification » ci-dessous pour réessayer.',
  'login.resend': 'Renvoyer l’e-mail de vérification',
  'login.resending': 'Envoi…',
  'login.resendSent':
    'Si cette adresse existe et n’est pas encore vérifiée, un nouvel e-mail de vérification a été envoyé. Consultez votre boîte de réception et vos courriers indésirables.',
  'login.backToLogin': 'Retour à la connexion',
  'login.verifyHint':
    'Vous ne l’avez pas reçu ? Vérifiez vos courriers indésirables, ou renvoyez l’e-mail de vérification dans un instant.',
  'verify.checking': 'Vérification de votre e-mail…',
  'verify.success': 'Vérifié. Redirection…',
  'verify.failedTitle': 'Échec de la vérification',
  'verify.goLogin': 'Aller à la connexion pour renvoyer l’e-mail',

  // ---------- compte ----------
  'account.title': 'Paramètres du compte',
  'account.email': 'E-mail',
  'account.setTitle': 'Définir un mot de passe',
  'account.changeTitle': 'Modifier le mot de passe',
  'account.googleHint':
    'Vous vous connectez avec Google et n’avez pas encore de mot de passe. Définissez-en un pour pouvoir aussi vous connecter avec votre e-mail et votre mot de passe sur le même compte.',
  'account.current': 'Mot de passe actuel',
  'account.new': 'Nouveau mot de passe (au moins 6 caractères)',
  'account.confirm': 'Confirmer le nouveau mot de passe',
  'account.set': 'Définir le mot de passe',
  'account.change': 'Modifier le mot de passe',
  'account.saved': 'Mot de passe mis à jour. Les autres appareils devront se reconnecter.',
  'account.saveFailed': 'Impossible de modifier le mot de passe',
  'account.tooShort': 'Le nouveau mot de passe doit contenir au moins 6 caractères',
  'account.mismatch': 'Les deux nouveaux mots de passe ne correspondent pas',
  'account.sessionHint':
    'Après avoir modifié votre mot de passe, ce compte est déconnecté sur les autres appareils.',

  // ---------- projets ----------
  'projects.title': 'Mes projets',
  'projects.new': 'Nouveau projet',
  'projects.empty': 'Aucun projet pour l’instant. Décrivez une idée sur la page d’accueil pour en créer un.',
  'projects.untitled': 'Projet sans titre',
  'projects.published': 'Publié',
  'projects.draft': 'Brouillon',
  'projects.noDescription': 'Aucune description',
  'projects.draftNoVersion': 'Brouillon (pas encore de version)',
  'projects.notGenerated': 'Pas encore généré',
  'projects.publish': 'Publier',
  'projects.publishing': 'Publication…',
  'projects.unpublish': 'Dépublier',
  'projects.draftHint': 'Vous avez un brouillon sans version — ouvrez-le pour créer une version et la publier',
  'projects.emptyHint': 'Pas encore généré — ouvrez-le et décrivez votre idée pour créer l’application',
  'projects.confirmDelete': 'La suppression est irréversible. Supprimer ce projet ?',
  'projects.confirmUnpublish':
    'Le lien public cessera de fonctionner immédiatement (404). Les versions et les données sont conservées et vous pourrez republier à tout moment. Dépublier ?',

  // ---------- facturation / rechargement ----------
  'billing.title': 'Crédits et facturation',
  'billing.balance': 'Crédits actuels',
  'billing.balanceHint':
    '{cost} crédit par génération ; remboursé automatiquement si l’exécution échoue ou si vous l’arrêtez.',
  'billing.comingSoon':
    'Le paiement est en cours de mise en place : consultez d’abord les tarifs, la commande sera bientôt disponible.',
  'billing.packs': 'Packs de crédits',
  'billing.packsHint': 'Achat unique. Les crédits n’expirent jamais — rechargez quand vous en avez besoin.',
  'billing.subscribe': 'Abonnement',
  'billing.subscribeHint': 'Facturé chaque mois, crédits ajoutés chaque mois, résiliable à tout moment.',
  'billing.creditsAmount': '{credits} crédits',
  'billing.perMonth': '{credits} crédits / mois',
  'billing.perMonthSuffix': ' / mois',
  'billing.buy': 'Acheter',
  'billing.subscribeAction': 'S’abonner',
  'billing.generationsHint': 'environ {count} générations',
  'billing.badge.popular': 'Le plus populaire',
  'billing.badge.bestValue': 'Meilleure valeur',
  'billing.checkoutNotReady': 'Le paiement n’est pas encore ouvert — revenez bientôt',
  'billing.checkoutSuccess':
    'Paiement reçu. Les crédits arrivent généralement en quelques secondes — actualisez la page si vous ne les voyez pas encore.',
  'billing.morNotice':
    'Les paiements, les factures et les taxes sont gérés par Creem (Merchant of Record) : votre relevé bancaire affiche Creem et non ce site, et les remboursements sont traités par Creem.',
  'billing.creditsNotice':
    'Les crédits ne sont utilisables qu’au sein de ce produit — ils ne sont ni retirables ni transférables.',
  'billing.ledger': 'Historique des crédits',
  'billing.ledgerEmpty': 'Aucune activité de crédits pour l’instant.',
  'billing.orders': 'Commandes',
  'billing.ordersEmpty': 'Aucune commande pour l’instant.',
  'billing.colTime': 'Heure',
  'billing.colReason': 'Type',
  'billing.colDelta': 'Variation',
  'billing.colBalance': 'Solde',
  'billing.colNote': 'Note',
  'billing.colAmount': 'Montant',
  'billing.colCredits': 'Crédits',
  'billing.colStatus': 'Statut',
  'billing.loadFailed': 'Échec du chargement, veuillez actualiser',
  'billing.reason.signup': 'Bonus d’inscription',
  'billing.reason.job_hold': 'Génération débitée',
  'billing.reason.job_release': 'Remboursement (échec / arrêt)',
  'billing.reason.purchase': 'Recharge',
  'billing.reason.refund': 'Remboursement',
  'billing.reason.admin_grant': 'Accordé par un administrateur',
  'billing.reason.expire': 'Crédits expirés',
  'billing.status.pending': 'En attente',
  'billing.status.paid': 'Payé',
  'billing.status.failed': 'Échec',
  'billing.status.refunded': 'Remboursé',

  // ---------- messages d’erreur du serveur ----------
  'req.failed': 'Échec de la requête ({status})',
  'req.network': 'Erreur réseau, veuillez réessayer plus tard',
  'err.serverError': 'Erreur interne du serveur',
  'err.unauthorized': 'Non autorisé',
  'err.notLoggedIn': 'Non connecté',
  'err.apiNotFound': 'Point d’accès introuvable',
  'err.methodNotAllowed': 'Méthode non autorisée',
  'err.invalidBody': 'Corps de requête invalide',
  'err.invalidParams': 'Paramètres invalides',
  'err.bodyMustBeJson': 'Le corps de la requête doit être du JSON',
  'err.bodyMustBeJsonObject': 'Le corps de la requête doit être un objet JSON',
  'err.bodyTooLarge': 'Corps de requête trop volumineux',
  'err.tooFrequent': 'Trop de requêtes, veuillez réessayer plus tard',
  'err.emailTaken': 'Cette adresse e-mail est déjà enregistrée',
  'err.invalidEmail': 'Adresse e-mail invalide',
  'err.passwordTooShort': 'Le mot de passe doit contenir au moins 6 caractères',
  'err.passwordTooLong': 'Le mot de passe est trop long',
  'err.currentPasswordWrong': 'Le mot de passe actuel est incorrect',
  'err.badCredentials': 'E-mail ou mot de passe incorrect',
  'err.emailNotVerified': 'E-mail non vérifié. Veuillez d’abord consulter votre e-mail de vérification.',
  'err.verifyLinkInvalid': 'Ce lien de vérification est invalide ou a expiré. Veuillez le renvoyer.',
  'err.verifyTooFrequent': 'Les e-mails de vérification sont envoyés trop souvent. Veuillez réessayer plus tard.',
  'err.verifySendFailed': 'Impossible d’envoyer l’e-mail de vérification. Veuillez réessayer plus tard.',
  'err.userNotFound': 'Utilisateur introuvable',
  'err.googleNotConfigured': 'La connexion avec Google n’est pas configurée',
  'err.insufficientCredits': 'Crédits insuffisants pour générer',
  'err.billingNotReady': 'Le paiement n’est pas encore ouvert',
  'err.billingNotConfigured': 'La facturation n’est pas configurée',
  'err.billingProductMissing': 'Le produit n’est pas configuré',
  'err.billingBadSignature': 'Signature de webhook invalide',
  'err.projectNotFound': 'Projet introuvable',
  'err.cloneFailed': 'Échec du clonage, veuillez réessayer plus tard',
  'err.projectBusy': 'Une génération est déjà en cours pour ce projet, veuillez patienter',
  'err.jobNotFound': 'Tâche introuvable',
  'err.jobAlreadyDone': 'La tâche vient de se terminer, il n’y a rien à arrêter',
  'err.jobFinishedSendNormally': 'La tâche est terminée, envoyez simplement votre message',
  'err.noActiveJob': 'Aucune tâche en cours d’exécution',
  'err.ideaEmpty': 'Veuillez décrire votre idée',
  'err.contentEmpty': 'Le contenu ne peut pas être vide',
  'err.generateFirst': 'Générez d’abord l’application, puis faites vos modifications',
  'err.versionFirst': 'Créez une version avant de publier',
  'err.versionNotFound': 'Version introuvable',
  'err.publishVersionNotFound': 'La version à publier n’existe pas',
  'err.invalidVersionNo': 'Numéro de version invalide',
  'err.noDraftToVersion': 'Aucun brouillon à convertir en version',
  'err.generationInProgress': 'Génération en cours, veuillez patienter avant de créer une version',
  'err.invalidAttachment': 'Pièce jointe invalide',
  'err.unknownConnector': 'Connecteur inconnu',
  'err.connectionNotFound': 'Connexion introuvable',
  'err.connectorKekMissing': 'CONNECTOR_KEK n’est pas configuré, les connecteurs sont indisponibles',
  'err.connectorNoSecretUpload': 'Ce connecteur n’accepte pas l’envoi de clés',
  'err.connectorNoAuthNeeded':
    'Ce connecteur ne nécessite aucune autorisation, renseignez simplement la configuration',
  'err.connectorNoSecretFields': 'Ce connecteur ne définit aucun champ de clé',
  'err.noSecretToSave': 'Rien à enregistrer',
  'err.invalidKeyName': 'Nom de clé invalide',
  'err.objectNotFound': 'Objet introuvable',
  'err.objectTooLarge': 'Objet trop volumineux (limite de 2 Mo)',
  'err.recordNotFound': 'Enregistrement introuvable',
  'err.siteDataFull': 'Ce site a atteint sa limite de données',
  'err.invalidCollectionName': 'Nom de collection invalide',
  'err.sqlEmpty': 'Le SQL ne peut pas être vide',
  'err.sqlTooLong': 'La requête SQL est trop longue',
  'err.invalidPath': 'Chemin invalide',
  'err.missingValue': 'Valeur manquante',
  'err.valueMustBeJson': 'La valeur doit être du JSON',
  'err.valueTooLarge': 'Valeur trop volumineuse',

  // ---------- suivi de tâche ----------
  'job.progressLost':
    'Suivi de la progression de la tâche perdu. Actualisez la page plus tard pour voir le résultat.',

  // ---------- pièces jointes ----------
  'attach.tooMany': 'Vous pouvez joindre au maximum {count} fichiers',
  'attach.totalTooLarge': 'La taille totale des pièces jointes ne peut pas dépasser {size}',
  'attach.readFailed': 'Échec de la lecture du fichier',
  'attach.rejectType': '{name} : seuls les images ({imageExt}) et les fichiers texte ({textExt}) sont acceptés',
  'attach.rejectSize': '{name} : dépasse la limite de {kb} Ko',
  'attach.rejectEmpty': '{name} : le fichier est vide',
  'attach.fileReadError': '{name} : lecture impossible',
  'attach.pastedFileName': 'image-collee-{ts}',
  'attach.marker': '📎 {count} pièce(s) jointe(s) : {names}',
  'attach.remove': 'Retirer {name}',
  'attach.add': 'Ajouter une pièce jointe',
  'attach.addTitle':
    'Ajouter des images ou des fichiers texte (jusqu’à {count} : images ≤{imageMB} Mo, texte ≤{textKB} Ko). Vous pouvez aussi coller une image.',

  // ---------- panneau de chat / processus de génération ----------
  'chat.listSep': ', ',
  'chat.stage.planning': 'Planification',
  'chat.stage.coding': 'Écriture de l’application',
  'chat.stage.modify': 'Modification du code',
  'chat.stage.building': 'Construction des artefacts',
  'chat.stage.active': 'en cours…',
  'chat.planningPrefix': 'Plan : {name}',
  'chat.processing': 'Traitement en cours',
  'chat.processTitle': 'Processus de génération',
  'chat.elapsedSec': '{s} s écoulées',
  'chat.elapsedMin': '{m} min {s} s écoulées',
  'chat.elapsedHour': '{h} h {m} min écoulées',
  'chat.collapse': 'Réduire ▾',
  'chat.features': 'Ce que contient cette version',
  'chat.jobFailed': 'Cette exécution ne s’est pas terminée',
  'chat.jobFailedHint':
    'Aucun crédit n’a été débité. Réessayez, ou reprenez depuis la sauvegarde si elle existe.',
  'chat.retry': 'Réessayer',
  'chat.resume': 'Reprendre depuis la sauvegarde',
  'chat.resumeHint': 'Dernière progression enregistrée ({count} fichiers)',
  'chat.stoppedTitle': 'Arrêtée',
  'chat.stoppedHint':
    'Votre progression a été sauvegardée — reprenez depuis la sauvegarde plutôt que de recommencer. Aucun crédit n’a été débité.',
  'chat.steerFailed': 'Impossible d’ajouter la demande, veuillez réessayer',
  'chat.resizeAria': 'Faites glisser pour redimensionner le panneau de chat',
  'chat.resizeTitle':
    'Faites glisser pour redimensionner le panneau de chat, double-cliquez pour réinitialiser',
  'chat.placeholderStreaming':
    'Génération en cours — ajoutez des exigences ou collez une image, appuyez sur Entrée pour envoyer…',
  'chat.placeholderGenerating': 'Génération…',
  'chat.placeholderIdle': 'Décrivez votre idée, ou demandez une modification (vous pouvez coller une image)…',
  'chat.stop': 'Arrêter',
  'chat.stopping': 'Arrêt…',
  'chat.stopTitle':
    'Arrêter cette exécution : la progression écrite est conservée pour que vous puissiez reprendre depuis la sauvegarde ; aucun crédit n’est débité',
  'chat.send': 'Envoyer',
  'chat.steer': 'Ajouter',
  'chat.steerTitle': 'Ajouter cette exigence à la tâche en cours',

  // ---------- espace de travail (commun) ----------
  'nav.chat': 'Chat',
  'nav.preview': 'Aperçu',
  'nav.code': 'Code',
  'nav.data': 'Données',
  'env.test': 'Environnement de test',
  'env.liveLabel': 'Environnement en ligne',
  'env.draftLabel': 'Brouillon / environnement de test',
  'env.draftShort': 'Brouillon / test',
  'env.testShort': 'Test',
  'env.live': 'En ligne',

  // ---------- espace de travail (messages de page) ----------
  'ws.generateFailed': 'Échec de la génération, veuillez réessayer',
  'ws.syncFailed':
    'Impossible de synchroniser le résultat. Actualisez la page pour voir la dernière version.',
  'ws.stage.connecting': 'Connexion au service d’exécution',
  'ws.stage.planning': 'Planification de l’approche',
  'ws.stage.coding': 'Écriture du code de l’application',
  'ws.stage.building': 'Construction des artefacts de l’application',
  'ws.stage.chat': 'Application de vos modifications demandées',
  'ws.conn.missing':
    '{name} connecté, mais « {fields} » reste à renseigner — complétez avant de générer',
  'ws.conn.writable':
    '{name} connecté. Il dispose d’un accès en écriture, désactivé par défaut — activez-le dans la barre de chat pour une exécution qui en a besoin',
  'ws.conn.readonly': '{name} connecté. Les prochaines générations l’incluront par défaut',
  'ws.conn.failed': 'Connexion non terminée : {reason}',
  'ws.published': 'v{version} publiée. Le lien public a été mis à jour.',
  'ws.unpublished': 'Dépublié. Le lien public ne fonctionne plus.',
  'ws.stopped': 'Cette exécution a été arrêtée (aucun crédit débité)',
  'ws.versionCommitted':
    'v{version} créée. Retrouvez-la dans la liste des versions, puis publiez-la pour la mettre en ligne.',
  'ws.confirmUnpublish':
    'La dépublication met immédiatement hors service le lien public (404). Les versions, le code source et les données sont conservés et vous pourrez republier à tout moment. Dépublier ?',
  'ws.attachmentDefault': 'Veuillez tenir compte des pièces jointes que j’ai téléversées',
  'ws.idleDraft':
    'Décrivez votre modification ; elle sera appliquée au brouillon (cliquez sur « Enregistrer la version » quand vous êtes satisfait)…',
  'ws.idleVersion': 'Décrivez votre modification ; le brouillon sera mis à jour à partir de v{version}…',

  // ---------- panneau d’aperçu ----------
  'preview.viewVersion': 'Voir la version',
  'preview.versionTitle':
    'Choisissez le brouillon ou la version affiché (affichage uniquement — cela ne change pas ce qui est en ligne)',
  'preview.draftOption': 'Brouillon · pas encore de version',
  'preview.liveSuffix': ' (en ligne)',
  'preview.committing': 'Construction…',
  'preview.commitVersion': 'Enregistrer la version v{version}',
  'preview.commitTitle':
    'Enregistrez le brouillon actuel comme version ; vous pourrez ensuite la publier',
  'preview.device.desktop': 'Ordinateur',
  'preview.device.mobile': 'Mobile',
  'preview.refresh': 'Actualiser l’aperçu',
  'preview.refreshTitle':
    'Rechargez l’aperçu ; il s’actualise automatiquement à la fin de la génération — utilisez cette option si la page affiche encore l’ancien contenu',
  'preview.publishTitle':
    'Publiez la version de travail en cours (crée un lien public accessible à tous)',
  'preview.publishSwitchTitle':
    'Publiez directement v{version} et basculez la version en ligne ; la version de travail reste inchangée',
  'preview.switchLive': 'Basculer la version en ligne sur v{version}',
  'preview.publishVersion': 'Publier v{version}',
  'preview.helpTitle': 'À propos des versions',
  'preview.help.heading': 'Versions et livraison',
  'preview.help.1':
    'L’onglet « Aperçu » affiche l’**environnement de test** : le contenu du brouillon, totalement isolé de la page publique en ligne (données séparées). Un badge « environnement de test » figure dans le coin.',
  'preview.help.2':
    'La génération et les échanges écrivent tous deux dans le **brouillon** ; vous pouvez itérer librement. Cela **n’affecte pas le site en ligne et ne crée pas automatiquement de version**.',
  'preview.help.3':
    'Lorsque vous êtes satisfait, cliquez sur « Enregistrer la version vN » pour conserver le brouillon comme version. Les versions sont conservées indéfiniment et ne s’écrasent jamais ; les échanges se poursuivent sur la version la plus récente.',
  'preview.help.4':
    'La liste « Voir la version » ne fait que changer ce que vous **voyez** (rien n’est modifié).',
  'preview.help.5':
    '**Modifier le site en ligne tient en une seule action** : choisissez la version dans la liste → cliquez sur « Basculer la version en ligne sur vN ». Pour avancer, prenez la plus récente ; pour revenir en arrière, une plus ancienne — l’action est identique.',
  'preview.help.6':
    'Livraison : « ↓ Télécharger le projet » dans l’onglet code exporte le code source complet de cette version (zip, source uniquement, sans données) pour l’exécuter en local ou le conserver.',
  'preview.help.7':
    '« Dépublier » retire immédiatement le lien public (les versions et les données sont conservées ; vous pouvez republier à tout moment).',
  'preview.openTestTitle':
    'Ouvrir l’environnement de test dans un nouvel onglet — essayez-le sur un mobile ou en plein écran',
  'preview.copyTest': 'Copier le lien de test',
  'preview.copyTestTitle':
    'Copiez le lien de l’environnement de test ; la personne qui l’ouvre voit le brouillon (avec le badge « environnement de test »), pas le site en ligne',
  'preview.copyLive': 'Copier le lien en ligne',
  'preview.openLiveTitle': 'Ouvrir la page en ligne {url} (accessible à tous)',
  'preview.openExternal': 'Ouvrir ↗',
  'preview.unpublishTitle':
    'La dépublication supprime immédiatement le lien public (les versions et les données sont conservées)',
  'preview.liveNotPublished': 'En ligne · non publié',
  'preview.publishHint': 'Enregistrez une version, puis cliquez sur « Publier » pour la mettre en ligne',
  'preview.draftBanner':
    'Ceci est le brouillon (pas encore de version). La génération et les échanges écrivent ici : vous pouvez itérer librement.',
  'preview.draftBanner2':
    'Lorsque vous êtes satisfait, cliquez sur « Enregistrer la version v{version} » en haut à droite pour la conserver comme version ; seule une version peut être publiée.',
  'preview.historyBanner': 'Vous consultez la version historique v{view} ; la plus récente est v{latest}.',
  'preview.historyBanner2':
    'Les échanges se poursuivent sur le brouillon de la version la plus récente v{latest} ; pour mettre v{view} en ligne, cliquez sur « Basculer la version en ligne sur v{view} » en haut à droite.',
  'preview.generating': 'Génération de votre application…',
  'preview.generatingHint':
    'Les artefacts sont construits automatiquement à la fin de la génération ; vous pouvez quitter la page — le cloud continue de travailler',
  'preview.empty': 'Aucun aperçu pour l’instant — décrivez votre idée à gauche pour commencer',

  // ---------- connecteurs (puces / panneau / carte) ----------
  'conn.title': 'Connecteurs',
  'conn.openTitle':
    'Connecteurs : reliez les paiements, les statistiques, les dépôts de code et plus encore pour que le site généré les utilise vraiment',
  'conn.chipsAddTitle':
    'Connectez un système externe (paiements, statistiques, dépôts de code…) pour que le site généré l’utilise vraiment',
  'conn.connectExternal': 'Connecter un système',
  'conn.none': 'Aucun système externe disponible pour l’instant',
  'conn.writable': 'en écriture',
  'conn.readonly': 'lecture seule',
  'conn.connected': 'connecté',
  'conn.manageAll':
    'Gérer tous les connecteurs (changer de compte / dissocier / configuration par environnement)▸',
  'conn.chipLocked':
    'Cette exécution a déjà commencé ; les connecteurs sont figés au lancement et ne peuvent pas changer en cours d’exécution',
  'conn.chipOnTitle':
    '{name} est actif pour cette exécution ({kind}). Cliquez pour le désactiver (non enregistré ; réinitialisé après l’exécution).',
  'conn.chipOffTitle':
    '{name} n’est pas actif pour cette exécution. Cliquez pour l’activer pour cette exécution{hint}',
  'conn.chipWritableHint': ' (accès en écriture : l’agent vous confirmera avant d’agir)',
  'conn.panelSubtitle':
    'Connectez des systèmes externes pour que l’agent les utilise vraiment lors de la génération (ceux en lecture seule sont actifs par défaut une fois liés ; ceux en écriture sont désactivés par défaut — activez-les dans la barre de chat quand nécessaire)',
  'conn.disabled':
    'Les connecteurs sont désactivés{reason}. Configurez `CONNECTOR_KEK` sur le Worker pour les activer.',
  'conn.panelFooter':
    'Remarque : une connexion liée à l’**environnement en ligne** prend effet lorsqu’un visiteur ouvre la page publique — vérifiez qu’il s’agit bien du compte voulu (en particulier pour les paiements). Les clés que vous fournissez sont stockées chiffrées, servent uniquement à générer ce projet, ne sont jamais écrites dans les artefacts du site et peuvent être dissociées ou révoquées ici à tout moment.',
  'conn.status.connected': 'Connecté · {label}',
  'conn.status.revoked': 'Autorisation révoquée',
  'conn.status.unauthorized': 'Non autorisé',
  'conn.status.keySaved': 'Clé enregistrée · {label}',
  'conn.status.awaitKey': 'Clé en attente',
  'conn.status.notConnected': 'Non connecté',
  'conn.action.connect': 'Connecter',
  'conn.action.reconnect': 'Changer de compte',
  'conn.action.reconnectTitle': 'Autoriser à nouveau avec un autre compte',
  'conn.action.reupload': 'Réenvoyer',
  'conn.action.reuploadTitle':
    'Collez de nouveau la clé (un même nom écrase l’ancienne clé ; à utiliser pour une rotation)',
  'conn.action.unbind': 'Dissocier',
  'conn.action.unbindTitle':
    'Dissocier uniquement de ce projet ; la connexion au niveau du compte est conservée et les autres projets ne sont pas affectés',
  'conn.noOauthClient': 'La plateforme n’a pas configuré de client OAuth pour ce connecteur',
  'conn.oauthJump': 'Aller à la page d’autorisation externe',
  'conn.redirectWarn':
    'Si la page d’autorisation signale `redirect_uri_mismatch`, cette adresse n’a pas été enregistrée dans la console externe (il doit s’agir du **même client OAuth**, de type « Application Web », à l’identique près) :',
  'conn.nameLabel': 'Nom (facultatif)',
  'conn.namePlaceholder': 'par ex. Mon {provider} (test / live)',
  'conn.action.overwrite': 'Écraser',
  'conn.action.saveBind': 'Enregistrer et lier',
  'conn.action.reuseOption': 'Utiliser une clé existante…',
  'conn.action.reuseTitle': 'Réutiliser une clé enregistrée plutôt que de la recoller',
  'conn.action.saveConfig': 'Enregistrer la configuration',
  'conn.action.bind': 'Lier',
  'conn.missing': 'Manquant : {fields}',
  'conn.effective': 'Actif dans cet environnement',
  'conn.oauthUnavailable':
    'Lié, mais l’autorisation n’est pas exploitable — cliquez sur « Connecter » pour autoriser à nouveau.',
  'conn.keyMissing':
    'Ce projet n’a aucune clé utilisable liée dans cet environnement — collez une clé et enregistrez-la.',
  'conn.field.secret': 'secrète',
  'conn.field.public': 'publique sur la page',
  'conn.card.title': 'Connecter {provider}',
  'conn.card.reuseHint':
    'Vos identifiants {provider} sont déjà enregistrés dans votre compte. Cliquez pour les connecter à ce projet (pas de ré-envoi de clé{oauthNote}) :',
  'conn.card.reuseOauthNote': ', pas de nouvelle autorisation',
  'conn.card.reuseAction': 'Connecter ▸',
  'conn.card.fillFirst': 'Renseignez d’abord « {fields} » ci-dessous, puis cliquez sur Connecter',
  'conn.card.saveConnect': 'Enregistrer et connecter',
  'conn.card.bindTo': 'Connecter à',
  'conn.card.liveNote': 'prend effet lorsqu’un visiteur ouvre la page publique',
  'conn.card.oauthLeadNew': 'Ce connecteur vous demande de',
  'conn.card.oauthLeadReuse': 'Pour changer de compte,',
  'conn.card.oauthHint':
    ' autoriser votre propre compte {provider} : allez sur leur page, cliquez sur « Autoriser », et la liaison se fera automatiquement à votre retour.',
  'conn.card.goAuthorize': 'Aller à l’autorisation',
  'conn.card.reauthorize': 'Autoriser un autre compte {provider}',
  'conn.card.fillBeforeAuth':
    'Renseignez « {fields} » avant d’autoriser pour tout faire d’un seul coup',
  'conn.card.orPasteKey': 'Ou collez une nouvelle clé :',
  'conn.card.jobRunning':
    'Une exécution est déjà en cours ; les connecteurs sont figés au démarrage — les identifiants enregistrés ici prendront effet à partir de la **prochaine** génération.',
  'conn.card.secretNote':
    'La clé sert uniquement à appeler {provider} pendant la génération, est stockée chiffrée, n’est jamais écrite dans le code de votre site et n’apparaît jamais dans l’historique du chat.',
  'conn.card.doneTitle': '{provider} connecté',
  'conn.card.doneBody':
    'Lié à {env}. Les identifiants sont stockés chiffrés et n’apparaissent jamais dans le chat, le code source ni les artefacts. {tail}',
  'conn.card.doneTailWritable':
    'Il dispose d’un accès en écriture, désactivé par défaut — activez son chip dans la barre de chat pour une exécution qui en a besoin.',
  'conn.card.doneTailReadonly': 'Les prochaines générations l’incluront par défaut.',

  // ---------- panneau de données ----------
  'data.env.draftHint':
    'Données produites en interagissant avec l’aperçu de l’éditeur ; sans effet sur le site en ligne',
  'data.env.liveHint': 'Données produites par les visiteurs sur la page publique après publication',
  'data.kind.kv': 'Clés-valeurs',
  'data.kind.blob': 'Objets',
  'data.sqlHint':
    'S’exécute sur la base SQLite isolée de l’environnement « {env} » ; indépendante de l’autre environnement et des autres projets',
  'data.jsonInvalid': 'La valeur doit être du JSON valide (entourez les chaînes de guillemets)',
  'data.confirmDeleteKey': 'Supprimer la clé « {key} » ?',
  'data.keyNameInvalid':
    'Un nom de clé ne peut contenir que des lettres, des chiffres, des points, des tirets bas et des traits d’union (1 à 64 caractères)',
  'data.newKey': '+ Nouvelle clé',
  'data.keyName': 'Nom de la clé',
  'data.noKeys': 'Aucune clé dans cet environnement pour l’instant',
  'data.saved': 'Enregistré',
  'data.valuePlaceholder': 'Valeur JSON, par ex. {"count": 1} ou "texte"',
  'data.valueHint':
    'Les valeurs sont stockées au format JSON ; pour stocker du texte brut, entourez-le de guillemets, par ex. "hello"',
  'data.pickKey': 'Choisissez une clé à gauche pour voir ou modifier sa valeur',
  'data.upload': '+ Téléverser un objet',
  'data.uploading': 'Téléversement…',
  'data.noObjects': 'Aucun objet dans cet environnement pour l’instant',
  'data.readFailed': 'Échec de la lecture ({status})',
  'data.uploadFailed': 'Échec du téléversement ({status})',
  'data.download': '↓ Télécharger',
  'data.reading': 'Lecture…',
  'data.noPreview':
    'Ce type ne peut pas être prévisualisé ici — cliquez sur « Télécharger » pour le voir',
  'data.pickObject': 'Choisissez un objet à gauche pour le voir ou le télécharger',
  'data.confirmDeleteObject': 'Supprimer l’objet « {key} » ?',
  'data.confirmDeleteRow': 'Supprimer cette ligne ?',
  'data.rowCount': '{count} lignes',
  'data.addRow': 'Ajouter une ligne',
  'data.noRowid':
    'Cette table n’a pas de rowid : elle est uniquement consultable (pas d’édition ni de suppression en ligne)',
  'data.colRow': 'Ligne',
  'data.colActions': 'Actions',
  'data.newBadge': 'nouveau',
  'data.tableEmpty': 'Cette table ne contient encore aucune donnée',
  'data.prevPage': 'Précédent',
  'data.nextPage': 'Suivant',
  'data.schema': 'Schéma',
  'data.noTables': 'Aucune table pour l’instant — écrivez du SQL pour en créer une',
  'data.loaded': 'Requête « {name} » chargée ; cliquez sur « Exécuter » pour la voir',
  'data.openInSql': 'Ouvrir dans l’éditeur SQL',
  'data.index': 'index',
  'data.view': 'vue',
  'data.trigger': 'déclencheur',
  'data.tabTable': 'Données de la table',
  'data.tabSql': 'Éditeur SQL',
  'data.sqlScope': 'S’exécute sur le SQLite isolé de l’environnement « {env} »',
  'data.run': 'Exécuter ⌘/Ctrl+↵',
  'data.running': 'Exécution…',
  'data.pickTable': 'Choisissez une table à gauche pour voir et modifier ses données',
  'data.resultMeta': '{rows} ligne(s) renvoyée(s) · lu {read} · écrit {written} · {ms} ms',
  'data.okNoRows': 'Réussi (aucune ligne renvoyée)',
  'data.sqlTemplate':
    '-- Écrivez ici n’importe quel SQLite : création de tables, d’index, requêtes\nCREATE TABLE IF NOT EXISTS notes (\n  id         INTEGER PRIMARY KEY AUTOINCREMENT,\n  title      TEXT NOT NULL,\n  done       INTEGER NOT NULL DEFAULT 0,\n  created_at TEXT NOT NULL DEFAULT (datetime(\'now\'))\n);\nCREATE INDEX IF NOT EXISTS idx_notes_done ON notes(done);\nINSERT INTO notes (title) VALUES (\'essayez de me demander\');\nSELECT * FROM notes LIMIT 100;',

  // ---------- vue code ----------
  'code.liveWriting': 'écriture en direct',
  'code.files': 'Fichiers',
  'code.downloadTitle':
    'Téléchargez le code source complet de cette version (zip) ; exécutez-le en local avec npm install && npm run build',
  'code.download': '↓ Télécharger le projet',
  'code.pickFile': 'Choisissez un fichier à gauche pour l’afficher',
  'code.artifacts': 'Artefacts de build',
  'code.artifactsMeta': 'entrée {entry} · {count} fichier(s) · {size} Ko',
  'code.empty':
    'Dès que la génération démarre, le code source écrit par l’agent apparaît ici en temps réel',

  // ---------- tarifs publics / pied de page / mentions légales ----------
  'landing.pricingLink': 'Tarifs',
  'footer.pricing': 'Tarifs',
  'footer.terms': 'Conditions d’utilisation',
  'footer.privacy': 'Politique de confidentialité',
  'footer.acceptableUse': 'Politique d’utilisation acceptable',
  'footer.support': 'Assistance',
  'footer.tagline': 'Transformez vos idées en sites web publiables grâce à l’IA.',
  'footer.operator': 'Forge est exploité par {entity} (raison sociale : {business}).',
  'footer.rights': '© {year} {entity}. Tous droits réservés.',
  'pricing.title': 'Tarifs',
  'pricing.subtitle':
    'Les crédits sont consommés par génération. Achetez un pack de crédits à usage unique ou abonnez-vous mensuellement. Tous les prix sont en dollars américains.',
  'pricing.included': 'Recevez {credits} crédits offerts à l’inscription',
  'pricing.note':
    'Le paiement, la facturation, la taxe et les remboursements sont gérés par Creem en tant que Merchant of Record. Votre relevé bancaire affichera Creem, et non Forge.',
  'pricing.viewFull': 'Voir tous les tarifs',
  'pricing.cta': 'Inscrivez-vous gratuitement et commencez à créer',
  'pricing.loadFailed': 'Échec du chargement des tarifs. Veuillez réessayer plus tard.',
  'login.consentPrefix': 'En créant un compte, vous acceptez nos',
  'login.consentAnd': 'et',
  'login.consentSuffix': '.',
  'legal.lastUpdated': 'Dernière mise à jour : 20 octobre 2026',
  'legal.backHome': 'Retour à l’accueil',
  'legal.contact': 'Des questions sur cette page ? Contactez {entity} à {email}. Site web : {url}.',
  'legal.operator':
    'Exploitant du service : {entity} (raison sociale : {business}, {country}). Contact : {email}.',
  'legal.fallbackNotice':
    'Une traduction de ce document juridique n’est pas encore disponible dans votre langue. Le texte anglais ci-dessous fait foi.',
  'app.title': 'Forge — transformez votre idée en un site web en production',
}
