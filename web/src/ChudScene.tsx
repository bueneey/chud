import { useState, useCallback } from "react";
import type { ChudState, TradeRecord } from "./api";

/** Strip DexScreener/chart URLs from text. */
function stripUrls(text: string): string {
  return text.replace(/\s*Chart:\s*https?:\/\/[^\s]+/gi, "").trim();
}

interface Props {
  state: ChudState | null;
  trades: TradeRecord[];
  isHappy: boolean;
}

function getOpenTrade(trades: TradeRecord[]): TradeRecord | null {
  return trades.find((t) => !t.sellTimestamp || t.sellTimestamp === "") ?? null;
}

export function ChudScene({ state, trades, isHappy }: Props) {
  const [copiedMint, setCopiedMint] = useState(false);
  const kind = state?.kind ?? "idle";
  const message = state?.message ?? "";
  const openTrade = getOpenTrade(trades);
  const hasLivePosition = kind === "bought" && !!openTrade;

  const copyMint = useCallback((mint: string) => {
    navigator.clipboard.writeText(mint).then(() => {
      setCopiedMint(true);
      setTimeout(() => setCopiedMint(false), 2000);
    });
  }, []);

  const positionMint = openTrade?.mint ?? state?.chosenMint;
  const effectiveSymbol = openTrade?.symbol ?? state?.chosenSymbol ?? "—";
  const effectiveMcap = openTrade?.mcapUsd ?? state?.chosenMcapUsd;
  const effectiveReason = openTrade?.why ?? state?.chosenReason;

  if (!hasLivePosition) {
    return (
      <div className="panel chud-scene chud-scene-empty">
        <div className="panel-title">[ live claw ]</div>
        <div className="chud-claw-and-sprite">
          <div className="screens-row screens-row-single">
            <div className="ascii-screen">
              <div className="screen-frame">
                <div className="screen-title">[ claw ]</div>
                <div className="screen-content">
                  <div className="screen-empty">no live position</div>
                </div>
              </div>
            </div>
          </div>
          <div className="chud-sprite-container" aria-hidden>
            <img src="/chudpfptbg.png" alt="Chud the Trader" className="chud-sprite idle" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel chud-scene">
      <div className="panel-title">[ live claw ]</div>
      <div className="chud-status-bar">
        <span className="chud-status chud-status-position">in position: {effectiveSymbol}</span>
      </div>
      <div className="chud-claw-and-sprite">
        <div className="screens-row screens-row-single">
          <div className="ascii-screen selected">
            <div className="screen-frame">
              <div className="screen-title">[ claw ]</div>
              <div className="screen-content">
                {positionMint && (
                  <div className="screen-single">
                    <div className="screen-symbol">{effectiveSymbol}</div>
                    <div className="screen-message">{message || "position opened"}</div>
                    {effectiveMcap != null && (
                      <div className="screen-metrics">
                        <span>mcap @ entry ${(effectiveMcap / 1000).toFixed(1)}k</span>
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
        <div className="chud-sprite-container" aria-hidden>
          <img
            src={isHappy ? "/chudhappy.png" : "/chudpfptbg.png"}
            alt="Chud the Trader"
            className="chud-sprite bought"
          />
        </div>
      </div>
    </div>
  );
}
