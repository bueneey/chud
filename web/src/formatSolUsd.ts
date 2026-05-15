const FALLBACK_SOL_USD = 91;

export function formatSolWithUsd(sol: number, solPriceUsd?: number | null): string {
  const px =
    typeof solPriceUsd === "number" && Number.isFinite(solPriceUsd) && solPriceUsd > 0
      ? solPriceUsd
      : FALLBACK_SOL_USD;
  const usd = sol * px;
  const usdStr =
    Math.abs(usd) >= 1000
      ? `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : `$${usd.toFixed(2)}`;
  return `${sol.toFixed(4)} SOL (${usdStr})`;
}
