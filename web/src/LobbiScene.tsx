import { useState, useCallback } from "react";
import type { LobbiState, TradeRecord } from "./api";

/** Strip DexScreener/chart URLs from text. */
function stripUrls(text: string): string {
  return text.replace(/\s*Chart:\s*https?:\/\/[^\s]+/gi, "").trim();
}

interface Props {
  state: LobbiState | null;
  trades: TradeRecord[];
  isHappy: boolean;
}

function getOpenTrade(trades: TradeRecord[]): TradeRecord | null {
  return trades.find((t) => !t.sellTimestamp || t.sellTimestamp === "") ?? null;
}

export function LobbiScene({ state, trades, isHappy }: Props) {
  const [copiedMint, setCopiedMint] = useState(false);
  const kind = state?.kind ?? "idle";
  const message = state?.message ?? "";
  const openTrade = getOpenTrade(trades);

  const copyMint = useCallback((mint: string) => {
    navigator.clipboard.writeText(mint).then(() => {
      setCopiedMint(true);
      setTimeout(() => setCopiedMint(false), 2000);
    });
  }, []);

  const hasPosition = kind === "bought" || !!openTrade;
  const positionMint = openTrade?.mint ?? state?.chosenMint;
  const effectiveSymbol = state?.chosenSymbol ?? openTrade?.symbol ?? "—";
  const effectiveMcap = state?.chosenMcapUsd ?? openTrade?.mcapUsd;
  const effectiveReason = state?.chosenReason ?? openTrade?.why;
  const searching = (kind === "idle" || kind === "thinking" || kind === "choosing") && !openTrade;
  const showSelecting = (searching || kind === "sold") && !hasPosition;

  return (
    <div className="panel lobbi-scene">
      <div className="panel-title">[ live claw ]</div>
      <div className="lobbi-status-bar">
        {(searching || kind === "sold") && !openTrade && (
          <span className="lobbi-status">
            {kind === "sold" ? "position closed · selecting next coin…" : "no position · selecting next coin…"}
          </span>
        )}
        {hasPosition && <span className="lobbi-status lobbi-status-position">in position: {effectiveSymbol}</span>}
      </div>

      {(kind === "thinking" || kind === "choosing") && (
        <div className="thought-bubble">
          <span className="blink">...</span> {kind === "choosing" ? "selecting coin ..." : "searching for coins ..."}
        </div>
      )}

      <div className="lobbi-claw-and-sprite">
        <div className="screens-row screens-row-single">
          <div className={`ascii-screen ${hasPosition ? "selected" : ""}`}>
            <div className="screen-frame">
              <div className="screen-title">[ claw ]</div>
              <div className="screen-content">
                {kind === "sold" && (
                  <div className="screen-single">
                    <div className="screen-symbol">{state?.chosenSymbol ?? "—"}</div>
                    <div className="screen-message">{message || "position closed"}</div>
                    <div className="screen-reason">next: selecting in a few seconds…</div>
                  </div>
                )}
                {showSelecting && kind !== "sold" && (
                  <div className="screen-empty">
                    {kind === "idle" ? "selecting next coin…" : "searching for coins…"}
                  </div>
                )}
                {hasPosition && positionMint && (
                  <div className="screen-single">
                    <div className="screen-symbol">{effectiveSymbol}</div>
                    <div className="screen-message">{message || "position opened"}</div>
                    {(effectiveMcap != null || state?.chosenHolderCount != null) && (
                      <div className="screen-metrics">
                        {effectiveMcap != null && (
                          <span>mcap @ entry ${(effectiveMcap / 1000).toFixed(1)}k</span>
                        )}
                        {state?.chosenHolderCount != null && (
                          <span> · holders: {state.chosenHolderCount}</span>
                        )}
                      </div>
                    )}
                    {effectiveReason && (
                      <div className="screen-reason" title={effectiveReason}>
                        why: {stripUrls(effectiveReason)}
                      </div>
                    )}
                    <button
                      type="button"
                      className="screen-ca-btn"
                      onClick={() => copyMint(positionMint)}
                      title="copy contract address"
                    >
                      CA: {positionMint.slice(0, 6)}…{positionMint.slice(-4)}
                      {copiedMint && " ✓"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="lobbi-sprite-container" aria-hidden>
          <img
            src={isHappy ? "/chudhappy.png" : "/chudpfptbg.png"}
            alt="Chud the Trader"
            className={`lobbi-sprite ${hasPosition ? "bought" : kind}`}
          />
        </div>
      </div>
    </div>
  );
}
