/**
 * Entry point. GdsProvider is the single required root provider (it sets up
 * Mantine + GDS theming, notifications, and modals). The whole app renders
 * inside it; SessionProvider holds the in-memory wallet for the session.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { GdsProvider } from "@sovereignsquad/gds";
import { App } from "./App.js";
import { SessionProvider } from "./session.js";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <GdsProvider defaultColorScheme="auto">
      <SessionProvider>
        <App />
      </SessionProvider>
    </GdsProvider>
  </StrictMode>,
);
