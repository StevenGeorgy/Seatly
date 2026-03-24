/** French — namespace `common`. Keep keys identical to `en/common`. */
const common = {
  app: {
    stub: {
      tagline: "Seatly — Vite + shadcn (thème sombre par défaut)",
      cta: "Bouton",
    },
    dev: {
      missingSupabase:
        "Supabase n’est pas configuré. Ajoutez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY au fichier .env à la racine du dépôt, puis redémarrez le serveur de développement.",
    },
  },
  marketing: {
    nav: {
      ariaLabel: "Sections du site public",
      homeAria: "Accueil Seatly",
    },
    home: {
      headline: "Pilotez votre restaurant au même endroit.",
      subhead:
        "Réservations, plan de salle, personnel, commandes et clients — pensé pour les restaurants au Canada. Connectez-vous pour ouvrir le tableau de bord.",
      ctaLogIn: "Connexion",
      ctaSignUp: "Créer un compte",
    },
  },
  booking: {
    step1: {
      title: "Choisissez une date",
    },
  },
  dashboard: {
    overview: {
      totalCovers: "Couverts totaux",
    },
    shell: {
      restaurant: "Restaurant",
      navLabel: "Navigation du tableau de bord",
      signOut: "Déconnexion",
      noRestaurants: "Aucun restaurant n’est lié à votre compte personnel.",
      loadRestaurantsFailed: "Impossible de charger les restaurants. Réessayez plus tard.",
    },
  },
  routes: {
    loading: "Chargement…",
    placeholder: {
      subtitle: "Cet écran n’est pas encore branché.",
    },
    notFound: {
      title: "Page introuvable",
      hint: "Ce lien n’existe pas ou a été déplacé.",
      backHome: "Retour à l’accueil",
    },
    home: { title: "Seatly" },
    features: { title: "Fonctionnalités" },
    pricing: { title: "Tarifs" },
    about: { title: "À propos" },
    auth: {
      login: { title: "Connexion" },
      register: { title: "Inscription" },
      forgotPassword: { title: "Mot de passe oublié" },
      setup: { title: "Configuration du restaurant" },
    },
    discover: { title: "Découvrir" },
    account: { title: "Mon compte" },
    restaurant: { title: "Restaurant" },
    dashboard: {
      overview: { title: "Aperçu" },
      reservations: { title: "Réservations" },
      floorPlan: { title: "Plan de salle" },
      waitlist: { title: "Liste d’attente" },
      orders: { title: "Commandes & cuisine" },
      menu: { title: "Menu" },
      staff: { title: "Personnel" },
      schedule: { title: "Horaire & pointage" },
      crm: { title: "CRM" },
      analytics: { title: "Analytique" },
      expenses: { title: "Dépenses" },
      events: { title: "Événements" },
      export: { title: "Export" },
      settings: { title: "Paramètres" },
    },
  },
  auth: {
    login: {
      title: "Connexion",
      submit: "Se connecter",
      divider: "Ou continuer avec",
      google: "Continuer avec Google",
      forgotLink: "Mot de passe oublié ?",
      noAccount: "Pas de compte ?",
      registerLink: "Créer un compte",
      confirmEmail: "Confirmez votre courriel pour terminer la connexion.",
    },
    register: {
      title: "Créer un compte",
      submit: "S’inscrire",
      google: "Continuer avec Google",
      hasAccount: "Vous avez déjà un compte ?",
      loginLink: "Connexion",
      checkEmail: "Vérifiez votre courriel pour confirmer votre compte.",
    },
    forgot: {
      title: "Réinitialiser le mot de passe",
      description: "Nous enverrons un lien pour réinitialiser votre mot de passe.",
      submit: "Envoyer le lien",
      sent: "Courriel envoyé",
      sentDetail:
        "Si un compte existe pour cette adresse, vous recevrez un courriel sous peu.",
      backToLogin: "Retour à la connexion",
    },
    reset: {
      title: "Choisir un nouveau mot de passe",
      submit: "Mettre à jour le mot de passe",
      invalid: "Ce lien est invalide ou expiré. Demandez-en un nouveau.",
      requestNew: "Mot de passe oublié ?",
      success: "Mot de passe mis à jour. Vous pouvez vous connecter.",
    },
    oauth: {
      title: "Connexion en cours",
      error: "Nous n’avons pas pu terminer la connexion.",
      backLogin: "Retour à la connexion",
    },
    fields: {
      email: { label: "Courriel" },
      password: { label: "Mot de passe" },
      confirmPassword: { label: "Confirmer le mot de passe" },
      fullName: { label: "Nom complet (facultatif)" },
    },
    validation: {
      required: "Ce champ est obligatoire.",
      emailInvalid: "Entrez une adresse courriel valide.",
      passwordMin: "Utilisez au moins 8 caractères.",
      passwordMismatch: "Les mots de passe ne correspondent pas.",
      fullNameMax: "Le nom est trop long.",
    },
    errors: {
      signInFailed: "Connexion impossible. Vérifiez le courriel et le mot de passe.",
      signUpFailed: "Impossible de créer le compte. Réessayez.",
      loadProfileFailed: "Connecté, mais le profil n’a pas pu être chargé.",
      oauthFailed: "Impossible de démarrer la connexion Google.",
      resetEmailFailed: "Impossible d’envoyer le courriel. Réessayez.",
      updatePasswordFailed: "Impossible de mettre à jour le mot de passe.",
      supabaseNotConfigured:
        "L’authentification n’est pas disponible. Configurez Supabase dans votre environnement (voir la bannière de développement).",
    },
  },
  common: {
    actions: {
      save: "Enregistrer",
      cancel: "Annuler",
      submit: "Envoyer",
    },
  },
} as const;

export default common;
