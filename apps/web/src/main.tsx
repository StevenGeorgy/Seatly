import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/lib/i18n/i18n";
import "./index.css";
import App from "./App.tsx";
import { initPostHog } from "./lib/analytics/posthog";
import { initSentry } from "./lib/analytics/sentry";

initSentry();
initPostHog();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
