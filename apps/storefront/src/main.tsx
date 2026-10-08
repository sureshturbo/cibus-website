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

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root is missing from index.html");

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);