/** English — namespace `common`. Keys: dot notation (e.g. booking.step1.title). */
const common = {
  app: {
    stub: {
      tagline: "Seatly — Vite + shadcn (dark default)",
      cta: "Button",
    },
    dev: {
      missingSupabase:
        "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the repo root .env and restart the dev server.",
    },
  },
  marketing: {
    nav: {
      ariaLabel: "Marketing site sections",
      homeAria: "Seatly home",
    },
    home: {
      headline: "Run your restaurant from one place.",
      subhead:
        "Reservations, floor plan, staff, orders, and guests — built for Canadian restaurants. Sign in to open your dashboard.",
      ctaLogIn: "Log in",
      ctaSignUp: "Create account",
    },
  },
  booking: {
    step1: {
      title: "Choose a Date",
    },
  },
  dashboard: {
    overview: {
      totalCovers: "Total Covers",
    },
    shell: {
      restaurant: "Restaurant",
      navLabel: "Dashboard navigation",
      signOut: "Sign out",
      noRestaurants: "No restaurants are linked to your staff account.",
      loadRestaurantsFailed: "Could not load restaurants. Try again later.",
    },
  },
  routes: {
    loading: "Loading…",
    placeholder: {
      subtitle: "This screen is not wired yet.",
    },
    notFound: {
      title: "Page not found",
      hint: "That link does not exist or has moved.",
      backHome: "Back to home",
    },
    home: { title: "Seatly" },
    features: { title: "Features" },
    pricing: { title: "Pricing" },
    about: { title: "About" },
    auth: {
      login: { title: "Log in" },
      register: { title: "Register" },
      forgotPassword: { title: "Forgot password" },
      setup: { title: "Restaurant setup" },
    },
    discover: { title: "Discover" },
    account: { title: "My account" },
    restaurant: { title: "Restaurant" },
    dashboard: {
      overview: { title: "Overview" },
      reservations: { title: "Reservations" },
      floorPlan: { title: "Floor plan" },
      waitlist: { title: "Waitlist" },
      orders: { title: "Orders & KDS" },
      menu: { title: "Menu" },
      staff: { title: "Staff" },
      schedule: { title: "Schedule & clock" },
      crm: { title: "CRM" },
      analytics: { title: "Analytics" },
      expenses: { title: "Expenses" },
      events: { title: "Events" },
      export: { title: "Export" },
      settings: { title: "Settings" },
    },
  },
  auth: {
    login: {
      title: "Log in",
      submit: "Sign in",
      divider: "Or continue with",
      google: "Continue with Google",
      forgotLink: "Forgot password?",
      noAccount: "No account?",
      registerLink: "Create one",
      confirmEmail: "Confirm your email to finish signing in.",
    },
    register: {
      title: "Create an account",
      submit: "Sign up",
      google: "Continue with Google",
      hasAccount: "Already have an account?",
      loginLink: "Log in",
      checkEmail: "Check your email to confirm your account.",
    },
    forgot: {
      title: "Reset password",
      description: "We will send a link to reset your password.",
      submit: "Send reset link",
      sent: "Email sent",
      sentDetail:
        "If an account exists for that address, you will receive an email shortly.",
      backToLogin: "Back to log in",
    },
    reset: {
      title: "Choose a new password",
      submit: "Update password",
      invalid: "This reset link is invalid or expired. Request a new one.",
      requestNew: "Forgot password?",
      success: "Password updated. You can log in.",
    },
    oauth: {
      title: "Signing you in",
      error: "We could not finish signing you in.",
      backLogin: "Back to log in",
    },
    fields: {
      email: { label: "Email" },
      password: { label: "Password" },
      confirmPassword: { label: "Confirm password" },
      fullName: { label: "Full name (optional)" },
    },
    validation: {
      required: "This field is required.",
      emailInvalid: "Enter a valid email address.",
      passwordMin: "Use at least 8 characters.",
      passwordMismatch: "Passwords do not match.",
      fullNameMax: "Name is too long.",
    },
    errors: {
      signInFailed: "Could not sign in. Check your email and password.",
      signUpFailed: "Could not create the account. Try again.",
      loadProfileFailed: "Signed in but profile could not be loaded.",
      oauthFailed: "Could not start Google sign-in.",
      resetEmailFailed: "Could not send reset email. Try again.",
      updatePasswordFailed: "Could not update password.",
      supabaseNotConfigured:
        "Authentication is not available. Configure Supabase in your environment (see dev banner).",
    },
  },
  common: {
    actions: {
      save: "Save",
      cancel: "Cancel",
      submit: "Submit",
    },
  },
} as const;

export default common;
