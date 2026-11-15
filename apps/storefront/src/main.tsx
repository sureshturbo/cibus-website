import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.js";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/chrome.css";
import "./styles/shop.css";
import "./styles/pages.css";
import "./styles/flows.css";
import "./styles/admin.css";

/* index.html only preloads the web font, so the page can paint with the
   fallback font first. Attaching it here rather than via an inline onload
   handler keeps it working under the API's script-src 'self' CSP. */
const fontPreload = document.getElementById("font-css");
if (fontPreload instanceof HTMLLinkElement) {
  const sheet = document.createElement("link");
  sheet.rel = "stylesheet";
  sheet.href = fontPreload.href;
  document.head.appendChild(sheet);
}

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root is missing from index.html");

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);