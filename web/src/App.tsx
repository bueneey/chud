import { useEffect, useState } from "react";
import {
  fetchTrades,
  fetchBalance,
  fetchPnl,
  fetchBalanceChart,
  fetchChudState,
  fetchChudChat,
  fetchLogs,
  fetchChudOutbox,
  type TradeRecord,
  type ChudState,
  type BalanceChartPoint,
  type BalanceChartMeta,
  type ChudChatTurn,
  type LogEntry,
  type ChudOutboxResponse,
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
import { getOrCreateChudChatTabSessionId } from "./chudChatSession";

const POLL_MS = 3000;
type PageView = "home" | "feed" | "logs";

export default function App() {
  const blownPortCount = 1; // manual counter: bump when the chud nukes another port
  const [chatTabSessionId] = useState(() => getOrCreateChudChatTabSessionId());
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [pnl, setPnl] = useState<number>(0);
  const [balanceChartPoints, setBalanceChartPoints] = useState<BalanceChartPoint[]>([]);
  const [balanceChartMeta, setBalanceChartMeta] = useState<BalanceChartMeta | null>(null);
  const [state, setState] = useState<ChudState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChudChatTurn[]>([]);
  const [chatLlmConfigured, setChatLlmConfigured] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [outbox, setOutbox] = useState<ChudOutboxResponse>({ text: null, at: null });
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
    Promise.all([
      fetchTrades(),
      fetchBalance(),
      fetchPnl(),
      fetchBalanceChart(),
      fetchChudState(),
      fetchChudChat(chatTabSessionId).catch(() => ({ messages: [] as ChudChatTurn[], llmConfigured: false })),
      fetchLogs(200).catch(() => [] as LogEntry[]),
      fetchChudOutbox(),
    ])
      .then(([t, b, p, chart, s, chat, logsData, outboxData]) => {
        setTrades(t);
        setBalance(b);
        setPnl(p.totalPnlSol);
        setBalanceChartPoints(chart.points ?? []);
        setBalanceChartMeta(chart.meta ?? null);
        setState(s);
        setChatMessages(chat.messages);
        setChatLlmConfigured(chat.llmConfigured);
        setLogs(logsData);
        setOutbox(outboxData);
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
  }, []);

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
            <div className="stat-value">{balance.toFixed(4)} SOL</div>
            <p className="stat-desc">current wallet (start 1 SOL + pnl)</p>
          </div>
          <div className="panel stat-box">
            <div className="panel-title">total pnl</div>
            <div
              className="stat-value"
              style={{ color: pnl >= 0 ? "var(--green)" : "var(--red)" }}
            >
              {pnl >= 0 ? "+" : ""}{pnl.toFixed(4)} SOL
            </div>
            <p className="stat-desc">sum of all trade pnl</p>
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
        <p className="section-desc">
          full timeline: every closed trade step plus saved on-chain balance samples (same data folder as the bot). polls every few seconds.
        </p>
        <div className="panel balance-chart-panel">
          <div className="panel-title">[ bot wallet balance - all time ]</div>
          <WalletBalanceChart points={balanceChartPoints} meta={balanceChartMeta} />
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
            <p><strong>live chud brain feed</strong>: what openclaw + chud are thinking and doing in real time.</p>
            <p><strong>latest thought</strong>: {outbox.text ?? "no thought posted yet."}</p>
            {outbox.at && <p><strong>thought time</strong>: {new Date(outbox.at).toLocaleString()}</p>}
            <p><strong>live log stream</strong>:</p>
            <div className="trade-feed trade-feed-rows">
              {logs.map((l) => (
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
