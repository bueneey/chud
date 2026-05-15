import { useEffect, useState } from "react";
import {
  fetchTrades,
  fetchBalance,
  fetchPnl,
  fetchBalanceChart,
  fetchChudState,
  fetchChudChat,
  fetchSolPrice,
  fetchLogs,
  type TradeRecord,
  type ChudState,
  type BalanceChartPoint,
  type ChudChatTurn,
  type LogEntry,
} from "./api";
import { ChudPanel } from "./ChudPanel";
import { ChudScene } from "./ChudScene";
import { TradeFeed } from "./TradeFeed";
import { WalletBalanceChart } from "./WalletBalanceChart";
import DelicateAsciiDots from "./components/ui/delicate-ascii-dots";
import CursorDitherTrail from "./components/ui/cursor-dither-trail";
import { CAButton } from "./components/CAButton";
import { SocialLinks } from "./components/SocialLinks";
import { CHUD_WALLET } from "./site-config";
import { formatSolWithUsd } from "./formatSolUsd";

const POLL_MS = 3000;
type PageView = "home" | "feed" | "logs";

export default function App() {
  const blownPortCount: number = 5;
  const [chatTabSessionId] = useState(() => crypto.randomUUID());
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [pnl, setPnl] = useState<number>(0);
  const [solPriceUsd, setSolPriceUsd] = useState<number>(91);
  const [balanceChartPoints, setBalanceChartPoints] = useState<BalanceChartPoint[]>([]);
  const [state, setState] = useState<ChudState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChudChatTurn[]>([]);
  const [chatLlmConfigured, setChatLlmConfigured] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [walletCopied, setWalletCopied] = useState(false);
  const [page, setPage] = useState<PageView>("home");

  const latestClosedTrade = trades.find((t) => !!t.sellTimestamp);
  const isHappy = latestClosedTrade ? latestClosedTrade.pnlSol > 0 : pnl > 0 || balance > 1;

  function copyWallet(): void {
    navigator.clipboard.writeText(CHUD_WALLET).then(() => {
      setWalletCopied(true);
      setTimeout(() => setWalletCopied(false), 2000);
    });
  }

  function poll() {
    const tasks: Promise<unknown>[] = [
      fetchTrades(),
      fetchBalance(),
      fetchPnl(),
      fetchSolPrice().catch(() => 91),
      fetchBalanceChart(),
      fetchChudState(),
      fetchChudChat(chatTabSessionId).catch(() => ({ messages: [] as ChudChatTurn[], llmConfigured: false })),
    ];
    if (page === "logs") {
      tasks.push(fetchLogs(200).catch(() => [] as LogEntry[]));
    }
    Promise.all(tasks)
      .then((results) => {
        const t = results[0] as TradeRecord[];
        const b = results[1] as { balanceSol: number; solPriceUsd?: number };
        const p = results[2] as {
          totalPnlSol: number;
          lifetimeNetDepositSol?: number;
          solPriceUsd?: number;
        };
        const solPx = results[3] as number;
        const chart = results[4] as { points?: BalanceChartPoint[] };
        const s = results[5] as ChudState | null;
        const chat = results[6] as { messages: ChudChatTurn[]; llmConfigured: boolean };
        const logsData = page === "logs" ? (results[7] as LogEntry[]) : logs;
        setTrades(t);
        setBalance(b.balanceSol);
        const lifetime = p.lifetimeNetDepositSol;
        setPnl(
          typeof lifetime === "number" && Number.isFinite(lifetime)
            ? b.balanceSol - lifetime
            : p.totalPnlSol
        );
        setSolPriceUsd(p.solPriceUsd ?? b.solPriceUsd ?? solPx ?? 91);
        setBalanceChartPoints(chart.points ?? []);
        setState(s);
        setChatMessages(chat.messages);
        setChatLlmConfigured(chat.llmConfigured);
        if (page === "logs") setLogs(logsData);
        setError(null);
      })
      .catch((e) => {
        const msg = e?.message ?? String(e) ?? "Failed to fetch";
        setError(msg);
        console.error("[Chud] API error:", msg, e);
      });
  }

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [page, chatTabSessionId]);

  return (
    <div className="app-wrap">
      <div style={{ opacity: 0.35, position: "fixed", inset: 0, zIndex: 0 }}>
        <DelicateAsciiDots
          backgroundColor="#bcbcbc"
          textColor="74, 95, 74"
          gridSize={80}
          removeWaveLine
          animationSpeed={0.75}
        />
      </div>
      <CursorDitherTrail
        trailColor="#6b8f62"
        dotSize={6}
        fadeDuration={1000}
        className="app-cursor-trail"
      />
      <div className="app">
      <div className="top-nav" aria-label="site pages">
        <button type="button" className={`top-nav-btn ${page === "home" ? "active" : ""}`} onClick={() => setPage("home")}>
          home page
        </button>
        <button
          type="button"
          className={`top-nav-btn ${page === "feed" ? "active" : ""}`}
          onClick={() => setPage("feed")}
        >
          live trade feed
        </button>
        <button type="button" className={`top-nav-btn ${page === "logs" ? "active" : ""}`} onClick={() => setPage("logs")}>
          chud logs
        </button>
      </div>
      <header className="header">
        <img src="/chudpfptbg.png" alt="Chud the Trader" />
        <div className="header-titles">
          <h1>chud the trader</h1>
          <span className="header-sub">
            the chud starts with 1 SOL, knows nothing, and has to learn by trading one position at a time, all live.
          </span>
        </div>
        <div className="header-right">
          <CAButton variant="header" />
          <span className="live-dot" title="data refreshes every 3s">live</span>
        </div>
      </header>

      {error && (
        <div className="panel panel-error" role="alert">
          {error}
          <p className="panel-error-hint">check console for details. is the backend running on port 4000?</p>
        </div>
      )}

      {page === "home" && (
        <>
      <section className="about-section" aria-label="about chud the trader">
        <h2 className="section-label">about</h2>
        <div className="panel about-panel">
          <p>
            chud the trader is just a chud, no strategy, no brain, no logic. he is given 1 SOL, with the only goal of
            not loosing it.
          </p>
          <p>
            he isnt taught how to trade, but forced to learn it himself. he journals his trades live, and posts whatever
            he feels like on x. all automated by openclaw.
          </p>
          <p>
            will the chud stay chudded, or will he change?
          </p>
          <p>
            <strong>track the chud:</strong>{" "}
            <button type="button" className="ca-button ca-button-footer" onClick={copyWallet} title="copy wallet address">
              {CHUD_WALLET}
              {walletCopied && <span className="ca-copied"> ✓</span>}
            </button>
          </p>
        </div>
      </section>

      <section className="stats-section" aria-label="balance and pnl">
        <h2 className="section-label">bot wallet</h2>
        <div className="stats-row">
          <div className="panel stat-box">
            <div className="panel-title">balance</div>
            <div className="stat-value">{formatSolWithUsd(balance, solPriceUsd)}</div>
            <p className="stat-desc">live on-chain balance</p>
          </div>
          <div className="panel stat-box">
            <div className="panel-title">total pnl</div>
            <div
              className="stat-value"
              style={{ color: pnl >= 0 ? "var(--green)" : "var(--red)" }}
            >
              {pnl >= 0 ? "+" : ""}
              {formatSolWithUsd(pnl, solPriceUsd)}
            </div>
          </div>
        </div>
      </section>

      <section className="claw-section" aria-label="live claw">
        <h2 className="section-label">live claw</h2>
        <p className="section-desc">
          live view of what chud is scanning, holding, or exiting.
        </p>
        <ChudScene state={state} trades={trades} isHappy={isHappy} />
      </section>

      <section className="coach-section" aria-label="talk to chud">
        <h2 className="section-label">talk to chud</h2>
        <p className="section-desc">chat directly with the chud.</p>
        <ChudPanel
          chatMessages={chatMessages}
          chatLlmConfigured={chatLlmConfigured}
          chatSessionId={chatTabSessionId}
          onRefresh={poll}
        />
      </section>

      <section className="balance-chart-section" aria-label="wallet balance over time">
        <h2 className="section-label">wallet balance chart</h2>
        <div className="panel balance-chart-panel">
          <div className="panel-title">[ bot wallet balance - all time ]</div>
          <WalletBalanceChart points={balanceChartPoints} solPriceUsd={solPriceUsd} />
        </div>
      </section>
      <section aria-label="blown port counter">
        <div className="panel stat-box">
          <div className="panel-title">chud damage report</div>
          <div className="stat-value">
            the chud trader has blown his port <u>{blownPortCount}</u>{" "}
            {blownPortCount === 1 ? "time" : "times"}
          </div>
        </div>
      </section>
      </>
      )}

      {page === "feed" && (
        <section className="feed-section" aria-label="live trade feed">
          <h2 className="section-label">live trade feed</h2>
          <p className="section-desc">
            full trade list from the server (polls every few seconds). use &quot;live&quot; for the last 72 hours, &quot;all past&quot; for
            everything on file.
          </p>
          <TradeFeed trades={trades} />
        </section>
      )}

      {page === "logs" && (
        <section aria-label="chud logs">
          <h2 className="section-label">chud logs</h2>
          <div className="panel about-panel">
            <div className="trade-feed trade-feed-rows">
              {logs
                .filter((l) => l.type !== "skip" && !l.message.includes("Trading paused"))
                .map((l) => (
                <div key={l.id} className="trade-feed-row">
                  <div className="trade-feed-row-main">
                    <div className="trade-feed-row-line1">
                      <span className="trade-symbol">{l.type}</span>
                      <span className="trade-feed-row-sep"> · </span>
                      <span>{new Date(l.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="trade-feed-row-why">{l.message}</div>
                    {l.reason && <div className="trade-feed-row-why">chud note: {l.reason}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <footer className="footer">
        <div className="footer-main">
          <SocialLinks />
        </div>
        <p className="footer-text">this chud will make it.</p>
      </footer>
      </div>
    </div>
  );
}
