import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ChudSiteMedia } from "./components/ChudSiteMedia";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ChudSiteMedia>
      <App />
    </ChudSiteMedia>
  </React.StrictMode>
);
