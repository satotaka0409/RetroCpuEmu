import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HexKeyboard } from "./components/HexKeyboard.tsx";
import DisplayView from "./components/DisplayView/DIsplayView.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* 7セグメントLED表示 */}
    <DisplayView
      address="ABCDEF"
      data="012F"
      status={[true, true, true, true, true, true, true, true]}
    />
    <HexKeyboard />
  </StrictMode>,
);
