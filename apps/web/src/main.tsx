import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AccountsGate } from "./components/AccountsGate";
import { ReplayView } from "./components/ReplayView";
import "./index.css";

const root = document.getElementById("root");
if (root === null) throw new Error("missing #root");
const replay = location.pathname.startsWith("/replay");
createRoot(root).render(
  <StrictMode>
    <AccountsGate>{(accounts) => (replay ? <ReplayView accounts={accounts} /> : <App accounts={accounts} />)}</AccountsGate>
  </StrictMode>,
);
