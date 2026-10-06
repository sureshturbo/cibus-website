import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.js";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root is missing from index.html");

// Vite sets BASE_URL to "/admin/" in the production build (see vite.config.ts)
// and "/" under the dev server, so the router follows whichever it is.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);