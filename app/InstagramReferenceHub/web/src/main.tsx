import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// ?amostra=1 → página de amostra dos componentes (InstagramPost, Button, facetas…), sem tocar no App.
const amostra = new URLSearchParams(location.search).has("amostra");
const Amostra = lazy(() => import("./design/Amostra").then((m) => ({ default: m.Amostra })));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {amostra ? <Suspense fallback={null}><Amostra /></Suspense> : <App />}
  </StrictMode>,
);
